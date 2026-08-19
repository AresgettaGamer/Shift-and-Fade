import { system } from "@minecraft/server";
import { createWatiProvider } from "./wati_provider.js";
import { createWatiLensProvider } from "./wati_lens_provider.js";
import {
    getFavorites,
    getKnown,
    getNaturalMeta,
    getPad,
    getWaystone,
    makePadId,
    makeWaystoneId,
    visibleKnownWaystones,
} from "./storage.js";

const ADDON_NAME = "Shift & Fade: Waystones";
const VERSION = "1.0.0";
const WAYSTONE_ID = "shift_fade_waystones:waystone";
const PAD_ID = "shift_fade_waystones:teleport_pad";

const structureVariants = [
    ["shift_fade_waystones:natural_waystone", "Natural Waystone", "wilderness", "wati.sfw.structure.natural_waystone", ["Waystone natural"]],
    ["shift_fade_waystones:village_plains", "Plains Village Waystone Sanctuary", "village", "wati.sfw.structure.village_plains", ["Santuario de Waystone de aldea de llanura"]],
    ["shift_fade_waystones:village_birch", "Birch Village Waystone Sanctuary", "village", "wati.sfw.structure.village_birch", ["Santuario de Waystone de aldea de abedul"]],
    ["shift_fade_waystones:village_spruce", "Spruce Village Waystone Sanctuary", "village", "wati.sfw.structure.village_spruce", ["Santuario de Waystone de aldea de abeto"]],
    ["shift_fade_waystones:village_jungle", "Jungle Village Waystone Sanctuary", "village", "wati.sfw.structure.village_jungle", ["Santuario de Waystone de aldea de jungla"]],
    ["shift_fade_waystones:village_desert", "Desert Village Waystone Sanctuary", "village", "wati.sfw.structure.village_desert", ["Santuario de Waystone de aldea del desierto"]],
    ["shift_fade_waystones:village_mesa", "Badlands Village Waystone Sanctuary", "village", "wati.sfw.structure.village_mesa", ["Santuario de Waystone de aldea de tierras baldías"]],
    ["shift_fade_waystones:village_mangrove", "Mangrove Village Waystone Sanctuary", "village", "wati.sfw.structure.village_mangrove", ["Santuario de Waystone de aldea de manglar"]],
    ["shift_fade_waystones:village_cherry", "Cherry Grove Village Waystone Sanctuary", "village", "wati.sfw.structure.village_cherry", ["Santuario de Waystone de aldea de cerezos"]],
    ["shift_fade_waystones:village_pale", "Pale Garden Village Waystone Sanctuary", "village", "wati.sfw.structure.village_pale", ["Santuario de Waystone de aldea de jardín pálido"]],
    ["shift_fade_waystones:village_roofed", "Dark Forest Village Waystone Sanctuary", "village", "wati.sfw.structure.village_roofed", ["Santuario de Waystone de aldea de bosque oscuro"]],
];

