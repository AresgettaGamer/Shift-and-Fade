import { world } from "@minecraft/server";

export const BUILD_LABEL = "Release v2.0.0";
export const DEFAULT_STYLE_PROPERTY = "shift_fade:default_style";

export function normalizeConfiguredStyle(value) {
    const style = String(value ?? "auto").toLowerCase();
    return style === "grand" || style === "twilight" ? style : "auto";
}

export function getConfiguredDefaultStyle() {
    try {
        return normalizeConfiguredStyle(world.getDynamicProperty(DEFAULT_STYLE_PROPERTY));
    } catch (_) {
        return "auto";
    }
}

export function setConfiguredDefaultStyle(style) {
    const normalized = normalizeConfiguredStyle(style);
    world.setDynamicProperty(DEFAULT_STYLE_PROPERTY, normalized);
    return normalized;
}
