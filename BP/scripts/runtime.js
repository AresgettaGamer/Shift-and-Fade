import {
    EasingType,
    Player,
    StructureSaveMode,
    InputPermissionCategory,
    system,
    world,
} from "@minecraft/server";
import { BUILD_LABEL, getConfiguredDefaultStyle } from "./settings.js";
const PACK_PREFIX = "§d[Shift & Fade]§r ";
const TICKS_PER_SECOND = 20;
const GRAND_VISIBLE_TRAVEL_LIMIT = 64;
const GRAND_CRUISE_HEIGHT = 62;
const GRAND_VISIBLE_TRAVEL_SECONDS = 2.40;
const GRAND_SOUND_UP = "shift_fade.grand.up";
const GRAND_SOUND_TRANSITION = "shift_fade.grand.transition";
const GRAND_SOUND_DOWN = "shift_fade.grand.down";
const GRAND_SOUND_VOLUME = 3.0;
const TWILIGHT_SOUND_TRAVEL = "shift_fade.twilight.travel";
const TWILIGHT_SOUND_ARRIVAL = "shift_fade.twilight.arrival";
const AUTO_GRAND_LIMIT = 1000;
const DESTINATION_LOAD_TIMEOUT_TICKS = 220;
const DESTINATION_TICKING_RADIUS = 80;
const sessions = new Map();
let nextSessionNumber = 1;
let nextCompanionHandoffNumber = 1;
const TRANSIT_JOURNAL_PROPERTY = "shift_fade:companion_transit_v1";

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    system.runTimeout(() => {
        if (!sessions.has(player.id)) emergencyReset(player, false);
    }, 20);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    const session = sessions.get(playerId);
    if (!session) return;
    clearCameraRun(session);
    clearParticleRun(session);
    clearScheduledRuns(session);
    removeTickingArea(session);
    sessions.delete(playerId);
});

export function isTransitionActive(player) {
    return sessions.has(player.id);
}

export function resolveTeleportMode(player, request) {
    const requested = String(request.mode ?? request.style ?? "auto").toLowerCase();
    // An explicit per-request style always wins over the world preference.
    if (requested === "grand" || requested === "twilight") return requested;

    // Requests using Auto inherit the host/world preference. This lets integrations such
    // as Waystones keep asking for Auto while the world owner chooses a consistent style.
    const configured = getConfiguredDefaultStyle();
    if (configured === "grand" || configured === "twilight") return configured;

    // True Auto: cross-dimension defaults to Twilight because the fade naturally hides
    // the dimension handoff; same-dimension keeps the original distance rule.
    if (request.dimension?.id && request.dimension.id !== player.dimension.id) return "twilight";

    const distance = request.requestedDistance ?? horizontalDistance(player.location, request);
    return distance <= AUTO_GRAND_LIMIT ? "grand" : "twilight";
}

export function startAnimatedTeleport(player, request) {
    if (sessions.has(player.id)) {
        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Ya hay una transición activa.`);
        return false;
    }

    request.dimension ??= player.dimension;
    request.crossDimension = request.dimension.id !== player.dimension.id;
    request.requestedDistance ??= horizontalDistance(player.location, request);
    request.mode = resolveTeleportMode(player, request);
    request.fallbackOnError ??= true;
    request.capturedCompanions = captureCompanions(player, request.integration);

    const runner = request.mode === "twilight" ? runTwilightTeleport : runGrandTeleport;
    runner(player, request).then(() => {
        try { request.onComplete?.(); } catch (_) {}
    }).catch(async (error) => {
        reportError(player, "La transición fue cancelada", error);
        emergencyReset(player, false);
        let fallbackUsed = false;

        if (request.fallbackOnError && !request.teleportCompleted && !request.disableFallbackAfterTransitRollback) {
            try {
                const fallbackLocation = { x: request.x, y: request.y, z: request.z };
                await performRequestedTeleport(player, request, fallbackLocation, player.getRotation());
                fallbackUsed = true;
                if (!request.silent) player.sendMessage(`${PACK_PREFIX}§eSe usó el TP normal de recuperación.§r`);
            } catch (fallbackError) {
                reportError(player, "También falló el TP de recuperación", fallbackError);
            }
        }
        try { request.onFailure?.(error, fallbackUsed); } catch (_) {}
    });
    return true;
}

async function runGrandTeleport(player, request) {
    const session = createSession(player, "grand");
    sessions.set(player.id, session);

    try {
        beginSession(player, session);
        const origin = cloneVector(player.location);
        const originHead = cloneVector(player.getHeadLocation());
        const originRotation = cloneRotation(player.getRotation());
        // Coordinates are not spatially comparable across dimensions, so explicit Grand uses the
        // player's facing direction for the visible departure/arrival segments.
        const direction = request.crossDimension ? getHorizontalDirection(player) : normalizedDirectionTo(origin, request);
        const distance = request.requestedDistance ?? horizontalDistance(origin, request);

        if (!request.silent) {
            const detail = request.crossDimension ? "cambio de dimensión" : `${Math.round(distance)} bloques`;
            player.sendMessage(`${PACK_PREFIX}Grand iniciado: §f${detail}§r.`);
        }
        setStatus(player, request.crossDimension
            ? "Grand: salida → cambio dimensional oculto → llegada"
            : (distance <= GRAND_VISIBLE_TRAVEL_LIMIT
                ? "Grand: recorrido corto visible"
                : "Grand: salida visible → corte negro → llegada visible"));

        const destinationPromise = prepareDestination(session, request.dimension, request.x, request.z, request.y, request.exactY);

        // Cross-dimension Grand must always use the hybrid path; a continuous short path cannot
        // exist across two dimensions.
        if (!request.crossDimension && distance <= GRAND_VISIBLE_TRAVEL_LIMIT) {
            await runShortGrand(player, session, {
                origin,
                originHead,
                originRotation,
                direction,
                distance,
                destinationPromise,
                request,
            });
        } else {
            await runHybridGrand(player, session, {
                origin,
                originHead,
                originRotation,
                direction,
                distance,
                destinationPromise,
                request,
            });
        }

        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Teletransporte Grand completado.`);
    } finally {
        finishSession(player, session);
    }
}

async function runShortGrand(player, session, context) {
    const { origin, originHead, originRotation, distance, destinationPromise, request } = context;
    const destinationData = await withTimeout(
        destinationPromise,
        DESTINATION_LOAD_TIMEOUT_TICKS,
        "El destino no cargó a tiempo"
    );
    ensureSession(player, session);

    const destination = destinationData.location;
    const destinationHead = headLocation(destination);
    const cruiseY = Math.max(origin.y, destination.y) + GRAND_CRUISE_HEIGHT;
    const travelSeconds = clamp(
        GRAND_VISIBLE_TRAVEL_SECONDS * (distance / GRAND_VISIBLE_TRAVEL_LIMIT),
        0.85,
        GRAND_VISIBLE_TRAVEL_SECONDS
    );

    setFreeCameraRotation(player, originHead, originRotation);
    await delayTicks(2);
    // Grand usa cámara libre muy lejos de la entidad. El sonido se origina cerca de la
    // trayectoria de cámara, no cerca del jugador, para evitar atenuación durante el viaje.
    scheduleSessionTask(player, session, 1, () => tryPlaySoundAt(player, GRAND_SOUND_UP, GRAND_SOUND_VOLUME, 1.0,
        { x: origin.x, y: origin.y + 31, z: origin.z }));

    // El ascenso conserva exactamente la X/Z del jugador.
    await cameraToFacing(player, session,
        { x: origin.x, y: origin.y + 10, z: origin.z },
        groundFocus(origin), 0.68, EasingType.OutCubic);
    await cameraToFacing(player, session,
        { x: origin.x, y: origin.y + 28, z: origin.z },
        groundFocus(origin), 0.76, EasingType.InOutSine);
    await cameraToFacing(player, session,
        { x: origin.x, y: cruiseY, z: origin.z },
        groundFocus(origin), 0.92, EasingType.InOutCubic);

    // Un solo recorrido continuo: sin punto medio ni segundo tirón.
    const shortTravelStart = { x: origin.x, y: cruiseY, z: origin.z };
    const shortTravelEnd = { x: destination.x, y: cruiseY, z: destination.z };
    const shortTravelSoundLocation = lerpVector(shortTravelStart, shortTravelEnd, 0.5);
    let shortTransitionSound;
    scheduleSessionTask(player, session, 1, () => {
        shortTransitionSound = tryPlaySoundAt(player, GRAND_SOUND_TRANSITION, GRAND_SOUND_VOLUME, 1.0, shortTravelSoundLocation);
    });
    await runLinearOverheadTravel(
        player,
        session,
        shortTravelStart,
        shortTravelEnd,
        travelSeconds
    );

    fade(player, 0.14, 0.18, 0.22);
    await delayTicks(4);
    ensureSession(player, session);
    await performRequestedTeleport(player, request, destination, originRotation);

    // Corta la cola de transición antes del cue de llegada cuando SoundInstance está disponible.
    try { shortTransitionSound?.stop?.(); } catch (_) {}

    // La cámara ya está exactamente encima del destino: solo desciende.
    scheduleSessionTask(player, session, 1, () => tryPlaySoundAt(player, GRAND_SOUND_DOWN, GRAND_SOUND_VOLUME, 1.0,
        { x: destination.x, y: destination.y + 31, z: destination.z }));
    await cameraToFacing(player, session,
        { x: destination.x, y: destination.y + 27, z: destination.z },
        groundFocus(destination), 0.82, EasingType.InOutCubic);
    await cameraToFacing(player, session,
        { x: destination.x, y: destination.y + 11, z: destination.z },
        groundFocus(destination), 0.72, EasingType.InOutSine);
    await cameraToFacing(player, session,
        { x: destination.x, y: destination.y + 4.2, z: destination.z },
        bodyFocus(destination), 0.62, EasingType.InOutSine);
    await cameraToRotation(player, session, destinationHead, originRotation, 0.44, EasingType.InOutSine);
}

