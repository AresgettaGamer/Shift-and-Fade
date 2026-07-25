# Shift & Fade

**Shift & Fade** añade transiciones cinematográficas de teletransporte a Minecraft Bedrock y ofrece una API ligera para integrar otros addons.

## Requisitos

- Minecraft Bedrock **1.26.30 o posterior**
- Behavior Pack y Resource Pack activos
- Trucos activados únicamente para utilizar los comandos públicos `/sf:*`
- No requiere experimentos

## Modos

- **Grand:** ascenso vertical, recorrido aéreo, fundido para ocultar terreno no cargado y descenso en el destino.
- **Twilight:** órbita, fragmentos oscuros, desaparición simulada, fundido y reconstrucción.
- **Auto:** Grand hasta 1,000 bloques horizontales y Twilight para distancias mayores.

## Comandos

```mcfunction
/sf:tp <x y z> [auto|grand|twilight]
/sf:send <jugadores> <x y z> [auto|grand|twilight]
/sf:reset [jugadores]
```

Minecraft puede informar que el nombre corto `tp` ya existe por el comando vanilla. No es un error: utiliza siempre `/sf:tp` con su namespace completo.

## Integración

La SDK se encuentra en `sdk/shift_fade_sdk.js`. El addon integrador sigue siendo responsable de permisos, costos, cooldowns, interfaces y mensajes.

Consulta [docs/API.es.md](docs/API.es.md).

## Límites

- No reemplaza ni intercepta automáticamente `/tp` vanilla.
- Las animaciones actuales se realizan dentro de la dimensión del jugador.
- Los cambios de dimensión deben conservar el TP normal del addon integrador.

## Licencia

Código y recursos bajo licencia [MIT](LICENSE).
