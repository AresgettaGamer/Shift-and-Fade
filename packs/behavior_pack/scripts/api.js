import { Player, system, world } from "@minecraft/server";
import { emergencyReset, isTransitionActive, startAnimatedTeleport } from "./runtime.js";

const PUBLIC_REQUEST = "shift_fade:request";
const PUBLIC_RESET = "shift_fade:reset";
const LEGACY_WAYSTONE_REQUEST = "animated_tp:waystone";

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
    if (id === PUBLIC_REQUEST) {
        system.run(() => handlePublicRequest(message, sourceEntity));
    } else if (id === LEGACY_WAYSTONE_REQUEST) {
        system.run(() => handleBetterOnBedrockWaystoneRequest(message));
    } else if (id === PUBLIC_RESET && sourceEntity instanceof Player) {
        // /function reset compatibility is handled by the command-facing event.
        system.run(() => emergencyReset(sourceEntity, true));
    }
}, { namespaces: ["shift_fade", "animated_tp"] });

function handlePublicRequest(rawMessage, sourceEntity) {
    const payload = parsePayload(rawMessage);
    if (!payload) return;
    const player = findPlayer(payload, sourceEntity);
    if (!(player instanceof Player)) return;

    const requestId = sanitizeRequestId(payload.requestId);
    if (isTransitionActive(player)) {
        mark(player, "fail", requestId);
        return;
    }
    if (payload.dimensionId && payload.dimensionId !== player.dimension.id) {
        mark(player, "fail", requestId);
        return;
    }

    const x = Number(payload.x), y = Number(payload.y), z = Number(payload.z);
    if (![x, y, z].every(Number.isFinite)) {
        mark(player, "fail", requestId);
        return;
    }

    const accepted = startAnimatedTeleport(player, {
        x, y, z,
        dimension: player.dimension,
        mode: normalizeStyle(payload.style ?? payload.mode),
        exactY: payload.exactY !== false,
        silent: payload.silent !== false,
        fallbackOnError: payload.fallbackOnError !== false,
        integration: {
            source: String(payload.source ?? "external"),
            teleportNearbyTamed: payload.teleportNearbyTamed === true,
            soundId: safeAssetId(payload.soundId),
            animationId: safeAssetId(payload.animationId),
        },
        onComplete: () => mark(player, "done", requestId),
        onFailure: () => mark(player, "fail", requestId),
    });
    if (accepted) mark(player, "ack", requestId);
}

function handleBetterOnBedrockWaystoneRequest(rawMessage) {
    const payload = parsePayload(rawMessage);
    if (!payload) return;
    const player = world.getAllPlayers().find((candidate) => candidate.id === payload.playerId);
    if (!(player instanceof Player) || isTransitionActive(player)) return;
    if (payload.dimensionId !== player.dimension.id) return;

    const x = Number(payload.x), y = Number(payload.y), z = Number(payload.z);
    const requiredLevel = Math.max(0, Math.floor(Number(payload.requiredLevel) || 0));
    if (![x, y, z].every(Number.isFinite) || player.level < requiredLevel) return;

    const requestId = sanitizeRequestId(payload.requestId);
    if (!requestId) return;
    mark(player, "ack", requestId, "shift_fade");

    const warpName = String(payload.warpName ?? "Waystone").slice(0, 96);
    try { player.addLevels(-requiredLevel); } catch (_) {}
    try { player.startItemCooldown("marker", 600); } catch (_) {}
    try {
        player.sendMessage([{ text: "§u[!] §r" }, { translate: "bob.message.waystone.teleporting", with: [warpName] }]);
    } catch (_) {}

    startAnimatedTeleport(player, {
        x, y, z,
        dimension: player.dimension,
        mode: "auto",
        exactY: true,
        silent: true,
        fallbackOnError: true,
        integration: {
            source: "better_on_bedrock:waystone",
            warpName,
            teleportNearbyTamed: true,
            soundId: "block.better_on_bedrock:waystone.teleport",
            animationId: "animation.waystone_teleport",
        },
    });
}

function parsePayload(raw) {
    try { return JSON.parse(raw); }
    catch (error) { console.warn(`[Shift & Fade API] Solicitud inválida: ${error}`); return undefined; }
}
function findPlayer(payload, sourceEntity) {
    if (payload.playerId) return world.getAllPlayers().find((p) => p.id === payload.playerId);
    if (payload.playerName) return world.getAllPlayers().find((p) => p.name === payload.playerName);
    return sourceEntity instanceof Player ? sourceEntity : undefined;
}
function normalizeStyle(value) {
    const style = String(value ?? "auto").toLowerCase();
    return style === "grand" || style === "twilight" ? style : "auto";
}
function safeAssetId(value) {
    if (typeof value !== "string") return undefined;
    return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value) ? value : undefined;
}
function sanitizeRequestId(value) {
    return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}
function mark(player, state, requestId, prefix = "sf") {
    if (!requestId) return;
    const tag = `${prefix}_${state}_${requestId}`;
    try { player.addTag(tag); } catch (_) { return; }
    system.runTimeout(() => { try { if (player.hasTag(tag)) player.removeTag(tag); } catch (_) {} }, state === "ack" ? 40 : 100);
}