createWatiProvider({
    id: "shift_fade_waystones",
    source: {
        name: ADDON_NAME,
        version: VERSION,
        namespaces: ["shift_fade_waystones"],
        aliases: ["sfw", "shift fade waystones", "shift & fade waystones"],
        packUuid: "0a979c10-44f3-4b42-aae6-39a092f1b2a4",
        minEngineVersion: [1, 26, 40],
        capabilities: ["items", "blocks", "structures", "worldgen", "teleport-network"],
        author: "AresgettaYT",
    },
    entries: [
        {
            kind: "block", id: WAYSTONE_ID, fallbackName: "Waystone",
            localizationKey: "tile.shift_fade_waystones:waystone.name",
            aliases: ["Waystone", "Piedra de viaje"], category: ADDON_NAME, group: "Waystones", preferWati: true,
            textureKey: "sfw_waystone", texturePath: "textures/blocks/sfw_waystone_stone",
            summaryKey: "wati.sfw.summary.waystone_block",
        },
        {
            kind: "item", id: WAYSTONE_ID, fallbackName: "Waystone",
            localizationKey: "item.shift_fade_waystones:waystone",
            aliases: ["Waystone", "Piedra de viaje"], category: ADDON_NAME, group: "Waystones", preferWati: true,
            textureKey: "sfw_waystone_item", texturePath: "textures/items/sfw_waystone_item",
            summaryKey: "wati.sfw.summary.waystone_item",
        },
        {
            kind: "item", id: "shift_fade_waystones:warp_stone", fallbackName: "Warp Stone",
            localizationKey: "item.shift_fade_waystones:warp_stone", aliases: ["Piedra de teletransporte"],
            category: ADDON_NAME, group: "Waystones", preferWati: true,
            textureKey: "sfw_warp_stone", texturePath: "textures/items/sfw_warp_stone",
            summaryKey: "wati.sfw.summary.warp_stone",
        },
        {
            kind: "item", id: "shift_fade_waystones:return_scroll", fallbackName: "Return Scroll",
            localizationKey: "item.shift_fade_waystones:return_scroll", aliases: ["Pergamino de Retorno"],
            category: ADDON_NAME, group: "Scrolls", preferWati: true,
            textureKey: "sfw_return_scroll", texturePath: "textures/items/sfw_return_scroll",
            summaryKey: "wati.sfw.summary.return_scroll",
        },
        {
            kind: "item", id: "shift_fade_waystones:death_scroll", fallbackName: "Death Scroll",
            localizationKey: "item.shift_fade_waystones:death_scroll", aliases: ["Pergamino de Muerte"],
            category: ADDON_NAME, group: "Scrolls", preferWati: true,
            textureKey: "sfw_death_scroll", texturePath: "textures/items/sfw_death_scroll",
            summaryKey: "wati.sfw.summary.death_scroll",
        },
        {
            kind: "item", id: "shift_fade_waystones:home_scroll", fallbackName: "Home Scroll",
            localizationKey: "item.shift_fade_waystones:home_scroll", aliases: ["Pergamino del Hogar"],
            category: ADDON_NAME, group: "Scrolls", preferWati: true,
            textureKey: "sfw_home_scroll", texturePath: "textures/items/sfw_home_scroll",
            summaryKey: "wati.sfw.summary.home_scroll",
        },
        {
            kind: "block", id: PAD_ID, fallbackName: "Teleport Pad",
            localizationKey: "tile.shift_fade_waystones:teleport_pad.name", aliases: ["Pad de Teletransporte"],
            category: ADDON_NAME, group: "Teleport Pads", preferWati: true,
            textureKey: "sfw_teleport_pad", texturePath: "textures/blocks/sfw_teleport_pad_stone",
            summaryKey: "wati.sfw.summary.teleport_pad",
        },
        ...structureVariants.map(([id, fallbackName, group, localizationKey, aliases]) => ({
            kind: "structure", id, fallbackName, localizationKey, aliases,
            category: ADDON_NAME, group: group === "wilderness" ? "Natural Waystones" : "Village Sanctuaries",
            preferWati: true, dimension: "minecraft:overworld",
            summaryKey: group === "wilderness" ? "wati.sfw.summary.structure_wilderness" : "wati.sfw.summary.structure_village",
        })),
    ],
});

function getBaseWaystoneBlock(block) {
    if (!block || block.typeId !== WAYSTONE_ID) return block;
    try {
        const part = Number(block.permutation.getState("minecraft:multi_block_part") ?? 0);
        if (!Number.isFinite(part) || part <= 0) return block;
        const base = block.dimension.getBlock({
            x: block.location.x,
            y: block.location.y - part,
            z: block.location.z,
        });
        return base?.typeId === WAYSTONE_ID ? base : block;
    } catch {
        return block;
    }
}

function valueKey(key) {
    return `sfw.lens.${key}`;
}

function getWaystoneData({ block, viewer }) {
    const base = getBaseWaystoneBlock(block);
    if (!base || base.typeId !== WAYSTONE_ID) return { ttl: 20, lines: [] };

    const id = makeWaystoneId(base.dimension.id, base.location);
    const record = getWaystone(id);
    const meta = getNaturalMeta(id);
    let natural = false;
    let activated = true;
    try { natural = base.permutation.getState("shift_fade_waystones:natural") === true; } catch {}
    try { activated = base.permutation.getState("shift_fade_waystones:activated") !== false; } catch {}

    const lines = [];
    const displayName = record?.name ?? meta?.villageName;
    if (displayName) {
        lines.push({ id: "name", labelKey: valueKey("name"), value: displayName, color: "aqua" });
    }

    lines.push({
        id: "status",
        labelKey: valueKey("status"),
        valueKey: valueKey(activated ? "active" : "dormant"),
        color: activated ? "green" : "gray",
    });

    if (!activated && natural) {
        lines.push({
            id: "discover_hint",
            valueKey: valueKey("activate_hint"),
            color: "yellow",
            visibility: "when_sneaking",
        });
    }

    if (record) {
        const access = record.isNatural ? "natural" : (record.isPublic ? "public" : "private");
        lines.push({
            id: "access",
            labelKey: valueKey("access"),
            valueKey: valueKey(access),
            color: record.isPublic || record.isNatural ? "green" : "gold",
            visibility: "when_sneaking",
        });
        if (!record.isNatural && record.ownerName) {
            lines.push({
                id: "owner",
                labelKey: valueKey("owner"),
                value: record.ownerName,
                color: "white",
                visibility: "when_sneaking",
            });
        }
    }

    if (viewer) {
        const known = new Set(getKnown(viewer));
        const discovered = known.has(id);
        lines.push({
            id: "discovered",
            labelKey: valueKey("discovered"),
            valueKey: valueKey(discovered ? "yes" : "no"),
            color: discovered ? "green" : "gray",
            visibility: "when_sneaking",
        });
        if (discovered) {
            const favorite = new Set(getFavorites(viewer)).has(id);
            lines.push({
                id: "favorite",
                labelKey: valueKey("favorite"),
                valueKey: valueKey(favorite ? "yes" : "no"),
                color: favorite ? "gold" : "gray",
                visibility: "when_sneaking",
            });
            lines.push({
                id: "destinations",
                labelKey: valueKey("destinations"),
                value: visibleKnownWaystones(viewer).length,
                color: "aqua",
                visibility: "when_sneaking",
            });
        }
    }

    return { ttl: 10, lines };
}

