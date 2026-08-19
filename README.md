# Shift & Fade


**Shift & Fade** adds cinematic teleport transitions to Minecraft Bedrock Edition and exposes a lightweight public SDK for other add-ons.

> **Release v2.0.0:** validated stable Core based on the approved Beta v1.2.6 runtime. Protocol v2, Structure Transit, Grand and Twilight are frozen for release.

## Requirements

- Minecraft Bedrock **1.26.30 or newer**
- Behavior Pack and Resource Pack enabled
- Cheats are only required for the public `/sf:*` commands
- No experimental toggles required

## Teleport styles

### Grand
The camera rises above the player, travels toward the destination, hides long or dimensional handoffs behind a black fade, then approaches and descends at the destination.

### Twilight
The camera orbits the player while dark fragments dissolve the body. The teleport happens behind a black fade, followed by a reverse rebuild at the destination.

### Auto
With the world preference set to `auto`:

- Same dimension, up to 1,000 horizontal blocks: Grand
- Same dimension, over 1,000 horizontal blocks: Twilight
- Cross dimension: Twilight

World owners can override Auto globally with `/sf:mode grand` or `/sf:mode twilight`. Explicit SDK requests for `grand` or `twilight` always override the world preference.

## Commands

```mcfunction
/sf:tp <x y z> [auto|grand|twilight]
/sf:dimtp <dimension> <x y z> [auto|grand|twilight]
/sf:send <players> <x y z> [auto|grand|twilight]
/sf:mode [auto|grand|twilight]
/sf:reset [players]
```

Minecraft may report that the command leaf `tp` already exists. This is informational; use the fully namespaced command `/sf:tp`.

## API / SDK — Protocol v2

Copy `sdk/shift_fade_sdk.js` into the add-on that owns the teleport logic. **Do not import Shift & Fade internal runtime modules.**

```js
import {
    requestShiftFadeTeleport,
    waitForShiftFadeAcceptance,
    waitForShiftFadeCompletion,
} from "./shift_fade_sdk.js";

const requestId = requestShiftFadeTeleport(player, {
    x: destination.x,
    y: destination.y,
    z: destination.z,
    dimensionId: destination.dimensionId,
}, {
    style: "auto",
    source: "my_addon:waystone",
    teleportNearbyTamed: true,
    companionRadius: 10,
});

const accepted = await waitForShiftFadeAcceptance(player, requestId);
if (accepted === "accepted" || accepted === "completed") {
    // Apply the integrating add-on's cost/cooldown here.
}

const result = await waitForShiftFadeCompletion(player, requestId);
```

The integrating add-on remains responsible for permissions, costs, cooldowns, menus, messages, waypoint storage, validation, and deciding when a teleport is allowed. Shift & Fade owns only the cinematic transition.

See [`docs/API.md`](docs/API.md) for the complete Protocol v2 payload and behavior.

## Cross-dimension teleporting

Protocol v2 can target another dimension by passing `dimensionId` (or `targetDimensionId`). Shift & Fade preloads the target area and performs the dimensional handoff during the hidden part of the selected transition.

- True Auto uses Twilight for cross-dimension requests.
- Explicit `style: "grand"` uses Grand's hidden dimensional handoff.
- Explicit `style: "twilight"` uses Twilight's dissolve/rebuild handoff.
- `/sf:mode grand|twilight` changes how SDK requests using `style: "auto"` are presented.

Protocol v1 remains supported for same-dimension compatibility.

## Companion transport

Protocol v2 supports:

- `teleportNearbyTamed: true`
- `companionRadius: 1..32`
- `companionEntityIds: [...]` for up to 16 explicit loaded entities

Shift & Fade verifies ownership when the Script API exposes an owner ID. Some Vanilla tamed entities expose only a generic tamed marker after taming; in those cases nearby tamed mobs are accepted as a best-effort fallback. **This means a nearby pet owned by another player can travel too.** Integrations that know the exact companions should use `companionEntityIds`.

Companion transport has two internal paths and the public SDK does not need to know which one is used:

- **Same dimension:** the lightweight Script API + Safe Arrival path is used.
- **Cross dimension:** Release v2.0.0 uses **Structure Transit**. Each companion is staged in the source dimension, stored temporarily as a persistent entity-only world structure, removed only after storage succeeds, then restored in the destination after the player handoff. Safe Arrival is applied only after the restored companion is already in the destination dimension.

Structure Transit avoids relying on direct cross-dimensional `Entity.teleport()` for companions. The frozen Structure Transit core was stress-tested with eight nearby tamed wolves across Overworld, Nether and The End, including repeated Nether → Overworld travel. Transaction rollback keeps the player in the source dimension if the full companion party cannot be stored safely.