async function runHybridGrand(player, session, context) {
    const { origin, originHead, originRotation, direction, destinationPromise, request } = context;
    const visibleTravel = GRAND_VISIBLE_TRAVEL_LIMIT;
    const originCruiseY = origin.y + GRAND_CRUISE_HEIGHT;

    setFreeCameraRotation(player, originHead, originRotation);
    await delayTicks(2);
    scheduleSessionTask(player, session, 1, () => tryPlaySoundAt(player, GRAND_SOUND_UP, GRAND_SOUND_VOLUME, 1.0,
        { x: origin.x, y: origin.y + 31, z: origin.z }));

    const verticalDeparture = [
        { y: 10, seconds: 0.68, easing: EasingType.OutCubic },
        { y: 28, seconds: 0.76, easing: EasingType.InOutSine },
        { y: GRAND_CRUISE_HEIGHT, seconds: 0.92, easing: EasingType.InOutCubic },
    ];

    for (const stage of verticalDeparture) {
        await cameraToFacing(player, session,
            { x: origin.x, y: origin.y + stage.y, z: origin.z },
            groundFocus(origin), stage.seconds, stage.easing);
    }

    // Recorre exactamente 64 bloques de forma continua y mirando verticalmente al suelo.
    const departureStart = { x: origin.x, y: originCruiseY, z: origin.z };
    const departureEnd = {
        x: origin.x + direction.x * visibleTravel,
        y: originCruiseY,
        z: origin.z + direction.z * visibleTravel,
    };
    const departureSoundLocation = lerpVector(departureStart, departureEnd, 0.5);
    scheduleSessionTask(player, session, 1, () => tryPlaySoundAt(player, GRAND_SOUND_TRANSITION, GRAND_SOUND_VOLUME, 1.0, departureSoundLocation));
    await runLinearOverheadTravel(
        player,
        session,
        departureStart,
        departureEnd,
        GRAND_VISIBLE_TRAVEL_SECONDS
    );

    setStatus(player, "Grand: preparando el destino…");
    const destinationData = await withTimeout(
        destinationPromise,
        DESTINATION_LOAD_TIMEOUT_TICKS,
        "El destino no cargó a tiempo"
    );
    ensureSession(player, session);

    setStatus(player, "Grand: ocultando el tramo intermedio…");
    fade(player, 0.50, 1.15, 0.68);

    await delayTicks(12);
    ensureSession(player, session);

    const destination = destinationData.location;
    const destinationHead = headLocation(destination);
    const destinationCruiseY = destination.y + GRAND_CRUISE_HEIGHT;
    await performRequestedTeleport(player, request, destination, originRotation);

    // Reaparece exactamente 64 bloques antes del destino y recorre todo ese tramo fluidamente.
    const arrivalStart = {
        x: destination.x - direction.x * visibleTravel,
        y: destinationCruiseY,
        z: destination.z - direction.z * visibleTravel,
    };
    const arrivalEnd = {
        x: destination.x,
        y: destinationCruiseY,
        z: destination.z,
    };
    setFreeCameraDown(player, arrivalStart);
    await delayTicks(8);
    setStatus(player, "Grand: aproximación fluida de 64 bloques…");
    const arrivalSoundLocation = lerpVector(arrivalStart, arrivalEnd, 0.5);
    let arrivalTransitionSound;
    scheduleSessionTask(player, session, 1, () => {
        arrivalTransitionSound = tryPlaySoundAt(player, GRAND_SOUND_TRANSITION, GRAND_SOUND_VOLUME, 1.0, arrivalSoundLocation);
    });
    await runLinearOverheadTravel(
        player,
        session,
        arrivalStart,
        arrivalEnd,
        GRAND_VISIBLE_TRAVEL_SECONDS
    );

    // Evita que la cola del audio de transición tape el cue de descenso.
    try { arrivalTransitionSound?.stop?.(); } catch (_) {}
    scheduleSessionTask(player, session, 1, () => tryPlaySoundAt(player, GRAND_SOUND_DOWN, GRAND_SOUND_VOLUME, 1.0,
        { x: destination.x, y: destination.y + 31, z: destination.z }));
    const verticalArrival = [
        { y: 27, seconds: 0.82, easing: EasingType.InOutCubic },
        { y: 11, seconds: 0.72, easing: EasingType.InOutSine },
        { y: 4.2, seconds: 0.62, easing: EasingType.InOutSine },
    ];

    for (const stage of verticalArrival) {
        await cameraToFacing(player, session,
            { x: destination.x, y: destination.y + stage.y, z: destination.z },
            stage.y > 5 ? groundFocus(destination) : bodyFocus(destination),
            stage.seconds, stage.easing);
    }

    await cameraToRotation(player, session, destinationHead, originRotation, 0.44, EasingType.InOutSine);
}

