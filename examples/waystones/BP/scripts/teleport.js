import { world } from "@minecraft/server";
import { clearDeathAnchor, clearReturnAnchor, setReturnAnchor } from "./storage.js";
import { resolvePersonalHomeAnchor } from "./home_safety.js";
import {
    requestShiftFadeTeleport,
    waitForShiftFadeAcceptance,
    waitForShiftFadeCompletion,
} from "./shift_fade_sdk.js";

const activeTeleports = new Set();
const SAME_DIMENSION_BLOCKS_PER_LEVEL = 500;
const SAME_DIMENSION_MAX_COST = 6;
const CROSS_DIMENSION_COST = 6;
const COMPANION_RADIUS = 10;
const BUILD_LABEL = "Release v1.0.0";

export function getTeleportCost(player, record) {
    if (record.dimensionId !== player.dimension.id) return CROSS_DIMENSION_COST;
    const dx = player.location.x - (record.x + 0.5);
    const dz = player.location.z - (record.z + 0.5);
    const distance = Math.hypot(dx, dz);
    return Math.max(1, Math.min(SAME_DIMENSION_MAX_COST, Math.ceil(distance / SAME_DIMENSION_BLOCKS_PER_LEVEL)));
}

export async function teleportToWaystone(player, record) {
    if (activeTeleports.has(player.id)) return { ok: false, reason: "busy" };

    const returnAnchor = captureCurrentAnchor(player);

    const requiredLevel = getTeleportCost(player, record);
    if (player.level < requiredLevel) {
        return { ok: false, reason: "not_enough_levels", requiredLevel };
    }

    activeTeleports.add(player.id);
    try {
        const destination = {
            x: record.x + 0.5,
            y: record.y + 0.10,
            z: record.z + 0.5,
            dimensionId: record.dimensionId,
        };

        let requestId;
        try {
            // Waystones deliberately delegates companion transport to the public Shift & Fade SDK.
            // Beta v1.2.2+ owns robust cross-dimensional Structure Transit internally; this consumer
            // only requests nearby tamed companions and does not reimplement the Core handoff.
            requestId = requestShiftFadeTeleport(player, destination, {
                targetDimensionId: record.dimensionId,
                style: "auto",
                exactY: true,
                silent: true,
                fallbackOnError: true,
                teleportNearbyTamed: true,
                companionRadius: COMPANION_RADIUS,
                source: "shift_fade_waystones:waystone",
            });
        } catch (_) {
            requestId = undefined;
        }

        if (requestId) {
            const acceptance = await waitForShiftFadeAcceptance(player, requestId, 12);
            if (acceptance === "accepted" || acceptance === "completed") {
                chargeLevels(player, requiredLevel);
                // Keep this Waystones request locked for the lifetime of the transition, but never
                // issue a second fallback after Shift & Fade has accepted it. Shift & Fade owns its
                // own fallbackOnError path once accepted.
                const completion = acceptance === "completed"
                    ? "completed"
                    : await waitForShiftFadeCompletion(player, requestId, 520);
                // Return Scroll anchors are new in v0.3.0. Store the origin only after Core reports
                // completion, so a canceled Structure Transit does not create a false return point.
                if (completion === "completed") setReturnAnchor(player, returnAnchor);
                return { ok: true, cinematic: true, cost: requiredLevel };
            }
        }

        const fallback = teleportPlayerOnlyFallback(player, record, destination);
        if (!fallback.ok) return { ok: false, reason: "fallback_failed" };
        setReturnAnchor(player, returnAnchor);
        chargeLevels(player, requiredLevel);
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Instant player-only fallback`);
        return { ok: true, cinematic: false, cost: requiredLevel };
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport failed: ${error}`);
        return { ok: false, reason: "exception" };
    } finally {
        activeTeleports.delete(player.id);
    }
}

function teleportPlayerOnlyFallback(player, record, destination) {
    let dimension;
    try { dimension = world.getDimension(record.dimensionId); }
    catch (_) { return { ok: false }; }

    const target = { x: destination.x, y: destination.y, z: destination.z };

    try {
        player.camera.fade({
            fadeColor: { red: 0, green: 0, blue: 0 },
            fadeTime: { fadeInTime: 0, holdTime: 0.25, fadeOutTime: 0.25 },
        });
    } catch (_) {}

    // Standalone fallback is intentionally player-only. Robust companion handling belongs to
    // Shift & Fade Core and is not reimplemented in the Waystones add-on.
    try {
        player.teleport(target, {
            dimension,
            rotation: player.getRotation(),
            keepVelocity: false,
            checkForBlocks: false,
        });
    } catch (_) {
        return { ok: false };
    }

    return { ok: true };
}


