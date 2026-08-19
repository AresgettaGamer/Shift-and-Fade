# Shift & Fade — Changelog

## Release v2.0.0

Release v2.0.0 promotes the fully validated Beta v1.2.6 Core without redesigning the approved teleport runtime.

### Added / finalized
- Public Protocol v2 SDK with cross-dimension destinations.
- Robust companion transport:
  - same-dimension Safe Arrival path;
  - cross-dimension persistent Structure Transit with rollback-safe staging/restoration;
  - nearby tamed companions and explicit `companionEntityIds`.
- Final Grand cinematic audio pass:
  - rise cue;
  - horizontal transition cue(s);
  - arrival/descent cue;
  - camera-path-relative sound positioning so free-camera distance does not attenuate late cues.
- Final Twilight departure and arrival/rebuild audio variant pools.
- Focused Content Log warnings for custom cinematic sound playback failures.

### Validated
- Eight-wolf Structure Transit stress routes across Overworld, Nether and The End, including Nether -> Overworld returns.
- Shift & Fade: Waystones consumer integration through the same public Protocol v2 SDK used by third-party add-ons.
- Grand and Twilight cinematic transitions, including the final audio pass.
- Better on Bedrock compatibility bridge remains available for existing private integrations.

### Compatibility
- Protocol v1 remains supported for same-dimension integrations.
- Protocol v2 is the recommended public API.
- The integrating add-on remains responsible for gameplay rules, costs, cooldowns, UI and waypoint storage.
- Shift & Fade owns the cinematic transition and requested companion transport after acceptance.

### Release packaging
- Manifest, modules and BP/RP dependency promoted to `2.0.0`.
- Visible Beta labels removed.
- English and Spanish README files included in source.
- Public SDK and Protocol v2 API documentation included in source.
- MIT license included.

## Beta v1.2.6
- Camera-path-relative Grand audio fixed transition/arrival attenuation.
- Grand Up begins one tick into motion.
- Transition follows horizontal camera runs.
- Down follows arrival descent.
- No Grand camera timing, teleport timing or Structure Transit logic changed.

## Beta v1.2.2
- Structure Transit companion architecture frozen after multi-dimension stress validation.
