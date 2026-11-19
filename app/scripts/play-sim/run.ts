// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The ranked balance simulation. Many AI-against-AI matches under the chain's
 * rules (`match.ts`), fixed seeds, one process; prints markdown tables.
 *
 *   nice node --no-warnings --experimental-strip-types app/scripts/play-sim/run.ts [experiment...] [--scale 1] [--before]
 *
 * Experiments: values, presets, mirror, field, budget, degenerate, field4 (all when none named).
 * `--before` prices squads with the first-cut table kept below instead of the
 * economy's own, for the before/after comparison. `--scale` multiplies sample sizes.
 */

import {
    defaultSquad,
    PRESETS,
    PRICES,
    TIERS,
    type Loadout,
    type Mode,
    type Tier,
} from "../../src/features/play/economy/index.ts";
import { playMatch } from "./match.ts";
import { logistic, pct, rate } from "./stats.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const SCALE = option("scale", 1);
const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--scale"));

/** The first cut, before any tuning: prices and budgets by tier. */
const BEFORE = {
    prices: {
        "rifle-1": 20,
        "rifle-2": 35,
        "rifle-3": 55,
        "armor-1": 10,
        "armor-2": 20,
        "armor-3": 35,
        "frag-grenade": 15,
    } as Record<string, number>,
    budgets: {
        rookie: { "3x3": 120, "4x4": 160 },
        contractor: { "3x3": 150, "4x4": 200 },
        operative: { "3x3": 180, "4x4": 240 },
        elite: { "3x3": 210, "4x4": 280 },
    } as Record<string, Record<Mode, number>>,
};
const PRICE = flag("before") ? BEFORE.prices : PRICES;
const budgetAt = (tier: Tier, mode: Mode) =>
    flag("before") ? BEFORE.budgets[tier.id][mode] : tier.budget[mode];
const price = (u: Loadout) => PRICE[u.weapon] + PRICE[u.armor] + (u.utility ? PRICE[u.utility] : 0);
const squadPrice = (s: Loadout[]) => s.reduce((sum, u) => sum + price(u), 0);

// === Loadouts and squads ===

const WEAPONS = ["rifle-1", "rifle-2", "rifle-3"];
const ARMORS = ["armor-1", "armor-2", "armor-3"];
const UTILITIES = [null, "frag-grenade"];
const SHORT: Record<string, string> = {
    "rifle-1": "R",
    "rifle-2": "S",
    "rifle-3": "P",
    "armor-1": "l",
    "armor-2": "m",
    "armor-3": "h",
    "frag-grenade": "+g",
};

/** The preset a loadout is, or the closest by weapon for a label. */
function presetName(u: Loadout): string {
    const exact = PRESETS.find(
        (p) =>
            p.loadout.weapon === u.weapon &&
            p.loadout.armor === u.armor &&
            p.loadout.utility === u.utility,
    );
    return exact
        ? exact.name
        : SHORT[u.weapon] + SHORT[u.armor] + (u.utility ? SHORT[u.utility] : "");
}
const label = (s: Loadout[]) => s.map(presetName).join(" + ");

const ALL_LOADOUTS: Loadout[] = WEAPONS.flatMap((weapon) =>
    ARMORS.flatMap((armor) =>
        UTILITIES.map((utility) => ({ preset: "custom", weapon, armor, utility })),
    ),
).map((u) => ({ ...u, preset: PRESETS.find((p) => presetName(u) === p.name)?.id ?? "custom" }));

const preset = (id: string): Loadout => ({ ...PRESETS.find((p) => p.id === id)!.loadout });
const many = (id: string, n: number) => Array.from({ length: n }, () => preset(id));

/** Every multiset of `n` loadouts. */
function multisets(items: Loadout[], n: number, from = 0): Loadout[][] {
    if (n === 0) return [[]];
    const out: Loadout[][] = [];
    for (let i = from; i < items.length; i++)
        for (const rest of multisets(items, n - 1, i)) out.push([items[i], ...rest]);
    return out;
}

const unlockedLoadouts = (tier: Tier) =>
    ALL_LOADOUTS.filter((u) =>
        [u.weapon, u.armor, u.utility].every((id) => id === null || tier.items.includes(id)),
    );

