# Shift & Fade: Waystones v1.0.0

**Shift & Fade: Waystones** es un addon complementario completamente jugable y, al mismo tiempo, el demo/referencia oficial de gameplay para el **SDK público de Shift & Fade Protocol v2**.

Está construido intencionalmente como un consumidor real del mismo SDK copy-in disponible para creadores externos. No importa archivos internos de Shift & Fade. Por eso puede jugarse normalmente en survival/multijugador y también funciona como ejemplo práctico de cómo construir redes de teletransporte completas sobre Shift & Fade.

## Gameplay

- Waystones privados o públicos con nombre, descubrimiento natural y red persistente de destinos.
- Coste por distancia: 1 nivel de XP por cada 500 bloques dentro de la misma dimensión, con máximo de 6; los viajes entre dimensiones cuestan 6 niveles.
- Destinos favoritos y descubrimiento individual por jugador.
- Warp Stone para viaje portátil.
- Return Scroll, Death Scroll y Home Scroll.
- Teleport Pads enlazados sin coste de XP y con protección anti-rebote.
- Waystones naturales en zonas silvestres del Overworld.
- Santuarios de aldea generados en runtime con variantes por entorno.
- Assets PBR preparados para Vibrant Visuals y audio propio de interacción.

## Integración con Shift & Fade

Cuando **Shift & Fade** está instalado, Waystones envía los viajes mediante el SDK público Protocol v2 para usar las presentaciones cinematográficas Grand/Twilight y el transporte/seguridad implementado por Core.

Si Shift & Fade no está presente, Waystones conserva un fallback instantáneo solo para el jugador, así que el addon sigue siendo jugable. Para la experiencia de referencia/demo prevista, Shift & Fade es muy recomendado.

## Integración WATI opcional

Waystones incluye Providers opcionales para:

- **WATI Core / Codex** — conocimiento de bloques, objetos y estructuras naturales/de aldea.
- **WATI Lens** — identidad localizada y datos dinámicos de Waystones/Teleport Pads: nombre registrado, acceso, descubrimiento/favorito, destinos visibles y enlaces de pads.

WATI no es necesario para jugar.

## Compatibilidad

- Minecraft Bedrock 26.40 / engine 1.26.40+
- `@minecraft/server` 2.8.0 (el runtime puede promover el binding estable instalado)
- `@minecraft/server-ui` 2.1.0
- Singleplayer y multijugador/servidor
- Español de México e inglés de EE. UU.

## Estado del proyecto

v1.0.0 es la primera Release pública estable y se promueve desde la línea Beta v0.9.8 aprobada en runtime. La promoción no rediseña viajes, generación, audio, UI, persistencia ni Providers ya aprobados.

## Ubicación en el repositorio

El repositorio de Shift & Fade puede conservar este proyecto dentro de `examples/waystones/` como referencia jugable oficial del SDK. También se distribuye como addon independiente en CurseForge porque es contenido jugable completo y no únicamente un ejemplo de código.

## Licencia

Licencia MIT. Copyright (c) 2026 AresgettaYT.