async function runTwilightTeleport(player, request) {
    const session = createSession(player, "twilight");
    sessions.set(player.id, session);

    try {
        beginSession(player, session);
        const origin = cloneVector(player.location);
        const originHead = cloneVector(player.getHeadLocation());
        const originRotation = cloneRotation(player.getRotation());
        const forward = getHorizontalDirection(player);
        const right = perpendicular(forward);
        const distance = request.requestedDistance ?? horizontalDistance(origin, request);
        const focus = bodyFocus(origin);

        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Twilight iniciado: §f${Math.round(distance)} bloques§r.`);
        setStatus(player, "Twilight: buscando una órbita libre…");

        const destinationPromise = prepareDestination(session, request.dimension, request.x, request.z, request.y, request.exactY);
        const departureOrbit = chooseSafeOrbit(player.dimension, focus, forward, right);
        const firstOrbitPoint = orbitPoint(
            focus, forward, right, departureOrbit.startAngle,
            departureOrbit.radius, departureOrbit.height
        );

        setFreeCameraRotation(player, originHead, originRotation);
        await delayTicks(2);
        await cameraToFacing(player, session, firstOrbitPoint, focus, 0.82, EasingType.OutCubic);

        // Arranca antes de la órbita y genera suficientes fragmentos para cubrir todo el cuerpo.
        startDissolveParticles(player, session, false, 82);
        // Oculta el cuerpo cuando la disolución ya alcanzó el torso, no después de terminar.
        scheduleSessionTask(player, session, 38, () => applyTemporaryInvisibility(player, session));
        tryPlaySound(player, TWILIGHT_SOUND_TRAVEL, 1.0, 1.0);
        await delayTicks(5);
        await runCircularOrbit(
            player, session, focus, forward, right,
            departureOrbit.startAngle, departureOrbit.endAngle,
            departureOrbit.radius, departureOrbit.height, 2.65
        );

        setStatus(player, "Twilight: preparando el destino…");
        const destinationData = await withTimeout(
            destinationPromise,
            DESTINATION_LOAD_TIMEOUT_TICKS,
            "El destino no cargó a tiempo"
        );
        ensureSession(player, session);

        applyTemporaryInvisibility(player, session);
        fade(player, 0.50, 1.10, 0.70);
        tryPlaySound(player, "mob.endermen.portal", 0.9, 0.55);

        await delayTicks(12);
        ensureSession(player, session);

        const destination = destinationData.location;
        await performRequestedTeleport(player, request, destination, originRotation);

        const destinationFocus = bodyFocus(destination);
        const arrivalOrbit = chooseSafeOrbit(player.dimension, destinationFocus, forward, right);
        const arrivalOrbitPoint = orbitPoint(
            destinationFocus, forward, right, arrivalOrbit.endAngle,
            arrivalOrbit.radius, arrivalOrbit.height
        );
        setFreeCameraFacing(player, arrivalOrbitPoint, destinationFocus);
        startDissolveParticles(player, session, true, 82);

        await delayTicks(9);
        removeTemporaryInvisibility(player, session);
        tryPlaySound(player, TWILIGHT_SOUND_ARRIVAL, 1.0, 1.0);

        setStatus(player, "Twilight: reconstrucción y regreso circular…");
        await runCircularOrbit(
            player, session, destinationFocus, forward, right,
            arrivalOrbit.endAngle, arrivalOrbit.startAngle,
            arrivalOrbit.radius, arrivalOrbit.height, 2.65
        );

        // Sin movimiento hacia la cabeza: un pequeño destello devuelve la vista directamente a los ojos.
        setStatus(player, "Twilight: reincorporación final…");
        fade(player, 0.08, 0.06, 0.16);
        await delayTicks(2);
        try { player.camera.clear(); } catch (_) {}
        await delayTicks(4);

        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Teletransporte Twilight completado.`);
    } finally {
        finishSession(player, session);
    }
}

function createSession(player, mode) {
    const movementWasEnabled = safePermissionState(player, InputPermissionCategory.Movement, true);
    const cameraWasEnabled = safePermissionState(player, InputPermissionCategory.Camera, true);
    let hadInvisibility = false;
    try {
        hadInvisibility = player.getEffect("invisibility") !== undefined;
    } catch (_) {}

    return {
        playerId: player.id,
        mode,
        token: nextSessionNumber++,
        areaId: undefined,
        cameraRunId: undefined,
        particleRunId: undefined,
        scheduledRunIds: [],
        movementWasEnabled,
        cameraWasEnabled,
        hadInvisibility,
        appliedInvisibility: false,
        finished: false,
    };
}

function beginSession(player, session) {
    setPermission(player, InputPermissionCategory.Movement, false);
    setPermission(player, InputPermissionCategory.Camera, false);
    try {
        player.teleport(player.location, {
            rotation: player.getRotation(),
            keepVelocity: false,
        });
    } catch (_) {}
    setStatus(player, `${session.mode === "grand" ? "Grand" : "Twilight"}: preparando transición…`);
}

function finishSession(player, session) {
    if (session.finished) return;
    session.finished = true;

    clearCameraRun(session);
    clearParticleRun(session);
    clearScheduledRuns(session);
    removeTickingArea(session);
    removeTemporaryInvisibility(player, session);

    try { player.camera.clear(); } catch (_) {}
    setPermission(player, InputPermissionCategory.Movement, session.movementWasEnabled);
    setPermission(player, InputPermissionCategory.Camera, session.cameraWasEnabled);
    try { player.onScreenDisplay.setActionBar(""); } catch (_) {}

    const active = sessions.get(player.id);
    if (active?.token === session.token) sessions.delete(player.id);
}

export function emergencyReset(player, notify) {
    const session = sessions.get(player.id);
    if (session) {
        finishSession(player, session);
    } else {
        try { player.camera.clear(); } catch (_) {}
        setPermission(player, InputPermissionCategory.Movement, true);
        setPermission(player, InputPermissionCategory.Camera, true);
        try { player.removeEffect("invisibility"); } catch (_) {}
        try { player.onScreenDisplay.setActionBar(""); } catch (_) {}
    }

    if (notify) player.sendMessage(`${PACK_PREFIX}Cámara, controles e invisibilidad restaurados.`);
}

async function prepareDestination(session, dimension, x, z, requestedY, exactY = false) {
    const manager = world.tickingAreaManager;
    const areaId = `shift_fade_${session.playerId.replace(/[^a-zA-Z0-9_]/g, "_").slice(-20)}_${session.token}`;
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    const minY = dimension.heightRange.min;
    const maxY = dimension.heightRange.max - 1;
    const r = DESTINATION_TICKING_RADIUS;
    const options = {
        dimension,
        from: { x: blockX - r, y: minY, z: blockZ - r },
        to: { x: blockX + r, y: maxY, z: blockZ + r },
    };

    if (!manager.hasCapacity(options)) {
        throw new Error("No hay capacidad disponible para precargar el destino");
    }

    session.areaId = areaId;
    await manager.createTickingArea(areaId, options);
    if (session.finished) {
        try { manager.removeTickingArea(areaId); } catch (_) {}
        throw new Error("La sesión terminó durante la precarga");
    }

    if (exactY) {
        const y = Number(requestedY);
        if (!Number.isFinite(y) || y < minY || y >= maxY) {
            throw new Error("La altura exacta del destino no es válida");
        }
        return {
            location: { x, y, z },
            topBlockType: "better_on_bedrock:waystone",
        };
    }

    const topBlock = dimension.getTopmostBlock({ x: blockX, z: blockZ });
    if (!topBlock) throw new Error("No se encontró una superficie segura en el destino");

    const y = topBlock.location.y + 1;
    if (y >= maxY) throw new Error("La superficie del destino está fuera del límite del mundo");

    return {
        location: { x: blockX + 0.5, y, z: blockZ + 0.5 },
        topBlockType: topBlock.typeId,
    };
}

function removeTickingArea(session) {
    if (!session?.areaId) return;
    try {
        const manager = world.tickingAreaManager;
        if (manager.hasTickingArea(session.areaId)) manager.removeTickingArea(session.areaId);
    } catch (_) {}
    session.areaId = undefined;
}

async function cameraToFacing(player, session, location, facingLocation, seconds, easingType) {
    ensureSession(player, session);
    player.camera.setCamera("minecraft:free", {
        location,
        facingLocation,
        easeOptions: {
            easeTime: seconds,
            easeType: easingType ?? EasingType.InOutSine,
        },
    });
    await delayTicks(seconds * TICKS_PER_SECOND + 1);
    ensureSession(player, session);
}

async function cameraToRotation(player, session, location, rotation, seconds, easingType) {
    ensureSession(player, session);
    player.camera.setCamera("minecraft:free", {
        location,
        rotation,
        easeOptions: {
            easeTime: seconds,
            easeType: easingType ?? EasingType.InOutSine,
        },
    });
    await delayTicks(seconds * TICKS_PER_SECOND + 1);
    ensureSession(player, session);
}

function setFreeCameraRotation(player, location, rotation) {
    player.camera.setCamera("minecraft:free", { location, rotation });
}

function setFreeCameraFacing(player, location, facingLocation) {
    player.camera.setCamera("minecraft:free", { location, facingLocation });
}

function setFreeCameraDown(player, location) {
    player.camera.setCamera("minecraft:free", {
        location,
        facingLocation: { x: location.x, y: location.y - 16, z: location.z },
    });
}

function runLinearOverheadTravel(player, session, start, end, seconds) {
    clearCameraRun(session);
    const totalTicks = Math.max(1, Math.round(seconds * TICKS_PER_SECOND));

    return new Promise((resolve, reject) => {
        let age = 0;
        session.cameraRunId = system.runInterval(() => {
            try {
                ensureSession(player, session);
                const rawProgress = clamp(age / totalTicks, 0, 1);
                const progress = smootherStep(rawProgress);
                const location = lerpVector(start, end, progress);
                setFreeCameraDown(player, location);

                age++;
                if (age > totalTicks) {
                    setFreeCameraDown(player, end);
                    clearCameraRun(session);
                    resolve();
                }
            } catch (error) {
                clearCameraRun(session);
                reject(error);
            }
        }, 1);
    });
}