## Cinematic audio

Release v2.0.0 adds the finalized cinematic sound pass without changing the approved camera choreography.

- **Grand:** original three-stage audio follows the camera path: rise, horizontal transition and arrival/descent. Camera-relative playback prevents attenuation while the free camera is far from the player entity.
- **Twilight:** departure/dissolve and arrival/rebuild use randomized author-edited variant pools.

The audio pass was validated in runtime after the Structure Transit architecture was frozen.

## Compatibility and fallback design

A good integration should follow this flow:

```text
Player requests teleport
        ↓
Integrating add-on validates permissions/costs/destination
        ↓
Integrating add-on requests Shift & Fade
        ↓
Shift & Fade accepts the request
        ↓
Apply cost/cooldown
        ↓
Cinematic teleport + Shift & Fade-owned companion handling
```

The integrating add-on may keep its original teleport as a **best-effort fallback** when Shift & Fade is missing or rejects the request. The fallback does **not** need to reproduce Shift & Fade feature-for-feature; in particular, integrations should not duplicate Structure Transit or run a second companion handoff after Shift & Fade has already accepted a request.

This keeps gameplay ownership in the integrating add-on while Shift & Fade owns the cinematic transition and, when requested through Protocol v2, the robust companion transport.


## Official reference implementation

**Shift & Fade: Waystones** is the companion gameplay add-on and real-world reference implementation for the public SDK. It is intentionally designed to consume the same SDK available to third-party developers instead of importing Shift & Fade internals.

Its purpose is both to provide a playable Waystone network and to demonstrate how larger teleport systems can be built on top of Protocol v2.

## 🤖 AI-assisted private integrations

You do **not** need to be an experienced JavaScript developer to create a private Shift & Fade compatibility patch for another Bedrock add-on.

This is especially useful when an add-on already has Waystones, Homes, Warps, Fast Travel, Portals, teleport items, admin menus, or another teleport system but **does not natively support the Shift & Fade SDK**.

### What to provide to a coding assistant

Provide the coding assistant with:

1. The **Behavior Pack** of the add-on you want to integrate (`.mcpack`, `.mcaddon`, `.zip`, or source folder).
2. The official **Shift & Fade SDK ZIP** or `sdk/shift_fade_sdk.js`.
3. Tell it exactly which feature performs the teleport.
4. Ask it to inspect the original teleport flow before changing anything.

The integration should preserve the original add-on's:

- Permissions
- XP/currency costs
- Cooldowns
- Messages and sounds
- Waypoint storage
- Menus and UI
- Pet/companion logic when it already has its own system
- Validation and gameplay restrictions

Only the **actual teleport transition** should be handed to Shift & Fade.

### Recommended prompt

> I want to add Shift & Fade compatibility to this Minecraft Bedrock add-on for private use. I attached the add-on and the official Shift & Fade SDK. Read the SDK documentation and analyze how the add-on currently performs its teleport before changing anything. Integrate Shift & Fade only into the actual teleport step, preserve all existing permissions, costs, cooldowns, menus, messages, waypoint storage, pet logic, and restrictions, and keep the original normal teleport as a fallback if Shift & Fade is unavailable or rejects the request. Use only the public SDK; do not import Shift & Fade internal runtime files. Do not modify unrelated systems. When finished, give me the modified installable add-on and explain exactly what changed.

### Private use vs. redistribution

Shift & Fade is MIT licensed, but **the third-party add-on may not be**.

Creating a compatibility build for your own private world/server does not automatically grant permission to publish that modified third-party add-on. Before distributing a patch or modified build, check the original project's license, permissions, and author requirements.

Shift & Fade does **not** grant permission to copy, modify, or redistribute someone else's project.

## Vibrant Visuals

The Resource Pack declares the `pbr` capability so it can coexist with Vibrant Visuals-compatible resource-pack stacks.

## Localization

- English (United States) — `en_US`
- Spanish (Mexico) — `es_MX`

## Source layout

- `BP/` — Behavior Pack runtime.
- `RP/` — Resource Pack, particles and cinematic audio.
- `sdk/shift_fade_sdk.js` — public Protocol v2 helper.
- `docs/API.md` / `docs/API.es.md` — integration contract.

## License

Shift & Fade is licensed under the [MIT License](LICENSE).

## Credits

Created by **AresgettaYT**.

The presentation was conceptually inspired by the Java Edition projects Grand Teleport and Twilight Teleport. Shift & Fade contains its own Bedrock implementation and original assets; no source code or assets from those projects are distributed here.

Minecraft is a trademark of Microsoft. This project is not affiliated with or endorsed by Mojang Studios or Microsoft.
