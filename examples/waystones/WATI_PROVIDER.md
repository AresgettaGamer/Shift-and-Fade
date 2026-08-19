# WATI integration — Shift & Fade: Waystones v1.0.0

- WATI source/add-on display name: **Shift & Fade: Waystones**
- Runtime Provider ID: `shift_fade_waystones`
- Lens Provider ID: `shift_fade_waystones.lens`
- Authoritative namespace: `shift_fade_waystones`
- Runtime public entries: 18
- Lens identity entries: 7 (2 dynamic blocks + 5 items)
- Lens title identity uses dedicated `wati.sfw.name.*` localization keys; native `tile.*` / `item.*` keys remain available through `minecraft:display_name` and Core/Codex metadata.
- Provider source relies on `namespaces` + `addonName` and does not force an optional `addonKey`.
- Dynamic Lens state from v0.9.7 is unchanged.
- WATI remains optional; gameplay does not depend on Core/Codex/Lens.
