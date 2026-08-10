# Shift & Fade — AI Integration Prompt

I want you to integrate the Shift & Fade SDK into the Minecraft Bedrock add-on I provided.

I have also provided the official Shift & Fade SDK and its documentation.

Your goal is to make this add-on use Shift & Fade's animated teleport system whenever its teleport feature is used.

## IMPORTANT INSTRUCTIONS

### 1. FIRST ANALYZE THE ADD-ON

Before modifying anything, inspect the Behavior Pack and determine:

- Which JavaScript file or files control teleportation.
- What function actually teleports the player.
- How the destination coordinates and dimension are obtained.
- What happens before the teleport.
- What happens after the teleport.
- Whether the system handles pets or other entities.
- Whether it uses costs, XP, currency, cooldowns, permissions, tags, dynamic properties, messages, sounds, UI, or other validation.

Do not guess how the add-on works.

### 2. READ THE SHIFT & FADE SDK

Inspect the supplied Shift & Fade SDK and documentation before implementing anything.

Use the API/protocol exactly as documented in the supplied SDK.

Do not invent Shift & Fade functions, event IDs, properties, or APIs that are not present in the supplied version.

### 3. MODIFY AS LITTLE AS POSSIBLE

Do not rewrite the add-on's teleport system unnecessarily.

Preserve its existing architecture and behavior.

Only change what is required to route its teleport through Shift & Fade.

### 4. PRESERVE ALL ORIGINAL FEATURES

The integration must preserve, whenever applicable:

- Teleport permissions
- XP costs
- Currency costs
- Cooldowns
- Messages
- Sounds
- UI
- Waypoint/Home/Warp storage
- Destination validation
- Player rotation
- Tags
- Dynamic properties
- Pets or entities that teleport with the player
- Any other behavior already implemented by the original add-on

Shift & Fade should control the animated transition, not replace the add-on's gameplay systems.

### 5. KEEP THE ORIGINAL TELEPORT AS A FALLBACK

The integration must not make the add-on completely dependent on Shift & Fade.

If Shift & Fade:

- Is not installed
- Does not accept the request
- Returns a failure
- Times out
- Cannot perform the requested transition

then use the original teleport behavior whenever it is safe to do so.

Do not create a situation where the player becomes unable to teleport simply because Shift & Fade is unavailable.

### 6. DO NOT TELEPORT TWICE

When Shift & Fade accepts responsibility for the teleport, make sure the original teleport function does not also immediately execute.

There must never be both:

```text
Shift & Fade teleport
+
original teleport
```

for the same request.

### 7. PRESERVE MULTIPLAYER SAFETY

The integration must work per-player.

Do not use global variables for state that could mix teleport requests from different players unless they are safely indexed by player/request.

Two players using the teleport system at approximately the same time must not interfere with each other.

### 8. PRESERVE DIMENSION BEHAVIOR

Respect the original add-on's dimension restrictions.

If the supplied Shift & Fade version does not support a certain type of cross-dimension transition, preserve the original add-on's normal teleport for that case instead of forcing an unsupported animation.

Follow the behavior documented by the supplied SDK.

### 9. KEEP PET/ENTITY TELEPORTS WORKING

If the original add-on teleports nearby pets or other entities together with the player, preserve that behavior.

Coordinate those entities with the Shift & Fade transition where appropriate, especially during the hidden/fade portion of the teleport.

Do not silently remove this feature.

### 10. DO NOT BREAK THE MANIFEST

Inspect the existing `manifest.json`.

Only change Script API dependencies or manifest fields if the integration actually requires it.

Preserve:

- Pack UUIDs unless changing them is absolutely necessary
- Existing module UUIDs
- Existing dependencies
- Existing compatibility with the add-on's Resource Pack
- Existing `min_engine_version` unless an SDK requirement requires a newer version

If a dependency must be changed, explain exactly why.

### 11. DO NOT MODIFY UNRELATED FEATURES

Do not refactor unrelated systems.

Do not rename unrelated identifiers.

Do not remove files simply because they appear unused unless you can prove they are unnecessary.

Do not alter textures, entities, blocks, items, recipes, world generation, UI, or unrelated gameplay systems.

### 12. KEEP THE CODE MAINTAINABLE

Clearly mark the small section used for Shift & Fade compatibility.

Prefer a clean helper function or compatibility layer instead of duplicating integration code throughout the project.

If appropriate, use comments such as:

```js
// Shift & Fade integration
```

Do not fill the source with unnecessary comments.

### 13. HANDLE ERRORS SAFELY

The compatibility code should fail gracefully.

If something unexpected happens:

- Restore the player's ability to teleport.
- Prefer the original teleport fallback when safe.
- Avoid leaving the player frozen, invisible, or in an invalid state.
- Log a concise useful warning for debugging.

### 14. DO NOT MODIFY OR REDISTRIBUTE SHIFT & FADE INTERNALS

Use the provided public SDK.

Do not copy private Shift & Fade runtime implementation into the other add-on.

Do not attempt to recreate Shift & Fade's camera system inside the third-party add-on.

### 15. VERIFY THE RESULT

After implementing the integration:

- Check JavaScript syntax.
- Validate modified JSON files.
- Verify manifest dependencies.
- Search for every original teleport call related to this feature.
- Confirm there is no path that accidentally triggers two teleports.
- Confirm fallback behavior still exists.
- Confirm multiplayer requests are isolated.
- Confirm unrelated systems were not modified.

### 16. PROVIDE ME WITH

A. The modified installable Minecraft Bedrock add-on/package.

B. A short changelog describing exactly what was modified.

C. A list of the files changed.

D. The exact original teleport location/function you found.

E. An explanation of how the Shift & Fade integration now works.

F. Any limitations or cases that still use the original teleport.

G. Any testing steps I should perform inside Minecraft.

Do not claim that something works in Minecraft unless it can actually be verified from a Minecraft test. If you can only validate the files statically, clearly say that runtime testing is still required.

## FINAL GOAL

```text
ORIGINAL ADD-ON
    ↓
validates its normal teleport
    ↓
requests Shift & Fade
    ↓
Shift & Fade performs the animated transition
    ↓
original add-on preserves its costs, cooldowns, messages, pets, permissions, and other gameplay logic
```

with the **ORIGINAL TELEPORT** remaining available as a safe fallback.
