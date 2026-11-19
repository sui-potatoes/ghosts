// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * First mover versus starting distance. Mirror matches under the chain's rules
 * (the agent package's sandbox, same bot as `run.ts`) with the first move and the
 * spawn side pulled apart, and the spawns moved further and further from each other.
 *
 *   nice node --no-warnings --experimental-strip-types app/scripts/play-sim/first-mover.ts [facts|black|synthetic|variants] [--pairs 500]
 *
 * One cell is `pairs` seeds, each played twice: once with the first move on spawn
 * set X and once on set Y, so a cell holds 2 x `pairs` games on `pairs` seeds.
 * Nothing here touches `run.ts` or the economy: squads come from its presets.
 */

import { BLACK_RAIN, BLACK_RAIN_POSITIONS } from "../../../packages/agent/src/maps.ts";
import { MapBcs, decodeTiles } from "../../../packages/agent/src/bcs.ts";
import { referencePolicy, type Policy } from "../../../packages/agent/src/bot.ts";
import { legalActions, lineOfSight, parseAction } from "../../../packages/agent/src/rules.ts";
import { createSandbox } from "../../../packages/agent/src/sandbox.ts";
import type { GameState, Tile } from "../../../packages/agent/src/types.ts";
import { defaultSquad, PRESETS, type Loadout } from "../../src/features/play/economy/index.ts";
import { simPolicy, squadUnits } from "./match.ts";
import { pct, rate, wilson } from "./stats.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
};
const PAIRS = option("pairs", 500);
const TARGETS = (() => {
    const i = args.indexOf("--targets");
    return i >= 0 ? args[i + 1].split(",").map(Number) : null;
})();
const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const log = (line = "") => console.log(line);

type Cell = [number, number];

// === Maps and geometry ===

const blackRain: Tile[][] = decodeTiles(MapBcs.parse(Uint8Array.from(Buffer.from(BLACK_RAIN, "hex"))));

/** An open grid with a few symmetric cover blocks, for the synthetic runs. */
function syntheticGrid(size: number): Tile[][] {
    const tiles: Tile[][] = Array.from({ length: size }, () =>
        Array.from({ length: size }, (): Tile => ({ kind: "empty" })),
    );
    const low: Tile = { kind: "cover", left: 1, top: 1, right: 1, bottom: 1 };
    // symmetric under a half turn: every block is placed with its image
    const blocks: [number, number, number][] = [
        // row, col, kind (0 low cover tile, 1 two-by-two wall)
        [5, 4, 1],
        [9, 13, 0],
        [8, 8, 0],
        [4, 15, 0],
        [11, 5, 0],
        [6, 10, 0],
        [3, 7, 0],
        [10, 2, 1],
        [7, 18, 1],
    ];
    for (const [r, c, kind] of blocks) {
        for (const [rr, cc] of [
            [r, c],
            [size - 1 - r - (kind ? 1 : 0), size - 1 - c - (kind ? 1 : 0)],
        ]) {
            for (let dr = 0; dr <= kind; dr++)
                for (let dc = 0; dc <= kind; dc++)
                    tiles[rr + dr][cc + dc] = kind ? { kind: "wall" } : { ...low };
        }
    }
    return tiles;
}

const walkable = (t: Tile) => t.kind === "empty" || t.kind === "cover";
const rowsOf = (tiles: Tile[][]) => tiles.length;
const colsOf = (tiles: Tile[][]) => tiles[0].length;

/** Walking distance (orthogonal steps over walkable tiles, units ignored) from a cell to every cell. */
function walkFrom(tiles: Tile[][], from: Cell): number[][] {
    const dist = tiles.map((row) => row.map(() => Infinity));
    dist[from[0]][from[1]] = 0;
    let frontier = [from];
    while (frontier.length) {
        const next: Cell[] = [];
        for (const [x, y] of frontier)
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const [nx, ny] = [x + dx, y + dy];
                if (nx < 0 || ny < 0 || nx >= rowsOf(tiles) || ny >= colsOf(tiles)) continue;
                if (!walkable(tiles[nx][ny]) || dist[nx][ny] !== Infinity) continue;
                dist[nx][ny] = dist[x][y] + 1;
                next.push([nx, ny]);
            }
        frontier = next;
    }
    return dist;
}

interface Geometry {
    walk: { min: number; avg: number; max: number };
    manhattan: { min: number; avg: number; max: number };
    chebyshev: { min: number; avg: number; max: number };
    /** Pairs (own spawn, enemy spawn) that see each other at the start. */
    sight: number;
}

