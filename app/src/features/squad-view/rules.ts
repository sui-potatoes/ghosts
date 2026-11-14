// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match's squad selection as plain functions: who stands on the podiums
 * at first, swaps and the bench, whether the squad can deploy (and why not),
 * the deadline as a clock, and a recruit's kit as the base plate shows it.
 * The rules are `ghosts::ghosts::deploy_squad`'s: one to as many recruits as
 * the side has spawn positions, each once, from the account, before the
 * deadline. An unarmed recruit deploys but cannot attack (`unit::from_recruit`).
 * Pure, tested in `tests/squad-select.test.ts`.
 */

/** Who stands on each podium, left to right; null is a vacant podium. */
export type Podiums = (string | null)[];

/** Below this the deployment clock turns amber. */
export const LOW_TIME_MS = 20_000;

/** Where the last deployed squad is kept on this device. */
export const LAST_SQUAD_KEY = "ghosts:last-squad";

/**
 * The podiums a side fills: the spawn positions it has left plus the recruits
 * it already put on them (`deploy_squad` takes a position per recruit).
 */
export const podiumCount = (positionsLeft: number, deployed: number) => positionsLeft + deployed;

/**
 * The squad on entry: the last squad deployed from this device where those
 * recruits are still on the roster (on the same podiums), then the rest of
 * the podiums from the roster in order. A player who only confirms deploys a
 * full squad.
 */
export function defaultSquad(roster: string[], podiums: number, remembered: Podiums = []): Podiums {
    const onRoster = new Set(roster);
    const result: Podiums = Array.from({ length: podiums }, () => null);
    const used = new Set<string>();
    remembered.slice(0, podiums).forEach((id, i) => {
        if (id && onRoster.has(id) && !used.has(id)) {
            result[i] = id;
            used.add(id);
        }
    });
    const rest = roster.filter((id) => !used.has(id));
    for (let i = 0; i < podiums; i++) if (result[i] === null) result[i] = rest.shift() ?? null;
    return result;
}

/**
 * Put `id` on podium `index` (null leaves it vacant). A recruit standing on
 * another podium trades places with whoever stood here.
 */
export function place(podiums: Podiums, index: number, id: string | null): Podiums {
    const next = [...podiums];
    const from = id ? next.indexOf(id) : -1;
    if (from >= 0 && from !== index) next[from] = next[index];
    next[index] = id;
    return next;
}

/** The roster recruits on no podium, in roster order: they stay home. */
export const benchOf = (roster: string[], podiums: Podiums) =>
    roster.filter((id) => !podiums.includes(id));

/**
 * The podium a bench recruit swaps onto: the first vacant one, else the one
 * the cursor last stood on, else the last.
 */
export function swapTarget(podiums: Podiums, last: number | null): number {
    const vacant = podiums.indexOf(null);
    if (vacant >= 0) return vacant;
    return last !== null && last >= 0 && last < podiums.length ? last : podiums.length - 1;
}

/** The recruits deploying, in podium order. */
export const squadOf = (podiums: Podiums) => podiums.filter((id): id is string => !!id);

export type DeployState = {
    podiums: Podiums;
    roster: string[];
    /** The deadline has passed: `deploy_squad` aborts with `EDeploymentOver`. */
    expired: boolean;
    /** The match's seat is not accepted yet: the game does not know this side. */
    joining: boolean;
    /** A deployment is in flight. */
    busy: boolean;
    /** This side has deployed (`EAlreadyDeployed`). */
    deployed: boolean;
};

/** Why Deploy is refused right now, in the player's terms; null when it can go. */
export function deployRefusal(s: DeployState): string | null {
    if (s.deployed) return "The squad is deployed";
    if (s.busy) return "Deploying the squad";
    if (s.expired) return "Time is up";
    if (s.joining) return "Joining the match";
    const squad = squadOf(s.podiums);
    if (!squad.length) return "Put an operative on a podium";
    if (new Set(squad).size !== squad.length) return "An operative stands on two podiums";
    const onRoster = new Set(s.roster);
    if (squad.some((id) => !onRoster.has(id))) return "An operative on the podiums left the roster";
    return null;
}

/** The time left as `m:ss`, rounded up (the last second shows `0:01`). */
export function formatClock(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The squad kept on this device: what the last deployment put on the podiums. */
export function readLastSquad(storage: Pick<Storage, "getItem"> | undefined): Podiums {
    try {
        const parsed: unknown = JSON.parse(storage?.getItem(LAST_SQUAD_KEY) ?? "[]");
        return Array.isArray(parsed)
            ? parsed.map((id) => (typeof id === "string" ? id : null))
            : [];
    } catch {
        return [];
    }
}

export function writeLastSquad(storage: Pick<Storage, "setItem"> | undefined, podiums: Podiums) {
    try {
        storage?.setItem(LAST_SQUAD_KEY, JSON.stringify(podiums));
    } catch {
        // storage unavailable: the next match starts from the roster order
    }
}

/** The parts of an on-chain recruit the plate reads (`ChainRecruit` has them). */
export type KitSource = {
    weapon?: { name: string; upgrades: { tier: number }[] } | null;
    armor?: { name: string } | null;
    utilities: { name: string; actions: { uses?: number | null }[] }[];
};

export type Kit = {
    /** Null: the player took the rifle off; the unit cannot attack. */
    weapon: { name: string; modded: boolean; mods: number[] } | null;
    armor: { name: string; tier: 1 | 2 | 3 } | null;
    /** `uses` null: the item grants nothing with a count. */
    utility: { name: string; uses: number | null } | null;
};

/** The armor class by the names `ghosts::items` mints. */
const armorTier = (name: string): 1 | 2 | 3 =>
    /heavy/i.test(name) ? 3 : /medium/i.test(name) ? 2 : 1;

export function kitOf(r: KitSource): Kit {
    const utility = r.utilities[0];
    const counted = utility?.actions.filter((a) => typeof a.uses === "number") ?? [];
    return {
        weapon: r.weapon
            ? {
                  name: r.weapon.name,
                  modded: r.weapon.upgrades.length > 0,
                  mods: r.weapon.upgrades.map((u) => Math.max(1, Math.min(3, u.tier))),
              }
            : null,
        armor: r.armor ? { name: r.armor.name, tier: armorTier(r.armor.name) } : null,
        utility: utility
            ? {
                  name: utility.name,
                  uses: counted.length
                      ? counted.reduce((sum, a) => sum + (a.uses as number), 0)
                      : null,
              }
            : null,
    };
}

/** What matters in a fight that the plate must say plainly. */
export function warningsOf(kit: Kit): string[] {
    return kit.weapon ? [] : ["Unarmed"];
}

/** The weapon as the plate names it: "+" when modded. */
export const weaponLabel = (kit: Kit) =>
    kit.weapon ? `${kit.weapon.name}${kit.weapon.modded ? " +" : ""}` : "No weapon";
