import { world } from "@minecraft/server";

const REGISTRY_KEY = "sfw:registry_v1";
const KNOWN_KEY = "sfw:known_v1";
const FAVORITES_KEY = "sfw:favorites_v1";
const RETURN_ANCHOR_KEY = "sfw:return_anchor_v1";
const DEATH_ANCHOR_KEY = "sfw:death_anchor_v1";
const PAD_REGISTRY_KEY = "sfw:pad_registry_v1";
const PAD_PENDING_KEY = "sfw:pad_pending_v1";
const NATURAL_META_KEY = "sfw:natural_meta_v1";
const MAX_WAYSTONES = 96;
const MAX_PLAYER_LINKS = 128;
const MAX_TELEPORT_PADS = 128;

export function makeWaystoneId(dimensionId, location) {
    return `${dimensionId}|${Math.floor(location.x)}|${Math.floor(location.y)}|${Math.floor(location.z)}`;
}

export function getRegistry() {
    const raw = world.getDynamicProperty(REGISTRY_KEY);
    if (typeof raw !== "string" || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isValidRecord) : [];
    } catch (_) {
        return [];
    }
}

export function saveRegistry(records) {
    const cleaned = records.filter(isValidRecord).slice(0, MAX_WAYSTONES);
    world.setDynamicProperty(REGISTRY_KEY, JSON.stringify(cleaned));
}

export function getWaystone(id) {
    return getRegistry().find((record) => record.id === id);
}

export function getOwnerWaystoneCounts(player) {
    const owned = getRegistry().filter((record) => record.ownerName === player.name);
    const publicCount = owned.filter((record) => record.isPublic).length;
    return {
        private: owned.length - publicCount,
        public: publicCount,
        total: owned.length,
    };
}

export function upsertWaystone(record) {
    const records = getRegistry();
    const index = records.findIndex((entry) => entry.id === record.id);
    if (index >= 0) records[index] = record;
    else {
        if (records.length >= MAX_WAYSTONES) return false;
        records.push(record);
    }
    saveRegistry(records);
    return true;
}

export function removeWaystone(id) {
    const records = getRegistry();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    saveRegistry(next);
    return true;
}

export function getKnown(player) {
    return readPlayerArray(player, KNOWN_KEY);
}

export function knowWaystone(player, id) {
    const values = getKnown(player);
    if (!values.includes(id)) values.push(id);
    writePlayerArray(player, KNOWN_KEY, values);
}

export function getFavorites(player) {
    return readPlayerArray(player, FAVORITES_KEY);
}

export function isFavorite(player, id) {
    return getFavorites(player).includes(id);
}

export function toggleFavorite(player, id) {
    const values = getFavorites(player);
    const index = values.indexOf(id);
    let enabled;
    if (index >= 0) {
        values.splice(index, 1);
        enabled = false;
    } else {
        values.push(id);
        enabled = true;
    }
    writePlayerArray(player, FAVORITES_KEY, values);
    return enabled;
}


export function getReturnAnchor(player) {
    const raw = player.getDynamicProperty(RETURN_ANCHOR_KEY);
    if (typeof raw !== "string" || !raw) return undefined;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value.dimensionId !== "string" ||
            !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) return undefined;
        return {
            dimensionId: value.dimensionId,
            x: value.x, y: value.y, z: value.z,
            rotationX: Number.isFinite(value.rotationX) ? value.rotationX : 0,
            rotationY: Number.isFinite(value.rotationY) ? value.rotationY : 0,
        };
    } catch (_) {
        return undefined;
    }
}

export function setReturnAnchor(player, anchor) {
    if (!anchor || typeof anchor.dimensionId !== "string" ||
        !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.z)) return false;
    player.setDynamicProperty(RETURN_ANCHOR_KEY, JSON.stringify({
        dimensionId: anchor.dimensionId,
        x: anchor.x, y: anchor.y, z: anchor.z,
        rotationX: Number.isFinite(anchor.rotationX) ? anchor.rotationX : 0,
        rotationY: Number.isFinite(anchor.rotationY) ? anchor.rotationY : 0,
    }));
    return true;
}

export function clearReturnAnchor(player) {
    try { player.setDynamicProperty(RETURN_ANCHOR_KEY, undefined); }
    catch (_) { try { player.setDynamicProperty(RETURN_ANCHOR_KEY, ""); } catch (_) {} }
}