const stat = (v: number[]) => ({
    min: Math.min(...v),
    avg: v.reduce((a, b) => a + b, 0) / v.length,
    max: Math.max(...v),
});

function geometry(tiles: Tile[][], a: Cell[], b: Cell[]): Geometry {
    const walk: number[] = [];
    const man: number[] = [];
    const che: number[] = [];
    let sight = 0;
    const fake = { tiles, rows: rowsOf(tiles), cols: colsOf(tiles), units: [] } as unknown as GameState;
    for (const p of a) {
        const d = walkFrom(tiles, p);
        for (const q of b) {
            walk.push(d[q[0]][q[1]]);
            man.push(Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]));
            che.push(Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])));
            if (lineOfSight(fake, p[0], p[1], q[0], q[1])) sight++;
        }
    }
    return { walk: stat(walk), manhattan: stat(man), chebyshev: stat(che), sight };
}

type Transform = "half-turn" | "flip-rows" | "flip-cols";
const image = (t: Transform, [x, y]: Cell, rows: number, cols: number): Cell =>
    t === "half-turn" ? [rows - 1 - x, cols - 1 - y] : t === "flip-rows" ? [rows - 1 - x, y] : [x, cols - 1 - y];

/** Tiles whose kind differs from their image under the transform, out of all. */
function asymmetry(tiles: Tile[][], t: Transform): number {
    let diff = 0;
    for (let x = 0; x < rowsOf(tiles); x++)
        for (let y = 0; y < colsOf(tiles); y++) {
            const [ix, iy] = image(t, [x, y], rowsOf(tiles), colsOf(tiles));
            if (tiles[x][y].kind !== tiles[ix][iy].kind) diff++;
        }
    return diff;
}

/** Tile mismatches within `radius` of the given cells, against their images. */
function localAsymmetry(tiles: Tile[][], t: Transform, cells: Cell[], radius = 5): number {
    const seen = new Set<string>();
    let diff = 0;
    for (const [cx, cy] of cells)
        for (let x = cx - radius; x <= cx + radius; x++)
            for (let y = cy - radius; y <= cy + radius; y++) {
                if (x < 0 || y < 0 || x >= rowsOf(tiles) || y >= colsOf(tiles)) continue;
                if (seen.has(`${x},${y}`)) continue;
                seen.add(`${x},${y}`);
                const [ix, iy] = image(t, [x, y], rowsOf(tiles), colsOf(tiles));
                if (tiles[x][y].kind !== tiles[ix][iy].kind) diff++;
            }
    return diff;
}

interface SpawnSet {
    /** Target and measured minimum walking distance between the sides. */
    target: number;
    a: Cell[];
    b: Cell[];
    geometry: Geometry;
    mismatch: number;
    transform: Transform;
}

/**
 * Spawn sets at each target minimum walking distance: side A is a three-cell
 * wedge, side B its image under the map's most symmetric transform, so the two
 * are mirror twins; the candidate with the least tile mismatch nearby wins.
 */
function spawnSets(tiles: Tile[][], targets: number[], transforms: Transform[]): SpawnSet[] {
    const [rows, cols] = [rowsOf(tiles), colsOf(tiles)];
    const patterns: Cell[][] = [
        [
            [0, 0],
            [1, 2],
            [0, 4],
        ],
        [
            [0, 0],
            [-1, 2],
            [0, 4],
        ],
        [
            [0, 0],
            [2, 1],
            [4, 0],
        ],
        [
            [0, 0],
            [2, -1],
            [4, 0],
        ],
        [
            [0, 0],
            [0, 2],
            [0, 4],
        ],
    ];
    const out: SpawnSet[] = [];
    for (const target of targets) {
        let best: SpawnSet | null = null;
        for (const transform of transforms)
        for (let x = 0; x < rows; x++)
            for (let y = 0; y < cols; y++)
                for (const pattern of patterns) {
                    const a = pattern.map(([dx, dy]): Cell => [x + dx, y + dy]);
                    if (a.some(([cx, cy]) => cx < 0 || cy < 0 || cx >= rows || cy >= cols)) continue;
                    const b = a.map((c) => image(transform, c, rows, cols));
                    const all = [...a, ...b];
                    if (all.some(([cx, cy]) => !walkable(tiles[cx][cy]))) continue;
                    if (new Set(all.map((c) => c.join())).size !== 6) continue;
                    const g = geometry(tiles, a, b);
                    if (g.walk.min !== target) continue;
                    const mismatch = localAsymmetry(tiles, transform, all);
                    // fewest mismatches, then the tightest group (smaller spread of distances)
                    const better =
                        !best ||
                        mismatch < best.mismatch ||
                        (mismatch === best.mismatch &&
                            g.walk.max - g.walk.min < best.geometry.walk.max - best.geometry.walk.min);
                    if (better) best = { target, a, b, geometry: g, mismatch, transform };
                }
        if (best) out.push(best);
    }
    return out;
}

