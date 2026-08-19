import { system, world } from "@minecraft/server";
import { getRegistry, makeWaystoneId, renameNaturalWaystone, setNaturalMeta } from "./storage.js";

const BUILD_LABEL = "Release v1.0.0";
const STRUCTURES = {"birch":{"size":[11,12,11],"marker":[5,3,5],"includesGround":true},"cherry":{"size":[9,10,9],"marker":[4,3,4],"includesGround":true},"desert":{"size":[9,12,9],"marker":[4,2,4],"includesGround":true},"jungle":{"size":[9,12,9],"marker":[4,3,4],"includesGround":true},"mangrove":{"size":[9,12,9],"marker":[4,3,4],"includesGround":true},"mesa":{"size":[7,12,7],"marker":[3,1,3],"includesGround":true},"pale":{"size":[9,12,9],"marker":[4,3,4],"includesGround":true},"plains":{"size":[9,12,9],"marker":[4,2,4],"includesGround":false},"roofed":{"size":[11,10,11],"marker":[5,2,5],"includesGround":false},"spruce":{"size":[11,10,11],"marker":[5,3,5],"includesGround":true}};

const VILLAGE_TRACK_KEY = "sfw:village_waystones_v1";
const SEARCH_PRELOAD_PADDING = 56;
const pendingVillageKeys = new Set();
// Spatial reservations close the race where two cats/probes from the same village can start
// under different 64-block keys before either probe has persisted its finished Waystone.
const pendingVillageClaims = new Map();
const VILLAGE_DEDUP_RADIUS = 220;
const retryAfter = new Map();
const PATH_BLOCKS = new Set([
    "minecraft:grass_path", "minecraft:dirt_path", "minecraft:smooth_sandstone",
    "minecraft:sandstone", "minecraft:gravel"
]);
const REPLACEABLE = new Set([
    "minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:snow_layer",
    "minecraft:deadbush", "minecraft:fern", "minecraft:large_fern", "minecraft:pink_petals",
    "minecraft:wildflowers", "minecraft:leaf_litter", "minecraft:dandelion", "minecraft:poppy",
    "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip",
    "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy",
    "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:torchflower", "minecraft:closed_eyeblossom",
    "minecraft:open_eyeblossom", "minecraft:brown_mushroom", "minecraft:red_mushroom", "minecraft:vine"
]);

export function tryVillageWaystoneGeneration(dimension, catLocation, trigger = "cat") {
    if (!dimension || dimension.id !== "minecraft:overworld") return;
    const key = `${Math.floor(catLocation.x / 64)},${Math.floor(catLocation.z / 64)}`;
    if (pendingVillageKeys.has(key) || hasPendingVillageNearby(catLocation, VILLAGE_DEDUP_RADIUS) || hasVillageNearby(catLocation, VILLAGE_DEDUP_RADIUS)) return;

    const retryAt = retryAfter.get(key) ?? 0;
    if (Date.now() < retryAt) return;

    const villagers = countNearbyVillagers(dimension, catLocation, 56);
    if (villagers < 2) {
        retryAfter.set(key, Date.now() + 60_000);
        return;
    }

    pendingVillageKeys.add(key);
    pendingVillageClaims.set(key, { x: catLocation.x, z: catLocation.z });
    console.warn(
        `[Shift & Fade: Waystones ${BUILD_LABEL}] Village probe trigger=${trigger} ` +
        `villagers=${villagers} at=${Math.floor(catLocation.x)},${Math.floor(catLocation.y)},${Math.floor(catLocation.z)}`
    );
    // The search ring extends beyond the normal ticking radius around the cat/player. Preload one
    // temporary square for the whole probe so getTopmostBlock/getBlock cannot lose their chunk
    // halfway through evaluateSite. This mirrors the already-proven Home Scroll preload pattern.
    void startVillageGeneration(dimension, catLocation, key, villagers);
}

function countNearbyVillagers(dimension, location, radius) {
    let count = 0;
    for (const type of ["minecraft:villager_v2", "minecraft:villager"]) {
        try {
            count += dimension.getEntities({ type, location, maxDistance: radius }).length;
        } catch (_) {}
    }
    return count;
}

