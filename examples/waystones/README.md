# Shift & Fade: Waystones v1.0.0

**Shift & Fade: Waystones** is a fully playable companion add-on and the official gameplay reference/demo for the public **Shift & Fade Protocol v2 SDK**.

It is intentionally built as a real consumer of the same copy-in SDK available to third-party creators. It does not import Shift & Fade internals. The add-on can therefore be used as normal survival/multiplayer content while also serving as a practical example of how to build larger teleport networks on top of Shift & Fade.

## Gameplay

- Place private or public Waystones, rename them, discover natural points and build a persistent destination network.
- Travel cost scales by distance: 1 XP level per 500 blocks in the same dimension, capped at 6; cross-dimensional Waystone travel costs 6 levels.
- Favorite destinations and per-player discovery state.
- Warp Stone for portable travel.
- Return Scroll, Death Scroll and Home Scroll.
- Linked Teleport Pads with no XP travel cost and anti-bounce handling.
- Natural wilderness Waystones in the Overworld.
- Runtime village sanctuaries with biome-aware variants.
- PBR/Vibrant Visuals-ready assets and custom interaction audio.

## Shift & Fade integration

When **Shift & Fade** is installed, Waystones routes travel through the public Protocol v2 SDK for cinematic Grand/Twilight teleport presentation and the transport/safety behavior implemented by Core.

When Shift & Fade is absent, Waystones keeps a player-only instant fallback so the gameplay add-on remains usable. For the intended reference/demo experience, installing Shift & Fade is strongly recommended.

## Optional WATI integration

Waystones includes optional providers for:

- **WATI Core / Codex** — public blocks, items and natural/village structure knowledge.
- **WATI Lens** — localized identity plus dynamic Waystone and Teleport Pad state, including registered names, access, discovery/favorite state, visible destinations and pad links.

WATI is not required for gameplay.

## Compatibility

- Minecraft Bedrock 26.40 / engine 1.26.40+
- `@minecraft/server` 2.8.0 (runtime may promote to the installed stable binding)
- `@minecraft/server-ui` 2.1.0
- Singleplayer and multiplayer/server use
- Mexican Spanish and US English

## Project status

v1.0.0 is the first stable public release, promoted from the runtime-approved Beta v0.9.8 line. The stable promotion does not redesign approved travel, generation, audio, UI, persistence or Provider behavior.

## Repository placement

The Shift & Fade repository may keep this project under `examples/waystones/` as the official playable SDK reference. It is also distributed as its own CurseForge add-on because it is complete gameplay content rather than only a code snippet.

## License

MIT License. Copyright (c) 2026 AresgettaYT.
