// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The menus' pictograms the unit readout needs, copied from the app's
 * `src/ui/icons.tsx` (the engine never imports the app): a 16-unit grid,
 * stroke only, `currentColor`, square caps and mitred joins.
 * Follow-up: one shared pictogram module both can import.
 */

const PATHS = {
  primary: "M1.5 8.5h8l1.5-1.5h3.5v2l-2 .5v1.5h-4l-1 2.5h-2l1-2.5h-5z",
  armor: "M5 2.5l3 1.5 3-1.5 3 2.5-2 2v6.5h-8v-6.5l-2-2z",
  utility: "M8 6.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8M6.5 6.5v-2h3v2M9.5 4.5l2.5-2",
  mobility: "M3 3.5l4.5 4.5-4.5 4.5M8.5 3.5l4.5 4.5-4.5 4.5",
  aim: "M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M8 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8",
  health: "M6 2.5h4v3.5h3.5v4h-3.5v3.5h-4v-3.5h-3.5v-4h3.5z",
  shield: "M8 1.5l5.5 2v4.5c0 3-2.5 5.5-5.5 6.5c-3-1-5.5-3.5-5.5-6.5v-4.5z",
  dodge: "M2 12.5l4-4 3 3 5-6M10.5 5.5h3.5v3.5",
  damage: "M8 1.5l1.5 4 4-1.5-2 4 3 2.5-4 .5-.5 4-2-3-3 2.5.5-4-4-1 3.5-2-1.5-4 4 1.5z",
  range: "M1.5 8h13M11.5 5l3 3-3 3M3.5 6.5v3M6.5 6.5v3",
  ammo: "M3 14.5v-8l1.5-3 1.5 3v8zM7.5 14.5v-8l1.5-3 1.5 3v8zM12 14.5v-8",
  // Readout only: the side markers.
  hostile: "M8 1.5l6.5 6.5-6.5 6.5-6.5-6.5z",
  friendly: "M8 1.5l6.5 6.5-6.5 6.5-6.5-6.5zM8 5l3 3-3 3-3-3z",
} as const;

export type IntelIconName = keyof typeof PATHS;

export function IntelIcon({ name, size = 12 }: { name: IntelIconName; size?: number }) {
  return (
    <svg
      className="intel-icon"
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

/**
 * Rank insignia by step: none for the lowest, one to three chevrons for the
 * enlisted steps, one to four bars for the officers.
 */
export function RankMark({ index }: { index: number }) {
  if (index <= 0) return null;
  const officer = index >= 4;
  const n = officer ? index - 3 : index;
  const d = officer
    ? Array.from({ length: n }, (_, i) => `M${2 + i * 3.4} 3.5v9`).join("")
    : Array.from({ length: n }, (_, i) => `M3 ${5 + i * 3.6}l5-3 5 3`).join("");
  return (
    <svg className="intel-icon intel-rank" width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" aria-hidden>
      <path d={d} />
    </svg>
  );
}
