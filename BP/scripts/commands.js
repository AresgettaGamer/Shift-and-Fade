import {
    CommandPermissionLevel,
    CustomCommandParamType,
    CustomCommandStatus,
    Player,
    system,
    world,
} from "@minecraft/server";
import { emergencyReset, startAnimatedTeleport } from "./runtime.js";
import { getConfiguredDefaultStyle, setConfiguredDefaultStyle } from "./settings.js";

const STYLE_ENUM = "sf:style";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    customCommandRegistry.registerEnum(STYLE_ENUM, ["auto", "grand", "twilight"]);

    customCommandRegistry.registerCommand({
        name: "sf:tp",
        description: "shift_fade.command.description.tp",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: true,
        mandatoryParameters: [
            { type: CustomCommandParamType.Location, name: "destino" },
        ],
        optionalParameters: [
            { type: CustomCommandParamType.Enum, name: STYLE_ENUM },
        ],
    }, (origin, destination, style) => {
        const player = origin.sourceEntity;
        if (!(player instanceof Player)) {
            return { status: CustomCommandStatus.Failure, message: "Este comando debe ejecutarlo un jugador." };
        }
        system.run(() => startForPlayer(player, destination, style, false));
        return { status: CustomCommandStatus.Success, message: "Transición programada." };
    });

    customCommandRegistry.registerCommand({
        name: "sf:dimtp",
        description: "shift_fade.command.description.dimtp",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: true,
        mandatoryParameters: [
            { type: CustomCommandParamType.String, name: "dimension" },
            { type: CustomCommandParamType.Location, name: "destino" },
        ],
        optionalParameters: [
            { type: CustomCommandParamType.Enum, name: STYLE_ENUM },
        ],
    }, (origin, dimensionId, destination, style) => {
        const player = origin.sourceEntity;
        if (!(player instanceof Player)) {
            return { status: CustomCommandStatus.Failure, message: "Este comando debe ejecutarlo un jugador." };
        }
        let dimension;
        try { dimension = world.getDimension(String(dimensionId)); }
        catch (_) {
            return { status: CustomCommandStatus.Failure, message: `Dimensión no válida: ${dimensionId}` };
        }
        system.run(() => startForPlayer(player, destination, style, false, dimension));
        return { status: CustomCommandStatus.Success, message: `Transición dimensional programada: ${dimension.id}` };
    });

    customCommandRegistry.registerCommand({
        name: "sf:send",
        description: "shift_fade.command.description.send",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        mandatoryParameters: [
            { type: CustomCommandParamType.PlayerSelector, name: "jugadores" },
            { type: CustomCommandParamType.Location, name: "destino" },
        ],
        optionalParameters: [
            { type: CustomCommandParamType.Enum, name: STYLE_ENUM },
        ],
    }, (_origin, players, destination, style) => {
        const targets = Array.isArray(players) ? players.filter((p) => p instanceof Player) : [];
        if (targets.length === 0) {
            return { status: CustomCommandStatus.Failure, message: "No se encontraron jugadores válidos." };
        }
        system.run(() => {
            for (const player of targets) startForPlayer(player, destination, style, true);
        });
        return { status: CustomCommandStatus.Success, message: `Transición programada para ${targets.length} jugador(es).` };
    });

    customCommandRegistry.registerCommand({
        name: "sf:mode",
        description: "shift_fade.command.description.mode",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        optionalParameters: [
            { type: CustomCommandParamType.Enum, name: STYLE_ENUM },
        ],
    }, (_origin, style) => {
        if (style === undefined) {
            const current = getConfiguredDefaultStyle();
            return { status: CustomCommandStatus.Success, message: `Shift & Fade mode: ${current}` };
        }
        const normalized = String(style).toLowerCase();
        system.run(() => setConfiguredDefaultStyle(normalized));
        return { status: CustomCommandStatus.Success, message: `Shift & Fade mode set to: ${normalized}` };
    });

    customCommandRegistry.registerCommand({
        name: "sf:reset",
        description: "shift_fade.command.description.reset",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        optionalParameters: [
            { type: CustomCommandParamType.PlayerSelector, name: "jugadores" },
        ],
    }, (origin, players) => {
        let targets = Array.isArray(players) ? players.filter((p) => p instanceof Player) : [];
        if (targets.length === 0 && origin.sourceEntity instanceof Player) targets = [origin.sourceEntity];
        if (targets.length === 0) {
            return { status: CustomCommandStatus.Failure, message: "No se encontraron jugadores para restaurar." };
        }
        system.run(() => { for (const player of targets) emergencyReset(player, true); });
        return { status: CustomCommandStatus.Success, message: `Restauración programada para ${targets.length} jugador(es).` };
    });
});

function startForPlayer(player, destination, style, silent, dimension = player.dimension) {
    const x = Number(destination?.x);
    const y = Number(destination?.y);
    const z = Number(destination?.z);
    if (![x, y, z].every(Number.isFinite)) {
        player.sendMessage("§d[Shift & Fade]§r §cEl destino no es válido.§r");
        return;
    }
    startAnimatedTeleport(player, {
        x, y, z,
        dimension,
        mode: style ?? "auto",
        exactY: true,
        silent,
        source: "command",
        fallbackOnError: true,
        integration: {
            source: "shift_fade:command",
            teleportNearbyTamed: true,
            companionRadius: 10,
        },
    });
}