function scheduleSessionTask(player, session, ticks, callback) {
    const runId = system.runTimeout(() => {
        const index = session.scheduledRunIds.indexOf(runId);
        if (index >= 0) session.scheduledRunIds.splice(index, 1);

        const active = sessions.get(player.id);
        if (!active || active.token !== session.token || session.finished) return;
        try { callback(); } catch (_) {}
    }, Math.max(0, Math.round(ticks)));
    session.scheduledRunIds.push(runId);
    return runId;
}

function clearScheduledRuns(session) {
    if (!session?.scheduledRunIds) return;
    for (const runId of session.scheduledRunIds) {
        try { system.clearRun(runId); } catch (_) {}
    }
    session.scheduledRunIds.length = 0;
}

function runCircularOrbit(player, session, focus, forward, right, startAngle, endAngle, radius, height, seconds) {
    clearCameraRun(session);
    const totalTicks = Math.max(1, Math.round(seconds * TICKS_PER_SECOND));

    return new Promise((resolve, reject) => {
        let age = 0;
        session.cameraRunId = system.runInterval(() => {
            try {
                ensureSession(player, session);
                const rawProgress = clamp(age / totalTicks, 0, 1);
                const progress = smootherStep(rawProgress);
                const angle = startAngle + (endAngle - startAngle) * progress;
                const location = orbitPoint(focus, forward, right, angle, radius, height);
                setFreeCameraFacing(player, location, focus);

                age++;
                if (age > totalTicks) {
                    clearCameraRun(session);
                    resolve();
                }
            } catch (error) {
                clearCameraRun(session);
                reject(error);
            }
        }, 1);
    });
}

function clearCameraRun(session) {
    if (session?.cameraRunId === undefined) return;
    try { system.clearRun(session.cameraRunId); } catch (_) {}
    session.cameraRunId = undefined;
}

function fade(player, fadeInTime, holdTime, fadeOutTime) {
    player.camera.fade({
        fadeColor: { red: 0, green: 0, blue: 0 },
        fadeTime: { fadeInTime, holdTime, fadeOutTime },
    });
}


function captureCompanions(player, integration) {
    if (!integration) return [];

    const result = [];
    const seen = new Set();
    let nearbyScanned = 0;
    let tamedSeen = 0;
    let ownerVerified = 0;
    let ownerRejected = 0;
    let bestEffort = 0;
    let explicit = 0;

    const addCompanion = (entity, reason) => {
        try {
            if (!entity || entity instanceof Player || entity.id === player.id || seen.has(entity.id)) return false;
            seen.add(entity.id);
            result.push({ entity, id: entity.id, typeId: entity.typeId, reason });
            return true;
        } catch (_) {
            return false;
        }
    };

    // Explicit IDs are authoritative: the integrating add-on selected these companions itself.
    if (Array.isArray(integration.companionEntityIds)) {
        for (const id of integration.companionEntityIds.slice(0, 16)) {
            try {
                const entity = world.getEntity(String(id));
                if (!entity || entity.dimension.id !== player.dimension.id) continue;
                if (addCompanion(entity, "explicit")) explicit++;
            } catch (_) {}
        }
    }

    if (integration.teleportNearbyTamed) {
        const radius = clamp(Number(integration.companionRadius) || 10, 1, 32);
        let nearby = [];
        try {
            nearby = player.dimension.getEntities({ location: player.location, maxDistance: radius });
        } catch (_) {}

        nearbyScanned = nearby.length;
        for (const entity of nearby) {
            try {
                if (entity instanceof Player || entity.id === player.id) continue;
                const status = getTamedOwnershipStatus(entity, player);
                if (!status.tamed) continue;
                tamedSeen++;

                if (status.ownerKnown) {
                    if (!status.ownedByPlayer) {
                        ownerRejected++;
                        continue;
                    }
                    if (addCompanion(entity, "owner_verified")) ownerVerified++;
                    continue;
                }

                // Vanilla pets such as wolves remove minecraft:tameable once tamed and retain
                // minecraft:is_tamed instead. The marker does not expose an owner ID, so nearby
                // vanilla tamed mobs remain best-effort compatible just as in the approved v1.0.x path.
                if (addCompanion(entity, "tamed_marker")) bestEffort++;
            } catch (_) {}
        }

        console.warn(`[Shift & Fade ${BUILD_LABEL}] Companion capture radius=${radius} scanned=${nearbyScanned} tamed=${tamedSeen} captured=${result.length} verified=${ownerVerified} bestEffort=${bestEffort} rejectedOwner=${ownerRejected} explicit=${explicit}`);
    } else if (explicit > 0) {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Companion capture explicit=${explicit} captured=${result.length}`);
    }

    return result;
}

function getTamedOwnershipStatus(entity, player) {
    let tamed = false;
    let ownerId;

    try {
        if (entity.getComponent("minecraft:is_tamed")) tamed = true;
    } catch (_) {}

    try {
        const tameable = entity.getComponent("minecraft:tameable");
        if (tameable?.isTamed) {
            tamed = true;
            if (typeof tameable.tamedToPlayerId === "string" && tameable.tamedToPlayerId) {
                ownerId = tameable.tamedToPlayerId;
            }
        }
    } catch (_) {}

    try {
        const tameMount = entity.getComponent("minecraft:tamemount");
        if (tameMount?.isTamed) {
            tamed = true;
            if (typeof tameMount.tamedToPlayerId === "string" && tameMount.tamedToPlayerId) {
                ownerId = tameMount.tamedToPlayerId;
            }
        }
    } catch (_) {}

    return {
        tamed,
        ownerKnown: ownerId !== undefined,
        ownedByPlayer: ownerId === player.id,
    };
}

async function performRequestedTeleport(player, request, location, rotation) {
    const targetDimension = request.dimension ?? player.dimension;
    const sourceDimension = player.dimension;
    const crossDimension = sourceDimension.id !== targetDimension.id;

    if (!crossDimension) {
        player.teleport(location, {
            dimension: targetDimension,
            rotation,
            keepVelocity: false,
            checkForBlocks: false,
        });
        request.teleportCompleted = true;
        teleportCapturedCompanions(player, request.capturedCompanions, location, targetDimension);
        scheduleIntegrationEffects(player, request);
        return;
    }

    let transaction;
    try {
        transaction = await captureCompanionsToTransitStructures(
            player,
            request.capturedCompanions,
            sourceDimension,
            targetDimension,
            location
        );
    } catch (error) {
        // A failed pre-handoff structure capture is already rolled back transactionally.
        // Do not immediately run the generic fallback with stale Entity references created
        // before that rollback; cancelling in-place is the safe behavior for the whole party.
        request.disableFallbackAfterTransitRollback = true;
        throw error;
    }

    try {
        player.teleport(location, {
            dimension: targetDimension,
            rotation,
            keepVelocity: false,
            checkForBlocks: false,
        });
        request.teleportCompleted = true;
        markTransitTransactionTargetPhase(transaction);

        const restoration = await restoreTransitTransactionToTarget(transaction, targetDimension, location);
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit restore captured=${transaction.entries.length} restored=${restoration.restored} failed=${restoration.failed} target=${targetDimension.id}`);
        if (restoration.failed > 0) {
            throw new Error(`Structure Transit could not restore ${restoration.failed} companion(s)`);
        }
        clearTransitJournal(transaction.id);
    } catch (error) {
        // If the player never completed the dimension handoff, restore every stored companion to
        // its original source cell. If the player already crossed, keep the persistent structures
        // and journal intact so startup recovery can restore them in the target dimension.
        if (!request.teleportCompleted) {
            await rollbackTransitTransaction(transaction, sourceDimension);
            clearTransitJournal(transaction.id);
        }
        throw error;
    }

    scheduleIntegrationEffects(player, request);
}

function scheduleIntegrationEffects(player, request) {
    if (request.integration?.soundId || request.integration?.animationId) {
        system.runTimeout(() => {
            if (request.integration?.soundId) {
                try { player.playSound(request.integration.soundId); } catch (_) {}
            }
            if (request.integration?.animationId) {
                try { player.playAnimation(request.integration.animationId); } catch (_) {}
            }
        }, 2);
    }
}

