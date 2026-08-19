import { ActionFormData } from "@minecraft/server-ui";
import { system, world } from "@minecraft/server";
import {
    clearPendingPad,
    getPad,
    getPadRegistry,
    getPendingPad,
    linkPads,
    makePadId,
    removePad,
    setPendingPad,
    unlinkPad,
    upsertPad,
} from "./storage.js";
import { teleportViaPad } from "./teleport.js";

export const TELEPORT_PAD_ID = "shift_fade_waystones:teleport_pad";
const BUILD_LABEL = "Release v1.0.0";

const padTravelState = new Map();
const padAmbientState = new Map();
let padAmbientClock = 0;

const T = (key, withValues = []) => withValues.length
    ? ({ translate: key, with: withValues.map((value) => String(value)) })
    : ({ translate: key });
const text = (value) => ({ text: String(value) });
const raw = (...parts) => ({ rawtext: parts.flat() });

export function registerPlacedPad(player, block) {
    const id = makePadId(block.dimension.id, block.location);
    const existing = getPad(id);
    if (existing) return existing;
    const record = {
        id,
        dimensionId: block.dimension.id,
        x: Math.floor(block.location.x),
        y: Math.floor(block.location.y),
        z: Math.floor(block.location.z),
        ownerName: player.name,
    };
    if (!upsertPad(record)) {
        player.sendMessage(T("sfw.pad.registry_full"));
        return undefined;
    }
    player.sendMessage(T("sfw.pad.placed"));
    return record;
}

export async function handleTeleportPadInteract(player, block) {
    const id = makePadId(block.dimension.id, block.location);
    let record = getPad(id);
    if (!record) record = registerPlacedPad(player, block);
    if (!record) return;

    // Clear stale pending selections before rendering the UI.
    let pendingId = getPendingPad(player);
    let pending = pendingId ? getPad(pendingId) : undefined;
    if (pendingId && (!pending || pending.linkId)) {
        clearPendingPad(player);
        pendingId = undefined;
        pending = undefined;
    }

    if (record.linkId) return openLinkedPad(player, record);
    return openUnlinkedPad(player, record, pending);
}

