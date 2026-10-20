// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ArmorColors } from "./types.ts";

export const DEFAULT_ARMOR_COLORS: ArmorColors = {
    primary: "#3c4143",
    secondary: "#525959",
    accent: "#3c9093",
};
export const ARMOR_FINISHES: { name: string; colors: ArmorColors }[] = [
    { name: "Graphite", colors: DEFAULT_ARMOR_COLORS },
    { name: "Bone", colors: { primary: "#aba89a", secondary: "#353a3d", accent: "#be713d" } },
    { name: "Oxblood", colors: { primary: "#633437", secondary: "#272c30", accent: "#b4a073" } },
    { name: "Olive", colors: { primary: "#555d42", secondary: "#292e2a", accent: "#b9a061" } },
];
/** Old saves and malformed colors receive defaults independently for each channel. */
export function normalizeArmorColors(input: unknown): ArmorColors {
    const value = input && typeof input === "object" ? (input as Partial<ArmorColors>) : {};
    const result = { ...DEFAULT_ARMOR_COLORS };
    for (const key of ["primary", "secondary", "accent"] as const) {
        const color = value[key];
        if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
            result[key] = color.toLowerCase();
    }
    return result;
}
