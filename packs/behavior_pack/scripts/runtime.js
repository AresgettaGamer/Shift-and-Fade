import {
    EasingType,
    EntityIsTamedComponent,
    InputPermissionCategory,
    system,
    world,
} from "@minecraft/server";
const PACK_PREFIX = "§d[Shift & Fade]§r ";
const TICKS_PER_SECOND = 20;
const GRAND_VISIBLE_TRAVEL_LIMIT = 64;
const GRAND_CRUISE_HEIGHT = 62;
const GRAND_VISIBLE_TRAVEL_SECONDS = 2.40;
const AUTO_GRAND_LIMIT = 1000;
const DESTINATION_LOAD_TIMEOUT_TICKS = 220;
const DESTINATION_TICKING_RADIUS = 80;
const sessions = new Map();
let nextSessionNumber = 1;

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
    if (requested === "grand" || requested === "twilight") return requested;
    const distance = request.requestedDistance ?? horizontalDistance(player.location, request);
    return distance <= AUTO_GRAND_LIMIT ? "grand" : "twilight";
}

export function startAnimatedTeleport(player, request) {
    if (sessions.has(player.id)) {
        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Ya hay una transición activa.`);
        return false;
    }

    request.dimension ??= player.dimension;
    request.requestedDistance ??= horizontalDistance(player.location, request);
    request.mode = resolveTeleportMode(player, request);
    request.fallbackOnError ??= true;

    const runner = request.mode === "twilight" ? runTwilightTeleport : runGrandTeleport;
    runner(player, request).then(() => {
        try { request.onComplete?.(); } catch (_) {}
    }).catch((error) => {
        reportError(player, "La transición fue cancelada", error);
        emergencyReset(player, false);
        let fallbackUsed = false;

        if (request.fallbackOnError && !request.teleportCompleted) {
            try {
                const fallbackLocation = { x: request.x, y: request.y, z: request.z };
                performRequestedTeleport(player, request, fallbackLocation, player.getRotation());
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
        const direction = normalizedDirectionTo(origin, request);
        const distance = request.requestedDistance ?? horizontalDistance(origin, request);

        if (!request.silent) player.sendMessage(`${PACK_PREFIX}Grand iniciado: §f${Math.round(distance)} bloques§r.`);
        setStatus(player, distance <= GRAND_VISIBLE_TRAVEL_LIMIT
            ? "Grand: recorrido corto visible"
            : "Grand: salida visible → corte negro → llegada visible");

        const destinationPromise = prepareDestination(session, request.dimension, request.x, request.z, request.y, request.exactY);

        if (distance <= GRAND_VISIBLE_TRAVEL_LIMIT) {
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
    await runLinearOverheadTravel(
        player,
        session,
        { x: origin.x, y: cruiseY, z: origin.z },
        { x: destination.x, y: cruiseY, z: destination.z },
        travelSeconds
    );

    fade(player, 0.14, 0.18, 0.22);
    await delayTicks(4);
    ensureSession(player, session);
    performRequestedTeleport(player, request, destination, originRotation);

    // La cámara ya está exactamente encima del destino: solo desciende.
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
    tryPlaySound(player, "portal.travel", 0.65, 0.55);

    await delayTicks(12);
    ensureSession(player, session);

    const destination = destinationData.location;
    const destinationHead = headLocation(destination);
    const destinationCruiseY = destination.y + GRAND_CRUISE_HEIGHT;
    performRequestedTeleport(player, request, destination, originRotation);

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
    await runLinearOverheadTravel(
        player,
        session,
        arrivalStart,
        arrivalEnd,
        GRAND_VISIBLE_TRAVEL_SECONDS
    );

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
        tryPlaySound(player, "respawn_anchor.charge", 0.8, 0.75);
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
        performRequestedTeleport(player, request, destination, originRotation);

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
        tryPlaySound(player, "random.orb", 0.75, 0.8);

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

function performRequestedTeleport(player, request, location, rotation) {
    if (request.integration?.teleportNearbyTamed) {
        teleportNearbyTamedEntities(player, location, request.dimension);
    }

    player.teleport(location, {
        dimension: request.dimension ?? player.dimension,
        rotation,
        keepVelocity: false,
        checkForBlocks: false,
    });
    request.teleportCompleted = true;

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

function teleportNearbyTamedEntities(player, location, dimension) {
    let entities = [];
    try {
        entities = player.dimension.getEntities({
            location: player.location,
            maxDistance: 10,
        });
    } catch (_) {
        return;
    }

    for (const entity of entities) {
        try {
            const tamed = entity.getComponent(EntityIsTamedComponent.componentId);
            if (!tamed) continue;
            entity.teleport(location, { dimension });
        } catch (_) {}
    }
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
    try { player.playSound(soundId, { volume, pitch }); } catch (_) {}
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
