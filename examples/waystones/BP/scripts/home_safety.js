import { world } from "@minecraft/server";

const HAZARD_BLOCKS = new Set([
    "minecraft:lava",
    "minecraft:flowing_lava",
    "minecraft:magma",
    "minecraft:magma_block",
    "minecraft:fire",
    "minecraft:soul_fire",
    "minecraft:campfire",
    "minecraft:soul_campfire",
    "minecraft:cactus",
    "minecraft:sweet_berry_bush",
    "minecraft:wither_rose",
    "minecraft:powder_snow",
]);

const SEARCH_RADIUS = 8;
const ANCHOR_SCAN_RADIUS = 4;
const HAZARD_CLEARANCE_RADIUS = 2;
const TICKING_PADDING = SEARCH_RADIUS + HAZARD_CLEARANCE_RADIUS + 2;
const Y_OFFSETS = [1, 0, 2, -1, 3, -2, 4, -3, 5, -4];

/**
 * Resolves a stored Bedrock personal spawn to a physically verified Vanilla respawn block
 * and a safe nearby standing cell.
 *
 * Cross-dimension home use may target an unloaded chunk. In that case Waystones creates a
 * small temporary Script API ticking area, waits for it to be fully loaded, inspects the
 * Bed/Respawn Anchor and nearby hazards, then removes its ticking area before handing the
 * final destination to Shift & Fade.
 *
 * Returns:
 *   { status: "ok", home }
 *   { status: "missing_anchor" }  -> stale getSpawnPoint(); caller should use world spawn.
 *   { status: "unsafe" }          -> respawn block exists but no survivable landing was found.
 *   { status: "unavailable" }     -> destination could not be loaded/read safely.
 */
export async function resolvePersonalHomeAnchor(spawnPoint, playerId = "player") {
    if (!spawnPoint?.dimension || !Number.isFinite(spawnPoint.x) ||
        !Number.isFinite(spawnPoint.y) || !Number.isFinite(spawnPoint.z)) {
        return { status: "unavailable" };
    }

    const dimension = spawnPoint.dimension;
    let tickingAreaId;

    try {
        if (!isInspectionAreaLoaded(dimension, spawnPoint)) {
            tickingAreaId = await createTemporaryHomeTickingArea(dimension, spawnPoint, playerId);
            if (!tickingAreaId) return { status: "unavailable" };
        }

        const anchorBlock = findExpectedRespawnBlock(dimension, spawnPoint);
        if (!anchorBlock) {
            return { status: "missing_anchor" };
        }

        const nearby = findNearbySafeLanding(dimension, anchorBlock.location);
        if (!nearby) {
            return { status: "unsafe" };
        }

        return {
            status: "ok",
            home: {
                dimensionId: dimension.id,
                x: nearby.x,
                y: nearby.y,
                z: nearby.z,
                rotationX: 0,
                rotationY: 0,
                exactY: true,
                homeMode: "personal_safe",
                safeResolved: true,
                anchorType: anchorBlock.typeId,
                anchorX: anchorBlock.location.x,
                anchorY: anchorBlock.location.y,
                anchorZ: anchorBlock.location.z,
            },
        };
    } catch (_) {
        return { status: "unavailable" };
    } finally {
        removeTemporaryHomeTickingArea(tickingAreaId);
    }
}

async function createTemporaryHomeTickingArea(dimension, spawnPoint, playerId) {
    const manager = world.tickingAreaManager;
    if (!manager) return undefined;

    const x = Math.floor(spawnPoint.x);
    const z = Math.floor(spawnPoint.z);
    const minY = dimension.heightRange.min;
    const maxY = dimension.heightRange.max - 1;
    const options = {
        dimension,
        from: { x: x - TICKING_PADDING, y: minY, z: z - TICKING_PADDING },
        to: { x: x + TICKING_PADDING, y: maxY, z: z + TICKING_PADDING },
    };
    if (!manager.hasCapacity(options)) return undefined;

    const safePlayer = String(playerId).replace(/[^a-zA-Z0-9_]/g, "_").slice(-12);
    const areaId = `sfw_home_${safePlayer}_${Date.now().toString(36).slice(-6)}`;
    await manager.createTickingArea(areaId, options);
    return areaId;
}

function removeTemporaryHomeTickingArea(areaId) {
    if (!areaId) return;
    try {
        const manager = world.tickingAreaManager;
        if (manager?.hasTickingArea(areaId)) manager.removeTickingArea(areaId);
    } catch (_) {}
}

