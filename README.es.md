# Shift & Fade


**Shift & Fade** agrega transiciones cinematográficas de teletransporte a Minecraft Bedrock Edition y ofrece un SDK público y ligero para que otros addons puedan integrarlas.

> **Release v2.0.0:** Core estable validado sobre el runtime aprobado de Beta v1.2.6. Protocol v2, Structure Transit, Grand y Twilight quedan congelados para la Release.

## Requisitos

- Minecraft Bedrock **1.26.30 o posterior**
- Behavior Pack y Resource Pack activados
- Los trucos solo son necesarios para utilizar los comandos públicos `/sf:*`
- No requiere toggles experimentales

## Estilos de teletransporte

### Grand
La cámara asciende sobre el jugador, recorre parte del trayecto, oculta distancias largas o cambios dimensionales mediante un fundido negro y continúa con la aproximación y el descenso en el destino.

### Twilight
La cámara orbita al jugador mientras fragmentos oscuros simulan su disolución. El teletransporte ocurre durante un fundido negro y el jugador se reconstruye en el destino.

### Auto
Con la preferencia global en `auto`:

- Misma dimensión, hasta 1,000 bloques horizontales: Grand
- Misma dimensión, más de 1,000 bloques: Twilight
- Entre dimensiones: Twilight

El administrador del mundo puede cambiar el comportamiento global con `/sf:mode grand` o `/sf:mode twilight`. Una petición explícita del SDK con `grand` o `twilight` siempre tiene prioridad sobre esa preferencia.

## Comandos

```mcfunction
/sf:tp <x y z> [auto|grand|twilight]
/sf:dimtp <dimension> <x y z> [auto|grand|twilight]
/sf:send <jugadores> <x y z> [auto|grand|twilight]
/sf:mode [auto|grand|twilight]
/sf:reset [jugadores]
```

Minecraft puede informar que la hoja de comando `tp` ya está en uso por el comando Vanilla. Es únicamente informativo; utiliza siempre `/sf:tp` con su namespace completo.

## API / SDK — Protocol v2

Copia `sdk/shift_fade_sdk.js` dentro del addon que controla la lógica del teletransporte. **No importes módulos internos del runtime de Shift & Fade.**

```js
import {
    requestShiftFadeTeleport,
    waitForShiftFadeAcceptance,
    waitForShiftFadeCompletion,
} from "./shift_fade_sdk.js";

const requestId = requestShiftFadeTeleport(player, {
    x: destination.x,
    y: destination.y,
    z: destination.z,
    dimensionId: destination.dimensionId,
}, {
    style: "auto",
    source: "mi_addon:waystone",
    teleportNearbyTamed: true,
    companionRadius: 10,
});

const accepted = await waitForShiftFadeAcceptance(player, requestId);
if (accepted === "accepted" || accepted === "completed") {
    // Aplica aquí el coste/cooldown del addon integrador.
}

const result = await waitForShiftFadeCompletion(player, requestId);
```

El addon integrador sigue siendo responsable de permisos, costes, cooldowns, menús, mensajes, almacenamiento de destinos, validaciones y de decidir si el TP está permitido. Shift & Fade únicamente controla la transición cinematográfica.

Consulta [`docs/API.es.md`](docs/API.es.md) para ver el comportamiento y payload completo de Protocol v2.

## Teletransporte entre dimensiones

Protocol v2 puede apuntar a otra dimensión mediante `dimensionId` (o `targetDimensionId`). Shift & Fade precarga la zona de destino y realiza el cambio de dimensión durante la parte oculta de la transición seleccionada.

- Auto real utiliza Twilight entre dimensiones.
- `style: "grand"` explícito utiliza el handoff dimensional oculto de Grand.
- `style: "twilight"` explícito utiliza la disolución/reconstrucción de Twilight.
- `/sf:mode grand|twilight` cambia cómo se presentan las solicitudes del SDK que usan `style: "auto"`.

Protocol v1 continúa siendo compatible para teletransportes dentro de la misma dimensión.

## Transporte de acompañantes

Protocol v2 admite:

- `teleportNearbyTamed: true`
- `companionRadius: 1..32`
- `companionEntityIds: [...]` para hasta 16 entidades cargadas explícitas

Shift & Fade comprueba el propietario cuando Script API expone un ID de dueño. Algunos animales Vanilla domesticados solamente exponen un marcador genérico después de domesticarse; en esos casos se utiliza la proximidad como fallback de mejor esfuerzo. **Esto significa que una mascota cercana perteneciente a otro jugador también puede viajar contigo.** Los addons que conozcan exactamente qué acompañantes deben viajar deberían utilizar `companionEntityIds`.

El transporte de acompañantes tiene dos rutas internas y el SDK público no necesita saber cuál se utiliza:

- **Misma dimensión:** se mantiene la ruta ligera de Script API + Safe Arrival.
- **Entre dimensiones:** Release v2.0.0 utiliza **Structure Transit**. Cada acompañante se estabiliza en la dimensión de origen, se guarda temporalmente como una estructura persistente que contiene la entidad, se elimina solamente después de confirmar el guardado y se restaura en el destino tras el cambio del jugador. Safe Arrival se aplica únicamente cuando la mascota ya existe otra vez en la dimensión destino.

Structure Transit evita depender de `Entity.teleport()` entre dimensiones para las mascotas. El núcleo congelado de Structure Transit fue probado con ocho lobos domesticados a través de Overworld, Nether y The End, incluyendo viajes repetidos Nether → Overworld. El rollback transaccional mantiene al jugador en origen si no puede almacenarse de forma segura toda la manada.


## Audio cinematográfico

Release v2.0.0 incorpora el pase final de sonido cinematográfico sin cambiar la coreografía de cámara aprobada.

