import { system } from "@minecraft/server";

const REQUEST_EVENT = "shift_fade:request";
const PROTOCOL_VERSION = 2;
let sequence = 1;

/**
 * Requests a Shift & Fade animated teleport.
 * Protocol v2 supports cross-dimension destinations.
 *
 * The integrating add-on remains responsible for permissions, costs, cooldowns,
 * UI and deciding whether the teleport should be allowed.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{x:number,y:number,z:number,dimensionId?:string,dimension?:{id:string}}} destination
 * @param {object} [options]
 * @param {"auto"|"grand"|"twilight"} [options.style] "auto" respects the Shift & Fade world preference; explicit grand/twilight overrides it.
 * @param {string} [options.targetDimensionId]
 * @param {boolean} [options.exactY]
 * @param {boolean} [options.silent]
 * @param {boolean} [options.fallbackOnError]
 * @param {boolean} [options.teleportNearbyTamed] Auto-select nearby tamed entities. Ownership is enforced when exposed by Script API; Vanilla is_tamed-only pets use proximity as a best-effort fallback.
 * @param {number} [options.companionRadius] 1..32 blocks, default 10.
 * @param {string[]} [options.companionEntityIds] Explicit loaded companion entity IDs, max 16.
 * @param {string} [options.source]
 * @param {string} [options.soundId]
 * @param {string} [options.animationId]
 * @returns {string} request id used to read temporary response tags
 */
export function requestShiftFadeTeleport(player, destination, options = {}) {
    const requestId = sanitize(options.requestId ?? `${Date.now().toString(36)}${sequence++}`);
    const targetDimensionId = String(
        options.targetDimensionId
        ?? destination.dimensionId
        ?? destination.dimension?.id
        ?? player.dimension.id
    );
    const payload = {
        version: PROTOCOL_VERSION,
        requestId,
        playerId: player.id,
        x: destination.x,
        y: destination.y,
        z: destination.z,
        sourceDimensionId: player.dimension.id,
        targetDimensionId,
        // Keep dimensionId as a safety guard for v1 runtimes: an old Shift & Fade will reject
        // cross-dimension v2 requests instead of accidentally teleporting to the same dimension.
        dimensionId: targetDimensionId,
        style: options.style ?? "auto",
        exactY: options.exactY ?? true,
        silent: options.silent ?? true,
        fallbackOnError: options.fallbackOnError ?? true,
        teleportNearbyTamed: options.teleportNearbyTamed ?? false,
        companionRadius: clamp(Number(options.companionRadius) || 10, 1, 32),
        companionEntityIds: Array.isArray(options.companionEntityIds)
            ? options.companionEntityIds.slice(0, 16).map(String)
            : undefined,
        source: options.source ?? "external",
        soundId: options.soundId,
        animationId: options.animationId,
    };

    system.sendScriptEvent(REQUEST_EVENT, JSON.stringify(payload));
    return requestId;
}

/** @returns {"pending"|"accepted"|"completed"|"failed"} */
export function getShiftFadeRequestState(player, requestId) {
    const id = sanitize(requestId);
    if (player.hasTag(`sf_done_${id}`)) return "completed";
    if (player.hasTag(`sf_fail_${id}`)) return "failed";
    if (player.hasTag(`sf_ack_${id}`)) return "accepted";
    return "pending";
}

export async function waitForShiftFadeAcceptance(player, requestId, timeoutTicks = 60) {
    return waitForState(player, requestId, timeoutTicks, true);
}

export async function waitForShiftFadeCompletion(player, requestId, timeoutTicks = 500) {
    return waitForState(player, requestId, timeoutTicks, false);
}

async function waitForState(player, requestId, timeoutTicks, resolveOnAcceptance) {
    const limit = Math.max(1, Math.floor(Number(timeoutTicks) || 1));
    for (let tick = 0; tick <= limit; tick++) {
        const state = getShiftFadeRequestState(player, requestId);
        if (state === "failed" || state === "completed") return state;
        if (resolveOnAcceptance && state === "accepted") return state;
        await delayTicks(1);
    }
    return "timeout";
}

function delayTicks(ticks) {
    return new Promise((resolve) => system.runTimeout(resolve, ticks));
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function sanitize(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}
