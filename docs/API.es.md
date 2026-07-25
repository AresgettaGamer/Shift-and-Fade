# API de Shift & Fade — Protocolo v1

Shift & Fade recibe solicitudes mediante `system.sendScriptEvent` con el ID `shift_fade:request`. Se recomienda copiar `sdk/shift_fade_sdk.js` al addon integrador.

## Flujo recomendado

1. Validar permisos, destino y costo.
2. Enviar la solicitud.
3. Esperar el estado `accepted` antes de cobrar o activar cooldown.
4. Esperar `completed` antes del mensaje final.
5. Ante `failed` o timeout, usar el TP original cuando corresponda.

## Estados

- `sf_ack_<requestId>`: aceptada.
- `sf_done_<requestId>`: terminada.
- `sf_fail_<requestId>`: rechazada o fallida.

## Responsabilidades

Shift & Fade controla la cámara y el TP dentro de la misma dimensión. El addon integrador controla permisos, costos, cooldowns, menús, destinos guardados y cambios de dimensión.

Consulta `API.md` para la tabla completa del payload.