- **Grand:** audio original en tres etapas siguiendo la trayectoria de cámara: subida, transición horizontal y llegada/bajada. La reproducción relativa a la ruta de cámara evita que el sonido se atenúe cuando la cámara libre está lejos de la entidad del jugador.
- **Twilight:** salida/disolución y llegada/reconstrucción usan pools aleatorios de variantes editadas por el autor.

El pase de audio fue validado en runtime después de congelar la arquitectura Structure Transit.

## Diseño de compatibilidad y fallback

Una integración recomendable sigue aproximadamente este flujo:

```text
El jugador solicita el teletransporte
        ↓
El addon integrador valida permisos/costes/destino
        ↓
El addon integrador solicita Shift & Fade
        ↓
Shift & Fade acepta la solicitud
        ↓
Se aplica el coste/cooldown
        ↓
Teletransporte cinematográfico + acompañantes gestionados por Shift & Fade
```

El addon integrador puede conservar su teletransporte original como **fallback de mejor esfuerzo** si Shift & Fade no está instalado o rechaza la solicitud. Ese fallback **no necesita** replicar todas las funciones de Shift & Fade; en particular, el integrador no debería duplicar Structure Transit ni ejecutar un segundo traslado de mascotas después de que Shift & Fade ya aceptó la petición.

Así el addon integrador conserva sus reglas de gameplay mientras Shift & Fade se encarga de la transición cinematográfica y, cuando se solicita mediante Protocol v2, del transporte robusto de acompañantes.


## Implementación oficial de referencia

**Shift & Fade: Waystones** es el addon jugable complementario y la implementación real de referencia del SDK público. Está diseñado intencionalmente para consumir exactamente el mismo SDK disponible para desarrolladores externos, sin importar archivos internos de Shift & Fade.

Su objetivo es ofrecer una red de Waystones jugable y, al mismo tiempo, demostrar cómo puede construirse un sistema de teletransporte completo sobre Protocol v2.

## 🤖 Integraciones privadas asistidas por IA

No necesitas ser un desarrollador experto en JavaScript para crear una compatibilidad privada de Shift & Fade con otro addon de Minecraft Bedrock.

Esto es especialmente útil cuando un addon ya tiene Waystones, Homes, Warps, Fast Travel, Portales, objetos de teletransporte, menús de administrador u otro sistema de TP, pero **no ofrece compatibilidad oficial con el SDK de Shift & Fade**.

### Qué debes proporcionar a un asistente de código

Proporciónale:

1. El **Behavior Pack** del addon que quieres integrar (`.mcpack`, `.mcaddon`, `.zip` o su carpeta de código fuente).
2. El **ZIP oficial del SDK de Shift & Fade** o `sdk/shift_fade_sdk.js`.
3. Indícale exactamente qué función o sistema realiza el teletransporte.
4. Pídele que estudie el flujo original del TP antes de modificarlo.

La integración debe conservar los sistemas originales del addon, como:

- Permisos
- Costes de experiencia o moneda
- Cooldowns
- Mensajes y sonidos
- Almacenamiento de Waystones/destinos
- Menús e interfaces
- Lógica propia de mascotas/acompañantes cuando exista
- Validaciones y restricciones de gameplay

Solamente el **paso real del teletransporte** debería entregarse a Shift & Fade.

### Prompt recomendado

> Quiero agregar compatibilidad con Shift & Fade a este addon de Minecraft Bedrock para uso privado. Anexé el addon y el SDK oficial de Shift & Fade. Lee la documentación del SDK y analiza cómo realiza actualmente el teletransporte antes de cambiar cualquier cosa. Integra Shift & Fade únicamente en el paso real del teletransporte; conserva todos los permisos, costes, cooldowns, menús, mensajes, almacenamiento de destinos, lógica de mascotas y restricciones existentes, y mantén el teletransporte normal original como fallback si Shift & Fade no está disponible o rechaza la solicitud. Utiliza únicamente el SDK público; no importes archivos internos del runtime de Shift & Fade. No modifiques sistemas no relacionados. Al terminar, entrégame el addon instalable modificado y explica exactamente qué cambiaste.

### Uso privado y redistribución

Shift & Fade utiliza licencia MIT, pero **el addon de terceros puede utilizar otra licencia**.

Crear una compatibilidad para tu propio mundo o servidor privado no concede automáticamente permiso para publicar una versión modificada del addon de otra persona. Antes de distribuir un parche o build modificada, revisa la licencia, permisos y requisitos del proyecto original.

Shift & Fade **no** concede permiso para copiar, modificar o redistribuir el proyecto de otro desarrollador.

## Vibrant Visuals

El Resource Pack declara la capacidad `pbr` para convivir con stacks de Resource Packs compatibles con Vibrant Visuals.

## Idiomas

- Inglés (Estados Unidos) — `en_US`
- Español (México) — `es_MX`

## Estructura del código fuente

- `BP/` — runtime del Behavior Pack.
- `RP/` — Resource Pack, partículas y audio cinematográfico.
- `sdk/shift_fade_sdk.js` — helper público de Protocol v2.
- `docs/API.md` / `docs/API.es.md` — contrato de integración.

## Licencia

Shift & Fade utiliza la [licencia MIT](LICENSE).

## Créditos

Creado por **AresgettaYT**.

La presentación fue inspirada conceptualmente por los proyectos de Java Edition Grand Teleport y Twilight Teleport. Shift & Fade contiene una implementación propia para Bedrock y recursos originales; no distribuye código fuente ni assets de esos proyectos.

Minecraft es una marca registrada de Microsoft. Este proyecto no está afiliado ni respaldado por Mojang Studios o Microsoft.