async function startVillageGeneration(dimension, catLocation, pendingKey, villagers) {
    let preload;
    try {
        preload = await prepareVillageSearchArea(dimension, catLocation, pendingKey);
        if (!preload.fullyLoaded) {
            console.warn(
                `[Shift & Fade: Waystones ${BUILD_LABEL}] Village preload unavailable; ` +
                `probe will inspect loaded chunks only near=${Math.floor(catLocation.x)},${Math.floor(catLocation.z)}`
            );
        }
        system.runJob(generateVillageWaystone(
            dimension,
            catLocation,
            pendingKey,
            villagers,
            preload.areaId
        ));
    } catch (error) {
        removeVillageTickingArea(preload?.areaId);
        retryAfter.set(pendingKey, Date.now() + 45_000);
        pendingVillageKeys.delete(pendingKey);
        pendingVillageClaims.delete(pendingKey);
        console.warn(
            `[Shift & Fade: Waystones ${BUILD_LABEL}] Village preload failed ` +
            `near=${Math.floor(catLocation.x)},${Math.floor(catLocation.z)}: ${error}`
        );
    }
}

async function prepareVillageSearchArea(dimension, center, pendingKey) {
    if (isVillageSearchAreaLoaded(dimension, center)) {
        return { areaId: undefined, fullyLoaded: true };
    }

    const manager = world.tickingAreaManager;
    if (!manager) return { areaId: undefined, fullyLoaded: false };

    const minY = dimension.heightRange.min;
    const maxY = dimension.heightRange.max - 1;
    const x = Math.floor(center.x);
    const z = Math.floor(center.z);
    const options = {
        dimension,
        from: {
            x: x - SEARCH_PRELOAD_PADDING,
            y: minY,
            z: z - SEARCH_PRELOAD_PADDING,
        },
        to: {
            x: x + SEARCH_PRELOAD_PADDING,
            y: maxY,
            z: z + SEARCH_PRELOAD_PADDING,
        },
    };

    if (!manager.hasCapacity(options)) {
        return { areaId: undefined, fullyLoaded: false };
    }

    const safeKey = String(pendingKey).replace(/[^a-zA-Z0-9_]/g, "_").slice(-18);
    const areaId = `sfw_village_${safeKey}_${Date.now().toString(36).slice(-5)}`;
    await manager.createTickingArea(areaId, options);
    return { areaId, fullyLoaded: true };
}

function isVillageSearchAreaLoaded(dimension, center) {
    const minY = dimension.heightRange.min;
    const maxY = dimension.heightRange.max - 1;
    const y = Math.max(minY, Math.min(maxY, Math.floor(center.y)));
    const x = Math.floor(center.x);
    const z = Math.floor(center.z);
    const points = [
        { x, y, z },
        { x: x - SEARCH_PRELOAD_PADDING, y, z: z - SEARCH_PRELOAD_PADDING },
        { x: x - SEARCH_PRELOAD_PADDING, y, z: z + SEARCH_PRELOAD_PADDING },
        { x: x + SEARCH_PRELOAD_PADDING, y, z: z - SEARCH_PRELOAD_PADDING },
        { x: x + SEARCH_PRELOAD_PADDING, y, z: z + SEARCH_PRELOAD_PADDING },
    ];
    try {
        return points.every((point) => dimension.isChunkLoaded(point));
    } catch (_) {
        return false;
    }
}

function removeVillageTickingArea(areaId) {
    if (!areaId) return;
    try {
        const manager = world.tickingAreaManager;
        if (manager?.hasTickingArea(areaId)) manager.removeTickingArea(areaId);
    } catch (_) {}
}

function isFootprintLoaded(dimension, pos, meta) {
    const extra = 7;
    const hx = Math.floor(meta.size[0] / 2) + extra;
    const hz = Math.floor(meta.size[2] / 2) + extra;
    const y = dimension.heightRange.min;
    const minX = pos.x - hx;
    const maxX = pos.x + hx;
    const minZ = pos.z - hz;
    const maxZ = pos.z + hz;

    try {
        // Sample every chunk boundary across the inspection square, not just the four corners.
        // This is also the safe fallback when the temporary ticking-area budget is unavailable.
        for (let x = minX; x <= maxX; x += 16) {
            for (let z = minZ; z <= maxZ; z += 16) {
                if (!dimension.isChunkLoaded({ x, y, z })) return false;
            }
        }
        if (!dimension.isChunkLoaded({ x: maxX, y, z: maxZ })) return false;
        return true;
    } catch (_) {
        return false;
    }
}