export function getDeathAnchor(player) {
    const raw = player.getDynamicProperty(DEATH_ANCHOR_KEY);
    if (typeof raw !== "string" || !raw) return undefined;
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value.dimensionId !== "string" ||
            !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) return undefined;
        return {
            dimensionId: value.dimensionId,
            x: value.x, y: value.y, z: value.z,
            rotationX: Number.isFinite(value.rotationX) ? value.rotationX : 0,
            rotationY: Number.isFinite(value.rotationY) ? value.rotationY : 0,
            deathX: Number.isFinite(value.deathX) ? value.deathX : value.x,
            deathY: Number.isFinite(value.deathY) ? value.deathY : value.y,
            deathZ: Number.isFinite(value.deathZ) ? value.deathZ : value.z,
            safeResolved: value.safeResolved === true,
            safeMode: typeof value.safeMode === "string" ? value.safeMode : "legacy_unresolved",
            pendingGrant: value.pendingGrant === true,
            recordedAt: Number.isFinite(value.recordedAt) ? value.recordedAt : 0,
        };
    } catch (_) {
        return undefined;
    }
}

export function setDeathAnchor(player, anchor) {
    if (!anchor || typeof anchor.dimensionId !== "string" ||
        !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.z)) return false;
    player.setDynamicProperty(DEATH_ANCHOR_KEY, JSON.stringify({
        dimensionId: anchor.dimensionId,
        x: anchor.x, y: anchor.y, z: anchor.z,
        rotationX: Number.isFinite(anchor.rotationX) ? anchor.rotationX : 0,
        rotationY: Number.isFinite(anchor.rotationY) ? anchor.rotationY : 0,
        deathX: Number.isFinite(anchor.deathX) ? anchor.deathX : anchor.x,
        deathY: Number.isFinite(anchor.deathY) ? anchor.deathY : anchor.y,
        deathZ: Number.isFinite(anchor.deathZ) ? anchor.deathZ : anchor.z,
        safeResolved: anchor.safeResolved === true,
        safeMode: typeof anchor.safeMode === "string" ? anchor.safeMode : "unresolved",
        pendingGrant: anchor.pendingGrant === true,
        recordedAt: Number.isFinite(anchor.recordedAt) ? anchor.recordedAt : Date.now(),
    }));
    return true;
}

export function markDeathScrollGranted(player) {
    const anchor = getDeathAnchor(player);
    if (!anchor) return false;
    anchor.pendingGrant = false;
    return setDeathAnchor(player, anchor);
}

export function clearDeathAnchor(player) {
    try { player.setDynamicProperty(DEATH_ANCHOR_KEY, undefined); }
    catch (_) { try { player.setDynamicProperty(DEATH_ANCHOR_KEY, ""); } catch (_) {} }
}

export function visibleKnownWaystones(player) {
    const known = new Set(getKnown(player));
    const favorites = new Set(getFavorites(player));
    return getRegistry()
        .filter((record) => known.has(record.id) && (record.isPublic || record.ownerName === player.name))
        .sort((a, b) => {
            const af = favorites.has(a.id) ? 1 : 0;
            const bf = favorites.has(b.id) ? 1 : 0;
            if (af !== bf) return bf - af;
            return a.name.localeCompare(b.name);
        });
}

function readPlayerArray(player, key) {
    const raw = player.getDynamicProperty(key);
    if (typeof raw !== "string" || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string").slice(0, MAX_PLAYER_LINKS) : [];
    } catch (_) {
        return [];
    }
}

function writePlayerArray(player, key, values) {
    const unique = [...new Set(values.filter((value) => typeof value === "string"))].slice(0, MAX_PLAYER_LINKS);
    player.setDynamicProperty(key, JSON.stringify(unique));
}

function isValidRecord(record) {
    return record && typeof record.id === "string" && typeof record.name === "string" &&
        typeof record.dimensionId === "string" && Number.isFinite(record.x) &&
        Number.isFinite(record.y) && Number.isFinite(record.z) && typeof record.ownerName === "string";
}


export function makePadId(dimensionId, location) {
    return `${dimensionId}|${Math.floor(location.x)}|${Math.floor(location.y)}|${Math.floor(location.z)}`;
}

export function getPadRegistry() {
    const raw = world.getDynamicProperty(PAD_REGISTRY_KEY);
    if (typeof raw !== "string" || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isValidPadRecord) : [];
    } catch (_) {
        return [];
    }
}

export function savePadRegistry(records) {
    const cleaned = records.filter(isValidPadRecord).slice(0, MAX_TELEPORT_PADS);
    world.setDynamicProperty(PAD_REGISTRY_KEY, JSON.stringify(cleaned));
}

export function getPad(id) {
    return getPadRegistry().find((record) => record.id === id);
}

