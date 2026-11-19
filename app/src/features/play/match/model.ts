// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A mock match as data: plain TypeScript, no React, no engine values, tested in
 * `tests/play-match.test.ts`. The screen (`MockMatchScreen.tsx`) and the
 * scenario (`scenario.ts`) build on it.
 *
 * - **Staging.** A screen stores the match in sessionStorage (`stageMockMatch`)
 *   and navigates to `/play/match`. Every match gets an id when staged; the
 *   opponent squad, callsigns and faces are drawn from a seed of that id, so a
 *   reload plays the same match again.
 * - **Units.** A `Loadout` names its items by catalog id
 *   (`packages/catalog/items.json`); the economy's `kitOf` turns those into the
 *   squad catalog ids a recruit carries (`mx4`, `spectre`, `frag`...). Each id
 *   is checked against the squad catalog for its slot; one that is unknown
 *   falls back to the basic kit (Standard Rifle, Spectre Carrier, no utility)
 *   with a console warning. The player's units are virtual recruits (the
 *   engine deploys them like saved recruits: `fieldStats`, the same numbers a
 *   chain unit gets); the opponent's are hostiles with that kit.
 * - **Result.** `settleMatch` records the outcome once per match id and, for
 *   ranked, moves the rating once (`applyResult` from `../rating.ts`); a
 *   second call, a reload of the debrief or a double effect returns the same
 *   record without touching the rating again.
 */

import { itemById } from "@ghosts/squad/catalog";
import { normalizeArmorColors } from "@ghosts/squad/armor-colors";
import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import type { Recruit, Role as RecruitRole } from "@ghosts/squad/types";
import type { EncounterDebrief, EncounterReport } from "@ghosts/engine";

import type { Debrief, Plate } from "../../debrief/result.ts";
import {
    defaultSquad,
    itemsFor,
    kitOf,
    presetOf,
    presetsFor,
    squadSize,
    tierOf,
    validateSquad,
    type Loadout,
    type Mode,
    type Slot,
} from "../economy/index.ts";
import { applyResult, readRating, writeRating, type RatingState } from "../rating.ts";

// === The staged match ===

export type MockMatch = {
    kind: "ranked" | "friendly";
    mode: Mode;
    squad: Loadout[];
    /** Who the player is told they face. */
    opponent: { name: string; rating: number };
    /** Where Back and the debrief return to. */
    returnTo: string;
    /** Set by `stageMockMatch`; the seed of everything drawn for the match. */
    id?: string;
};

export const MATCH_KEY = "ghosts:play-match";
/** The settled result of the staged match (`settleMatch`). */
export const RESULT_KEY = "ghosts:play-match:result";

/** One string in a store (sessionStorage by default; a map in tests). */
export type TextSlot = { get(): string | null; set(value: string | null): void };

export function sessionSlot(key: string): TextSlot {
    return {
        get() {
            try {
                return sessionStorage.getItem(key);
            } catch {
                return null;
            }
        },
        set(value) {
            try {
                if (value === null) sessionStorage.removeItem(key);
                else sessionStorage.setItem(key, value);
            } catch {
                // Storage may be unavailable; the match then lives for this page only.
            }
        },
    };
}

/** A fresh id for a staged match. */
export const newMatchId = (now = Date.now(), random = Math.random()) =>
    `m${now.toString(36)}${Math.floor(random * 0x100000).toString(36)}`;

/** The match's id: its own, else one derived from its contents (a match staged by hand). */
export const matchIdOf = (match: MockMatch): string =>
    match.id ?? `h${hash(JSON.stringify(match)).toString(36)}`;

/** A staged match as read back, or null when there is none or it does not read. */
export function parseMatch(raw: string | null): MockMatch | null {
    if (!raw) return null;
    try {
        const m = JSON.parse(raw) as Partial<MockMatch>;
        const ok =
            (m.kind === "ranked" || m.kind === "friendly") &&
            (m.mode === "3x3" || m.mode === "4x4") &&
            Array.isArray(m.squad) &&
            m.squad.length > 0 &&
            !!m.opponent &&
            typeof m.opponent.name === "string" &&
            Number.isFinite(m.opponent.rating);
        if (!ok) return null;
        return {
            ...(m as MockMatch),
            returnTo: typeof m.returnTo === "string" ? m.returnTo : "/play",
        };
    } catch {
        return null;
    }
}