// === Playing ===

type Variant = "none" | "ap1";

interface Game {
    /** 0 the first mover won, 1 the second, null a draw. */
    winner: 0 | 1 | null;
    turns: number;
    firstShotTurn: number | null;
    /** Side (0 first mover) that scored the first hit and the first kill. */
    firstHit: 0 | 1 | null;
    firstKill: 0 | 1 | null;
}

const MAX_ACTIONS = 32;

/**
 * One match. The first mover (side 0) takes `positions[0..half]`, so which spawn
 * set moves first is decided by the order of `positions`. Squads are identical.
 */
async function play(
    squad: Loadout[],
    positions: Cell[],
    tiles: Tile[][] | undefined,
    seed: number,
    variant: Variant = "none",
    policy: Policy = simPolicy,
): Promise<Game> {
    const units = squadUnits(squad);
    const backend = createSandbox({
        seed,
        seated: true,
        opponent: policy,
        now: () => 0,
        squads: [units, units],
        positions,
        tiles,
    });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    await backend.acceptSeat();
    const account = (await backend.account())!;
    const id = account.search.kind === "playing" ? account.search.game : "";
    let state = (await backend.game(id))!;
    await backend.submit(state, [{ kind: "deploy" }]);
    let actions = 0;
    // the variant: on turn 0 each first-mover unit may act once, as if it had one AP
    const spent = new Set<string>();
    for (;;) {
        state = (await backend.game(id))!;
        if (state.status.kind === "finished") break;
        if (state.active !== 0) throw new Error("the opponent did not end its turn");
        let legal = legalActions(state, 0, 0);
        if (variant === "ap1" && state.turn === 0) {
            legal = legal.filter((a) => {
                if (!a.unit) return true;
                const u = state.units.find((o) => o.x === a.unit![0] && o.y === a.unit![1])!;
                return !spent.has(u.recruit);
            });
        }
        const ids =
            actions++ >= MAX_ACTIONS ? ["next_turn"] : await policy({ state, side: 0, legal, nowMs: 0 });
        if (ids[0] === "next_turn") actions = 0;
        if (variant === "ap1" && state.turn === 0) {
            const chosen = legal.find((a) => a.id === ids[0]);
            if (chosen?.unit) {
                const u = state.units.find((o) => o.x === chosen.unit![0] && o.y === chosen.unit![1])!;
                spent.add(u.recruit);
            }
        }
        await backend.submit(state, ids.map(parseAction));
    }
    const status = state.status as { kind: "finished"; winner: string | null };
    const winner = status.winner === null ? null : (state.players.indexOf(status.winner) as 0 | 1);

    // who acts when: the active side is the turn number's parity
    let turn = 0;
    let firstShotTurn: number | null = null;
    let firstHit: 0 | 1 | null = null;
    let firstKill: 0 | 1 | null = null;
    for (const r of state.history) {
        if (r.kind === "next_turn") turn = r.turn;
        else if ((r.kind === "attack" || r.kind === "grenade") && firstShotTurn === null)
            firstShotTurn = turn;
        else if ((r.kind === "damage" || r.kind === "critical_hit") && firstHit === null)
            firstHit = (turn % 2) as 0 | 1;
        else if (r.kind === "kia" && firstKill === null) firstKill = (turn % 2) as 0 | 1;
    }
    return { winner, turns: state.turn, firstShotTurn, firstHit, firstKill };
}

const score = (g: Game) => (g.winner === 0 ? 1 : g.winner === null ? 0.5 : 0);

interface Cellular {
    n: number;
    /** First mover's score (draw half) with the first move on set a, and on set b. */
    onA: { wins: number; n: number };
    onB: { wins: number; n: number };
    wins: number;
    shot: number[]; // first shot turns
    noShot: number;
    hit: number; // first mover scored first hit
    hits: number; // games with a hit
    kill: number;
    kills: number;
    turns: number;
    draws: number;
}

