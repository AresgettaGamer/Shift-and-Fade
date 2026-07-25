# Changelog

## v1.0.0 — Public Release

- Promotes the approved Release Candidate to the first public release.
- Replaces the temporary project artwork with the final Shift & Fade cover.
- Updates the minimum supported game version to Minecraft Bedrock 1.26.30, matching `@minecraft/server` 2.8.0.
- Publishes the standalone commands and protocol v1 SDK.
- Keeps the tested cinematic runtime unchanged.

## RC v0.3.0 — Public Candidate

- Removed the test item, test menu, and predefined test destinations.
- Added `/sf:tp`, `/sf:send`, and `/sf:reset`.
- Separated runtime, commands, and external API modules.
- Added public `shift_fade:request` protocol support.
- Added dark Twilight particles.
- Removed the `@minecraft/server-ui` dependency.

## Beta v0.2.0 — Integration

- Added the first tested Waystone integration.
- Added PBR/Vibrant Visuals compatibility.
- Preserved costs, cooldowns, messages, sounds, and nearby tamed-entity transport in the private server integration.

## Beta v0.1.3 — Approved Core

- Added continuous 64-block visible Grand travel on departure and arrival.
- Simplified the final Twilight camera return.
- Renamed the project to Shift & Fade.

## Beta v0.1.2

- Rebuilt Grand ascent/descent as strictly vertical stages.
- Added terrain-aware Twilight orbit selection.
- Fixed custom destination forms and particle Molang errors.

## Beta v0.1.1

- Replaced spline spirals with staged camera movement and circular Twilight orbits.
- Fixed the controller icon and deprecated item components used by the test build.

## Beta v0.1.0 — Prototype

- First Grand and Twilight teleport animation prototypes.
- Added destination preloading, camera/input recovery, particles, and fallback teleport behavior.