// === Seeds ===

/** FNV-1a: a stable 32-bit number for a string. */
export function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** Mulberry32: a small seeded generator in [0, 1). */
export function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T>(list: readonly T[], random: () => number): T =>
    list[Math.floor(random() * list.length) % list.length];

/** `count` different entries of `list` (it must hold that many), in drawn order. */
function draw<T>(list: readonly T[], count: number, random: () => number): T[] {
    const pool = [...list];
    const out: T[] = [];
    while (out.length < count && pool.length)
        out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return out;
}

export const matchSeed = (match: MockMatch) => hash(`${matchIdOf(match)}:${match.opponent.name}`);

// === Loadout → engine unit ===

/** A unit's kit by squad catalog id (`@ghosts/squad/catalog`), as the engine's `Kit` takes it. */
export type FieldKit = { primary: string; armor: string; utility: string | null };

/** The basic kit an unknown id falls back to. */
export const BASIC_KIT: FieldKit = { primary: "mx4", armor: "spectre", utility: null };

const SQUAD_SLOT = { primary: "primary", armor: "armor", utility: "utility" } as const;
const warned = new Set<string>();

function warnOnce(text: string) {
    if (warned.has(text)) return;
    warned.add(text);
    console.warn(`[mock match] ${text}`);
}

/**
 * A loadout as the squad catalog's ids, slot by slot: the economy's `kitOf`
 * maps the catalog ids, each result must be a squad item of that slot, and
 * anything else falls back to the basic kit with a console warning.
 */
export function fieldKit(loadout: Loadout): FieldKit {
    let mapped: { primary: string | null; armor: string | null; utility: string | null };
    try {
        mapped = kitOf(loadout);
    } catch {
        mapped = { primary: null, armor: null, utility: null };
    }
    const check = (slot: keyof typeof SQUAD_SLOT, id: string | null, from: string | null) => {
        if (slot === "utility" && from === null) return null;
        const item = id ? itemById(id) : undefined;
        if (item && item.slot === SQUAD_SLOT[slot]) return item.id;
        warnOnce(
            `unknown ${slot} "${from}" for preset "${loadout.preset}": the basic kit stands in`,
        );
        return BASIC_KIT[slot];
    };
    return {
        primary: check("primary", mapped.primary, loadout.weapon) ?? BASIC_KIT.primary,
        armor: check("armor", mapped.armor, loadout.armor) ?? BASIC_KIT.armor,
        utility: check("utility", mapped.utility, loadout.utility),
    };
}

/** The engine's role for a kit: what the HUD names it and how the AI weighs it. */
export type FieldRole = "ASSAULT" | "RECON" | "HEAVY" | "SPECIALIST";

export function fieldRole(kit: FieldKit): FieldRole {
    if (itemById(kit.primary)?.model === "sniper") return "RECON";
    if (kit.armor === "nyx-heavy") return "HEAVY";
    if (kit.utility === "trauma") return "SPECIALIST";
    return "ASSAULT";
}

const RECRUIT_ROLE: Record<FieldRole, RecruitRole> = {
    ASSAULT: "Assault",
    RECON: "Marksman",
    HEAVY: "Assault",
    SPECIALIST: "Support",
};

/** The preset's name, else its id as written. */
export const presetName = (loadout: Loadout) => presetOf(loadout.preset)?.name ?? loadout.preset;