function *generateVillageWaystone(dimension, catLocation, pendingKey, villagers, tickingAreaId) {
    try {
        const variant = selectVariant(dimension, catLocation);
        const meta = STRUCTURES[variant] ?? STRUCTURES.plains;
        const candidate = yield* findSite(dimension, catLocation, meta);
        if (!candidate) {
            retryAfter.set(pendingKey, Date.now() + 45_000);
            console.warn(
                `[Shift & Fade: Waystones ${BUILD_LABEL}] Village probe found no safe site ` +
                `variant=${variant} villagers=${villagers} near=${Math.floor(catLocation.x)},${Math.floor(catLocation.z)}`
            );
            return;
        }
        const origin = {
            x: candidate.x - Math.floor(meta.size[0] / 2),
            y: candidate.y + (meta.includesGround ? 0 : 1),
            z: candidate.z - Math.floor(meta.size[2] / 2),
        };
        try {
            world.structureManager.place(`shift_fade_waystones:village_${variant}`, dimension, origin);
        } catch (error) {
            retryAfter.set(pendingKey, Date.now() + 60_000);
            console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Village sanctuary placement failed (${variant}): ${error}`);
            return;
        }
        const waystoneLocation = {
            x: origin.x + meta.marker[0],
            y: origin.y + meta.marker[1],
            z: origin.z + meta.marker[2],
        };
        const id = makeWaystoneId(dimension.id, waystoneLocation);
        const villageName = generateVillageName(candidate, variant);
        setNaturalMeta({ id, kind: "village", variant, villageName });
        rememberVillage(candidate, id, villageName, variant);
        retryAfter.delete(pendingKey);
        console.warn(
            `[Shift & Fade: Waystones ${BUILD_LABEL}] Village Waystone placed variant=${variant} ` +
            `village=${villageName} at=${Math.floor(waystoneLocation.x)},${Math.floor(waystoneLocation.y)},${Math.floor(waystoneLocation.z)}`
        );
    } finally {
        removeVillageTickingArea(tickingAreaId);
        pendingVillageKeys.delete(pendingKey);
        pendingVillageClaims.delete(pendingKey);
    }
}

function selectVariant(dimension, location) {
    let id = "";
    try { id = dimension.getBiome(location)?.id ?? ""; } catch (_) {}
    const name = id.replace("minecraft:", "");
    if (name.includes("pale_garden")) return "pale";
    if (name.includes("cherry")) return "cherry";
    if (name.includes("mangrove")) return "mangrove";
    if (name.includes("badlands") || name.includes("mesa")) return "mesa";
    if (name.includes("dark_forest") || name.includes("roofed")) return "roofed";
    if (name.includes("birch")) return "birch";
    if (name.includes("jungle")) return "jungle";
    if (name.includes("desert")) return "desert";
    if (name.includes("taiga") || name.includes("spruce") || name.includes("snowy")) return "spruce";
    return "plains";
}

function *findSite(dimension, center, meta) {
    const candidates = [];
    // Search a broader ring than v0.9.0. The cat+villager evidence already tells us this is a
    // village, so path blocks are a preference rather than the sole proof of the settlement.
    for (let r = 8; r <= 42; r += 2) {
        for (let dx = -r; dx <= r; dx += 4) {
            candidates.push({ x: Math.floor(center.x + dx), z: Math.floor(center.z - r) });
            candidates.push({ x: Math.floor(center.x + dx), z: Math.floor(center.z + r) });
        }
        for (let dz = -r + 4; dz <= r - 4; dz += 4) {
            candidates.push({ x: Math.floor(center.x - r), z: Math.floor(center.z + dz) });
            candidates.push({ x: Math.floor(center.x + r), z: Math.floor(center.z + dz) });
        }
    }
    let best;
    let bestScore = -Infinity;
    let checked = 0;
    for (const pos of candidates) {
        const result = evaluateSite(dimension, pos, meta);
        if (result && result.score > bestScore) { best = result; bestScore = result.score; }
        if (++checked % 10 === 0) yield;
        if (bestScore >= 18) break;
    }
    return best;
}

function evaluateSite(dimension, pos, meta) {
    if (!isFootprintLoaded(dimension, pos, meta)) return undefined;

    // Block handles can become invalid if a chunk unloads between retrieving the block and reading
    // properties such as isLiquid/typeId. The ticking area should prevent that, but the broad
    // guard keeps the fallback path silent and safe instead of surfacing LocationInUnloadedChunkError.
    try {
        const top = dimension.getTopmostBlock({ x: pos.x, z: pos.z });
        if (!top || top.isLiquid) return undefined;
        const y = top.location.y;
        const hx = Math.floor(meta.size[0] / 2), hz = Math.floor(meta.size[2] / 2);
        let minY = y, maxY = y, pathHints = 0;
        for (let dx = -hx; dx <= hx; dx += 2) {
            for (let dz = -hz; dz <= hz; dz += 2) {
                const ground = dimension.getTopmostBlock({ x: pos.x + dx, z: pos.z + dz });
                if (!ground || ground.isLiquid) return undefined;
                minY = Math.min(minY, ground.location.y);
                maxY = Math.max(maxY, ground.location.y);
                if (PATH_BLOCKS.has(ground.typeId)) pathHints++;
                // Protect buildings and trunks while allowing harmless vegetation to be replaced.
                for (let dy = 1; dy <= Math.min(meta.size[1], 6); dy++) {
                    const b = dimension.getBlock({
                        x: pos.x + dx,
                        y: ground.location.y + dy,
                        z: pos.z + dz,
                    });
                    if (b && !isReplaceable(b)) return undefined;
                }
            }
        }
        if (maxY - minY > 2) return undefined;
        for (let d = Math.max(hx, hz) + 1; d <= Math.max(hx, hz) + 7; d += 2) {
            for (const off of [[d,0],[-d,0],[0,d],[0,-d]]) {
                const b = dimension.getTopmostBlock({ x: pos.x + off[0], z: pos.z + off[1] });
                if (b && PATH_BLOCKS.has(b.typeId)) pathHints += 3;
            }
        }
        const score = 11 - (maxY - minY) * 3 + pathHints * 2 + hashUnit(pos.x, pos.z);
        return { x: pos.x, y: Math.round((minY + maxY) / 2), z: pos.z, score };
    } catch (_) {
        return undefined;
    }
}

function isReplaceable(block) {
    if (!block) return true;
    if (REPLACEABLE.has(block.typeId)) return true;
    try { if (block.isAir) return true; } catch (_) {}
    return false;
}


function hasPendingVillageNearby(pos, radius) {
    for (const site of pendingVillageClaims.values()) {
        if (Math.hypot(site.x - pos.x, site.z - pos.z) < radius) return true;
    }
    return false;
}

function getVillages() {
    const raw = world.getDynamicProperty(VILLAGE_TRACK_KEY);
    if (typeof raw !== "string" || !raw) return [];
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function hasVillageNearby(pos, radius) {
    return getVillages().some((site) => Math.hypot(site.x - pos.x, site.z - pos.z) < radius);
}

function rememberVillage(pos, id, villageName, variant) {
    const sites = getVillages();
    sites.push({ x: pos.x, z: pos.z, id, villageName, variant });
    world.setDynamicProperty(VILLAGE_TRACK_KEY, JSON.stringify(sites.slice(-96)));
}

const NAME_A = [
    "Alder", "Amber", "Ash", "Birch", "Cinder", "Dawn", "Elder", "Fern",
    "Golden", "Hazel", "Iron", "Moss", "Oak", "River", "Stone", "Willow",
    "Frost", "Pine", "Raven", "Silver", "Sun", "Thorn", "Maple", "Cedar",
    "Mist", "Moon", "Rose", "Bright", "Clear", "High", "Ember", "Copper",
    "Sage", "Cloud", "Meadow", "Lake", "Shadow", "Wind", "Rain", "Star",
    "Fox", "Wolf", "Hearth", "North", "West", "Green", "White", "Red"
];
const NAME_B = [
    "brook", "cross", "field", "ford", "haven", "hollow", "mere", "rest",
    "ridge", "stead", "vale", "watch", "wick", "wood", "reach", "fall",
    "gate", "grove", "hearth", "keep", "marsh", "mill", "moor", "run",
    "shire", "spring", "water", "way", "crest", "den", "dale", "shore",
    "view", "wall", "bridge", "mead", "point", "rock", "harbor", "peak",
    "glade", "barrow", "bank", "holt", "well", "port", "cliff", "garden"
];
// Rare deterministic easter eggs. Proper names remain language-neutral and are deliberately rare
// enough that the normal procedural village names remain the identity of the system.
const EASTER_EGG_NAMES = ["Ecatepec", "Guadalajara", "Monterrey", "Puebla", "Merida", "Queretaro", "Toluca", "Veracruz"];

function villageNameKey(name) {
    return String(name ?? "").trim().toLowerCase();
}

function collectUsedVillageNames(exceptId = undefined) {
    const used = new Set();
    for (const site of getVillages()) {
        if (exceptId && site.id === exceptId) continue;
        const key = villageNameKey(site.villageName);
        if (key) used.add(key);
    }
    // Registry entries cover already-discovered natural Waystones even if an old village tracker
    // entry has fallen outside its compact history window.
    for (const record of getRegistry()) {
        if (record.isNatural !== true || (exceptId && record.id === exceptId)) continue;
        const key = villageNameKey(record.villageName || record.name);
        if (key) used.add(key);
    }
    return used;
}

function generateVillageName(pos, variant, usedNames = collectUsedVillageNames(), allowEasterEgg = true) {
    const x = Math.floor(pos.x);
    const z = Math.floor(pos.z);
    const seed = hash32(x, z, variant.length * 97);

    if (allowEasterEgg && seed % 32 === 0) {
        const easter = EASTER_EGG_NAMES[(seed >>> 8) % EASTER_EGG_NAMES.length];
        if (!usedNames.has(villageNameKey(easter))) return easter;
    }

    // 48 x 48 = 2,304 normal names. The 577 stride is coprime with 2,304, so this
    // deterministic walk visits every combination exactly once before a fallback is needed.
    const total = NAME_A.length * NAME_B.length;
    const base = seed % total;
    const stride = 577;
    for (let attempt = 0; attempt < total; attempt++) {
        const index = (base + attempt * stride) % total;
        const a = NAME_A[Math.floor(index / NAME_B.length)];
        const b = NAME_B[index % NAME_B.length];
        const candidate = `${a}${b}`;
        if (!usedNames.has(villageNameKey(candidate))) return candidate;
    }

    // The registry currently tops out far below 2,304 village names, but keep a deterministic
    // coordinate suffix as a hard guarantee if that limit ever changes in the future.
    return `Wayfarer-${hash32(x, z, seed).toString(36).slice(0, 6)}`;
}

export function repairVillageNameCollisions() {
    const sites = getVillages();
    if (sites.length === 0) return 0;

    const trackedIds = new Set(sites.map((site) => site.id));
    const used = new Set();
    // Preserve natural names that still exist in the public registry but no longer fit in the
    // compact village-tracker history; new/repaired tracked villages must not collide with them.
    for (const record of getRegistry()) {
        if (record.isNatural !== true || trackedIds.has(record.id)) continue;
        const key = villageNameKey(record.villageName || record.name);
        if (key) used.add(key);
    }

    let changed = 0;
    for (const site of sites) {
        const currentKey = villageNameKey(site.villageName);
        if (currentKey && !used.has(currentKey)) {
            used.add(currentKey);
            continue;
        }

        const replacement = generateVillageName(
            { x: site.x, z: site.z },
            typeof site.variant === "string" ? site.variant : "plains",
            used,
            false
        );
        site.villageName = replacement;
        used.add(villageNameKey(replacement));
        renameNaturalWaystone(site.id, replacement);
        changed++;
    }

    if (changed > 0) {
        world.setDynamicProperty(VILLAGE_TRACK_KEY, JSON.stringify(sites.slice(-96)));
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Village name repair renamed=${changed}`);
    }
    return changed;
}
function hash32(x, z, salt = 0) {
    let h = (Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ salt) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0;
}
function hashUnit(x, z) { return (hash32(x,z) & 1023) / 1024; }
