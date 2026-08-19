import { Player, system, world } from "@minecraft/server";
import { emergencyReset, isTransitionActive, startAnimatedTeleport } from "./runtime.js";
import { BUILD_LABEL } from "./settings.js";

const PUBLIC_REQUEST = "shift_fade:request";
const PUBLIC_RESET = "shift_fade:reset";
const LEGACY_WAYSTONE_REQUEST = "animated_tp:waystone";
const API_PROTOCOL = 2;

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
    if (id === PUBLIC_REQUEST) {
        system.run(() => handlePublicRequest(message, sourceEntity));
    } else if (id === LEGACY_WAYSTONE_REQUEST) {
        system.run(() => handleBetterOnBedrockWaystoneRequest(message));
    } else if (id === PUBLIC_RESET && sourceEntity instanceof Player) {
        system.run(() => emergencyReset(sourceEntity, true));
    }
}, { namespaces: ["shift_fade", "animated_tp"] });

function handlePublicRequest(rawMessage, sourceEntity) {
    const payload = parsePayload(rawMessage);
    if (!payload) return;
    const player = findPlayer(payload, sourceEntity);
    if (!(player instanceof Player)) return;

    const requestId = sanitizeRequestId(payload.requestId);
    const protocol = normalizeProtocol(payload.version);
    if (isTransitionActive(player)) return reject(player, requestId, "transition_active");

    const sourceDimensionId = String(payload.sourceDimensionId ?? player.dimension.id);
    if (sourceDimensionId !== player.dimension.id) {
        return reject(player, requestId, `source_dimension_mismatch:${sourceDimensionId}`);
    }

    // Protocol v1 semantics are intentionally preserved: dimensionId must be the current dimension.
    // Protocol v2 adds targetDimensionId for cross-dimension transitions.
    const legacyDimensionId = typeof payload.dimensionId === "string" ? payload.dimensionId : undefined;
    if (protocol < 2 && legacyDimensionId && legacyDimensionId !== player.dimension.id) {
        return reject(player, requestId, "v1_cross_dimension_not_supported");
    }

    const targetDimensionId = protocol >= 2
        ? String(payload.targetDimensionId ?? legacyDimensionId ?? player.dimension.id)
        : player.dimension.id;
    const targetDimension = getDimensionSafe(targetDimensionId);
    if (!targetDimension) return reject(player, requestId, `invalid_target_dimension:${targetDimensionId}`);

    const x = Number(payload.x), y = Number(payload.y), z = Number(payload.z);
    if (![x, y, z].every(Number.isFinite)) return reject(player, requestId, "invalid_coordinates");

    const companionEntityIds = sanitizeEntityIds(payload.companionEntityIds);
    const source = String(payload.source ?? "external").slice(0, 96);
    const requestedStyle = normalizeStyle(payload.style ?? payload.mode);

    console.warn(`[Shift & Fade ${BUILD_LABEL}] API v${protocol} ${player.dimension.id} -> ${targetDimension.id} style=${requestedStyle} source=${source}`);

    const accepted = startAnimatedTeleport(player, {
        x, y, z,
        dimension: targetDimension,
        mode: requestedStyle,
        exactY: payload.exactY !== false,
        silent: payload.silent !== false,
        fallbackOnError: payload.fallbackOnError !== false,
        integration: {
            source,
            teleportNearbyTamed: payload.teleportNearbyTamed === true,
            companionRadius: clampNumber(payload.companionRadius, 1, 32, 10),
            companionEntityIds,
            soundId: safeAssetId(payload.soundId),
            animationId: safeAssetId(payload.animationId),
        },
        onComplete: () => mark(player, "done", requestId),
        onFailure: () => mark(player, "fail", requestId),
    });
    if (accepted) mark(player, "ack", requestId);
    else reject(player, requestId, "runtime_rejected");
}

// Compatibility bridge for the first private Better on Bedrock integration.
// It remains available so existing worlds do not break; new integrations should use shift_fade:request v2.
function handleBetterOnBedrockWaystoneRequest(rawMessage) {
    const payload = parsePayload(rawMessage);
    if (!payload) return;
    const player = world.getAllPlayers().find((candidate) => candidate.id === payload.playerId);
    if (!(player instanceof Player) || isTransitionActive(player)) return;

    const targetDimension = getDimensionSafe(String(payload.dimensionId ?? player.dimension.id));
    if (!targetDimension) return;

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
        dimension: targetDimension,
        mode: "auto",
        exactY: true,
        silent: true,
        fallbackOnError: true,
        integration: {
            source: "better_on_bedrock:waystone:legacy",
            teleportNearbyTamed: true,
            companionRadius: 10,
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
function getDimensionSafe(id) {
    try { return world.getDimension(id); }
    catch (_) { return undefined; }
}
function normalizeProtocol(value) {
    const version = Math.floor(Number(value) || 1);
    return version >= API_PROTOCOL ? API_PROTOCOL : 1;
}
function normalizeStyle(value) {
    const style = String(value ?? "auto").toLowerCase();
    return style === "grand" || style === "twilight" ? style : "auto";
}
function safeAssetId(value) {
    if (typeof value !== "string") return undefined;
    return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value) ? value : undefined;
}
function sanitizeEntityIds(value) {
    if (!Array.isArray(value)) return [];
    const unique = [];
    for (const raw of value) {
        const id = String(raw ?? "").slice(0, 128);
        if (!id || unique.includes(id)) continue;
        unique.push(id);
        if (unique.length >= 16) break;
    }
    return unique;
}
function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function sanitizeRequestId(value) {
    return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}
function reject(player, requestId, reason) {
    console.warn(`[Shift & Fade ${BUILD_LABEL}] Solicitud rechazada: ${reason}`);
    mark(player, "fail", requestId);
}
function mark(player, state, requestId, prefix = "sf") {
    if (!requestId) return;
    const tag = `${prefix}_${state}_${requestId}`;
    try { player.addTag(tag); } catch (_) { return; }
    system.runTimeout(() => { try { if (player.hasTag(tag)) player.removeTag(tag); } catch (_) {} }, state === "ack" ? 40 : 100);
}