const PLAYER_CALLSIGNS = [
    "KESTREL",
    "ONYX",
    "VANTA",
    "RELIC",
    "CINDER",
    "HALCYON",
    "NOMAD",
    "SABLE",
    "TALON",
    "VESPER",
    "QUILL",
    "RAVEN",
];
const OPPONENT_CALLSIGNS = [
    "MANTIS",
    "HEX",
    "SPECTRA",
    "GRAVEL",
    "OUTLAW",
    "BRAND",
    "LYNX",
    "FLINT",
    "WIDOW",
    "DRIFT",
    "CARBON",
    "SHRIKE",
];
const SURNAMES = [
    "Arden",
    "Brandt",
    "Castell",
    "Dahl",
    "Ekwueme",
    "Fujita",
    "Halloran",
    "Ivers",
    "Kade",
    "Lindqvist",
    "Moreau",
    "Nakamura",
    "Okafor",
    "Petrov",
    "Quade",
    "Reyes",
    "Sato",
    "Tamsin",
    "Varga",
    "Wen",
];

/** The faces a virtual unit can wear: the character editor's identity presets. */
const FACES = presets.filter((p) => p.sex);

/** One side's units as the match deploys them. */
export type Side = {
    /** Unit ids in deployment order (`a1`..., `b1`...). */
    ids: string[];
    loadouts: Loadout[];
    kits: FieldKit[];
    roles: FieldRole[];
    callsigns: string[];
    /** Full names. */
    names: string[];
};

function sideOf(
    prefix: "a" | "b",
    loadouts: Loadout[],
    callsigns: string[],
    random: () => number,
): Side {
    const kits = loadouts.map(fieldKit);
    const signs = draw(callsigns, loadouts.length, random);
    const faces = draw(FACES, Math.min(FACES.length, loadouts.length), random);
    return {
        ids: loadouts.map((_, i) => `${prefix}${i + 1}`),
        loadouts,
        kits,
        roles: kits.map(fieldRole),
        callsigns: loadouts.map((_, i) => signs[i] ?? `${prefix.toUpperCase()}-${i + 1}`),
        names: loadouts.map(
            (_, i) => `${(faces[i % faces.length] ?? FACES[0]).name} ${pick(SURNAMES, random)}`,
        ),
    };
}

/**
 * The opponent's squad: `squadSize(mode)` presets the opponent's rating opens,
 * drawn by the seed, each slot a preset lets go of swapped now and then for
 * another unlocked item, kept only if the economy calls it legal at that
 * rating (budget, tier, size). Eight draws that all fail give the economy's
 * `defaultSquad`.
 */
export function opponentSquad(rating: number, mode: Mode, seed: number): Loadout[] {
    const random = seeded(seed ^ 0x5bd1e995);
    const open = presetsFor(rating);
    if (!open.length) return defaultSquad(rating, mode);
    const slots: Slot[] = ["weapon", "armor", "utility"];
    for (let attempt = 0; attempt < 8; attempt++) {
        const squad = Array.from({ length: squadSize(mode) }, () => {
            const preset = pick(open, random);
            const unit: Loadout = { ...preset.loadout };
            for (const slot of slots) {
                if (!preset.swaps.includes(slot) || random() > 0.3) continue;
                const items = itemsFor(rating, slot);
                if (slot === "utility" && random() < 0.3) unit.utility = null;
                else if (items.length) unit[slot] = pick(items, random).id;
            }
            return unit;
        });
        if (!validateSquad(squad, rating, mode).length) return squad;
    }
    return defaultSquad(rating, mode);
}

/** Everything drawn for a match: both sides, from the match's seed. */
export type MatchPlan = { id: string; seed: number; player: Side; opponent: Side };

export function matchPlan(match: MockMatch): MatchPlan {
    const seed = matchSeed(match);
    const random = seeded(seed);
    const size = squadSize(match.mode);
    const squad = match.squad.slice(0, size);
    return {
        id: matchIdOf(match),
        seed,
        player: sideOf("a", squad, PLAYER_CALLSIGNS, random),
        opponent: sideOf(
            "b",
            opponentSquad(match.opponent.rating, match.mode, seed),
            OPPONENT_CALLSIGNS,
            random,
        ),
    };
}