function transitStructureId(transactionId, index) {
    return `shift_fade:transit_${transactionId}_${index}`;
}

function transitTag(transactionId, index) {
    return `sft_${transactionId}_${index}`;
}

function safeTransitToken() {
    const raw = `${Date.now().toString(36)}_${(nextCompanionHandoffNumber++).toString(36)}`.toLowerCase();
    return raw.replace(/[^a-z0-9_]/g, "_").slice(-32);
}

function captureCellFromLocation(location) {
    return {
        x: Math.floor(location.x),
        y: Math.floor(location.y),
        z: Math.floor(location.z),
    };
}

function structureExists(structureId) {
    try { return world.structureManager.get(structureId) !== undefined; }
    catch (_) { return false; }
}

function deleteTransitStructure(structureId) {
    try { return world.structureManager.delete(structureId); }
    catch (_) { return false; }
}

function saveTransitStructure(entity, structureId) {
    const cell = captureCellFromLocation(entity.location);
    world.structureManager.createFromWorld(
        structureId,
        entity.dimension,
        cell,
        cell,
        {
            includeBlocks: false,
            includeEntities: true,
            saveMode: StructureSaveMode.World,
        }
    );
    return cell;
}

function placeTransitStructure(structureId, dimension, location) {
    world.structureManager.place(structureId, dimension, location, {
        includeBlocks: false,
        includeEntities: true,
    });
}

function getTransitJournal() {
    try {
        const raw = world.getDynamicProperty(TRANSIT_JOURNAL_PROPERTY);
        if (typeof raw !== "string" || !raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function setTransitJournal(entries) {
    try { world.setDynamicProperty(TRANSIT_JOURNAL_PROPERTY, JSON.stringify(entries)); }
    catch (error) { console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit journal write failed: ${error}`); }
}

function persistTransitTransaction(transaction) {
    const journal = getTransitJournal().filter(entry => entry?.id !== transaction.id);
    journal.push({
        id: transaction.id,
        phase: transaction.phase,
        sourceDimensionId: transaction.sourceDimensionId,
        targetDimensionId: transaction.targetDimensionId,
        targetLocation: transaction.targetLocation,
        entries: transaction.entries.map(entry => ({
            structureId: entry.structureId,
            tag: entry.tag,
            sourceCell: entry.sourceCell,
            sourceLocation: entry.sourceLocation,
            stagingCell: entry.stagingCell,
            sourceDimensionId: entry.sourceDimensionId,
            index: entry.index,
        })),
    });
    setTransitJournal(journal.slice(-16));
}

function clearTransitJournal(transactionId) {
    setTransitJournal(getTransitJournal().filter(entry => entry?.id !== transactionId));
}

function markTransitTransactionTargetPhase(transaction) {
    transaction.phase = "restore_target";
    persistTransitTransaction(transaction);
}

function entityAloneInCell(entity) {
    try {
        const cell = captureCellFromLocation(entity.location);
        const center = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
        const nearby = entity.dimension.getEntities({ location: center, maxDistance: 0.95 });
        return nearby.filter(other => {
            try { return other.id !== entity.id; } catch (_) { return false; }
        }).length === 0;
    } catch (_) {
        return false;
    }
}

function transitStagingCandidates(dimension, anchor, reserved) {
    const candidates = [];
    const baseX = Math.floor(anchor.x);
    const baseY = Math.floor(anchor.y);
    const baseZ = Math.floor(anchor.z);
    let minY = baseY - 8;
    let maxY = baseY + 8;
    try {
        const range = dimension.heightRange;
        minY = Math.max(minY, Math.ceil(range.min) + 1);
        maxY = Math.min(maxY, Math.floor(range.max) - 2);
    } catch (_) {}

    // Staging only needs a temporarily occupiable cell, not a long-term safe landing.
    // Scan a compact 3D grid around the player and let tryTeleport perform the actual
    // collision check. This is deliberately less restrictive than Safe Arrival: hazards
    // and nearby lava are irrelevant because companions remain here for only one tick.
    const rings = [2, 3, 4, 5, 6, 7, 8];
    const yOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];
    for (const radius of rings) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (const dz of [-radius, radius]) {
                for (const dy of yOffsets) {
                    const y = baseY + dy;
                    if (y < minY || y > maxY) continue;
                    const target = { x: baseX + dx + 0.5, y, z: baseZ + dz + 0.5 };
                    const key = companionLandingKey(target);
                    const columnKey = `column:${Math.floor(target.x)}:${Math.floor(target.z)}`;
                    if (reserved.has(key) || reserved.has(columnKey)) continue;
                    candidates.push(target);
                }
            }
        }
        for (let dz = -radius + 1; dz <= radius - 1; dz++) {
            for (const dx of [-radius, radius]) {
                for (const dy of yOffsets) {
                    const y = baseY + dy;
                    if (y < minY || y > maxY) continue;
                    const target = { x: baseX + dx + 0.5, y, z: baseZ + dz + 0.5 };
                    const key = companionLandingKey(target);
                    const columnKey = `column:${Math.floor(target.x)}:${Math.floor(target.z)}`;
                    if (reserved.has(key) || reserved.has(columnKey)) continue;
                    candidates.push(target);
                }
            }
        }
        if (candidates.length >= 160) break;
    }
    return candidates;
}

function transitCellHasOtherEntities(dimension, location, entityId) {
    try {
        const cell = captureCellFromLocation(location);
        const center = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
        return dimension.getEntities({ location: center, maxDistance: 0.95 }).some(other => {
            try { return other.id !== entityId; } catch (_) { return false; }
        });
    } catch (_) {
        return true;
    }
}

function resolveCapturedEntity(capturedEntry) {
    let entity = capturedEntry?.entity;
    try {
        if (entity?.isValid) return entity;
    } catch (_) {}
    if (capturedEntry?.id) {
        try {
            entity = world.getEntity(capturedEntry.id);
            if (entity?.isValid) return entity;
        } catch (_) {}
    }
    return undefined;
}

async function stageCompanionsForTransit(player, captured, sourceDimension) {
    const staged = [];
    const reserved = new Set();
    const anchor = cloneVector(player.location);

    try {
        for (let index = 0; index < captured.length; index++) {
            const capturedEntry = captured[index];
            const entity = resolveCapturedEntity(capturedEntry);
            if (!entity?.isValid || entity instanceof Player) {
                throw new Error(`Companion ${index} is not valid before transit staging`);
            }

            const originalLocation = cloneVector(entity.location);
            const originalCell = captureCellFromLocation(originalLocation);
            let stageLocation;
            const candidates = transitStagingCandidates(sourceDimension, anchor, reserved);

            for (const candidate of candidates) {
                if (transitCellHasOtherEntities(sourceDimension, candidate, entity.id)) continue;
                let moved = false;
                try {
                    moved = entity.tryTeleport(candidate, {
                        dimension: sourceDimension,
                        keepVelocity: false,
                        checkForBlocks: true,
                    });
                } catch (_) {
                    moved = false;
                }
                if (!moved) continue;
                stageLocation = cloneVector(entity.location);
                reserved.add(companionLandingKey(stageLocation));
                reserved.add(`column:${Math.floor(stageLocation.x)}:${Math.floor(stageLocation.z)}`);
                break;
            }

            if (!stageLocation) {
                throw new Error(`Could not stage companion ${index} for structure capture`);
            }

            staged.push({
                index,
                capturedEntry,
                entity,
                originalLocation,
                originalCell,
                stageLocation,
            });
        }

        // createFromWorld is synchronous, but moving and snapshotting the same entity in the same
        // script turn proved racy under 8-companion stress. Let Bedrock commit every same-dimension
        // staging move first, then snapshot the settled entities on the following tick.
        await system.waitTicks(1);

        for (const record of staged) {
            if (!record.entity?.isValid) {
                throw new Error(`Companion ${record.index} became invalid during transit staging`);
            }
            if (record.entity.dimension.id !== sourceDimension.id) {
                throw new Error(`Companion ${record.index} left the source dimension during transit staging`);
            }
            if (!entityAloneInCell(record.entity)) {
                throw new Error(`Companion ${record.index} did not remain isolated after transit staging`);
            }
        }

        console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit staging captured=${captured.length} staged=${staged.length} failed=0 source=${sourceDimension.id}`);
        return staged;
    } catch (error) {
        for (const record of staged) {
            try {
                if (record.entity?.isValid) {
                    record.entity.teleport(record.originalLocation, {
                        dimension: sourceDimension,
                        keepVelocity: false,
                        checkForBlocks: false,
                    });
                }
            } catch (_) {}
        }
        throw error;
    }
}

function restoreUnstoredStagedCompanions(staged, transaction, sourceDimension) {
    const storedIndexes = new Set(transaction.entries.map(entry => entry.index));
    for (const record of staged) {
        if (storedIndexes.has(record.index)) continue;
        try {
            if (!record.entity?.isValid) continue;
            record.entity.teleport(record.originalLocation, {
                dimension: sourceDimension,
                keepVelocity: false,
                checkForBlocks: false,
            });
        } catch (_) {}
    }
}

async function captureCompanionsToTransitStructures(player, captured, sourceDimension, targetDimension, targetLocation) {
    const transaction = {
        id: safeTransitToken(),
        phase: "capturing",
        sourceDimensionId: sourceDimension.id,
        targetDimensionId: targetDimension.id,
        targetLocation: cloneVector(targetLocation),
        entries: [],
    };

    if (!Array.isArray(captured) || captured.length === 0) {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit capture captured=0 stored=0 failed=0 source=${sourceDimension.id} target=${targetDimension.id}`);
        return transaction;
    }

    let staged = [];
    try {
        staged = await stageCompanionsForTransit(player, captured, sourceDimension);

        for (const record of staged) {
            const { index, entity, originalLocation, originalCell } = record;
            if (!entity?.isValid || entity instanceof Player) {
                throw new Error(`Companion ${index} is not valid before transit capture`);
            }
            if (!entityAloneInCell(entity)) {
                throw new Error(`Companion ${index} is no longer isolated before structure capture`);
            }

            const structureId = transitStructureId(transaction.id, index);
            const tag = transitTag(transaction.id, index);
            entity.addTag(tag);
            const stagingCell = saveTransitStructure(entity, structureId);
            if (!structureExists(structureId)) {
                try { entity.removeTag(tag); } catch (_) {}
                throw new Error(`Transit structure did not persist for companion ${index}`);
            }

            const entry = {
                index,
                structureId,
                tag,
                sourceCell: originalCell,
                sourceLocation: originalLocation,
                sourceDimensionId: sourceDimension.id,
                stagingCell,
            };
            transaction.entries.push(entry);
            persistTransitTransaction(transaction);

            // The entity has been stable in this cell for at least one full tick before the
            // snapshot. Keep the tag on the live original until removal for crash-safe recovery.
            entity.remove();
        }
    } catch (error) {
        await rollbackTransitTransaction(transaction, sourceDimension);
        restoreUnstoredStagedCompanions(staged, transaction, sourceDimension);
        clearTransitJournal(transaction.id);
        throw error;
    }

    console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit capture captured=${captured.length} stored=${transaction.entries.length} failed=0 source=${sourceDimension.id} target=${targetDimension.id}`);
    return transaction;
}

function findTransitEntity(dimension, location, tag) {
    try {
        return dimension.getEntities({ location, maxDistance: 8, tags: [tag] })[0];
    } catch (_) {
        return undefined;
    }
}

function findTransitEntityAnywhere(dimension, tag) {
    try {
        return dimension.getEntities({ tags: [tag] })[0];
    } catch (_) {
        return undefined;
    }
}

async function waitForTransitEntity(dimension, location, tag, attempts = 10) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const found = findTransitEntity(dimension, location, tag) ?? findTransitEntityAnywhere(dimension, tag);
        if (found?.isValid) return found;
        await system.waitTicks(1);
    }
    return findTransitEntity(dimension, location, tag) ?? findTransitEntityAnywhere(dimension, tag);
}

