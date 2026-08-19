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

const WATER_BLOCKS = new Set([
    "minecraft:water",
    "minecraft:flowing_water",
]);

const SEARCH_RADIUS = 5;
const Y_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];

/**
 * Samples a position that is known to be survivable because the player is currently standing
 * there. This is kept in memory and is used only as a final fallback for deaths whose exact
 * location has no survivable destination (most importantly the void and deep lava).
 */
export function sampleLastSafeAnchor(player) {
    try {
        if (!player.isValid || !player.isOnGround) return undefined;
        const location = player.location;
        const dimension = player.dimension;
        if (!isSafeStandingLocation(dimension, location)) return undefined;

        let rotation = { x: 0, y: 0 };
        try { rotation = player.getRotation(); } catch (_) {}
        return {
            dimensionId: dimension.id,
            x: location.x,
            y: location.y,
            z: location.z,
            rotationX: rotation.x,
            rotationY: rotation.y,
        };
    } catch (_) {
        return undefined;
    }
}

/**
 * Converts an exact death point into the actual Death Scroll destination.
 * Priority:
 *   1. exact death point when it is survivable (normal fall death / water death);
 *   2. nearest dry safe landing around the death point;
 *   3. last sampled safe standing point before death;
 *   4. unresolved marker (the scroll will refuse to teleport rather than kill the player again).
 */
export function resolveDeathReturnAnchor(player, deathAnchor, lastSafeAnchor) {
    const base = withDeathMetadata(deathAnchor, deathAnchor);
    let dimension;
    try { dimension = player.dimension; }
    catch (_) {
        return { ...base, safeResolved: false, safeMode: "unresolved" };
    }

    if (isSurvivableExactDeathLocation(dimension, deathAnchor)) {
        return {
            ...base,
            safeResolved: true,
            safeMode: "exact",
        };
    }

    const nearby = findNearbySafeLanding(dimension, deathAnchor);
    if (nearby) {
        return {
            ...withDeathMetadata(nearby, deathAnchor),
            rotationX: deathAnchor.rotationX ?? 0,
            rotationY: deathAnchor.rotationY ?? 0,
            safeResolved: true,
            safeMode: "nearby",
        };
    }

    if (lastSafeAnchor && lastSafeAnchor.dimensionId === deathAnchor.dimensionId &&
        Number.isFinite(lastSafeAnchor.x) && Number.isFinite(lastSafeAnchor.y) && Number.isFinite(lastSafeAnchor.z)) {
        return {
            ...withDeathMetadata(lastSafeAnchor, deathAnchor),
            safeResolved: true,
            safeMode: "last_safe",
        };
    }

    return {
        ...base,
        safeResolved: false,
        safeMode: "unresolved",
    };
}

function withDeathMetadata(destination, deathAnchor) {
    return {
        dimensionId: destination.dimensionId ?? deathAnchor.dimensionId,
        x: destination.x,
        y: destination.y,
        z: destination.z,
        rotationX: destination.rotationX ?? deathAnchor.rotationX ?? 0,
        rotationY: destination.rotationY ?? deathAnchor.rotationY ?? 0,
        deathX: deathAnchor.x,
        deathY: deathAnchor.y,
        deathZ: deathAnchor.z,
    };
}

function isSurvivableExactDeathLocation(dimension, location) {
    const bx = Math.floor(location.x);
    const by = Math.floor(location.y);
    const bz = Math.floor(location.z);

    try {
        const floor = dimension.getBlock({ x: bx, y: by - 1, z: bz });
        const feet = dimension.getBlock({ x: bx, y: by, z: bz });
        const head = dimension.getBlock({ x: bx, y: by + 1, z: bz });
        if (!feet || !head) return false;
        if (hasNearbyHazard(dimension, bx, by, bz)) return false;

        // Water is intentionally allowed. A drowning death should return to the water where the
        // player died; respawning restores air and this is not comparable to lava or the void.
        if (isWater(feet) || isWater(head)) return true;

        if (!floor) return false;
        if (isHazard(floor) || isHazard(feet) || isHazard(head)) return false;
        if (floor.isAir || floor.isLiquid) return false;
        if (feet.isLiquid || head.isLiquid) return false;

        // For the exact point be conservative about suffocation. If foliage or another passable
        // block occupies the point, the nearby scan can still find a clean two-block-high cell.
        if (!feet.isAir || !head.isAir) return false;
        return true;
    } catch (_) {
        return false;
    }
}

function findNearbySafeLanding(dimension, deathAnchor) {
    const baseY = Math.floor(deathAnchor.y);
    const offsets = horizontalOffsetsByDistance(SEARCH_RADIUS);

    for (const { dx, dz } of offsets) {
        for (const dy of Y_OFFSETS) {
            const bx = Math.floor(deathAnchor.x) + dx;
            const by = baseY + dy;
            const bz = Math.floor(deathAnchor.z) + dz;
            if (!isDrySafeLandingCell(dimension, bx, by, bz)) continue;
            return {
                dimensionId: deathAnchor.dimensionId,
                x: bx + 0.5,
                y: by,
                z: bz + 0.5,
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

function isDrySafeLandingCell(dimension, bx, by, bz) {
    try {
        const floor = dimension.getBlock({ x: bx, y: by - 1, z: bz });
        const feet = dimension.getBlock({ x: bx, y: by, z: bz });
        const head = dimension.getBlock({ x: bx, y: by + 1, z: bz });
        if (!floor || !feet || !head) return false;
        if (floor.isAir || floor.isLiquid || isHazard(floor)) return false;
        if (!feet.isAir || !head.isAir) return false;
        if (isHazard(feet) || isHazard(head)) return false;
        if (hasNearbyHazard(dimension, bx, by, bz)) return false;
        return true;
    } catch (_) {
        return false;
    }
}

function isSafeStandingLocation(dimension, location) {
    const bx = Math.floor(location.x);
    const by = Math.floor(location.y);
    const bz = Math.floor(location.z);
    try {
        const floor = dimension.getBlock({ x: bx, y: by - 1, z: bz });
        const feet = dimension.getBlock({ x: bx, y: by, z: bz });
        const head = dimension.getBlock({ x: bx, y: by + 1, z: bz });
        if (!floor || !feet || !head) return false;
        if (floor.isAir || floor.isLiquid || isHazard(floor)) return false;
        if (isHazard(feet) || isHazard(head)) return false;
        if (feet.isLiquid || head.isLiquid) return false;
        if (hasNearbyHazard(dimension, bx, by, bz)) return false;
        return true;
    } catch (_) {
        return false;
    }
}

function hasNearbyHazard(dimension, bx, by, bz) {
    try {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const block = dimension.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
                    if (!block) return true;
                    if (isHazard(block)) return true;
                }
            }
        }
        return false;
    } catch (_) {
        return true;
    }
}

function isWater(block) {
    try { return WATER_BLOCKS.has(block.typeId); }
    catch (_) { return false; }
}

function isHazard(block) {
    try {
        if (HAZARD_BLOCKS.has(block.typeId)) return true;
        // Treat non-water liquids conservatively as dangerous. This also avoids blindly landing
        // inside future/custom liquid-like blocks if Bedrock exposes them through isLiquid.
        if (block.isLiquid && !isWater(block)) return true;
        return false;
    } catch (_) {
        return true;
    }
}
