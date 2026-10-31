// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

export const BODY_CONTROLS = [
    { key: "height", label: "Height", low: "Shorter", high: "Taller" },
    { key: "build", label: "Build", low: "Slender", high: "Broad" },
    { key: "muscle", label: "Musculature", low: "Soft", high: "Muscular" },
    { key: "chest", label: "Chest", low: "Narrow", high: "Full" },
    { key: "waist", label: "Waist", low: "Trim", high: "Full" },
    { key: "hips", label: "Hips", low: "Narrow", high: "Wide" },
] as const;

export type BodyShape = Record<(typeof BODY_CONTROLS)[number]["key"], number>;

/** Old identities acquire the original anatomy; malformed values never reach geometry. */
export function normalizeBody(input: unknown): BodyShape {
    const source =
        input && typeof input === "object" && !Array.isArray(input)
            ? (input as Partial<BodyShape>)
            : {};
    return Object.fromEntries(
        BODY_CONTROLS.map(({ key }) => {
            const value = source[key];
            return [
                key,
                typeof value === "number" && Number.isFinite(value)
                    ? Math.max(-1, Math.min(1, value))
                    : 0,
            ];
        }),
    ) as BodyShape;
}

export const bodyHeightScale = (body: BodyShape) => 1 + body.height * 0.09;