async function rollbackTransitTransaction(transaction, sourceDimension) {
    let restored = 0;
    let failed = 0;
    for (const entry of transaction.entries) {
        if (!structureExists(entry.structureId)) continue;
        try {
            const surviving = findTransitEntity(sourceDimension, entry.stagingCell ?? entry.sourceCell, entry.tag);
            if (surviving?.isValid) {
                // Capture never committed: the original entity survived. Drop the stored copy.
                if (!deleteTransitStructure(entry.structureId)) throw new Error("rollback duplicate structure delete failed");
                try { surviving.removeTag(entry.tag); } catch (_) {}
                const sourceLocation = entry.sourceLocation ?? entry.sourceCell;
                try { surviving.teleport(sourceLocation, { dimension: sourceDimension, keepVelocity: false, checkForBlocks: false }); } catch (_) {}
                restored++;
                continue;
            }

            const sourceLocation = entry.sourceLocation ?? entry.sourceCell;
            placeTransitStructure(entry.structureId, sourceDimension, captureCellFromLocation(sourceLocation));
            const entity = await waitForTransitEntity(sourceDimension, sourceLocation, entry.tag);
            if (!entity?.isValid) throw new Error("rollback entity not found");
            if (!deleteTransitStructure(entry.structureId)) {
                try { entity.remove(); } catch (_) {}
                throw new Error("rollback structure delete failed");
            }
            try { entity.removeTag(entry.tag); } catch (_) {}
            restored++;
        } catch (_) {
            failed++;
        }
    }
    console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit rollback stored=${transaction.entries.length} restored=${restored} failed=${failed} source=${sourceDimension.id}`);
    return { restored, failed };
}

async function restoreTransitTransactionToTarget(transaction, targetDimension, anchor) {
    let restored = 0;
    let failed = 0;
    const reserved = new Set();

    for (let index = 0; index < transaction.entries.length; index++) {
        const entry = transaction.entries[index];
        if (!structureExists(entry.structureId)) {
            failed++;
            continue;
        }
        const candidates = companionLandingCandidates(targetDimension, anchor, index, transaction.entries.length, reserved);
        const target = candidates[0] ?? companionEmergencyLanding(anchor, index);
        reserved.add(companionLandingKey(target));

        try {
            const placementCell = captureCellFromLocation(target);
            placeTransitStructure(entry.structureId, targetDimension, placementCell);
            const entity = await waitForTransitEntity(targetDimension, target, entry.tag);
            if (!entity?.isValid) throw new Error("placed structure did not expose tagged companion");

            // Structure placement already bypassed the inter-dimensional entity handoff. From this
            // point on, Safe Arrival is a normal same-dimension teleport.
            let snapped = false;
            try {
                snapped = entity.tryTeleport(target, {
                    dimension: targetDimension,
                    keepVelocity: false,
                    checkForBlocks: true,
                });
            } catch (_) {}
            if (!snapped) {
                const emergency = companionEmergencyLanding(anchor, index);
                entity.teleport(emergency, {
                    dimension: targetDimension,
                    keepVelocity: false,
                    checkForBlocks: false,
                });
            }

            if (!deleteTransitStructure(entry.structureId)) {
                try { entity.remove(); } catch (_) {}
                throw new Error("could not delete persistent transit structure after restore");
            }
            try { entity.removeTag(entry.tag); } catch (_) {}
            restored++;
        } catch (error) {
            failed++;
            console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit restore failure ${entry.structureId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { restored, failed };
}


function cleanupOrphanTransitStructures() {
    try {
        const referenced = new Set(
            getTransitJournal().flatMap(transaction =>
                Array.isArray(transaction?.entries)
                    ? transaction.entries.map(entry => entry?.structureId).filter(Boolean)
                    : []
            )
        );
        const ids = world.structureManager
            .getWorldStructureIds()
            .filter(id => id.startsWith("shift_fade:transit_"));
        let removed = 0;
        for (const id of ids) {
            if (referenced.has(id)) continue;
            if (deleteTransitStructure(id)) removed++;
        }
        if (removed > 0) {
            console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit orphan cleanup removed=${removed}`);
        }
    } catch (error) {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit orphan cleanup failed: ${error}`);
    }
}

async function recoverPendingTransitTransactions() {
    const journal = getTransitJournal();
    if (!journal.length) return;
    console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit startup recovery pending=${journal.length}`);

    for (const transaction of journal) {
        try {
            const sourceDimension = world.getDimension(transaction.sourceDimensionId);
            const targetDimension = world.getDimension(transaction.targetDimensionId);
            const useTarget = transaction.phase === "restore_target";
            let restored = 0;
            let failed = 0;

            for (const entry of transaction.entries ?? []) {
                if (!structureExists(entry.structureId)) continue;
                const location = useTarget
                    ? transaction.targetLocation
                    : (entry.sourceLocation ?? entry.sourceCell);
                const dimension = useTarget ? targetDimension : sourceDimension;
                try {
                    // A crash may happen after the entity was already placed but before the
                    // persistent structure was deleted. Reuse that tagged entity instead of
                    // placing the structure again and duplicating the companion.
                    const probeLocation = useTarget ? location : (entry.stagingCell ?? location);
                    let entity = findTransitEntity(dimension, probeLocation, entry.tag);
                    if (!entity?.isValid) {
                        placeTransitStructure(entry.structureId, dimension, captureCellFromLocation(location));
                        entity = await waitForTransitEntity(dimension, location, entry.tag, 6);
                    }
                    if (!entity?.isValid) throw new Error("startup recovery entity missing");
                    if (!deleteTransitStructure(entry.structureId)) {
                        try { entity.remove(); } catch (_) {}
                        throw new Error("startup recovery structure delete failed");
                    }
                    try { entity.removeTag(entry.tag); } catch (_) {}
                    if (!useTarget && entry.sourceLocation) {
                        try { entity.teleport(entry.sourceLocation, { dimension, keepVelocity: false, checkForBlocks: false }); } catch (_) {}
                    }
                    restored++;
                } catch (error) {
                    failed++;
                    console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit startup recovery failure ${entry.structureId}: ${error}`);
                }
            }

            console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit startup recovery id=${transaction.id} phase=${transaction.phase} restored=${restored} failed=${failed}`);
            if (failed === 0) clearTransitJournal(transaction.id);
        } catch (error) {
            console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit startup recovery transaction failure ${transaction?.id}: ${error}`);
        }
    }
}

system.runTimeout(() => {
    cleanupOrphanTransitStructures();
    recoverPendingTransitTransactions().catch(error => {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Structure Transit startup recovery error: ${error}`);
    });
}, 20);