/**
 * The player's side as recruits the engine deploys (`Encounter`'s `squad`):
 * matched to units by id, wearing their armor, named by callsign, a face from
 * the editor's presets. Rookies with no fittings; nothing is saved.
 */
export function virtualRecruits(side: Side, seed: number): Recruit[] {
    const random = seeded(seed ^ 0x2545f491);
    const faces = draw(FACES, Math.min(FACES.length, side.ids.length), random);
    return side.ids.map((id, i) => {
        const face = faces[i % faces.length] ?? FACES[0];
        const kit = side.kits[i];
        return {
            id,
            name: side.names[i],
            callsign: side.callsigns[i],
            role: RECRUIT_ROLE[side.roles[i]],
            appearance: normalize({ ...fromPreset(face), name: side.names[i] }, schema),
            armorColors: normalizeArmorColors(null),
            equipment: {
                primary: kit.primary,
                sidearm: "k12",
                armor: kit.armor,
                utility: kit.utility,
            },
            attachments: {},
        };
    });
}

// === Words ===

export const kindName = (kind: MockMatch["kind"]) => (kind === "ranked" ? "Ranked" : "Friendly");
/** The header's name for the match: "Ranked 3x3", "Friendly 4x4". */
export const matchTitle = (match: Pick<MockMatch, "kind" | "mode">) =>
    `${kindName(match.kind)} ${match.mode}`;

export const LEVEL_NAME = "Black Rain";

// === Spawns ===

export type Cell = [number, number];
export type SpawnSet = { a: Cell[]; b: Cell[] };

/**
 * The cells side B gains for a 4x4 on the Black Rain base (level grid cells):
 * the base deploys four on side A and three on side B; this is the fourth, an
 * open tile in the middle of side B's line, as far from side A as the others.
 */
export const BLACK_RAIN_EXTRA_B: Cell[] = [[8, 4]];

/** Each side's cells for `mode`: the base's own, side B topped up from `extra`. */
export function spawnsFor(
    base: SpawnSet,
    mode: Mode,
    extra: Cell[] = BLACK_RAIN_EXTRA_B,
): SpawnSet {
    const size = squadSize(mode);
    const b = [...base.b];
    for (const cell of extra)
        if (b.length < size && !b.some((c) => c[0] === cell[0] && c[1] === cell[1])) b.push(cell);
    return { a: base.a.slice(0, size), b: b.slice(0, size) };
}

// === The result ===

export type MatchOutcome = "victory" | "defeat" | "forfeit";

export type RatingChange = {
    before: number;
    after: number;
    delta: number;
    tierBefore: string;
    tierAfter: string;
};

/** A match as it ended: kept under `RESULT_KEY`, so the debrief survives a reload. */
export type SettledMatch = {
    id: string;
    outcome: MatchOutcome;
    /** Null for a friendly. */
    rating: RatingChange | null;
    debrief: EncounterDebrief;
};

export type SettleDeps = {
    ledger: TextSlot;
    read: () => RatingState;
    write: (state: RatingState) => void;
};

export function readSettled(ledger: TextSlot, id: string): SettledMatch | null {
    try {
        const raw = ledger.get();
        const settled = raw ? (JSON.parse(raw) as SettledMatch) : null;
        return settled?.id === id ? settled : null;
    } catch {
        return null;
    }
}

/**
 * Settle the match once: the first call records the outcome and, for ranked,
 * applies it to the rating (a forfeit is a loss); every later call for the
 * same match id returns that record and changes nothing.
 */