async function openUnlinkedPad(player, record, pending) {
    const owner = record.ownerName === player.name;
    const selectedThis = pending?.id === record.id;
    const canComplete = owner && pending && pending.id !== record.id && pending.ownerName === player.name && !pending.linkId;

    const form = new ActionFormData()
        .title(text(" "))
        .header(T("sfw.pad.title"))
        .label(T("sfw.pad.unlinked"))
        .label(padInfo(record))
        .divider();

    if (owner) {
        if (selectedThis) {
            form.label(T("sfw.pad.selected.help"));
            form.button(T("sfw.pad.cancel_selection"));
        } else if (canComplete) {
            form.label(raw(T("sfw.pad.link.from"), text(" "), padShortInfo(pending)));
            form.button(T("sfw.pad.link.complete"));
            form.button(T("sfw.pad.select_instead"));
        } else {
            form.label(T("sfw.pad.select.help"));
            form.button(T("sfw.pad.select"));
        }
    } else {
        form.label(T("sfw.pad.owner_only"));
    }
    form.button(T("sfw.common.close"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;

    if (!owner) return;
    if (selectedThis) {
        if (response.selection === 0) {
            clearPendingPad(player);
            player.sendMessage(T("sfw.pad.selection_cleared"));
        }
        return;
    }

    if (canComplete) {
        if (response.selection === 0) {
            const freshPending = getPad(pending.id);
            const freshCurrent = getPad(record.id);
            if (!freshPending || !freshCurrent || freshPending.linkId || freshCurrent.linkId ||
                freshPending.ownerName !== player.name || freshCurrent.ownerName !== player.name) {
                clearPendingPad(player);
                player.sendMessage(T("sfw.pad.link_failed"));
                return;
            }
            if (!linkPads(freshPending.id, freshCurrent.id)) {
                player.sendMessage(T("sfw.pad.link_failed"));
                return;
            }
            clearPendingPad(player);
            player.sendMessage(T("sfw.pad.linked"));
            console.warn(
                `[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport Pads linked ` +
                `${freshPending.id} <-> ${freshCurrent.id}`
            );
            return;
        }
        if (response.selection === 1) {
            setPendingPad(player, record.id);
            player.sendMessage(T("sfw.pad.selected"));
        }
        return;
    }

    if (response.selection === 0) {
        setPendingPad(player, record.id);
        player.sendMessage(T("sfw.pad.selected"));
    }
}

async function openLinkedPad(player, record) {
    const partner = getPad(record.linkId);
    if (!partner || partner.linkId !== record.id) {
        unlinkPad(record.id);
        player.sendMessage(T("sfw.pad.link_broken"));
        return;
    }

    const owner = record.ownerName === player.name;
    const form = new ActionFormData()
        .title(text(" "))
        .header(T("sfw.pad.title"))
        .label(T("sfw.pad.linked_status"))
        .label(padInfo(record))
        .divider()
        .label(raw(T("sfw.pad.destination"), text(" "), padShortInfo(partner)));

    if (owner) form.divider().button(T("sfw.pad.unlink"));
    form.button(T("sfw.common.close"));

    const response = await safeShow(form, player);
    if (!response || response.canceled || response.selection === undefined) return;
    if (owner && response.selection === 0) {
        unlinkPad(record.id);
        player.sendMessage(T("sfw.pad.unlinked_success"));
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport Pads unlinked ${record.id}`);
    }
}

export function cleanupBrokenPad(player, dimensionId, location) {
    const id = makePadId(dimensionId, location);
    const pending = getPendingPad(player);
    if (pending === id) clearPendingPad(player);
    const record = getPad(id);
    if (!record) return false;
    const linked = Boolean(record.linkId);
    removePad(id);
    if (linked) player.sendMessage(T("sfw.pad.partner_unlinked"));
    return true;
}

export function tickTeleportPads() {
    for (const player of world.getAllPlayers()) {
        const block = getPadUnderPlayer(player);
        let state = padTravelState.get(player.id);
        if (!state) {
            // Do not fire merely because the player joined/reloaded while already standing on a pad.
            // A fresh player state must leave the pad once before the movement trigger becomes armed.
            state = { armed: !block, busy: false, padId: block ? makePadId(block.dimension.id, block.location) : undefined };
            padTravelState.set(player.id, state);
            continue;
        }

        if (!block) {
            state.armed = true;
            state.padId = undefined;
            padTravelState.set(player.id, state);
            continue;
        }

        const padId = makePadId(block.dimension.id, block.location);
        state.padId = padId;
        padTravelState.set(player.id, state);

        if (!state.armed || state.busy) continue;
        const source = getPad(padId);
        if (!source?.linkId) continue;
        const target = getPad(source.linkId);
        if (!target || target.linkId !== source.id) {
            unlinkPad(source.id);
            player.sendMessage(T("sfw.pad.link_broken"));
            continue;
        }

        // Disarm immediately. Whether the travel succeeds or fails, the player must leave the pad
        // before it can fire again. This also prevents arrival on the linked pad from bouncing back.
        state.armed = false;
        state.busy = true;
        padTravelState.set(player.id, state);

        system.run(async () => {
            const result = await teleportViaPad(player, source, target);
            const latest = padTravelState.get(player.id) ?? state;
            latest.busy = false;
            latest.armed = false;
            padTravelState.set(player.id, latest);

            if (!result.ok) {
                if (result.reason === "busy") player.sendMessage(T("sfw.message.busy"));
                else player.sendMessage(T("sfw.pad.teleport_failed"));
                return;
            }
            if (!result.cinematic) player.sendMessage(T("sfw.pad.instant_fallback"));
        });
    }
}

export function tickTeleportPadAmbience() {
    padAmbientClock += 20;
    const activePads = getPadRegistry().filter((pad) => typeof pad.linkId === "string" && pad.linkId);
    for (const player of world.getAllPlayers()) {
        let nearest;
        let nearestDistance = Infinity;
        for (const pad of activePads) {
            if (pad.dimensionId !== player.dimension.id) continue;
            const dx = player.location.x - (pad.x + 0.5);
            const dy = player.location.y - (pad.y + 0.35);
            const dz = player.location.z - (pad.z + 0.5);
            const distance = Math.hypot(dx, dy, dz);
            if (distance <= 14 && distance < nearestDistance) {
                nearest = pad;
                nearestDistance = distance;
            }
        }

        if (!nearest) {
            padAmbientState.delete(player.id);
            continue;
        }

        const previous = padAmbientState.get(player.id);
        const changedPad = previous?.padId !== nearest.id;
        if (!changedPad && previous && padAmbientClock < previous.nextPlay) continue;

        try {
            player.playSound("sfw.teleport_pad.ambient", {
                location: { x: nearest.x + 0.5, y: nearest.y + 0.35, z: nearest.z + 0.5 },
                volume: 1.25,
                pitch: 1.0,
            });
        } catch (_) {}
        // The source clip is about eight seconds. Replay when it ends to create a portal-like
        // continuous ambience while the player remains nearby without stacking multiple copies.
        padAmbientState.set(player.id, { padId: nearest.id, nextPlay: padAmbientClock + 160 });
    }
}

export function clearPadPlayerState(playerId) {
    padTravelState.delete(playerId);
    padAmbientState.delete(playerId);
}

function getPadUnderPlayer(player) {
    const x = Math.floor(player.location.x);
    const z = Math.floor(player.location.z);
    const baseY = Math.floor(player.location.y);
    for (const y of [baseY, baseY - 1]) {
        try {
            const block = player.dimension.getBlock({ x, y, z });
            if (block?.typeId === TELEPORT_PAD_ID) return block;
        } catch (_) {}
    }
    return undefined;
}

function padInfo(record) {
    return raw(
        dimensionLabel(record.dimensionId),
        text(`  §8|§r  ${record.x}, ${record.y}, ${record.z}\n`),
        T("sfw.info.owner"), text(` ${record.ownerName}`)
    );
}

function padShortInfo(record) {
    return [
        dimensionLabel(record.dimensionId),
        text(`  §8|§r  ${record.x}, ${record.y}, ${record.z}`),
    ];
}

function dimensionLabel(id) {
    if (id === "minecraft:overworld") return T("sfw.dimension.overworld");
    if (id === "minecraft:nether") return T("sfw.dimension.nether");
    if (id === "minecraft:the_end") return T("sfw.dimension.the_end");
    return text(id);
}

async function safeShow(form, player) {
    try { return await form.show(player); }
    catch (error) {
        console.warn(`[Shift & Fade: Waystones ${BUILD_LABEL}] Teleport Pad UI error: ${error}`);
        return undefined;
    }
}
