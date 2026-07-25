import {
    requestShiftFadeTeleport,
    waitForShiftFadeAcceptance,
    waitForShiftFadeCompletion,
} from "../sdk/shift_fade_sdk.js";

export async function teleportFromWaystone(player, destination) {
    // Validate your own permission/cost rules before this point.
    const requestId = requestShiftFadeTeleport(player, destination, {
        style: "auto",
        source: "example:waystone",
        teleportNearbyTamed: true,
        fallbackOnError: true,
    });

    const acceptance = await waitForShiftFadeAcceptance(player, requestId, 60);
    if (acceptance !== "accepted" && acceptance !== "completed") {
        // Shift & Fade is absent, busy, or rejected the request.
        return false;
    }

    // Apply the cost/cooldown here.

    const completion = await waitForShiftFadeCompletion(player, requestId, 500);
    return completion === "completed";
}