export async function teleportToReturnAnchor(player, anchor) {
    if (activeTeleports.has(player.id)) return { ok: false, reason: "busy" };
    if (!anchor || typeof anchor.dimensionId !== "string") return { ok: false, reason: "no_anchor" };

    activeTeleports.add(player.id);
    try {
        const destination = {
            x: anchor.x, y: anchor.y, z: anchor.z,
            dimensionId: anchor.dimensionId,
        };

        let requestId;
        try {
            requestId = requestShiftFadeTeleport(player, destination, {
                targetDimensionId: anchor.dimensionId,
                style: "auto",
                exactY: true,
                silent: true,
                fallbackOnError: true,
                teleportNearbyTamed: true,
                companionRadius: COMPANION_RADIUS,
                source: "shift_fade_waystones:return_scroll",
            });
        } catch (_) {
            requestId = undefined;
        }

        if (requestId) {
            const acceptance = await waitForShiftFadeAcceptance(player, requestId, 12);
            if (acceptance === "accepted" || acceptance === "completed") {
                const completion = acceptance === "completed"
                    ? "completed"
                    : await waitForShiftFadeCompletion(player, requestId, 520);
                if (completion !== "completed") return { ok: false, reason: "core_failed" };
                clearReturnAnchor(player);
                return { ok: true, cinematic: true };
            }
        }

        let dimension;
        try { dimension = world.getDimension(anchor.dimensionId); }
        catch (_) { return { ok: false, reason: "fallback_failed" }; }

        try {
            player.camera.fade({
                fadeColor: { red: 0, green: 0, blue: 0 },
                fadeTime: { fadeInTime: 0, holdTime: 0.25, fadeOutTime: 0.25 },
            });
        } catch (_) {}

        try {
            player.teleport({ x: anchor.x, y: anchor.y, z: anchor.z }, {
                dimension,
                rotation: { x: anchor.rotationX ?? 0, y: anchor.rotationY ?? 0 },
                keepVelocity: false,
                checkForBlocks: false,
            });
        } catch (_) {
            return { ok: false, reason: "fallback_failed" };
        }

        clearReturnAnchor(player);
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Return Scroll instant player-only fallback`);
        return { ok: true, cinematic: false };
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Return Scroll failed: ${error}`);
        return { ok: false, reason: "exception" };
    } finally {
        activeTeleports.delete(player.id);
    }
}


export async function teleportToDeathAnchor(player, anchor) {
    if (activeTeleports.has(player.id)) return { ok: false, reason: "busy" };
    if (!anchor || typeof anchor.dimensionId !== "string") return { ok: false, reason: "no_anchor" };
    // Death Scroll never blindly teleports to a legacy/unresolved death coordinate. A missing
    // safe destination is safer to refuse than to deliberately kill the player a second time.
    if (anchor.safeResolved !== true) return { ok: false, reason: "unsafe_anchor" };

    activeTeleports.add(player.id);
    try {
        const destination = {
            x: anchor.x, y: anchor.y + 0.15, z: anchor.z,
            dimensionId: anchor.dimensionId,
        };

        let requestId;
        try {
            requestId = requestShiftFadeTeleport(player, destination, {
                targetDimensionId: anchor.dimensionId,
                style: "auto",
                exactY: true,
                silent: true,
                fallbackOnError: true,
                teleportNearbyTamed: true,
                companionRadius: COMPANION_RADIUS,
                source: "shift_fade_waystones:death_scroll",
            });
        } catch (_) {
            requestId = undefined;
        }

        if (requestId) {
            const acceptance = await waitForShiftFadeAcceptance(player, requestId, 12);
            if (acceptance === "accepted" || acceptance === "completed") {
                const completion = acceptance === "completed"
                    ? "completed"
                    : await waitForShiftFadeCompletion(player, requestId, 520);
                if (completion !== "completed") return { ok: false, reason: "core_failed" };
                clearDeathAnchor(player);
                return { ok: true, cinematic: true };
            }
        }

        let dimension;
        try { dimension = world.getDimension(anchor.dimensionId); }
        catch (_) { return { ok: false, reason: "fallback_failed" }; }

        try {
            player.camera.fade({
                fadeColor: { red: 0, green: 0, blue: 0 },
                fadeTime: { fadeInTime: 0, holdTime: 0.25, fadeOutTime: 0.25 },
            });
        } catch (_) {}

        try {
            player.teleport({ x: anchor.x, y: anchor.y + 0.15, z: anchor.z }, {
                dimension,
                rotation: { x: anchor.rotationX ?? 0, y: anchor.rotationY ?? 0 },
                keepVelocity: false,
                checkForBlocks: false,
            });
        } catch (_) {
            return { ok: false, reason: "fallback_failed" };
        }

        clearDeathAnchor(player);
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Death Scroll instant player-only fallback`);
        return { ok: true, cinematic: false };
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Death Scroll failed: ${error}`);
        return { ok: false, reason: "exception" };
    } finally {
        activeTeleports.delete(player.id);
    }
}