/** mulberry32. */
function random(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// === Playing ===

let played = 0;

/**
 * `pairs` pairs of games between `a` and `b`, each pair on one seed with each
 * side moving first once. Returns `a`'s score (a draw is half) and the games.
 */
async function duel(a: Loadout[], b: Loadout[], pairs: number, seed: number) {
    let score = 0;
    let firstScore = 0;
    for (let i = 0; i < pairs; i++) {
        const s = seed * 100_003 + i;
        const one = await playMatch([a, b], s);
        const two = await playMatch([b, a], s);
        const sa =
            (one.winner === 0 ? 1 : one.winner === null ? 0.5 : 0) +
            (two.winner === 1 ? 1 : two.winner === null ? 0.5 : 0);
        score += sa;
        firstScore +=
            (one.winner === 0 ? 1 : one.winner === null ? 0.5 : 0) +
            (two.winner === 0 ? 1 : two.winner === null ? 0.5 : 0);
        played += 2;
    }
    return { score, games: 2 * pairs, firstScore };
}

const n = (base: number) => Math.max(1, Math.round(base * SCALE));
const log = (line = "") => console.log(line);
const table = (head: string[], rows: (string | number)[][]) => {
    log(`| ${head.join(" | ")} |`);
    log(`|${head.map(() => "---").join("|")}|`);
    for (const row of rows) log(`| ${row.join(" | ")} |`);
    log();
};

// === Experiments ===

/** Item value in log-odds from random squads (3x3, every loadout), relative to rifle, light armor, no utility. */
async function values() {
    const features = ["rifle-2", "rifle-3", "armor-2", "armor-3", "frag-grenade"];
    const rng = random(7);
    const x: number[][] = [];
    const y: number[] = [];
    const pairs = n(3000);
    const count = (s: Loadout[], id: string) =>
        s.filter((u) => u.weapon === id || u.armor === id || u.utility === id).length;
    for (let i = 0; i < pairs; i++) {
        const pick = () =>
            Array.from({ length: 3 }, () => ALL_LOADOUTS[Math.floor(rng() * ALL_LOADOUTS.length)]);
        const [a, b] = [pick(), pick()];
        for (const [first, second] of [
            [a, b],
            [b, a],
        ]) {
            const r = await playMatch([first, second], 900_000 + i);
            played++;
            x.push([1, ...features.map((f) => count(first, f) - count(second, f))]);
            y.push(r.winner === 0 ? 1 : r.winner === null ? 0.5 : 0);
        }
    }
    const { beta, se } = logistic(x, y);
    log(`### Item values (logistic fit, ${x.length} games of random 3x3 squads)`);
    log();
    log(
        "Log-odds of winning per unit carrying the item, against a Standard Rifle, Light Armor or no utility; the intercept is moving first.",
    );
    log();
    table(
        ["term", "log-odds", "95% CI", "price now (diff to baseline)"],
        [["move first", ...fmt(beta[0], se[0]), "-"]].concat(
            features.map((f, i) => {
                const base = f.startsWith("rifle")
                    ? "rifle-1"
                    : f.startsWith("armor")
                      ? "armor-1"
                      : null;
                return [
                    f,
                    ...fmt(beta[i + 1], se[i + 1]),
                    String(PRICE[f] - (base ? PRICE[base] : 0)),
                ];
            }),
        ),
    );
}
const fmt = (b: number, se: number): [string, string] => [
    b.toFixed(3),
    `[${(b - 1.96 * se).toFixed(3)}, ${(b + 1.96 * se).toFixed(3)}]`,
];

/** Each preset in place of one Recruit, against three Recruits. */
async function presets() {
    log("### Preset contribution (3x3: the preset plus two Recruits against three Recruits)");
    log();
    const rows: (string | number)[][] = [];
    for (const p of PRESETS) {
        const squad = [preset(p.id), preset("recruit"), preset("recruit")];
        const r = await duel(squad, many("recruit", 3), n(400), 11 + rows.length);
        rows.push([
            p.name,
            price(p.loadout),
            price(p.loadout) - price(preset("recruit")),
            r.games,
            rate(r.score, r.games),
        ]);
    }
    table(["preset", "price", "over a Recruit", "games", "win rate [95% CI]"], rows);
}

/** Mirror matches of each tier's default squad: the first mover's share. */
async function mirror() {
    log("### First-mover advantage (mirror matches of the default squad)");
    log();
    const rows: (string | number)[][] = [];
    for (const mode of ["3x3", "4x4"] as Mode[])
        for (const tier of TIERS) {
            const squad = defaultSquad(tier.min, mode);
            const r = await duel(squad, squad, n(500), 21 + rows.length);
            rows.push([mode, tier.name, label(squad), r.games, rate(r.firstScore, r.games)]);
        }
    table(["mode", "tier", "squad", "games", "first mover wins"], rows);
}

/** Full-budget squads at a tier, a deterministic sample plus the default and the named extremes. */
function fieldOf(tier: Tier, mode: Mode, size: number) {
    const budget = budgetAt(tier, mode);
    const all = multisets(unlockedLoadouts(tier), mode === "3x3" ? 3 : 4).filter(
        (s) => squadPrice(s) <= budget && squadPrice(s) >= budget - 5,
    );
    const rng = random(31 + tier.min);
    const sample: Loadout[][] = [defaultSquad(tier.min, mode)];
    const key = (s: Loadout[]) =>
        label([...s].sort((a, b) => presetName(a).localeCompare(presetName(b))));
    const seen = new Set(sample.map(key));
    const pool = [...all];
    while (sample.length < size && pool.length) {
        const s = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        if (!seen.has(key(s))) {
            seen.add(key(s));
            sample.push(s);
        }
    }
    return { sample, total: all.length, budget };
}

/** Round robin of full-budget squads at each tier: no composition should stand out. */
async function field(mode: Mode = "3x3", tiers: readonly Tier[] = TIERS, size = 8, pairsEach = 60) {
    for (const tier of tiers) {
        const { sample, total, budget } = fieldOf(tier, mode, size);
        log(
            `### Field: ${tier.name} ${mode}, budget ${budget}, ${sample.length} of ${total} squads within 5 credits of the budget`,
        );
        log();
        const score = sample.map(() => 0);
        const games = sample.map(() => 0);
        let worst = { gap: 0, text: "" };
        for (let i = 0; i < sample.length; i++)
            for (let j = i + 1; j < sample.length; j++) {
                const r = await duel(
                    sample[i],
                    sample[j],
                    n(pairsEach),
                    1000 + i * 31 + j + tier.min,
                );
                score[i] += r.score;
                games[i] += r.games;
                score[j] += r.games - r.score;
                games[j] += r.games;
                const gap = Math.abs(pct(r.score, r.games) - 50);
                if (gap > worst.gap)
                    worst = {
                        gap,
                        text: `${label(sample[i])} vs ${label(sample[j])}: ${rate(r.score, r.games)} (${r.games} games)`,
                    };
            }
        table(
            ["squad", "price", "games", "win rate vs the field [95% CI]"],
            sample
                .map((s, i) => ({ s, i, p: pct(score[i], games[i]) }))
                .sort((a, b) => b.p - a.p)
                .map(({ s, i }) => [label(s), squadPrice(s), games[i], rate(score[i], games[i])]),
        );
        log(`Widest single matchup: ${worst.text}.`);
        log();
    }
}

/** What credits buy: squads below and at the budget against the default squad. */
async function budget() {
    const tier = TIERS[1];
    const mode: Mode = "3x3";
    const target = defaultSquad(tier.min, mode);
    log(
        `### Budget sensitivity (${tier.name} 3x3; each row's squad against the default squad, ${label(target)}, ${squadPrice(target)} credits)`,
    );
    log();
    const ladders: Loadout[][] = [
        many("recruit", 3),
        [preset("runner"), preset("recruit"), preset("recruit")],
        [preset("runner"), preset("runner"), preset("recruit")],
        [preset("assault"), preset("runner"), preset("recruit")],
        [preset("assault"), preset("runner"), preset("runner")],
        [preset("assault"), preset("sniper"), preset("recruit")],
        [preset("assault"), preset("assault"), preset("runner")],
        target,
    ];
    const rows: (string | number)[][] = [];
    for (const s of ladders) {
        const r = await duel(s, target, n(300), 51 + rows.length);
        rows.push([
            label(s),
            squadPrice(s),
            squadPrice(s) - squadPrice(target),
            r.games,
            rate(r.score, r.games),
        ]);
    }
    table(["squad", "price", "credits vs default", "games", "win rate [95% CI]"], rows);
}

/** One-note squads against the default squad and against a mixed full-budget squad. */
async function degenerate() {
    log("### One-note squads (3x3)");
    log();
    const rows: (string | number)[][] = [];
    const sniperMid = { ...preset("sniper"), armor: "armor-2" };
    const sniperHeavy = { ...preset("sniper"), armor: "armor-3" };
    const cases: [string, Tier, Loadout[]][] = [
        ["all Snipers", TIERS[1], many("sniper", 3)],
        ["all Runners", TIERS[1], many("runner", 3)],
        [
            "grenade spam, full budget",
            TIERS[1],
            [preset("assault"), preset("assault"), preset("runner")],
        ],
        ["grenades everywhere, cheapest", TIERS[0], many("runner", 3)],
        ["Snipers in the best armor that fits", TIERS[3], [sniperHeavy, sniperHeavy, sniperMid]],
        ["two Heavies", TIERS[3], [preset("heavy"), preset("heavy"), preset("recruit")]],
        [
            "heavy armor everywhere",
            TIERS[2],
            [
                { ...preset("recruit"), armor: "armor-3" },
                { ...preset("recruit"), armor: "armor-3" },
                { ...preset("recruit"), armor: "armor-2" },
            ],
        ],
        [
            "plasma everywhere",
            TIERS[3],
            Array.from({ length: 3 }, () => ({ ...preset("recruit"), weapon: "rifle-3" })),
        ],
        ["all Heavies", TIERS[3], many("heavy", 3)],
    ];
    for (const [name, tier, s] of cases) {
        const cost = squadPrice(s);
        const legal =
            cost <= budgetAt(tier, "3x3") &&
            s.every((u) =>
                [u.weapon, u.armor, u.utility].every((id) => !id || tier.items.includes(id)),
            );
        if (!legal) {
            rows.push([name, tier.name, label(s), cost, "over budget or locked", "-"]);
            continue;
        }
        const target = defaultSquad(tier.min, "3x3");
        const r = await duel(s, target, n(300), 71 + rows.length);
        rows.push([
            name,
            tier.name,
            label(s),
            cost,
            label(target),
            `${rate(r.score, r.games)} (${r.games})`,
        ]);
    }
    table(
        ["case", "tier", "squad", "price", "against (default squad)", "win rate [95% CI] (games)"],
        rows,
    );
}

/** Whether extra credits for the side that moves second can pay for moving second. */
async function handicap() {
    const tier = TIERS[1];
    const first = defaultSquad(tier.min, "3x3");
    log(
        `### Second-mover credits (${tier.name} 3x3: the first mover fields the default squad, ${label(first)}, ${squadPrice(first)} credits)`,
    );
    log();
    const sniperMid = { ...preset("sniper"), armor: "armor-2" };
    const options: Loadout[][] = [
        first,
        [preset("assault"), preset("assault"), preset("sniper")],
        [preset("assault"), preset("assault"), preset("assault")],
        [preset("assault"), preset("assault"), sniperMid],
        [preset("assault"), sniperMid, sniperMid],
        [sniperMid, sniperMid, sniperMid],
    ];
    const rows: (string | number)[][] = [];
    for (const s of options) {
        let score = 0;
        const games = n(500);
        for (let i = 0; i < games; i++) {
            const r = await playMatch([first, s], 5_000_000 + rows.length * 10_000 + i);
            played++;
            score += r.winner === 1 ? 1 : r.winner === null ? 0.5 : 0;
        }
        rows.push([
            label(s),
            squadPrice(s),
            squadPrice(s) - squadPrice(first),
            games,
            rate(score, games),
        ]);
    }
    table(
        ["second mover's squad", "price", "extra credits", "games", "second mover wins [95% CI]"],
        rows,
    );
}

const EXPERIMENTS: Record<string, () => Promise<void>> = {
    handicap,
    values,
    presets,
    mirror,
    field: () => field("3x3", TIERS, 10, 50),
    budget,
    degenerate,
    field4: () => field("4x4", TIERS.slice(1, 3), 6, 40),
};

const started = Date.now();
log(`Prices: ${flag("before") ? "first cut" : "economy module"}; scale ${SCALE}.`);
log();
for (const name of named.length ? named : Object.keys(EXPERIMENTS)) {
    const t = Date.now();
    await EXPERIMENTS[name]();
    log(`_${name}: ${((Date.now() - t) / 1000).toFixed(0)} s_`);
    log();
}
log(`${played} games in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