export function upsertPad(record) {
    if (!isValidPadRecord(record)) return false;
    const records = getPadRegistry();
    const index = records.findIndex((entry) => entry.id === record.id);
    if (index >= 0) records[index] = record;
    else {
        if (records.length >= MAX_TELEPORT_PADS) return false;
        records.push(record);
    }
    savePadRegistry(records);
    return true;
}

export function linkPads(firstId, secondId) {
    if (!firstId || !secondId || firstId === secondId) return false;
    const records = getPadRegistry();
    const aIndex = records.findIndex((entry) => entry.id === firstId);
    const bIndex = records.findIndex((entry) => entry.id === secondId);
    if (aIndex < 0 || bIndex < 0) return false;
    if (records[aIndex].linkId || records[bIndex].linkId) return false;
    records[aIndex] = { ...records[aIndex], linkId: secondId };
    records[bIndex] = { ...records[bIndex], linkId: firstId };
    savePadRegistry(records);
    return true;
}

export function unlinkPad(id) {
    const records = getPadRegistry();
    const index = records.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const partnerId = records[index].linkId;
    records[index] = { ...records[index] };
    delete records[index].linkId;
    if (partnerId) {
        const partnerIndex = records.findIndex((entry) => entry.id === partnerId);
        if (partnerIndex >= 0) {
            records[partnerIndex] = { ...records[partnerIndex] };
            delete records[partnerIndex].linkId;
        }
    }
    savePadRegistry(records);
    return true;
}

export function removePad(id) {
    const records = getPadRegistry();
    const index = records.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const partnerId = records[index].linkId;
    const next = records.filter((entry) => entry.id !== id).map((entry) => {
        if (partnerId && entry.id === partnerId && entry.linkId === id) {
            const copy = { ...entry };
            delete copy.linkId;
            return copy;
        }
        return entry;
    });
    savePadRegistry(next);
    return true;
}

export function getPendingPad(player) {
    const value = player.getDynamicProperty(PAD_PENDING_KEY);
    return typeof value === "string" && value ? value : undefined;
}

export function setPendingPad(player, padId) {
    if (typeof padId !== "string" || !padId) return clearPendingPad(player);
    player.setDynamicProperty(PAD_PENDING_KEY, padId);
    return true;
}

export function clearPendingPad(player) {
    try { player.setDynamicProperty(PAD_PENDING_KEY, undefined); }
    catch (_) { try { player.setDynamicProperty(PAD_PENDING_KEY, ""); } catch (_) {} }
    return true;
}

function isValidPadRecord(record) {
    return record && typeof record.id === "string" && typeof record.dimensionId === "string" &&
        Number.isFinite(record.x) && Number.isFinite(record.y) && Number.isFinite(record.z) &&
        typeof record.ownerName === "string" &&
        (record.linkId === undefined || typeof record.linkId === "string");
}


export function getNaturalMeta(id) {
    const all = readNaturalMeta();
    return all.find((entry) => entry.id === id);
}

export function setNaturalMeta(entry) {
    if (!entry || typeof entry.id !== "string") return false;
    const all = readNaturalMeta();
    const index = all.findIndex((value) => value.id === entry.id);
    if (index >= 0) all[index] = entry;
    else all.push(entry);
    world.setDynamicProperty(NATURAL_META_KEY, JSON.stringify(all.slice(-128)));
    return true;
}

// Keep the coordinate-based Waystone id as the canonical identity. Village names are display
// metadata only; changing a colliding procedural name must never create/replace a registry id.
export function renameNaturalWaystone(id, villageName) {
    if (typeof id !== "string" || !id || typeof villageName !== "string" || !villageName) return false;

    let changed = false;
    const all = readNaturalMeta();
    const metaIndex = all.findIndex((entry) => entry.id === id);
    if (metaIndex >= 0) {
        all[metaIndex] = { ...all[metaIndex], villageName };
        world.setDynamicProperty(NATURAL_META_KEY, JSON.stringify(all.slice(-128)));
        changed = true;
    }

    const records = getRegistry();
    const registryIndex = records.findIndex((record) => record.id === id && record.isNatural === true);
    if (registryIndex >= 0) {
        records[registryIndex] = { ...records[registryIndex], name: villageName, villageName };
        saveRegistry(records);
        changed = true;
    }

    return changed;
}

function readNaturalMeta() {
    const raw = world.getDynamicProperty(NATURAL_META_KEY);
    if (typeof raw !== "string" || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === "string") : [];
    } catch (_) {
        return [];
    }
}
