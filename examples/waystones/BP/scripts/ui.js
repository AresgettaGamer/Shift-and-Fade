import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
    getDeathAnchor,
    getOwnerWaystoneCounts,
    getNaturalMeta,
    getReturnAnchor,
    getWaystone,
    isFavorite,
    knowWaystone,
    makeWaystoneId,
    toggleFavorite,
    upsertWaystone,
    visibleKnownWaystones,
} from "./storage.js";
import { getTeleportCost, teleportToDeathAnchor, teleportToHome, teleportToReturnAnchor, teleportToWaystone } from "./teleport.js";

const WAYSTONE_ID = "shift_fade_waystones:waystone";
const WARP_STONE_ID = "shift_fade_waystones:warp_stone";
const RETURN_SCROLL_ID = "shift_fade_waystones:return_scroll";
const DEATH_SCROLL_ID = "shift_fade_waystones:death_scroll";
const HOME_SCROLL_ID = "shift_fade_waystones:home_scroll";

const T = (key, withValues = []) => withValues.length
    ? ({ translate: key, with: withValues.map((value) => String(value)) })
    : ({ translate: key });
const text = (value) => ({ text: String(value) });
const raw = (...parts) => ({ rawtext: parts.flat() });

function ownershipParts(record) {
    return record?.isNatural
        ? [T("sfw.natural.label")]
        : [T("sfw.info.owner"), text(` ${record.ownerName}`)];
}

function isNaturalWaystone(block) {
    try { return block.permutation.getState("shift_fade_waystones:natural") === true; }
    catch (_) { return false; }
}


function isActivatedWaystone(block) {
    try { return block.permutation.getState("shift_fade_waystones:activated") !== false; }
    catch (_) { return true; }
}

function activateNaturalWaystone(block) {
    try {
        const base = block;
        base.setPermutation(base.permutation.withState("shift_fade_waystones:activated", true));
        const top = base.dimension.getBlock({ x: base.location.x, y: base.location.y + 1, z: base.location.z });
        if (top?.typeId === WAYSTONE_ID) {
            top.setPermutation(top.permutation.withState("shift_fade_waystones:activated", true));
        }
        return true;
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones Release v1.0.0] Natural activation visual failed: ${error}`);
        return false;
    }
}

function playPlayerSound(player, id, volume = 1, pitch = 1, location = undefined) {
    try {
        // Keep pitch numeric at runtime. The v0.9.2 resource definitions used [min,max] pitch
        // arrays inside sound_definitions entries; Bedrock accepted the two definitions without
        // those arrays (discovery + pad) but the three definitions using them were silent.
        const options = { volume, pitch: Number(pitch) || 1 };
        // Portable-item sounds intentionally omit a fixed world location. A Warp/Scroll starts
        // immediately before Shift & Fade moves the player, so pinning the source to the old
        // coordinate can make the sound attenuate/disappear as the cinematic begins.
        if (location) options.location = location;
        player.playSound(id, options);
        return true;
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones Release v1.0.0] Sound failed id=${id}: ${error}`);
        return false;
    }
}

export async function handleWaystoneInteract(player, block) {
    const id = makeWaystoneId(block.dimension.id, block.location);
    let record = getWaystone(id);
    let justDiscovered = false;
    if (!record) {
        if (isNaturalWaystone(block)) {
            record = discoverNaturalWaystone(player, block, id);
            if (!record) return;
            justDiscovered = true;
        } else {
            await createWaystone(player, block, id);
            return;
        }
    }

    if (!record.isPublic && record.ownerName !== player.name) {
        player.sendMessage(T("sfw.message.private"));
        return;
    }

    knowWaystone(player, id);
    // First activation has its own longer discovery sound. Do not stack the short interaction
    // click on top of it in the same tick.
    if (!justDiscovered) {
        playPlayerSound(
            player,
            "sfw.waystone.interact",
            1.0,
            1.0,
            { x: block.location.x + 0.5, y: block.location.y + 0.8, z: block.location.z + 0.5 }
        );
    }
    await openWaystoneHome(player, record);
}

