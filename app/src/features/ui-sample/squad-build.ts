// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Squad builds for the sample's Deploy section: what a loadout costs, whether
 * it is its role's standard issue, and how a squad sits against a budget cap.
 * Plain TypeScript over item ids, no React and no storage, tested in
 * `tests/squad-build.test.ts`.
 *
 * THE COSTS ARE SAMPLE DATA. The game has no costs or budget yet; this table
 * only exists so the screen can show how a budget would read.
 */

export type ModSlot = "scope" | "laser" | "stock" | "clip";

/** One operative's kit, by item id (squad catalog / attachment ids). */
export type Loadout = {
    primary: string | null;
    /** Upgrades fitted to the rifle, by kind (`scope-2`, `clip-1`, …). */
    mods: Partial<Record<ModSlot, string | null>>;
    armor: string | null;
    utility: string | null;
};

/** Sample cost table: a base per operative, then each item by tier. */
export const SAMPLE_COSTS = {
    operative: 100,
    primary: { mx4: 100, srs9: 160, plasma: 240 } as Record<string, number>,
    armor: { spectre: 60, "nyx-mid": 100, "nyx-heavy": 150 } as Record<string, number>,
    /** By the upgrade's tier (the id's last digit). */
    modTier: [0, 30, 60, 100],
    utility: { frag: 40 } as Record<string, number>,
};

/** Two sample caps for one mode, so over-budget can be seen. */
export const SAMPLE_CAPS = [
    { id: "ranked-1000", label: "Ranked", cap: 1000 },
    { id: "ranked-900", label: "Ranked", cap: 900 },
] as const;

export const modTier = (id: string) => Number(id.slice(-1)) || 0;

export type CostLine = { label: string; cost: number };

/** What a loadout costs, line by line (the operative's base first). */
export function costLines(loadout: Loadout): CostLine[] {
    const lines: CostLine[] = [{ label: "Operative", cost: SAMPLE_COSTS.operative }];
    if (loadout.primary)
        lines.push({ label: "Rifle", cost: SAMPLE_COSTS.primary[loadout.primary] ?? 0 });
    const mods = Object.values(loadout.mods).filter((m): m is string => !!m);
    if (mods.length)
        lines.push({
            label: "Mods",
            cost: mods.reduce((sum, id) => sum + SAMPLE_COSTS.modTier[modTier(id)], 0),
        });
    if (loadout.armor) lines.push({ label: "Armor", cost: SAMPLE_COSTS.armor[loadout.armor] ?? 0 });
    if (loadout.utility)
        lines.push({ label: "Utility", cost: SAMPLE_COSTS.utility[loadout.utility] ?? 0 });
    return lines;
}

export const loadoutCost = (loadout: Loadout) =>
    costLines(loadout).reduce((sum, line) => sum + line.cost, 0);

/** The squad's total: vacant podiums cost nothing. */
export const squadCost = (podiums: (Loadout | null)[]) =>
    podiums.reduce((sum, l) => sum + (l ? loadoutCost(l) : 0), 0);

/**
 * Standard issue per role: the kit an operative of that role is handed. A
 * loadout that matches its role's is BASE; anything else is CUSTOM.
 */
export const ROLE_BASE: Record<string, Loadout> = {
    Assault: { primary: "mx4", mods: {}, armor: "spectre", utility: "frag" },
    Marksman: { primary: "srs9", mods: { scope: "scope-1" }, armor: "spectre", utility: "frag" },
    Support: { primary: "mx4", mods: {}, armor: "spectre", utility: "frag" },
    Recon: { primary: "mx4", mods: {}, armor: "spectre", utility: "frag" },
};

/** Two loadouts are the same kit (mod order and empty entries don't matter). */
export function sameLoadout(a: Loadout, b: Loadout): boolean {
    const mods = (l: Loadout) =>
        JSON.stringify(
            Object.entries(l.mods)
                .filter(([, id]) => !!id)
                .sort(([x], [y]) => x.localeCompare(y)),
        );
    return (
        a.primary === b.primary &&
        a.armor === b.armor &&
        a.utility === b.utility &&
        mods(a) === mods(b)
    );
}

/** BASE when the loadout is exactly its role's standard issue. */
export function buildMarker(role: string, loadout: Loadout): "base" | "custom" {
    const base = ROLE_BASE[role];
    return base && sameLoadout(base, loadout) ? "base" : "custom";
}

/** Why a squad cannot deploy, or null. */
export function deployRefusal(podiums: (Loadout | null)[], cap: number): string | null {
    const vacant = podiums.findIndex((p) => !p);
    if (vacant >= 0) return `Podium ${vacant + 1} is vacant`;
    const over = squadCost(podiums) - cap;
    if (over > 0) return `Over budget by ${over}`;
    return null;
}