function teleportCapturedCompanions(player, captured, location, dimension) {
    return teleportCapturedCompanionsScript(player, captured, location, dimension);
}

function teleportCapturedCompanionsScript(player, captured, location, dimension) {
    if (!Array.isArray(captured) || captured.length === 0) {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Companion transfer captured=0 moved=0 failed=0 safe=0 fallback=0 target=${dimension.id}`);
        return;
    }

    let moved = 0;
    let failed = 0;
    let safeMoved = 0;
    let fallbackMoved = 0;
    const failures = [];
    const reserved = new Set();
    const anchor = cloneVector(location);

    for (let index = 0; index < captured.length; index++) {
        const entry = captured[index];
        let entity = entry?.entity;

        // Prefer the live reference captured before the cinematic begins. Only fall back to an ID
        // lookup if that reference became invalid during the transition.
        try {
            void entity.id;
        } catch (_) {
            entity = undefined;
        }
        if (!entity && entry?.id) {
            try { entity = world.getEntity(entry.id); } catch (_) {}
        }

        if (!entity || entity instanceof Player || entity.id === player.id) {
            failed++;
            failures.push(`${String(entry?.id ?? "unknown").slice(-12)}:missing`);
            continue;
        }

        let success = false;
        const candidates = companionLandingCandidates(dimension, anchor, index, captured.length, reserved);
        for (const target of candidates) {
            try {
                success = entity.tryTeleport(target, {
                    dimension,
                    keepVelocity: false,
                    checkForBlocks: true,
                });
            } catch (_) {
                success = false;
            }
            if (success) {
                reserved.add(companionLandingKey(target));
                safeMoved++;
                break;
            }
        }

        // Last resort: the player's own anchor is known to be survivable for the player. We still
        // spread fallback positions tightly around it so a large party is less likely to stack and
        // shove one another into nearby hazards. This fallback is logged separately for diagnosis.
        if (!success) {
            const fallback = companionEmergencyLanding(anchor, index);
            try {
                entity.teleport(fallback, {
                    dimension,
                    keepVelocity: false,
                    checkForBlocks: false,
                });
                success = true;
                fallbackMoved++;
            } catch (error) {
                failures.push(`${String(entry?.id ?? "unknown").slice(-12)}:${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (success) moved++;
        else failed++;
    }

    console.warn(`[Shift & Fade ${BUILD_LABEL}] Companion transfer captured=${captured.length} moved=${moved} failed=${failed} safe=${safeMoved} fallback=${fallbackMoved} target=${dimension.id}`);
    if (failures.length > 0) {
        console.warn(`[Shift & Fade ${BUILD_LABEL}] Companion failures: ${failures.slice(0, 8).join(" | ")}`);
    }
}

const COMPANION_HAZARD_BLOCKS = new Set([
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

function companionLandingCandidates(dimension, anchor, index, total, reserved) {
    const points = [];
    const columns = companionLandingColumns(anchor, index, total);
    const baseY = Math.floor(anchor.y);
    const yOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];

    for (const column of columns) {
        for (const yOffset of yOffsets) {
            const target = {
                x: column.x,
                y: baseY + yOffset,
                z: column.z,
            };
            const key = companionLandingKey(target);
            if (reserved.has(key)) continue;
            if (!isSafeCompanionLanding(dimension, target)) continue;
            points.push(target);
            // Each companion only needs a few good candidates; tryTeleport performs the final
            // collision check against the entity's actual bounding box.
            if (points.length >= 12) return points;
        }
    }
    return points;
}

function companionLandingColumns(anchor, index, total) {
    const columns = [];
    const rings = [
        { radius: 2.0, slots: 8 },
        { radius: 3.25, slots: 12 },
        { radius: 4.5, slots: 16 },
        { radius: 5.75, slots: 20 },
    ];

    // Start each companion at a different point, then scan the remaining ring positions as
    // fallbacks. The half-slot rotation between rings avoids radial crowding.
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
        const ring = rings[ringIndex];
        const startSlot = index % ring.slots;
        for (let offset = 0; offset < ring.slots; offset++) {
            const slot = (startSlot + offset) % ring.slots;
            const angle = (Math.PI * 2 * slot) / ring.slots + (ringIndex % 2 ? Math.PI / ring.slots : 0);
            columns.push({
                x: anchor.x + Math.cos(angle) * ring.radius,
                z: anchor.z + Math.sin(angle) * ring.radius,
            });
        }
    }

    return columns;
}

function isSafeCompanionLanding(dimension, target) {
    const bx = Math.floor(target.x);
    const by = Math.floor(target.y);
    const bz = Math.floor(target.z);

    try {
        const floor = dimension.getBlock({ x: bx, y: by - 1, z: bz });
        const feet = dimension.getBlock({ x: bx, y: by, z: bz });
        const head = dimension.getBlock({ x: bx, y: by + 1, z: bz });
        if (!floor || !feet || !head) return false;

        // Require an actual non-liquid floor. tryTeleport will decide whether the feet/head blocks
        // are passable for the specific entity, but we reject liquids and damaging blocks first.
        if (floor.isAir || floor.isLiquid || isCompanionHazard(floor)) return false;
        if (feet.isLiquid || head.isLiquid || isCompanionHazard(feet) || isCompanionHazard(head)) return false;

        // Avoid landing immediately beside lava, magma, fire, cactus, etc. This matters when a
        // large group collides after arrival: one shove should not put a pet straight into danger.
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (const y of [by - 1, by]) {
                    const nearby = dimension.getBlock({ x: bx + dx, y, z: bz + dz });
                    if (!nearby) return false;
                    if (nearby.isLiquid || isCompanionHazard(nearby)) return false;
                }
            }
        }
        return true;
    } catch (_) {
        return false;
    }
}

function isCompanionHazard(block) {
    try {
        return COMPANION_HAZARD_BLOCKS.has(block.typeId);
    } catch (_) {
        return true;
    }
}