/** `pairs` seeds, each with the first move on set A and on set B. */
async function cell(
    squad: Loadout[],
    set: { a: Cell[]; b: Cell[] },
    tiles: Tile[][] | undefined,
    pairs: number,
    seed: number,
    variant: Variant = "none",
): Promise<Cellular> {
    const c: Cellular = {
        n: 0,
        onA: { wins: 0, n: 0 },
        onB: { wins: 0, n: 0 },
        wins: 0,
        shot: [],
        noShot: 0,
        hit: 0,
        hits: 0,
        kill: 0,
        kills: 0,
        turns: 0,
        draws: 0,
    };
    for (let i = 0; i < pairs; i++) {
        const s = seed * 100_003 + i;
        for (const [first, second, slot] of [
            [set.a, set.b, c.onA],
            [set.b, set.a, c.onB],
        ] as const) {
            const g = await play(squad, [...first, ...second], tiles, s, variant);
            c.n++;
            slot.n++;
            slot.wins += score(g);
            c.wins += score(g);
            if (g.winner === null) c.draws++;
            c.turns += g.turns;
            if (g.firstShotTurn === null) c.noShot++;
            else c.shot.push(g.firstShotTurn);
            if (g.firstHit !== null) {
                c.hits++;
                if (g.firstHit === 0) c.hit++;
            }
            if (g.firstKill !== null) {
                c.kills++;
                if (g.firstKill === 0) c.kill++;
            }
        }
    }
    return c;
}

// === Squads ===

const preset = (id: string): Loadout => ({ ...PRESETS.find((p) => p.id === id)!.loadout });
const SQUADS: Record<string, Loadout[]> = {
    "Contractor default": defaultSquad(1400, "3x3"),
    "3 Snipers": [preset("sniper"), preset("sniper"), preset("sniper")],
    "3 Recruits": [preset("recruit"), preset("recruit"), preset("recruit")],
};

// === Output ===

const table = (head: string[], rows: (string | number)[][]) => {
    log(`| ${head.join(" | ")} |`);
    log(`|${head.map(() => "---").join("|")}|`);
    for (const row of rows) log(`| ${row.join(" | ")} |`);
    log();
};

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const f1 = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(1));

/** The decomposition: A's spawn advantage and the move's, in points. */
function decompose(c: Cellular) {
    const p = pct(c.onA.wins, c.onA.n); // first mover wins, first move on A's spawns
    const q = pct(c.onB.wins, c.onB.n); // first mover wins, first move on B's spawns
    return { p, q, move: (p + q) / 2 - 50, side: (p - q) / 2 };
}

function mechanism(c: Cellular) {
    return {
        shot: f1(mean(c.shot)),
        noShot: `${((100 * c.noShot) / c.n).toFixed(0)}%`,
        hit: c.hits ? `${((100 * c.hit) / c.hits).toFixed(0)}%` : "-",
        kill: c.kills ? `${((100 * c.kill) / c.kills).toFixed(0)}%` : "-",
        turns: f1(c.turns / c.n),
    };
}

const showCells = (cells: Cell[]) => cells.map(([x, y]) => `(${x},${y})`).join(" ");

async function distanceRun(label: string, tiles: Tile[][], sets: SpawnSet[], seedBase: number) {
    log(`### ${label}`);
    log();
    table(
        ["target", "mirror", "walk min / avg / max", "manhattan min / avg", "sight at start", "A spawns", "B spawns", "local asymmetry"],
        sets.map((s) => [
            s.target,
            s.transform,
            `${s.geometry.walk.min} / ${s.geometry.walk.avg.toFixed(1)} / ${s.geometry.walk.max}`,
            `${s.geometry.manhattan.min} / ${s.geometry.manhattan.avg.toFixed(1)}`,
            `${s.geometry.sight} of 9`,
            showCells(s.a),
            showCells(s.b),
            s.mismatch,
        ]),
    );
    for (const [name, squad] of Object.entries(SQUADS)) {
        const rows: (string | number)[][] = [];
        const mech: (string | number)[][] = [];
        for (const [i, s] of sets.entries()) {
            const c = await cell(squad, s, tiles, PAIRS, seedBase + i);
            const d = decompose(c);
            const m = mechanism(c);
            rows.push([
                s.target,
                c.n,
                rate(c.wins, c.n),
                f1(d.p),
                f1(d.q),
                `${d.move >= 0 ? "+" : ""}${d.move.toFixed(1)}`,
                `${d.side >= 0 ? "+" : ""}${d.side.toFixed(1)}`,
            ]);
            mech.push([s.target, m.shot, m.noShot, m.hit, m.kill, m.turns, `${((100 * c.draws) / c.n).toFixed(1)}%`]);
            console.error(`  ${label} / ${name} / ${s.target}: ${rate(c.wins, c.n)}`);
        }
        log(`**${name}** (squad price and kit as in \`run.ts\`; mirror matches, ${PAIRS} paired seeds a cell)`);
        log();
        table(
            ["min walk", "games", "first mover wins [95% CI]", "wins, first on A", "wins, first on B", "move effect (pts)", "A spawn advantage (pts)"],
            rows,
        );
        table(
            ["min walk", "avg first-shot turn", "no shot fired", "first hit by first mover", "first kill by first mover", "avg turns", "draws"],
            mech,
        );
    }
}