export function settleMatch(
    match: MockMatch,
    outcome: MatchOutcome,
    debrief: EncounterDebrief,
    deps: SettleDeps = { ledger: sessionSlot(RESULT_KEY), read: readRating, write: writeRating },
): SettledMatch {
    const id = matchIdOf(match);
    const done = readSettled(deps.ledger, id);
    if (done) return done;
    let rating: RatingChange | null = null;
    if (match.kind === "ranked") {
        const before = deps.read();
        const after = applyResult(before, match.opponent.rating, outcome === "victory");
        rating = {
            before: before.rating,
            after: after.rating,
            delta: after.rating - before.rating,
            tierBefore: tierOf(before.rating).name,
            tierAfter: tierOf(after.rating).name,
        };
        // The record first: a second call sees it even if writing the rating throws.
        const settled: SettledMatch = { id, outcome, rating, debrief };
        deps.ledger.set(JSON.stringify(settled));
        deps.write(after);
        return settled;
    }
    const settled: SettledMatch = { id, outcome, rating, debrief };
    deps.ledger.set(JSON.stringify(settled));
    return settled;
}

/** How the engine's report reads as an outcome; a forfeit is the host's own. */
export const outcomeOf = (report: EncounterReport): MatchOutcome =>
    report.victory ? "victory" : "defeat";

const two = (n: number) => String(n).padStart(2, "0");
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The rating lines under the debrief's title: old → new with the delta, and a tier change. */
export function ratingLines(kind: MockMatch["kind"], rating: RatingChange | null): string[] {
    if (kind === "friendly" || !rating) return ["Friendly match: rating unchanged"];
    return [
        `Rating ${rating.before} → ${rating.after} · ${signed(rating.delta)}`,
        ...(rating.tierAfter !== rating.tierBefore
            ? [`Rank ${rating.tierBefore} → ${rating.tierAfter}`]
            : []),
    ];
}

const HEADLINE: Record<MatchOutcome, [string, Debrief["tone"]]> = {
    victory: ["Victory", "win"],
    defeat: ["Defeat", "loss"],
    forfeit: ["Match forfeited", "blame"],
};

/**
 * The settled match on the debrief's plates: one per unit that went out, its
 * callsign, preset, weapon and kills; the fallen KIA. No experience: virtual
 * units are discarded after the match.
 */
export function mockDebriefOf(match: MockMatch, plan: MatchPlan, settled: SettledMatch): Debrief {
    const { report } = settled.debrief;
    const side = plan.player;
    const podiums = Math.max(3, side.ids.length);
    const plates: Plate[] = Array.from({ length: podiums }, (_, i): Plate => {
        const id = side.ids[i];
        if (!id) return { kind: "vacant" };
        const r = report.recruits.find((u) => u.id === id);
        const kills = r?.kills ?? 0;
        const kia = r?.kia ?? false;
        const rank = presetName(side.loadouts[i]);
        const field = {
            role: itemById(side.kits[i].primary)?.name ?? "Rifle",
            full: side.names[i],
            kills,
            level: 1,
            progress: 0,
            levelXp: 0,
            hint: `${side.names[i]}. ${kia ? "Killed in action" : "Came home"} · ${kills} confirmed ${kills === 1 ? "kill" : "kills"}`,
        };
        const name = r?.name ?? side.callsigns[i];
        if (kia) return { kind: "kia", id, name, rank, turn: null, field };
        return {
            kind: "home",
            id,
            name,
            rankBefore: rank,
            rankAfter: rank,
            promoted: false,
            xpBefore: 0,
            xpAfter: 0,
            gained: null,
            band: null,
            field,
        };
    });
    const [title, tone] = HEADLINE[settled.outcome];
    const total = side.ids.length;
    const survivors = report.recruits.filter((u) => !u.kia).length;
    const lost = total - survivors;
    const kills = report.recruits.reduce((n, u) => n + u.kills, 0);
    return {
        title,
        tone,
        note: settled.outcome === "forfeit" && match.kind === "ranked" ? "Counts as a loss" : null,
        lines: [
            `${matchTitle(match)} · ${LEVEL_NAME}`,
            `${two(report.turns)} turns · ${survivors} / ${total} returned${lost ? ` · ${lost} lost` : ""} · ${kills} ${kills === 1 ? "kill" : "kills"}`,
            ...ratingLines(match.kind, settled.rating),
        ],
        opponent: `${match.opponent.name} · ${match.opponent.rating}`,
        rating: null,
        plates,
        replacement: null,
    };
}