function companionLandingKey(location) {
    return `${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}`;
}

function companionEmergencyLanding(anchor, index) {
    const slot = index % 8;
    const ring = Math.floor(index / 8);
    const radius = 0.45 + ring * 0.35;
    const angle = (Math.PI * 2 * slot) / 8;
    return {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y,
        z: anchor.z + Math.sin(angle) * radius,
    };
}

function startDissolveParticles(player, session, rebuilding, totalTicks) {
    clearParticleRun(session);
    let age = 0;
    const customId = rebuilding
        ? "shift_fade:rebuild_shard"
        : "shift_fade:dissolve_shard";
    session.particleRunId = system.runInterval(() => {
        if (session.finished || !sessions.has(player.id)) {
            clearParticleRun(session);
            return;
        }

        const progress = clamp(age / totalTicks, 0, 1);
        const verticalProgress = rebuilding ? 1 - progress : progress;
        const base = player.location;

        // Dos anillos con alturas alternadas para que se vea desde cualquier lado de la cámara.
        for (let i = 0; i < 10; i++) {
            const angle = age * 0.30 + i * (Math.PI * 2 / 10);
            const radius = 0.34 + (i % 3) * 0.10;
            const yOffset = 0.10 + verticalProgress * 1.90 + (i % 2) * 0.13;
            const location = {
                x: base.x + Math.cos(angle) * radius,
                y: base.y + yOffset,
                z: base.z + Math.sin(angle) * radius,
            };
            safeSpawnParticle(player.dimension, customId, location);
        }

        age += 2;
        if (age > totalTicks) clearParticleRun(session);
    }, 2);
}

function clearParticleRun(session) {
    if (session?.particleRunId === undefined) return;
    try { system.clearRun(session.particleRunId); } catch (_) {}
    session.particleRunId = undefined;
}

function safeSpawnParticle(dimension, particleId, location) {
    try { dimension.spawnParticle(particleId, location); } catch (_) {}
}

function applyTemporaryInvisibility(player, session) {
    if (session.hadInvisibility || session.appliedInvisibility) return;
    try {
        player.addEffect("invisibility", 240, { amplifier: 0, showParticles: false });
        session.appliedInvisibility = true;
    } catch (_) {}
}

function removeTemporaryInvisibility(player, session) {
    if (!session?.appliedInvisibility || session.hadInvisibility) return;
    try { player.removeEffect("invisibility"); } catch (_) {}
    session.appliedInvisibility = false;
}

function tryPlaySound(player, soundId, volume, pitch) {
    try { return player.playSound(soundId, { volume, pitch }); }
    catch (error) {
        console.warn(`[Shift & Fade] Sound playback failed id=${soundId}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

function tryPlaySoundAt(player, soundId, volume, pitch, location) {
    try { return player.playSound(soundId, { volume, pitch, location }); }
    catch (error) {
        console.warn(`[Shift & Fade] Cinematic sound playback failed id=${soundId}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

function setStatus(player, text) {
    try { player.onScreenDisplay.setActionBar(`§d${text}`); } catch (_) {}
}

function ensureSession(player, session) {
    const active = sessions.get(player.id);
    if (!active || active.token !== session.token || session.finished) {
        throw new Error("La sesión dejó de ser válida");
    }
}

function safePermissionState(player, category, fallback) {
    try { return player.inputPermissions.isPermissionCategoryEnabled(category); }
    catch (_) { return fallback; }
}

function setPermission(player, category, enabled) {
    try { player.inputPermissions.setPermissionCategory(category, enabled); } catch (_) {}
}

function reportError(player, prefix, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Shift & Fade] ${prefix}: ${message}\n${error?.stack ?? ""}`);
    try { player.sendMessage(`${PACK_PREFIX}§c${prefix}:§r ${message}`); } catch (_) {}
}

function delayTicks(ticks) {
    return new Promise((resolve) => system.runTimeout(resolve, Math.max(0, Math.round(ticks))));
}

async function withTimeout(promise, ticks, message) {
    return Promise.race([
        promise,
        delayTicks(ticks).then(() => { throw new Error(message); }),
    ]);
}

function getHorizontalDirection(player) {
    const view = player.getViewDirection();
    const length = Math.hypot(view.x, view.z);
    if (length > 0.05) return { x: view.x / length, z: view.z / length };

    const yaw = player.getRotation().y * Math.PI / 180;
    return { x: -Math.sin(yaw), z: Math.cos(yaw) };
}

function normalizedDirectionTo(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return { x: 0, z: 1 };
    return { x: dx / length, z: dz / length };
}

function perpendicular(direction) {
    return { x: -direction.z, z: direction.x };
}

function horizontalDistance(a, b) {
    return Math.hypot(b.x - a.x, b.z - a.z);
}

function chooseSafeOrbit(dimension, focus, forward, right) {
    const candidates = [];
    const radii = [4.4, 3.7, 3.0];
    const heights = [1.05, 2.4, 4.0, 6.0, 8.0];
    const starts = [0, Math.PI];
    const directions = [-1, 1];

    for (const height of heights) {
        for (const radius of radii) {
            for (const startAngle of starts) {
                for (const sign of directions) {
                    const endAngle = startAngle + sign * Math.PI * 0.70;
                    const score = scoreOrbitPath(
                        dimension, focus, forward, right,
                        startAngle, endAngle, radius, height
                    );
                    candidates.push({ startAngle, endAngle, radius, height, score });
                    if (score >= 1) return candidates[candidates.length - 1];
                }
            }
        }
    }

    candidates.sort((a, b) => b.score - a.score || a.height - b.height || b.radius - a.radius);
    return candidates[0] ?? {
        startAngle: 0,
        endAngle: -Math.PI * 0.70,
        radius: 2.6,
        height: 8.0,
        score: 0,
    };
}

function scoreOrbitPath(dimension, focus, forward, right, startAngle, endAngle, radius, height) {
    const samples = 14;
    let clear = 0;
    for (let i = 0; i <= samples; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / samples);
        const point = orbitPoint(focus, forward, right, angle, radius, height);
        if (isCameraPathClear(dimension, focus, point)) clear++;
    }
    return clear / (samples + 1);
}

function isCameraPathClear(dimension, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.1) return true;

    try {
        const hit = dimension.getBlockFromRay(
            from,
            { x: dx / distance, y: dy / distance, z: dz / distance },
            {
                maxDistance: Math.max(0.1, distance - 0.30),
                includeLiquidBlocks: false,
                includePassableBlocks: false,
            }
        );
        return hit === undefined;
    } catch (_) {
        return false;
    }
}

function orbitPoint(focus, forward, right, angle, radius, height) {
    const rightAmount = Math.cos(angle) * radius;
    const forwardAmount = Math.sin(angle) * radius;
    return {
        x: focus.x + right.x * rightAmount + forward.x * forwardAmount,
        y: focus.y + height,
        z: focus.z + right.z * rightAmount + forward.z * forwardAmount,
    };
}

function headLocation(location) {
    return { x: location.x, y: location.y + 1.62, z: location.z };
}

function bodyFocus(location) {
    return { x: location.x, y: location.y + 0.95, z: location.z };
}

function groundFocus(location) {
    return { x: location.x, y: location.y + 0.15, z: location.z };
}

function cloneVector(vector) {
    return { x: vector.x, y: vector.y, z: vector.z };
}

function formatVector(vector) {
    return `${Number(vector.x).toFixed(2)},${Number(vector.y).toFixed(2)},${Number(vector.z).toFixed(2)}`;
}

function cloneRotation(rotation) {
    return { x: rotation.x, y: rotation.y };
}

function add(base, horizontal = { x: 0, z: 0 }, vertical = { x: 0, y: 0, z: 0 }) {
    return {
        x: base.x + (horizontal.x ?? 0) + (vertical.x ?? 0),
        y: base.y + (horizontal.y ?? 0) + (vertical.y ?? 0),
        z: base.z + (horizontal.z ?? 0) + (vertical.z ?? 0),
    };
}

function scale(vector, scalar) {
    return { x: vector.x * scalar, z: vector.z * scalar };
}

function lerpVector(a, b, alpha) {
    return {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        z: a.z + (b.z - a.z) * alpha,
    };
}

function smootherStep(value) {
    const x = clamp(value, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
