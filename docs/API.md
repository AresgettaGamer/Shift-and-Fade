# Shift & Fade Protocol v2 API

Shift & Fade exposes a script-event based teleport API. Third-party add-ons should copy
`sdk/shift_fade_sdk.js` and use it instead of importing runtime internals.

## Request

Event: `shift_fade:request`

Protocol v2 accepts:

- `requestId`: short caller-generated request id.
- `playerId` or `playerName`: player to teleport.
- `x`, `y`, `z`: target coordinates.
- `sourceDimensionId`: expected current dimension.
- `targetDimensionId` / `dimensionId`: destination dimension.
- `style`: `auto`, `grand`, or `twilight`.
- `exactY`: whether the supplied Y must be respected.
- `silent`: suppresses Shift & Fade's optional integration feedback.
- `fallbackOnError`: allows Core to perform its internal fallback after acceptance.
- `teleportNearbyTamed`: requests nearby tamed-companion transport.
- `companionRadius`: 1..32 blocks, default 10.
- `companionEntityIds`: up to 16 explicit loaded entity ids.
- `source`: short integration identifier.
- `soundId` / `animationId`: optional integration metadata.

## Response tags

The SDK observes short-lived tags on the player:

- `sf_ack_<requestId>` — accepted.
- `sf_done_<requestId>` — completed.
- `sf_fail_<requestId>` — failed.

Use `waitForShiftFadeAcceptance()` before charging costs, then
`waitForShiftFadeCompletion()` if the caller needs confirmed arrival.

## Ownership boundary

The integrating add-on owns permissions, costs, cooldowns, menus, waypoint storage,
messages and gameplay rules. Shift & Fade owns the cinematic transition and, when
requested, companion transport.

For cross-dimension companion travel, Release v2.0.0 uses persistent Structure Transit
internally. Consumers must not implement a second companion handoff after Core accepts
the request.

Protocol v1 remains supported for same-dimension compatibility.
