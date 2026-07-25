# Shift & Fade API — Protocol v1

Shift & Fade receives requests through `system.sendScriptEvent` using the event ID:

```text
shift_fade:request
```

Use the provided `sdk/shift_fade_sdk.js` helper instead of constructing payloads manually whenever possible.

## Request payload

```json
{
  "version": 1,
  "requestId": "unique_id",
  "playerId": "runtime-player-id",
  "x": 120,
  "y": 70,
  "z": -350,
  "dimensionId": "minecraft:overworld",
  "style": "auto",
  "exactY": true,
  "silent": true,
  "fallbackOnError": true,
  "teleportNearbyTamed": false,
  "source": "my_addon:waystone",
  "soundId": "namespace:sound",
  "animationId": "namespace:animation"
}
```

## Fields

| Field | Required | Description |
|---|---:|---|
| `version` | Recommended | Protocol version. Current value: `1`. |
| `requestId` | Yes | Up to 32 alphanumeric, `_`, or `-` characters. |
| `playerId` | Yes | Runtime ID of the target player. |
| `x`, `y`, `z` | Yes | Destination coordinates. |
| `dimensionId` | Yes | Must match the player's current dimension. |
| `style` | No | `auto`, `grand`, or `twilight`. |
| `exactY` | No | Use the supplied Y coordinate. Defaults to `true` in the SDK. |
| `silent` | No | Suppress normal Shift & Fade chat messages. |
| `fallbackOnError` | No | Run a normal teleport if the animation fails. |
| `teleportNearbyTamed` | No | Move nearby tamed entities with the player. |
| `source` | No | Identifier used for diagnostics/integration context. |
| `soundId` | No | Optional sound played after teleport. |
| `animationId` | No | Optional player animation played after teleport. |

## Response states

Shift & Fade communicates through temporary player tags:

- `sf_ack_<requestId>` — request accepted.
- `sf_done_<requestId>` — transition completed.
- `sf_fail_<requestId>` — request rejected or failed.

These tags are temporary. Poll them immediately using the SDK helpers.

## Recommended integration flow

1. Validate permissions, destination, and costs in your add-on.
2. Send the Shift & Fade request.
3. Wait for `accepted` before consuming resources or starting cooldowns.
4. Wait for `completed` before showing the final success message.
5. If the request is `failed` or times out, run your original teleport fallback when appropriate.

## Responsibility boundary

Shift & Fade owns the camera transition and actual same-dimension teleport. The integrating add-on owns gameplay rules, permissions, costs, cooldowns, UI, saved destinations, and cross-dimension behavior.
