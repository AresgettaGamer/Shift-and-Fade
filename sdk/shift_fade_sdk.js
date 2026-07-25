import { system } from "@minecraft/server";

const REQUEST_EVENT = "shift_fade:request";
let sequence = 1;

/**
 * Requests an animated teleport from Shift & Fade in the player's current dimension.
 * The integrating add-on remains responsible for costs, cooldowns, permissions, and UI.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{x:number,y:number,z:number}} destination
 * @param {object} [options]
 * @returns {string} request id used to read the temporary response tags
 */
export function requestShiftFadeTeleport(player, destination, options = {}) {
    const requestId = sanitize(options.requestId ?? `${Date.now().toString(36)}${sequence++}`);
    const payload = {
        version: 1,
        requestId,
        playerId: player.id,
        x: destination.x,
        y: destination.y,
        z: destination.z,
        dimensionId: player.dimension.id,
        style: options.style ?? "auto",
        exactY: options.exactY ?? true,
        silent: options.silent ?? true,
        fallbackOnError: options.fallbackOnError ?? true,
        teleportNearbyTamed: options.teleportNearbyTamed ?? false,
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

/**
 * Waits until Shift & Fade accepts/rejects the request.
 * Returns "accepted", "completed", "failed", or "timeout".
 */
export async function waitForShiftFadeAcceptance(player, requestId, timeoutTicks = 60) {
    return waitForState(player, requestId, timeoutTicks, true);
}

/**
 * Waits until the transition finishes.
 * Returns "completed", "failed", or "timeout".
 */
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

function sanitize(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}
