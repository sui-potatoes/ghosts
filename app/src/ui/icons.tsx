// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * One pictogram set for the sample, in one line style: a 16-unit grid,
 * stroke only, `currentColor`, square caps and mitred joins (the house has
 * no soft corners). Used where the meaning is obvious without a word: slot
 * kinds, stat kinds, rank.
 */

const PATHS = {
    // Slots
    primary: "M1.5 8.5h8l1.5-1.5h3.5v2l-2 .5v1.5h-4l-1 2.5h-2l1-2.5h-5z",
    sidearm: "M2.5 4.5h11v3h-5l-1 5h-3l1-5h-3z",
    armor: "M5 2.5l3 1.5 3-1.5 3 2.5-2 2v6.5h-8v-6.5l-2-2z",
    utility: "M8 6.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8M6.5 6.5v-2h3v2M9.5 4.5l2.5-2",
    // Stats
    mobility: "M3 3.5l4.5 4.5-4.5 4.5M8.5 3.5l4.5 4.5-4.5 4.5",
    aim: "M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M8 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8",
    health: "M6 2.5h4v3.5h3.5v4h-3.5v3.5h-4v-3.5h-3.5v-4h3.5z",
    shield: "M8 1.5l5.5 2v4.5c0 3-2.5 5.5-5.5 6.5c-3-1-5.5-3.5-5.5-6.5v-4.5z",
    dodge: "M2 12.5l4-4 3 3 5-6M10.5 5.5h3.5v3.5",
    damage: "M8 1.5l1.5 4 4-1.5-2 4 3 2.5-4 .5-.5 4-2-3-3 2.5.5-4-4-1 3.5-2-1.5-4 4 1.5z",
    crit: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11M8 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4",
    range: "M1.5 8h13M11.5 5l3 3-3 3M3.5 6.5v3M6.5 6.5v3",
    ammo: "M3 14.5v-8l1.5-3 1.5 3v8zM7.5 14.5v-8l1.5-3 1.5 3v8zM12 14.5v-8",
    weight: "M5.5 5.5h5l3 9h-11zM6.5 5.5a1.5 1.5 0 1 1 3 0",
    // Rank: one chevron per step, stacked.
    rank1: "M3 9.5l5-3 5 3",
    rank2: "M3 7l5-3 5 3M3 11l5-3 5 3",
    rank3: "M3 5l5-3 5 3M3 9l5-3 5 3M3 13l5-3 5 3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
    return (
        <svg
            className="gui-icon"
            width={size}
            height={size}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden
        >
            <path d={PATHS[name]} />
        </svg>
    );
}

/** The pictogram for a squad or sample stat key. */
export const STAT_ICON: Record<string, IconName> = {
    mobility: "mobility",
    aim: "aim",
    health: "health",
    armor: "shield",
    dodge: "dodge",
    damage: "damage",
    critChance: "crit",
    crit: "crit",
    range: "range",
    ammo: "ammo",
    weight: "weight",
};

/** The pictogram for an equipment slot. */
export const SLOT_ICON: Record<string, IconName> = {
    primary: "primary",
    sidearm: "sidearm",
    armor: "armor",
    utility: "utility",
};