// === Experiments ===

function describeBlackRain() {
    const real = { a: BLACK_RAIN_POSITIONS.slice(0, 3) as Cell[], b: BLACK_RAIN_POSITIONS.slice(3) as Cell[] };
    const g = geometry(blackRain, real.a, real.b);
    log(`### Black Rain facts`);
    log();
    log(
        `Grid ${rowsOf(blackRain)} rows x ${colsOf(blackRain)} cols = ${rowsOf(blackRain) * colsOf(blackRain)} tiles.`,
    );
    const count: Record<string, number> = {};
    for (const row of blackRain) for (const t of row) count[t.kind] = (count[t.kind] ?? 0) + 1;
    log(`Tiles: ${JSON.stringify(count)}`);
    log(`Real spawns, first mover (side 0, bottom): ${showCells(real.a)}; second (side 1, top): ${showCells(real.b)}`);
    log(`Walking distance between sides: min ${g.walk.min}, avg ${g.walk.avg.toFixed(1)}, max ${g.walk.max}`);
    log(`Manhattan: min ${g.manhattan.min}, avg ${g.manhattan.avg.toFixed(1)}, max ${g.manhattan.max}`);
    log(`Chebyshev: min ${g.chebyshev.min}, avg ${g.chebyshev.avg.toFixed(1)}, max ${g.chebyshev.max}`);
    log(`Spawn pairs with line of sight at the start: ${g.sight} of 9`);
    log();
    for (const t of ["half-turn", "flip-rows", "flip-cols"] as Transform[])
        log(`Asymmetry under ${t}: ${asymmetry(blackRain, t)} of ${rowsOf(blackRain) * colsOf(blackRain)} tiles differ`);
    log();
}

/** The real spawns, first move on each side, and the variant. */
async function variants(seedBase: number) {
    const real = { a: BLACK_RAIN_POSITIONS.slice(0, 3) as Cell[], b: BLACK_RAIN_POSITIONS.slice(3) as Cell[] };
    log(`### Rule variants at the real Black Rain spawns (${PAIRS} paired seeds a cell)`);
    log();
    for (const [name, squad] of Object.entries(SQUADS)) {
        const rows: (string | number)[][] = [];
        for (const variant of ["none", "ap1"] as Variant[]) {
            const c = await cell(squad, real, undefined, PAIRS, seedBase, variant);
            const d = decompose(c);
            const m = mechanism(c);
            rows.push([
                variant === "none" ? "as shipped" : "first mover has 1 AP on turn 0",
                c.n,
                rate(c.wins, c.n),
                f1(d.p),
                f1(d.q),
                `${d.move >= 0 ? "+" : ""}${d.move.toFixed(1)}`,
                `${d.side >= 0 ? "+" : ""}${d.side.toFixed(1)}`,
                m.shot,
                m.turns,
            ]);
            console.error(`  variants / ${name} / ${variant}: ${rate(c.wins, c.n)}`);
        }
        log(`**${name}**`);
        log();
        table(
            [
                "rules",
                "games",
                "first mover wins [95% CI]",
                "first on bottom spawns",
                "first on top spawns",
                "move effect (pts)",
                "bottom-spawn advantage (pts)",
                "avg first-shot turn",
                "avg turns",
            ],
            rows,
        );
    }
}

async function main() {
    const all = named.length === 0;
    const want = (n: string) => all || named.includes(n);
    if (want("facts")) describeBlackRain();
    const transforms: Transform[] = ["half-turn", "flip-rows", "flip-cols"];
    if (want("black")) {
        const sets = spawnSets(blackRain, TARGETS ?? [4, 6, 8, 10, 12, 14, 16, 18, 20], transforms);
        await distanceRun("Black Rain, spawns moved apart", blackRain, sets, 1000);
    }
    if (want("synthetic")) {
        const grid = syntheticGrid(24);
        log(`Synthetic 24x24 grid, half-turn asymmetry ${asymmetry(grid, "half-turn")} tiles.`);
        log();
        await distanceRun(
            "SYNTHETIC open 24x24 grid, spawns moved apart",
            grid,
            spawnSets(grid, TARGETS ?? [4, 6, 8, 10, 12, 14, 16, 18], ["half-turn"]),
            2000,
        );
    }
    if (want("variants")) await variants(3000);
}

void wilson;
void referencePolicy;
await main();
