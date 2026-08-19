import "./wati_integration.js";
import { ItemStack, Player, system, world } from "@minecraft/server";
import { DEATH_SCROLL_ID, handleDeathScrollUse, handleHomeScrollUse, handleReturnScrollUse, handleWarpStoneUse, handleWaystoneInteract, HOME_SCROLL_ID, RETURN_SCROLL_ID, WARP_STONE_ID, WAYSTONE_ID } from "./ui.js";
import { getDeathAnchor, makeWaystoneId, markDeathScrollGranted, removeWaystone, setDeathAnchor } from "./storage.js";
import { clearPadPlayerState, cleanupBrokenPad, handleTeleportPadInteract, registerPlacedPad, TELEPORT_PAD_ID, tickTeleportPadAmbience, tickTeleportPads } from "./pads.js";
import { resolveDeathReturnAnchor, sampleLastSafeAnchor } from "./death_safety.js";
import { repairVillageNameCollisions, tryVillageWaystoneGeneration } from "./village_worldgen.js";

const lastSafeAnchors = new Map();

// One-time compatibility migration for worlds that already generated duplicate procedural
// village names in v0.9.3. It only renames colliding display metadata; block positions and ids stay untouched.
system.runTimeout(() => {
    try { repairVillageNameCollisions(); } catch (error) {
        console.warn(`[Shift & Fade: Waystones Release v1.0.0] Village name repair failed: ${error}`);
    }
}, 20);

// Keep a lightweight in-memory breadcrumb of the last place each player was actually standing
// safely. It is only consulted when a death location itself cannot produce a survivable return
// point (for example deep lava or the void).
system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        const anchor = sampleLastSafeAnchor(player);
        if (anchor) lastSafeAnchors.set(player.id, anchor);
    }
}, 10);

world.afterEvents.playerLeave.subscribe((event) => {
    lastSafeAnchors.delete(event.playerId);
    clearPadPlayerState(event.playerId);
});


function getWaystoneBaseBlock(block) {
    try {
        const part = Number(block.permutation.getState("minecraft:multi_block_part") ?? 0);
        if (!Number.isFinite(part) || part <= 0) return block;
        const base = block.dimension.getBlock({
            x: block.location.x,
            y: block.location.y - part,
            z: block.location.z,
        });
        return base?.typeId === WAYSTONE_ID ? base : block;
    } catch (_) {
        return block;
    }
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!event.isFirstEvent) return;
    if (event.block.typeId === WAYSTONE_ID) {
        event.cancel = true;
        const player = event.player;
        const block = getWaystoneBaseBlock(event.block);
        system.run(() => handleWaystoneInteract(player, block));
        return;
    }
    if (event.block.typeId === TELEPORT_PAD_ID) {
        event.cancel = true;
        const player = event.player;
        const block = event.block;
        system.run(() => handleTeleportPadInteract(player, block));
    }
});

world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (event.block.typeId !== TELEPORT_PAD_ID) return;
    registerPlacedPad(event.player, event.block);
});

// Direct linked pads are movement-driven: step on a linked pad to travel, then step off the
// destination before it can trigger again. Four ticks is responsive without scanning every tick.
system.runInterval(() => tickTeleportPads(), 4);
// The pad hum behaves like portal ambience: players near a linked pad hear the long clip as a
// spatial loop. One-second checks let it begin quickly without restarting the eight-second clip.
system.runInterval(() => tickTeleportPadAmbience(), 20);


world.afterEvents.itemUse.subscribe((event) => {
    const itemId = event.itemStack?.typeId;
    const player = event.source;
    if (itemId === WARP_STONE_ID) {
        system.run(() => handleWarpStoneUse(player));
        return;
    }
    if (itemId === RETURN_SCROLL_ID) {
        system.run(() => handleReturnScrollUse(player));
        return;
    }
    if (itemId === DEATH_SCROLL_ID) {
        system.run(() => handleDeathScrollUse(player));
        return;
    }
    if (itemId === HOME_SCROLL_ID) {
        system.run(() => handleHomeScrollUse(player));
    }
});