function dimensionName(id) {
    if (id === "minecraft:overworld") return "Overworld";
    if (id === "minecraft:nether") return "Nether";
    if (id === "minecraft:the_end") return "The End";
    return id.replace("minecraft:", "");
}

function getPadData({ block }) {
    if (!block || block.typeId !== PAD_ID) return { ttl: 20, lines: [] };
    const id = makePadId(block.dimension.id, block.location);
    const record = getPad(id);
    if (!record) {
        return {
            ttl: 10,
            lines: [{
                id: "link",
                labelKey: valueKey("link"),
                valueKey: valueKey("unlinked"),
                color: "gray",
            }],
        };
    }

    const partner = record.linkId ? getPad(record.linkId) : undefined;
    const linked = Boolean(partner && partner.linkId === record.id);
    const lines = [{
        id: "link",
        labelKey: valueKey("link"),
        valueKey: valueKey(linked ? "linked" : "unlinked"),
        color: linked ? "green" : "gray",
    }];

    if (record.ownerName) {
        lines.push({
            id: "owner",
            labelKey: valueKey("owner"),
            value: record.ownerName,
            visibility: "when_sneaking",
        });
    }
    if (linked) {
        lines.push({
            id: "destination",
            labelKey: valueKey("destination"),
            value: `${dimensionName(partner.dimensionId)} · ${partner.x}, ${partner.y}, ${partner.z}`,
            color: "aqua",
            visibility: "when_sneaking",
        });
    }
    return { ttl: 10, lines };
}

const lensProvider = createWatiLensProvider({
    id: "shift_fade_waystones.lens",
    priority: 100,
    source: { addonName: ADDON_NAME, namespaces: ["shift_fade_waystones"] },
    entries: [
        { kind: "block", id: WAYSTONE_ID, nameKey: "wati.sfw.name.waystone", fallbackName: "Waystone", addonName: ADDON_NAME, refreshTicks: 10, data: getWaystoneData },
        { kind: "block", id: PAD_ID, nameKey: "wati.sfw.name.teleport_pad", fallbackName: "Teleport Pad", addonName: ADDON_NAME, refreshTicks: 10, data: getPadData },
        { kind: "item", id: WAYSTONE_ID, nameKey: "wati.sfw.name.waystone", fallbackName: "Waystone", addonName: ADDON_NAME },
        { kind: "item", id: "shift_fade_waystones:warp_stone", nameKey: "wati.sfw.name.warp_stone", fallbackName: "Warp Stone", addonName: ADDON_NAME },
        { kind: "item", id: "shift_fade_waystones:return_scroll", nameKey: "wati.sfw.name.return_scroll", fallbackName: "Return Scroll", addonName: ADDON_NAME },
        { kind: "item", id: "shift_fade_waystones:death_scroll", nameKey: "wati.sfw.name.death_scroll", fallbackName: "Death Scroll", addonName: ADDON_NAME },
        { kind: "item", id: "shift_fade_waystones:home_scroll", nameKey: "wati.sfw.name.home_scroll", fallbackName: "Home Scroll", addonName: ADDON_NAME },
    ],
});

// Startup-order hardening: Lens is optional and may finish subscribing after this add-on.
// Re-publish the same provider transaction after startup using the official SDK handle.
system.runTimeout(() => lensProvider.publish(), 20);
system.runTimeout(() => lensProvider.publish(), 80);