export async function teleportToHome(player) {
    if (activeTeleports.has(player.id)) return { ok: false, reason: "busy" };

    let home;
    try {
        const personal = player.getSpawnPoint();
        if (personal) {
            const resolved = await resolvePersonalHomeAnchor(personal, player.id);
            if (resolved.status === "ok") {
                home = resolved.home;
                console.warn(
                    `[Shift & Fade: Waystones ${BUILD_LABEL}] Home resolution mode=personal_safe ` +
                    `anchor=${home.anchorType}@${home.anchorX},${home.anchorY},${home.anchorZ} ` +
                    `target=${Math.floor(home.x)},${Math.floor(home.y)},${Math.floor(home.z)}`
                );
            } else if (resolved.status === "missing_anchor") {
                home = makeWorldSpawnHome("world_spawn_invalid_personal");
                console.warn(
                    `[Shift & Fade: Waystones ${BUILD_LABEL}] Home resolution mode=world_spawn_invalid_personal ` +
                    `reason=stored respawn block no longer exists`
                );
            } else {
                console.warn(
                    `[Shift & Fade: Waystones ${BUILD_LABEL}] Home resolution refused status=${resolved.status}`
                );
                return { ok: false, reason: "no_safe_anchor" };
            }
        } else {
            home = makeWorldSpawnHome("world_spawn");
            console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Home resolution mode=world_spawn`);
        }
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Home resolution failed: ${error}`);
        return { ok: false, reason: "no_safe_anchor" };
    }

    activeTeleports.add(player.id);
    try {
        const destination = {
            x: home.x,
            y: home.y,
            z: home.z,
            dimensionId: home.dimensionId,
        };

        let requestId;
        try {
            requestId = requestShiftFadeTeleport(player, destination, {
                targetDimensionId: home.dimensionId,
                style: "auto",
                exactY: home.exactY !== false,
                silent: true,
                fallbackOnError: true,
                teleportNearbyTamed: true,
                companionRadius: COMPANION_RADIUS,
                source: "shift_fade_waystones:home_scroll",
            });
        } catch (_) {
            requestId = undefined;
        }

        if (requestId) {
            const acceptance = await waitForShiftFadeAcceptance(player, requestId, 12);
            if (acceptance === "accepted" || acceptance === "completed") {
                const completion = acceptance === "completed"
                    ? "completed"
                    : await waitForShiftFadeCompletion(player, requestId, 520);
                if (completion !== "completed") return { ok: false, reason: "core_failed" };
                return { ok: true, cinematic: true, homeMode: home.homeMode };
            }
        }

        let dimension;
        try { dimension = world.getDimension(home.dimensionId); }
        catch (_) { return { ok: false, reason: "fallback_failed" }; }

        let fallbackTarget = { x: home.x, y: home.y, z: home.z };
        if (home.exactY === false) {
            try {
                const top = dimension.getTopmostBlock({ x: Math.floor(home.x), z: Math.floor(home.z) });
                if (!top) return { ok: false, reason: "fallback_failed" };
                fallbackTarget = {
                    x: Math.floor(home.x) + 0.5,
                    y: top.location.y + 1,
                    z: Math.floor(home.z) + 0.5,
                };
            } catch (_) {
                return { ok: false, reason: "fallback_failed" };
            }
        }

        try {
            player.camera.fade({
                fadeColor: { red: 0, green: 0, blue: 0 },
                fadeTime: { fadeInTime: 0, holdTime: 0.25, fadeOutTime: 0.25 },
            });
        } catch (_) {}

        try {
            player.teleport(fallbackTarget, {
                dimension,
                rotation: { x: home.rotationX ?? 0, y: home.rotationY ?? 0 },
                keepVelocity: false,
                checkForBlocks: false,
            });
        } catch (_) {
            return { ok: false, reason: "fallback_failed" };
        }

        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Home Scroll instant player-only fallback`);
        return { ok: true, cinematic: false, homeMode: home.homeMode };
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Home Scroll failed: ${error}`);
        return { ok: false, reason: "exception" };
    } finally {
        activeTeleports.delete(player.id);
    }
}