world.afterEvents.entityDie.subscribe((event) => {
    const player = event.deadEntity;
    if (!(player instanceof Player)) return;
    try {
        const location = player.location;
        let rotation = { x: 0, y: 0 };
        try { rotation = player.getRotation(); } catch (_) {}
        const exactDeath = {
            dimensionId: player.dimension.id,
            x: location.x, y: location.y, z: location.z,
            rotationX: rotation.x, rotationY: rotation.y,
        };
        const resolved = resolveDeathReturnAnchor(player, exactDeath, lastSafeAnchors.get(player.id));
        setDeathAnchor(player, {
            ...resolved,
            pendingGrant: true,
            recordedAt: Date.now(),
        });
        console.warn(
            `[Shift & Fade: Waystones Release v1.0.0] Death safety mode=${resolved.safeMode} ` +
            `resolved=${resolved.safeResolved ? 1 : 0} death=${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)} ` +
            `target=${Math.floor(resolved.x)},${Math.floor(resolved.y)},${Math.floor(resolved.z)}`
        );
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones Release v1.0.0] Death anchor save failed: ${error}`);
    }
});

function queueVillageCatProbe(entity, trigger, delay = 20) {
    try {
        if (!entity?.isValid() || entity.typeId !== "minecraft:cat") return;
        if (entity.dimension.id !== "minecraft:overworld") return;
        const dimension = entity.dimension;
        const location = { ...entity.location };
        system.runTimeout(() => tryVillageWaystoneGeneration(dimension, location, trigger), delay);
    } catch (_) {}
}

world.afterEvents.entitySpawn.subscribe((event) => {
    try {
        // Village cats are normally natural spawns (Spawned), not Event spawns. Accept Event as
        // well for custom village implementations that explicitly create their cats.
        if (event.cause !== "Spawned" && event.cause !== "Event") return;
        queueVillageCatProbe(event.entity, `spawn:${event.cause}`, 30);
    } catch (_) {}
});

// Existing villages and chunks that were generated before the script subscribed still get a fair
// chance when their cats load back into the world.
try {
    world.afterEvents.entityLoad.subscribe((event) => queueVillageCatProbe(event.entity, "load", 20));
} catch (_) {}

// Last-resort, low-frequency probe around players. This makes the heuristic resilient to addon
// villages whose cats do not arrive through the same initialization path as Vanilla cats.
system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        if (player.dimension.id !== "minecraft:overworld") continue;
        try {
            const cats = player.dimension.getEntities({
                type: "minecraft:cat",
                location: player.location,
                maxDistance: 96,
            });
            for (const cat of cats.slice(0, 4)) {
                tryVillageWaystoneGeneration(player.dimension, { ...cat.location }, "nearby-scan");
            }
        } catch (_) {}
    }
}, 200);

world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn) return;
    const player = event.player;
    system.run(() => grantPendingDeathScroll(player));
});

function grantPendingDeathScroll(player) {
    const anchor = getDeathAnchor(player);
    if (!anchor?.pendingGrant) return;

    let granted = false;
    try {
        const container = player.getComponent("minecraft:inventory")?.container;
        if (container) {
            let alreadyHas = false;
            for (let i = 0; i < container.size; i++) {
                if (container.getItem(i)?.typeId === DEATH_SCROLL_ID) {
                    alreadyHas = true;
                    break;
                }
            }
            if (alreadyHas) {
                granted = true;
            } else {
                const leftover = container.addItem(new ItemStack(DEATH_SCROLL_ID, 1));
                if (leftover) player.dimension.spawnItem(leftover, player.location);
                granted = true;
            }
        }
    } catch (_) {}

    if (!granted) {
        try {
            player.runCommand(`give @s ${DEATH_SCROLL_ID} 1`);
            granted = true;
        } catch (_) {}
    }

    if (granted) {
        markDeathScrollGranted(player);
        player.sendMessage({ translate: "sfw.death.received" });
    }
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
    try {
        const typeId = event.brokenBlockPermutation.type.id;
        if (typeId === WAYSTONE_ID) {
            const part = Number(event.brokenBlockPermutation.getState("minecraft:multi_block_part") ?? 0);
            const location = { ...event.block.location, y: event.block.location.y - Math.max(0, part) };
            const id = makeWaystoneId(event.dimension.id, location);
            removeWaystone(id);
            return;
        }
        if (typeId === TELEPORT_PAD_ID) {
            cleanupBrokenPad(event.player, event.dimension.id, event.block.location);
        }
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones] Break cleanup failed: ${error}`);
    }
});

console.warn("[Shift & Fade: Waystones Release v1.0.0] Loaded");
