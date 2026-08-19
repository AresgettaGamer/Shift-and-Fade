# API de Shift & Fade — Protocol v2

Shift & Fade expone una API de teletransporte mediante Script Events. Los addons externos
deben copiar `sdk/shift_fade_sdk.js` y usarlo en vez de importar archivos internos del runtime.

## Solicitud

Evento: `shift_fade:request`

Protocol v2 acepta:

- `requestId`: identificador corto generado por el addon.
- `playerId` o `playerName`: jugador objetivo.
- `x`, `y`, `z`: coordenadas destino.
- `sourceDimensionId`: dimensión actual esperada.
- `targetDimensionId` / `dimensionId`: dimensión destino.
- `style`: `auto`, `grand` o `twilight`.
- `exactY`: respeta exactamente la Y enviada.
- `silent`: suprime feedback opcional de la integración.
- `fallbackOnError`: permite al Core usar su fallback interno tras aceptar.
- `teleportNearbyTamed`: solicita transportar mascotas domesticadas cercanas.
- `companionRadius`: 1..32 bloques, 10 por defecto.
- `companionEntityIds`: hasta 16 IDs explícitos de entidades cargadas.
- `source`: identificador corto de la integración.
- `soundId` / `animationId`: metadata opcional.

## Tags de respuesta

El SDK observa tags temporales sobre el jugador:

- `sf_ack_<requestId>` — aceptada.
- `sf_done_<requestId>` — completada.
- `sf_fail_<requestId>` — fallida.

Usa `waitForShiftFadeAcceptance()` antes de cobrar costes y
`waitForShiftFadeCompletion()` cuando necesites confirmar la llegada.

## Límite de responsabilidad

El addon integrador conserva permisos, costes, cooldowns, menús, almacenamiento de destinos,
mensajes y reglas de gameplay. Shift & Fade controla la transición cinematográfica y,
cuando se solicita, el transporte de acompañantes.

Para viajes dimensionales de mascotas, Release v2.0.0 usa Structure Transit persistente
internamente. El consumidor no debe ejecutar un segundo traslado de mascotas después de que
Core acepte la solicitud.

Protocol v1 continúa disponible para compatibilidad dentro de la misma dimensión.