function isInspectionAreaLoaded(dimension, location) {
    const minY = dimension.heightRange.min;
    const maxY = dimension.heightRange.max - 1;
    const y = Math.max(minY, Math.min(maxY, location.y));
    const points = [
        { x: location.x, y, z: location.z },
        { x: location.x - TICKING_PADDING, y, z: location.z - TICKING_PADDING },
        { x: location.x - TICKING_PADDING, y, z: location.z + TICKING_PADDING },
        { x: location.x + TICKING_PADDING, y, z: location.z - TICKING_PADDING },
        { x: location.x + TICKING_PADDING, y, z: location.z + TICKING_PADDING },
    ];
    try {
        return points.every((point) => dimension.isChunkLoaded(point));
    } catch (_) {
        return false;
    }
}

function findExpectedRespawnBlock(dimension, spawnPoint) {
    const expectedType = dimension.id === "minecraft:nether"
        ? "minecraft:respawn_anchor"
        : dimension.id === "minecraft:overworld"
            ? "minecraft:bed"
            : undefined;

    // Vanilla does not provide a valid bed/Respawn Anchor home in The End. If some external
    // system wrote an arbitrary spawn point there, Home Scroll deliberately does not guess.
    if (!expectedType) return undefined;

    const ox = Math.floor(spawnPoint.x);
    const oy = Math.floor(spawnPoint.y);
    const oz = Math.floor(spawnPoint.z);

    let best;
    let bestDistance = Infinity;
    for (let dx = -ANCHOR_SCAN_RADIUS; dx <= ANCHOR_SCAN_RADIUS; dx++) {
        for (let dz = -ANCHOR_SCAN_RADIUS; dz <= ANCHOR_SCAN_RADIUS; dz++) {
            for (let dy = -2; dy <= 2; dy++) {
                const block = safeGetBlock(dimension, { x: ox + dx, y: oy + dy, z: oz + dz });
                if (!block || block.typeId !== expectedType) continue;
                const distance = dx * dx + dz * dz + dy * dy;
                if (distance < bestDistance) {
                    best = block;
                    bestDistance = distance;
                }
            }
        }
    }
    return best;
}

function findNearbySafeLanding(dimension, anchorLocation) {
    const ox = Math.floor(anchorLocation.x);
    const oy = Math.floor(anchorLocation.y);
    const oz = Math.floor(anchorLocation.z);
    const offsets = horizontalOffsetsByDistance(SEARCH_RADIUS);

    for (const { dx, dz } of offsets) {
        for (const dy of Y_OFFSETS) {
            const x = ox + dx;
            const y = oy + dy;
            const z = oz + dz;
            if (!isSafeLandingCell(dimension, x, y, z)) continue;
            return {
                dimensionId: dimension.id,
                x: x + 0.5,
                y,
                z: z + 0.5,
            };
        }
    }
    return undefined;
}

function horizontalOffsetsByDistance(radius) {
    const offsets = [];
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
            offsets.push({ dx, dz, distance: dx * dx + dz * dz });
        }
    }
    offsets.sort((a, b) => a.distance - b.distance);
    return offsets;
}

function isSafeLandingCell(dimension, x, y, z) {
    const floor = safeGetBlock(dimension, { x, y: y - 1, z });
    const feet = safeGetBlock(dimension, { x, y, z });
    const head = safeGetBlock(dimension, { x, y: y + 1, z });
    if (!floor || !feet || !head) return false;

    if (floor.isAir || floor.isLiquid || isHazard(floor)) return false;
    if (!feet.isAir || !head.isAir) return false;
    if (feet.isLiquid || head.isLiquid || isHazard(feet) || isHazard(head)) return false;

    return !hasNearbyHazard(dimension, x, y, z);
}

function hasNearbyHazard(dimension, x, y, z) {
    for (let dx = -HAZARD_CLEARANCE_RADIUS; dx <= HAZARD_CLEARANCE_RADIUS; dx++) {
        for (let dz = -HAZARD_CLEARANCE_RADIUS; dz <= HAZARD_CLEARANCE_RADIUS; dz++) {
            // Check floor level through slightly above the player's head. This intentionally
            // leaves a two-block buffer from lava/fire/cactus-like hazards in the Nether.
            for (let dy = -1; dy <= 2; dy++) {
                const block = safeGetBlock(dimension, { x: x + dx, y: y + dy, z: z + dz });
                if (!block || isHazard(block)) return true;
            }
        }
    }
    return false;
}

function safeGetBlock(dimension, location) {
    try {
        return dimension.getBlock(location);
    } catch (_) {
        return undefined;
    }
}

function isHazard(block) {
    try {
        if (HAZARD_BLOCKS.has(block.typeId)) return true;
        return block.isLiquid === true;
    } catch (_) {
        return true;
    }
}