function discoverNaturalWaystone(player, block, id) {
    const x = Math.floor(block.location.x);
    const y = Math.floor(block.location.y);
    const z = Math.floor(block.location.z);
    const meta = getNaturalMeta(id);
    const name = meta?.villageName || `Waystone ${x}, ${z}`;
    const record = {
        id, name, dimensionId: block.dimension.id, x, y, z,
        ownerName: "Natural", isPublic: true, isNatural: true,
        naturalKind: meta?.kind || "wild",
        variant: meta?.variant,
        villageName: meta?.villageName,
    };
    if (!upsertWaystone(record)) {
        player.sendMessage(T("sfw.message.registry_full"));
        return undefined;
    }
    activateNaturalWaystone(block);
    knowWaystone(player, id);
    playPlayerSound(
        player,
        "sfw.waystone.discovered",
        1.2,
        1.0,
        { x: block.location.x + 0.5, y: block.location.y + 0.8, z: block.location.z + 0.5 }
    );
    player.sendMessage(T(meta?.villageName ? "sfw.natural.village.discovered" : "sfw.natural.discovered", [name]));
    return record;
}

async function createWaystone(player, block, id) {
    const x = Math.floor(block.location.x);
    const y = Math.floor(block.location.y);
    const z = Math.floor(block.location.z);
    const suggestedName = `Waystone ${x}, ${z}`;
    const counts = getOwnerWaystoneCounts(player);
    const form = new ModalFormData()
        .title(text(" "))
        .header(T("sfw.setup.header"))
        .label(T("sfw.setup.instructions"))
        .label(raw(
            T("sfw.setup.location"), text(" "), dimensionLabel(block.dimension.id),
            text(`  §8|§r  ${x}, ${y}, ${z}`)
        ))
        .label(T("sfw.setup.counts", [counts.private, counts.public]))
        .divider()
        // The suggested name is a real placeholder, not a pre-filled value. The player can
        // click and type immediately; leaving it empty accepts the suggestion.
        .textField(T("sfw.setup.name"), text(suggestedName))
        .toggle(T("sfw.setup.public"), { defaultValue: false })
        .label(T("sfw.setup.public.help"))
        .submitButton(T("sfw.common.create"));

    const response = await safeShow(form, player);
    if (!response || response.canceled) return;
    const values = response.formValues ?? [];
    // Modal labels/headers may surface as undefined entries depending on UI runtime; extract the
    // actual controls by type instead of relying on a positional index.
    const nameValue = values.find((value) => typeof value === "string");
    const publicValue = values.find((value) => typeof value === "boolean");
    const name = sanitizeName(nameValue, suggestedName);
    const record = {
        id,
        name,
        dimensionId: block.dimension.id,
        x,
        y,
        z,
        ownerName: player.name,
        // New Waystones are private unless the owner explicitly opts in.
        isPublic: publicValue === true,
    };

    if (!upsertWaystone(record)) {
        player.sendMessage(T("sfw.message.registry_full"));
        return;
    }
    knowWaystone(player, id);
    player.sendMessage(raw(T("sfw.message.created"), text(` ${name}`)));
    await openWaystoneHome(player, record);
}