function makeWorldSpawnHome(homeMode = "world_spawn") {
    const worldSpawn = world.getDefaultSpawnLocation();
    return {
        dimensionId: "minecraft:overworld",
        x: worldSpawn.x + 0.5,
        y: Number.isFinite(worldSpawn.y) ? worldSpawn.y : 0,
        z: worldSpawn.z + 0.5,
        rotationX: 0,
        rotationY: 0,
        exactY: false,
        homeMode,
        safeResolved: true,
    };
}

function captureCurrentAnchor(player) {
    const location = player.location;
    const rotation = player.getRotation();
    return {
        dimensionId: player.dimension.id,
        x: location.x, y: location.y, z: location.z,
        rotationX: rotation.x, rotationY: rotation.y,
    };
}

function chargeLevels(player, levels) {
    if (levels <= 0) return;
    try { player.addLevels(-levels); } catch (_) {}
}


export async function teleportViaPad(player, sourcePad, targetPad) {
    if (activeTeleports.has(player.id)) return { ok: false, reason: "busy" };
    if (!sourcePad || !targetPad || sourcePad.linkId !== targetPad.id || targetPad.linkId !== sourcePad.id) {
        return { ok: false, reason: "unlinked" };
    }

    activeTeleports.add(player.id);
    try {
        const destination = {
            x: targetPad.x + 0.5,
            y: targetPad.y + 0.28,
            z: targetPad.z + 0.5,
            dimensionId: targetPad.dimensionId,
        };

        let requestId;
        try {
            requestId = requestShiftFadeTeleport(player, destination, {
                targetDimensionId: targetPad.dimensionId,
                style: "auto",
                exactY: true,
                silent: true,
                fallbackOnError: true,
                teleportNearbyTamed: true,
                companionRadius: COMPANION_RADIUS,
                source: "shift_fade_waystones:teleport_pad",
            });
        } catch (_) {
            requestId = undefined;
        }

        if (requestId) {
            const acceptance = await waitForShiftFadeAcceptance(player, requestId, 12);
            if (acceptance === "accepted" || acceptance === "completed") {
                const completion = acceptance === "completed"
                    ? "completed"
                    : await waitForShiftFadeCompletion(player, requestId, 520);
                if (completion !== "completed") return { ok: false, reason: "core_failed" };
                return { ok: true, cinematic: true };
            }
        }

        let dimension;
        try { dimension = world.getDimension(targetPad.dimensionId); }
        catch (_) { return { ok: false, reason: "fallback_failed" }; }

        try {
            player.camera.fade({
                fadeColor: { red: 0, green: 0, blue: 0 },
                fadeTime: { fadeInTime: 0, holdTime: 0.20, fadeOutTime: 0.25 },
            });
        } catch (_) {}

        try {
            player.teleport(destination, {
                dimension,
                rotation: player.getRotation(),
                keepVelocity: false,
                checkForBlocks: false,
            });
        } catch (_) {
            return { ok: false, reason: "fallback_failed" };
        }

        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport Pad instant player-only fallback`);
        return { ok: true, cinematic: false };
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport Pad failed: ${error}`);
        return { ok: false, reason: "exception" };
    } finally {
        activeTeleports.delete(player.id);
    }
}