async function openWaystoneHome(player, record) {
    const current = getWaystone(record.id);
    if (!current) return;
    const favorite = isFavorite(player, current.id);
    const ownerCounts = getOwnerWaystoneCounts(player);
    const form = new ActionFormData()
        .title(text(" "))
        .header(text(current.name))
        .label(T("sfw.ui.network.header"))
        .label(waystoneInfo(current))
        .label(T("sfw.ui.owner_counts", [ownerCounts.private, ownerCounts.public]))
        .divider()
        .button(T("sfw.menu.travel"), dimensionIcon(current.dimensionId))
        .button(T(favorite ? "sfw.menu.unfavorite" : "sfw.menu.favorite"), favorite ? "textures/shift_fade_waystones/ui/favorite_on" : "textures/shift_fade_waystones/ui/favorite_off");

    const owner = !current.isNatural && current.ownerName === player.name;
    if (owner) form.button(T("sfw.menu.settings"), "textures/shift_fade_waystones/ui/settings");
    form.button(T("sfw.common.close"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    const index = response.selection;
    if (index === 0) return openTravelList(player, current.id);
    if (index === 1) {
        const enabled = toggleFavorite(player, current.id);
        player.sendMessage(T(enabled ? "sfw.message.favorite_added" : "sfw.message.favorite_removed"));
        return openWaystoneHome(player, current);
    }
    if (owner && index === 2) return editWaystone(player, current);
}

async function openTravelList(player, currentId) {
    const current = getWaystone(currentId);
    if (!current) return;
    const destinations = visibleKnownWaystones(player).filter((record) => record.id !== currentId);
    if (destinations.length === 0) {
        player.sendMessage(T("sfw.message.no_destinations"));
        return openWaystoneHome(player, current);
    }

    const publicCount = destinations.filter((record) => record.isPublic).length;
    const privateCount = destinations.length - publicCount;
    const form = new ActionFormData()
        .title(text(" "))
        .header(T("sfw.travel.title"))
        .label(raw(T("sfw.ui.from"), text(" "), text(current.name)))
        .label(T("sfw.travel.body"))
        .label(T("sfw.travel.visible_counts", [privateCount, publicCount]))
        .divider();

    for (const destination of destinations) {
        const star = isFavorite(player, destination.id) ? "§e* §r" : "";
        const cost = getTeleportCost(player, destination);
        form.button(raw(
            text(`${star}${destination.name}\n`),
            dimensionLabel(destination.dimensionId),
            text(`  §8|§r  ${cost} `), T("sfw.cost.levels.short")
        ), dimensionIcon(destination.dimensionId));
    }
    form.divider().button(T("sfw.common.back"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= destinations.length) return openWaystoneHome(player, current);
    return openDestinationDetails(player, current.id, destinations[response.selection].id);
}

async function openDestinationDetails(player, currentId, destinationId) {
    const current = getWaystone(currentId);
    const destination = getWaystone(destinationId);
    if (!current || !destination || (!destination.isPublic && destination.ownerName !== player.name)) {
        player.sendMessage(T("sfw.message.destination_unavailable"));
        return;
    }

    const cost = getTeleportCost(player, destination);
    const favorite = isFavorite(player, destination.id);
    const canAfford = player.level >= cost;
    const crossDimension = destination.dimensionId !== player.dimension.id;
    const form = new ActionFormData()
        .title(text(" "))
        .header(text(destination.name))
        .label(dimensionLabel(destination.dimensionId))
        .label(raw(T("sfw.info.coordinates", [destination.x, destination.y, destination.z])))
        .label(T(crossDimension ? "sfw.info.route.cross_dimension" : "sfw.info.route.same_dimension"))
        .divider()
        .label(T("sfw.info.travel_cost", [cost]))
        .label(T("sfw.info.your_levels", [player.level]))
        .label(raw(
            T(destination.isPublic ? "sfw.info.public" : "sfw.info.private"),
            text("  §8|§r  "), ...ownershipParts(destination)
        ))
        .divider()
        .button(T(canAfford ? "sfw.menu.travel_cost" : "sfw.menu.travel_locked", [cost]), dimensionIcon(destination.dimensionId))
        .button(T(favorite ? "sfw.menu.unfavorite" : "sfw.menu.favorite"), favorite ? "textures/shift_fade_waystones/ui/favorite_on" : "textures/shift_fade_waystones/ui/favorite_off")
        .button(T("sfw.common.back"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) {
        if (!canAfford || player.level < cost) {
            player.sendMessage(T("sfw.message.not_enough_levels", [cost]));
            return openDestinationDetails(player, currentId, destinationId);
        }
        return performTravel(player, current, destination);
    }
    if (response.selection === 1) {
        const enabled = toggleFavorite(player, destination.id);
        player.sendMessage(T(enabled ? "sfw.message.favorite_added" : "sfw.message.favorite_removed"));
        return openDestinationDetails(player, currentId, destinationId);
    }
    return openTravelList(player, currentId);
}

async function performTravel(player, current, destination) {
    // Re-read in case settings changed while the form was open.
    const fresh = getWaystone(destination.id);
    if (!fresh || (!fresh.isPublic && fresh.ownerName !== player.name)) {
        player.sendMessage(T("sfw.message.destination_unavailable"));
        return;
    }

    const expectedCost = getTeleportCost(player, fresh);
    if (player.level < expectedCost) {
        player.sendMessage(T("sfw.message.not_enough_levels", [expectedCost]));
        return openDestinationDetails(player, current.id, fresh.id);
    }

    const result = await teleportToWaystone(player, fresh);
    if (!result.ok) {
        if (result.reason === "not_enough_levels") {
            player.sendMessage(T("sfw.message.not_enough_levels", [result.requiredLevel ?? expectedCost]));
        } else if (result.reason === "busy") {
            player.sendMessage(T("sfw.message.busy"));
        } else {
            player.sendMessage(T("sfw.message.teleport_failed"));
        }
        return;
    }
    if (!result.cinematic) player.sendMessage(T("sfw.message.instant_fallback"));
}

export async function handleWarpStoneUse(player) {
    return openWarpStoneNetwork(player);
}

async function openWarpStoneNetwork(player) {
    const destinations = visibleKnownWaystones(player);
    if (destinations.length === 0) {
        player.sendMessage(T("sfw.warp.no_destinations"));
        return;
    }

    const publicCount = destinations.filter((record) => record.isPublic).length;
    const privateCount = destinations.length - publicCount;
    const form = new ActionFormData()
        .title(text(" "))
        .header(T("sfw.warp.title"))
        .label(T("sfw.warp.header"))
        .label(T("sfw.warp.source"))
        .label(T("sfw.warp.body"))
        .label(T("sfw.travel.visible_counts", [privateCount, publicCount]))
        .divider();

    for (const destination of destinations) {
        const star = isFavorite(player, destination.id) ? "§e* §r" : "";
        const cost = getTeleportCost(player, destination);
        form.button(raw(
            text(`${star}${destination.name}\n`),
            dimensionLabel(destination.dimensionId),
            text(`  §8|§r  ${cost} `), T("sfw.cost.levels.short")
        ), dimensionIcon(destination.dimensionId));
    }
    form.divider().button(T("sfw.common.close"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection >= destinations.length) return;
    return openWarpStoneDestinationDetails(player, destinations[response.selection].id);
}

async function openWarpStoneDestinationDetails(player, destinationId) {
    const destination = getWaystone(destinationId);
    if (!destination || (!destination.isPublic && destination.ownerName !== player.name)) {
        player.sendMessage(T("sfw.message.destination_unavailable"));
        return openWarpStoneNetwork(player);
    }

    const cost = getTeleportCost(player, destination);
    const favorite = isFavorite(player, destination.id);
    const canAfford = player.level >= cost;
    const crossDimension = destination.dimensionId !== player.dimension.id;
    const form = new ActionFormData()
        .title(text(" "))
        .header(text(destination.name))
        .label(dimensionLabel(destination.dimensionId))
        .label(raw(T("sfw.info.coordinates", [destination.x, destination.y, destination.z])))
        .label(T(crossDimension ? "sfw.info.route.cross_dimension" : "sfw.info.route.same_dimension"))
        .divider()
        .label(T("sfw.info.travel_cost", [cost]))
        .label(T("sfw.info.your_levels", [player.level]))
        .label(raw(
            T(destination.isPublic ? "sfw.info.public" : "sfw.info.private"),
            text("  §8|§r  "), ...ownershipParts(destination)
        ))
        .divider()
        .button(T(canAfford ? "sfw.menu.travel_cost" : "sfw.menu.travel_locked", [cost]), dimensionIcon(destination.dimensionId))
        .button(T(favorite ? "sfw.menu.unfavorite" : "sfw.menu.favorite"), favorite ? "textures/shift_fade_waystones/ui/favorite_on" : "textures/shift_fade_waystones/ui/favorite_off")
        .button(T("sfw.common.back"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    if (response.selection === 0) {
        if (!canAfford || player.level < cost) {
            player.sendMessage(T("sfw.message.not_enough_levels", [cost]));
            return openWarpStoneDestinationDetails(player, destinationId);
        }
        return performWarpStoneTravel(player, destination);
    }
    if (response.selection === 1) {
        const enabled = toggleFavorite(player, destination.id);
        player.sendMessage(T(enabled ? "sfw.message.favorite_added" : "sfw.message.favorite_removed"));
        return openWarpStoneDestinationDetails(player, destinationId);
    }
    return openWarpStoneNetwork(player);
}

async function performWarpStoneTravel(player, destination) {
    const fresh = getWaystone(destination.id);
    if (!fresh || (!fresh.isPublic && fresh.ownerName !== player.name)) {
        player.sendMessage(T("sfw.message.destination_unavailable"));
        return openWarpStoneNetwork(player);
    }

    const expectedCost = getTeleportCost(player, fresh);
    if (player.level < expectedCost) {
        player.sendMessage(T("sfw.message.not_enough_levels", [expectedCost]));
        return openWarpStoneDestinationDetails(player, fresh.id);
    }

    playPlayerSound(player, "sfw.warp_stone.use", 1.2, 1.0);
    const result = await teleportToWaystone(player, fresh);
    if (!result.ok) {
        if (result.reason === "not_enough_levels") {
            player.sendMessage(T("sfw.message.not_enough_levels", [result.requiredLevel ?? expectedCost]));
        } else if (result.reason === "busy") {
            player.sendMessage(T("sfw.message.busy"));
        } else {
            player.sendMessage(T("sfw.message.teleport_failed"));
        }
        return;
    }
    // The item definition keeps a tiny 0.35 s debounce so one physical use cannot open the UI twice.
    // The actual gameplay cooldown mirrors the deliberate Waystone rhythm: it starts only after a
    // successful Warp Stone trip, so opening/canceling the menu never punishes the player.
    try { player.startItemCooldown(WARP_STONE_ID, 20 * 30); } catch (_) {}
    if (!result.cinematic) player.sendMessage(T("sfw.message.instant_fallback"));
}


export async function handleReturnScrollUse(player) {
    const anchor = getReturnAnchor(player);
    if (!anchor) {
        player.sendMessage(T("sfw.return.no_anchor"));
        return;
    }

    playPlayerSound(player, "sfw.scroll.use", 1.2, 1.0);
    player.sendMessage(T("sfw.return.source"));
    const result = await teleportToReturnAnchor(player, anchor);
    if (!result.ok) {
        if (result.reason === "busy") player.sendMessage(T("sfw.message.busy"));
        else player.sendMessage(T("sfw.return.failed"));
        return;
    }

    consumeOneReturnScroll(player);
    player.sendMessage(T("sfw.return.success"));
}

function consumeOneReturnScroll(player) {
    try {
        player.runCommand(`clear @s ${RETURN_SCROLL_ID} 0 1`);
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones] Return Scroll consume failed: ${error}`);
    }
}


export async function handleDeathScrollUse(player) {
    const anchor = getDeathAnchor(player);
    if (!anchor) {
        player.sendMessage(T("sfw.death.no_anchor"));
        return;
    }

    playPlayerSound(player, "sfw.scroll.use", 1.2, 0.92);
    player.sendMessage(raw(
        T("sfw.death.source"), text(" "),
        dimensionLabel(anchor.dimensionId),
        text(`  §8|§r  ${Math.floor(anchor.deathX ?? anchor.x)}, ${Math.floor(anchor.deathY ?? anchor.y)}, ${Math.floor(anchor.deathZ ?? anchor.z)}`)
    ));
    if (anchor.safeMode === "nearby" || anchor.safeMode === "last_safe") {
        player.sendMessage(T("sfw.death.safe_adjusted"));
    }

    const result = await teleportToDeathAnchor(player, anchor);
    if (!result.ok) {
        if (result.reason === "busy") player.sendMessage(T("sfw.message.busy"));
        else if (result.reason === "unsafe_anchor") player.sendMessage(T("sfw.death.no_safe_anchor"));
        else player.sendMessage(T("sfw.death.failed"));
        return;
    }

    consumeOneDeathScroll(player);
    player.sendMessage(T("sfw.death.success"));
}

function consumeOneDeathScroll(player) {
    try {
        player.runCommand(`clear @s ${DEATH_SCROLL_ID} 0 1`);
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones] Death Scroll consume failed: ${error}`);
    }
}


export async function handleHomeScrollUse(player) {
    playPlayerSound(player, "sfw.scroll.use", 1.2, 1.08);
    const result = await teleportToHome(player);
    if (!result.ok) {
        if (result.reason === "busy") player.sendMessage(T("sfw.message.busy"));
        else if (result.reason === "no_safe_anchor") player.sendMessage(T("sfw.home.no_safe_anchor"));
        else player.sendMessage(T("sfw.home.failed"));
        return;
    }

    if (result.homeMode === "personal_safe") {
        player.sendMessage(T("sfw.home.source.personal"));
    } else {
        if (result.homeMode === "world_spawn_invalid_personal") {
            player.sendMessage(T("sfw.home.invalid_spawn"));
        } else {
            player.sendMessage(T("sfw.home.no_spawn"));
        }
        player.sendMessage(T("sfw.home.source.world"));
    }

    consumeOneHomeScroll(player);
    player.sendMessage(T("sfw.home.success"));
}

function consumeOneHomeScroll(player) {
    try {
        player.runCommand(`clear @s ${HOME_SCROLL_ID} 0 1`);
    } catch (error) {
        console.warn(`[Shift & Fade: Waystones] Home Scroll consume failed: ${error}`);
    }
}

async function editWaystone(player, record) {
    const form = new ModalFormData()
        .title(text(" "))
        .header(T("sfw.settings.title"))
        .label(text(record.name))
        .label(raw(dimensionLabel(record.dimensionId), text(`  §8|§r  ${record.x}, ${record.y}, ${record.z}`)))
        .divider()
        .textField(T("sfw.setup.name"), T("sfw.setup.name.placeholder"), { defaultValue: record.name })
        .toggle(T("sfw.setup.public"), { defaultValue: record.isPublic })
        .label(T("sfw.setup.public.help"))
        .submitButton(T("sfw.common.save"));
    const response = await safeShow(form, player);
    if (!response || response.canceled) return openWaystoneHome(player, record);
    const values = response.formValues ?? [];
    const nameValue = values.find((value) => typeof value === "string");
    const publicValue = values.find((value) => typeof value === "boolean");
    const updated = { ...record, name: sanitizeName(nameValue, record.name), isPublic: publicValue === true };
    upsertWaystone(updated);
    player.sendMessage(T("sfw.message.saved"));
    return openWaystoneHome(player, updated);
}

function sanitizeName(value, fallback) {
    const cleaned = String(value ?? "").replace(/[§\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);
    return cleaned || fallback;
}

function dimensionLabel(id) {
    if (id === "minecraft:overworld") return T("sfw.dimension.overworld");
    if (id === "minecraft:nether") return T("sfw.dimension.nether");
    if (id === "minecraft:the_end") return T("sfw.dimension.the_end");
    return text(id);
}

function dimensionIcon(id) {
    if (id === "minecraft:overworld") return "textures/shift_fade_waystones/ui/dimension_overworld";
    if (id === "minecraft:nether") return "textures/shift_fade_waystones/ui/dimension_nether";
    if (id === "minecraft:the_end") return "textures/shift_fade_waystones/ui/dimension_end";
    return "textures/blocks/sfw_waystone";
}

function waystoneInfo(record) {
    return raw(
        T(record.isPublic ? "sfw.info.public" : "sfw.info.private"),
        text("\n"), dimensionLabel(record.dimensionId),
        text(`\n${record.x}, ${record.y}, ${record.z}\n`),
        ...ownershipParts(record)
    );
}

async function safeShow(form, player) {
    try { return await form.show(player); }
    catch (error) {
        console.warn(`[Shift & Fade: Waystones] UI error: ${error}`);
        return undefined;
    }
}

export { DEATH_SCROLL_ID, HOME_SCROLL_ID, RETURN_SCROLL_ID, WARP_STONE_ID, WAYSTONE_ID };
