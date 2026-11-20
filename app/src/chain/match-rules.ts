// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the chain says about a game, as plain functions: whose turn it is, when
 * it is over, and how the records in `Game.history` read as engine events.
 * A tile on chain is `[row, col]` from the map's corner; a cell in the scene
 * is `[x, z]` around its center. Mirrors `ghosts::ghosts`.
 */

import type { GameEvent } from "@ghosts/engine";

import type { ChainGame, ChainRecord } from "./bcs";

/** `TURN_LIMIT_MS` in `ghosts::ghosts`: past it, a turn only takes `next_turn`. */
export const TURN_LIMIT_MS = 90_000;

/**
 * `FIRST_TURN_MS` in `ghosts::ghosts`: the first turn lasts longer, as the scene is
 * still loading. The deployed package has no such constant yet and gives the first
 * turn `TURN_LIMIT_MS` too: set this to 120_000 only once a package with it is live.
 */
export const FIRST_TURN_MS = TURN_LIMIT_MS;

/** How long turn number `turn` lasts; `turn_limit` in `ghosts::ghosts`. */
export const turnLimitMs = (turn: number) => (turn === 0 ? FIRST_TURN_MS : TURN_LIMIT_MS);

/** `MAX_MISSED_TURNS` in `ghosts::ghosts`: this many in a row abandon the game. */
export const MAX_MISSED_TURNS = 3;

/** A side's squad on this map: what is left of its spawn positions before it deploys. */
export const squadSize = (game: ChainGame, side: number) => game.positions[side].length;

/** A game started from a lobby: no rating, score, experience or losses come out of it. */
export const isFriendly = (game: Pick<ChainGame, "mode">): boolean =>
    game.mode?.$kind === "Friendly";

/** The most recruits each side deploys in a friendly game; null in a rated one. */
export const friendlySize = (game: Pick<ChainGame, "mode">): number | null =>
    game.mode?.$kind === "Friendly" ? game.mode.Friendly.size : null;

/**
 * How many recruits a side may deploy, as `deploy_squad` caps it: the spawn
 * positions it has left, and in a friendly game no more than the lobby's size.
 */
export function deployCap(game: ChainGame, side: number): number {
    const size = friendlySize(game);
    const positions = squadSize(game, side);
    return size === null ? positions : Math.min(positions, size);
}

/**
 * The podiums the squad selection shows a side: one per recruit it may deploy,
 * before it deploys (`deployCap`); once deployed, the positions it had in all,
 * still capped by a friendly game's size.
 */
export function podiumsFor(game: ChainGame, side: number, deployed: number): number {
    if (!deployed) return deployCap(game, side);
    const all = squadSize(game, side) + deployed;
    const size = friendlySize(game);
    return size === null ? all : Math.max(deployed, Math.min(all, size));
}

export type Cell = [x: number, z: number];

export interface Bounds {
    minX: number;
    minZ: number;
}

export const toCell = ([row, col]: readonly number[], { minX, minZ }: Bounds): Cell => [
    col + minX,
    row + minZ,
];

export const toTile = ([x, z]: Cell, { minX, minZ }: Bounds): [row: number, col: number] => [
    z - minZ,
    x - minX,
];

// `grid::direction`, a bitmask; up lowers the row, left lowers the column.
const UP = 1;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 8;

/** The path `move_unit` takes: the start tile, then a direction per step. */
export function encodePath(path: Cell[], bounds: Bounds): number[] {
    const bytes: number[] = toTile(path[0], bounds);
    for (let i = 1; i < path.length; i++) {
        const [dx, dz] = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
        bytes.push((dz < 0 ? UP : dz > 0 ? DOWN : 0) | (dx < 0 ? LEFT : dx > 0 ? RIGHT : 0));
    }
    return bytes;
}

export function decodePath(bytes: readonly number[], bounds: Bounds): Cell[] {
    let [row, col] = bytes;
    const path = [toCell([row, col], bounds)];
    for (const direction of bytes.slice(2)) {
        if (direction & UP) row--;
        if (direction & DOWN) row++;
        if (direction & LEFT) col--;
        if (direction & RIGHT) col++;
        path.push(toCell([row, col], bounds));
    }
    return path;
}

export const activeSide = (game: ChainGame) => game.turn % game.players.length;

/** The squads are still being picked. */
export const isDeploying = (game: ChainGame) => game.state.$kind === "Deploying";

/** When the squad pick ends, while it runs. */
export const deployUntil = (game: ChainGame) =>
    game.state.$kind === "Deploying" ? Number(game.state.Deploying.untilMs) : 0;

/** When the current turn started, while the sides take turns. */
export const turnStartedAt = (game: ChainGame) =>
    game.state.$kind === "Playing" ? Number(game.state.Playing.startedMs) : 0;

/** How many turns in a row a side let run out, while the sides take turns. */
export const missedTurns = (game: ChainGame, side: number) =>
    game.state.$kind === "Playing" ? game.state.Playing.missed[side] : 0;

/**
 * A game is over once its state says so: someone abandoned or forfeited it, a side
 * had nobody to show or has nobody left, or it went on for `MAX_TURNS`.
 */
export const isOver = (game: ChainGame) => game.state.$kind === "Over";

/** The recruits a side has on the map: its units, which say whose they are. */
export const squadOf = (game: ChainGame, side: number) =>
    unitsOnMap(game)
        .filter(({ unit }) => unit.owner === game.players[side])
        .map(({ unit }) => unit.recruit);

export type Outcome =
    | "victory"
    | "defeat"
    | "draw"
    | "stalemate"
    | "abandoned"
    | "opponent-abandoned"
    | "forfeited"
    | "opponent-forfeited"
    | "no-show"
    | "opponent-no-show";

/** How the game ended, once it is over. */
const endingOf = (game: ChainGame) => (game.state.$kind === "Over" ? game.state.Over : null);

/** How a game that is over ended for `side`. */
export function outcomeFor(game: ChainGame, side: number): Outcome {
    const ending = endingOf(game);
    const me = game.players[side];
    switch (ending?.$kind) {
        case "Won":
            return ending.Won === me ? "victory" : "defeat";
        case "Abandoned":
            return ending.Abandoned === me ? "abandoned" : "opponent-abandoned";
        case "Forfeited":
            return ending.Forfeited === me ? "forfeited" : "opponent-forfeited";
        case "NoShow":
            return ending.NoShow === me ? "no-show" : "opponent-no-show";
        case "NobodyShowed":
            return "no-show";
        case "Stalemate":
            return "stalemate";
        default:
            return "draw";
    }
}

// === Odds, cover and ground, as `ghosts::map` and `ghosts::unit` work them out ===

type Tile = readonly [row: number, col: number];

/** `DEFENSE_BONUS` in `ghosts::map`: what each level of cover takes off the odds. */
const DEFENSE_BONUS = 25;
const HIGH_COVER = 2;
/** `MAX_RANGE_OFFSET`, `DISTANCE_BONUS` and `DISTANCE_PENALTY` in `ghosts::unit`. */
const MAX_RANGE_OFFSET = 3;
const DISTANCE_BONUS = 5;
const DISTANCE_PENALTY = 10;

const tileType = (game: ChainGame, [row, col]: Tile) => game.map.grid.grid[row]?.[col]?.tileType;

/** Whether units can stand on a tile, and whether it is cover to climb over. */
export function terrainAt(game: ChainGame, tile: Tile): "open" | "cover" | "blocked" {
    const type = tileType(game, tile);
    if (type?.$kind === "Empty") return "open";
    return type?.$kind === "Cover" ? "cover" : "blocked";
}

/** `tile_cover!`: the cover on each side of a tile. A wall is high cover all around. */
function tileCover(game: ChainGame, tile: Tile) {
    const type = tileType(game, tile);
    if (type?.$kind === "Cover") return type.Cover;
    const level = type?.$kind === "Wall" ? HIGH_COVER : 0;
    return { left: level, top: level, right: level, bottom: level };
}

/** `cover_bonus`: the side facing the shot, or the neighbor's side facing the target. */
export function coverBonus(game: ChainGame, from: Tile, to: Tile): number {
    const [dRow, dCol] = [to[0] - from[0], to[1] - from[1]];
    if (dRow === 0 && dCol === 0) return 0;
    const [row, col] = to;
    // `direction!`: the axis that dominates, a diagonal only when neither does
    const vertical = Math.abs(dRow) >= Math.abs(dCol) ? Math.sign(dRow) : 0;
    const horizontal = Math.abs(dCol) >= Math.abs(dRow) ? Math.sign(dCol) : 0;
    const own = tileCover(game, to);

    // `vertical` is -1 for a shot going up the rows, `horizontal` -1 going left
    const sideRow = vertical < 0 ? own.bottom : vertical > 0 ? own.top : 0;
    const sideCol = horizontal < 0 ? own.right : horizontal > 0 ? own.left : 0;
    const onTarget = Math.max(sideRow, sideCol);
    if (onTarget !== 0) return onTarget * DEFENSE_BONUS;

    const nearRow = vertical < 0 ? tileCover(game, [row + 1, col]).top : 0;
    const farRow = vertical > 0 ? tileCover(game, [row - 1, col]).bottom : 0;
    const nearCol = horizontal < 0 ? tileCover(game, [row, col + 1]).left : 0;
    const farCol = horizontal > 0 ? tileCover(game, [row, col - 1]).right : 0;
    return Math.max(nearRow, farRow, nearCol, farCol) * DEFENSE_BONUS;
}

/** `step_blocks`: a wall always; high cover on an edge touching neither end of the line. */
function stepBlocks(
    game: ChainGame,
    from: Tile,
    to: Tile,
    inner: boolean,
    highCoverBlocks: boolean,
): boolean {
    if (tileType(game, to)?.$kind === "Wall") return true;
    if (!highCoverBlocks || !inner) return false;
    const [a, b] = [tileCover(game, from), tileCover(game, to)];
    // a wall has no sides here: it is a wall before it is cover
    const side = (cover: typeof a, tile: Tile, name: keyof typeof a) =>
        tileType(game, tile)?.$kind === "Cover" ? cover[name] : 0;
    const [dRow, dCol] = [to[0] - from[0], to[1] - from[1]];
    const out = dRow < 0 ? "top" : dRow > 0 ? "bottom" : dCol < 0 ? "left" : "right";
    const back = dRow < 0 ? "bottom" : dRow > 0 ? "top" : dCol < 0 ? "right" : "left";
    return side(a, from, out) === HIGH_COVER || side(b, to, back) === HIGH_COVER;
}

/** `trace_line`: the segment between two tile centers, one edge at a time. */
function traceLine(game: ChainGame, from: Tile, to: Tile, highCoverBlocks: boolean): boolean {
    const [dx, dy] = [Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])];
    const edges = dx + dy;
    const [stepX, stepY] = [to[0] > from[0] ? 1 : -1, to[1] > from[1] ? 1 : -1];
    let [x, y] = from;
    let [i, j] = [0, 0];
    while (i + j < edges) {
        const k = i + j;
        const [tRow, tCol] = [(2 * i + 1) * dy, (2 * j + 1) * dx];
        const inner = k > 0 && k + 1 < edges;
        if (tRow < tCol) {
            if (stepBlocks(game, [x, y], [x + stepX, y], inner, highCoverBlocks)) return false;
            x += stepX;
            i++;
        } else if (tCol < tRow) {
            if (stepBlocks(game, [x, y], [x, y + stepY], inner, highCoverBlocks)) return false;
            y += stepY;
            j++;
        } else {
            // a corner: clear if either route around the vertex is
            const [a, b, c]: Tile[] = [
                [x + stepX, y],
                [x, y + stepY],
                [x + stepX, y + stepY],
            ];
            const [first, second] = [k > 0, k + 2 < edges];
            const viaRow =
                !stepBlocks(game, [x, y], a, first, highCoverBlocks) &&
                !stepBlocks(game, a, c, second, highCoverBlocks);
            const viaCol =
                !stepBlocks(game, [x, y], b, first, highCoverBlocks) &&
                !stepBlocks(game, b, c, second, highCoverBlocks);
            if (!viaRow && !viaCol) return false;
            x += stepX;
            y += stepY;
            i++;
            j++;
        }
    }
    return true;
}

/** `line_of_sight`: walls and high covers block a shot, units and unwalkable tiles don't. */
export const lineOfSight = (game: ChainGame, from: Tile, to: Tile) =>
    traceLine(game, from, to, true);

/** `line_of_throw` and `perform_grenade`: only walls stop a throw, and it can't land on one. */
export const lineOfThrow = (game: ChainGame, from: Tile, to: Tile) =>
    tileType(game, to)?.$kind !== "Wall" && traceLine(game, from, to, false);

/**
 * `Unit.perform_attack`: the percent a shot hits, given the distance and the cover. `aim` is
 * the shooter's effective aim (`effectiveStats`) and `defense` the target's effective defense.
 * There is no floor: a dazed shooter (aim 0) still has the distance bonus, and none past the range.
 */
export function hitChance(
    shooter: { aim: number; range: number; areaSize: number },
    defense: number,
    distance: number,
    cover: number,
): number {
    const { aim, range, areaSize } = shooter;
    if (distance > range + MAX_RANGE_OFFSET) return 0;
    const chance =
        distance === range
            ? aim
            : distance < range
              ? Math.min(aim + DISTANCE_BONUS * (range - distance), 100)
              : aim - Math.min(DISTANCE_PENALTY * (distance - range), aim);
    // an area weapon aims at the tile: neither cover nor defense apply
    const lowered = areaSize > 0 ? 0 : Math.min(cover + defense, 100);
    return chance - Math.min(chance, lowered);
}

// === Status effects, as `ghosts::effect` and `Unit.effective_stats` work them ===

/** `ghosts::effect` kinds, the high nibble of an effect byte. */
export const EFFECT_KINDS = { daze: 0, smoke: 1 } as const;
export type EffectName = keyof typeof EFFECT_KINDS;

/** How many `next_turn` calls a fresh daze and a fresh smoke last (`DAZE_TURNS`, `SMOKE_TURNS`). */
export const EFFECT_TURNS = { daze: 2, smoke: 2 } as const;
/** `SMOKE_DEFENSE` and `SMOKE_AIM_PENALTY` in `ghosts::effect`. */
export const SMOKE_DEFENSE = 30;
export const SMOKE_AIM_PENALTY = 30;
/** What `stats::add` caps a modified stat at. */
const STAT_CAP = 127;

/** The engine's id of each kind (`effects.json`), `#<kind>` for one this client doesn't know. */
export const effectId = (kind: number): string =>
    kind === EFFECT_KINDS.daze ? "Daze" : kind === EFFECT_KINDS.smoke ? "Smoke" : `#${kind}`;

/** The effects of a unit on chain as the engine carries them: catalog id and turns left. */
export const effectsOf = (bytes: readonly number[]): { kind: string; turns: number }[] =>
    bytes.map((b) => ({ kind: effectId(effectKind(b)), turns: effectTurns(b) }));

/** The engine's effects as chain bytes; the ones with no turns left, and kinds unknown here, are left out. */
export const effectBytes = (effects: readonly { kind: string; turns: number }[]): number[] =>
    effects.flatMap(({ kind, turns }) => {
        const tag = Object.values(EFFECT_KINDS).find((k) => effectId(k) === kind);
        return tag === undefined || turns <= 0 ? [] : [effectByte(tag, turns)];
    });

/** The kind of an effect byte (`kind << 4 | turns`). */
export const effectKind = (effect: number) => effect >> 4;
/** The turns an effect byte has left. */
export const effectTurns = (effect: number) => effect & 0x0f;
/** An effect byte for a kind and its turns. */
export const effectByte = (kind: number, turns: number) => (kind << 4) | turns;
/** The name of an effect byte's kind, if this client knows it. */
export const effectName = (effect: number): EffectName | undefined =>
    (Object.keys(EFFECT_KINDS) as EffectName[]).find((n) => EFFECT_KINDS[n] === effectKind(effect));

/**
 * `Unit.effective_stats`: the base stats with each effect's modifier added in list order.
 * Daze takes the aim to 0; smoke takes 30 off the aim (to 0 at the least) and adds 30 defense;
 * `stats::add` caps a stat it modified at 127.
 */
export function effectiveStats<S extends { aim: number; defense: number }>(
    stats: S,
    effects: readonly number[],
): S {
    let { aim, defense } = stats;
    for (const effect of effects) {
        switch (effectKind(effect)) {
            case EFFECT_KINDS.daze:
                aim = 0;
                break;
            case EFFECT_KINDS.smoke:
                aim = Math.min(Math.max(aim - SMOKE_AIM_PENALTY, 0), STAT_CAP);
                defense = Math.min(defense + SMOKE_DEFENSE, STAT_CAP);
                break;
        }
    }
    return { ...stats, aim, defense };
}

/** `Effect` refresh: the same kind keeps the larger turns, in its place in the list. */
export function withEffect(effects: readonly number[], effect: number): number[] {
    const at = effects.findIndex((e) => effectKind(e) === effectKind(effect));
    if (at < 0) return [...effects, effect];
    return effects.map((e, i) => (i === at ? Math.max(e, effect) : e));
}

/** `Unit.tick_effects`: one turn off each effect; the ones at 0 are gone, with the kinds that went. */
export function tickEffects(effects: readonly number[]): { effects: number[]; ended: number[] } {
    const ended: number[] = [];
    const kept = effects.flatMap((e) => {
        if (effectTurns(e) > 1) return [e - 1];
        ended.push(effectKind(e));
        return [];
    });
    return { effects: kept, ended };
}

// === Grenades, as `Map.thrower` and the throws work them out ===

/** `GRENADE_RANGE` and `GRENADE_RADIUS` in `ghosts::map`, shared by every grenade. */
export const GRENADE_RANGE = 5;
export const GRENADE_RADIUS = 2;

const manhattan = (a: Tile, b: Tile) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * Whether a throw from one tile to another is allowed: in range, not onto a wall, over no wall,
 * from a tile holding a unit (`Map.thrower`). What the unit itself needs (the action, AP, a use
 * left) is `canDo` and `hasUsesLeft`.
 */
export function throwValid(game: ChainGame, from: Tile, to: Tile): boolean {
    return (
        manhattan(from, to) <= GRENADE_RANGE &&
        tileType(game, to)?.$kind !== "Wall" &&
        lineOfThrow(game, from, to) &&
        !!game.map.grid.grid[from[0]]?.[from[1]]?.unit
    );
}

/**
 * The tiles a flashbang or smoke grenade lands on: every unit within `GRENADE_RADIUS` of the
 * target, either side's and the thrower's own, in `Map.units` order (ascending `row * cols + col`),
 * which is the order the `EffectStart` records name them in.
 */
export function burstOf(game: ChainGame, target: Tile): { row: number; col: number }[] {
    return unitsOnMap(game).filter(
        ({ row, col }) => manhattan([row, col], target) <= GRENADE_RADIUS,
    );
}

// === What a game pays, as `ghosts::ghosts` works it out ===

/** The ranks in order. A recruit's rank is one of these. */
export const RANKS = [
    "Rookie",
    "Squaddie",
    "Corporal",
    "Sergeant",
    "Lieutenant",
    "Captain",
    "Major",
    "Colonel",
] as const;

/** `next_rank_xp` in `ghosts::rank`: the total experience each rank past `Rookie` takes. */
const RANK_XP = [3, 8, 15, 25, 40, 60, 90];

/** The experience the rank after `rank` takes, none at the top. */
export const nextRankXp = (rank: string): number | undefined =>
    RANK_XP[RANKS.indexOf(rank as never)];

/** The rank a recruit reaches with `xp` in total, starting from `rank`. */
export function rankWith(rank: string, xp: number): string {
    let index = RANKS.indexOf(rank as never);
    while (index < RANK_XP.length && xp >= RANK_XP[index]) index++;
    return RANKS[index];
}

const SURVIVAL_XP = 1;
const WIN_XP = 1;
const MIN_TURNS_TO_EARN = 2;

/**
 * The experience each recruit of a side coming home earns from a game that is over:
 * `experience` in `ghosts::ghosts`.
 */
export function experienceFor(game: ChainGame, side: number): number {
    // `experience` gives none at all in a friendly game.
    if (isFriendly(game)) return 0;
    const other = 1 - side;
    const ending = game.state.$kind === "Over" ? game.state.Over : null;
    // who is to blame for how it ended: `misbehaved` in the contract
    const blamed = (s: number) => {
        const player = game.players[s];
        if (ending?.$kind === "NobodyShowed") return true;
        if (ending?.$kind === "Abandoned") return ending.Abandoned === player;
        if (ending?.$kind === "Forfeited") return ending.Forfeited === player;
        if (ending?.$kind === "NoShow") return ending.NoShow === player;
        return false;
    };
    const walkover =
        (ending?.$kind === "Abandoned" && ending.Abandoned === game.players[other]) ||
        (ending?.$kind === "Forfeited" && ending.Forfeited === game.players[other]);

    if (walkover) return game.turn < MIN_TURNS_TO_EARN ? 0 : SURVIVAL_XP;
    if (blamed(side) || blamed(other)) return 0;
    return ending?.$kind === "Won" && ending.Won === game.players[side]
        ? SURVIVAL_XP + WIN_XP
        : SURVIVAL_XP;
}

/**
 * The recruits a side lost in a game, as its history has them fall, out of the
 * recruits seen in it (`known`): the game lets go of the fallen, whose dog tags
 * go home there and then. Each one's leader is the `Account` they fought for.
 */
export function fallenOf<R extends { objectId: string; leader: string }>(
    game: ChainGame,
    side: number,
    known: Iterable<R>,
): R[] {
    const byId = new Map([...known].map((recruit) => [recruit.objectId, recruit]));
    const player = game.players[side];
    return game.history.flatMap((record) => {
        if (record.$kind !== "UnitKIA") return [];
        const recruit = byId.get(record.UnitKIA[0]);
        return recruit?.leader === player ? [recruit] : [];
    });
}

/** Where a game's blasts went off so far, oldest first. */
export const blastCells = (game: ChainGame, bounds: Bounds): Cell[] =>
    game.history.flatMap((record) =>
        record.$kind === "Explosion" ? [toCell(record.Explosion.slice(0, 2), bounds)] : [],
    );

/** What a unit may be ordered to do: `ghosts::action::Action`. */
export type UnitAction = "Move" | "Attack" | "Reload" | "Grenade" | "Flashbang" | "SmokeGrenade";

/** Whether the unit on the map for `recruit` has `action`; the chain refuses the order otherwise. */
export function canDo(game: ChainGame, recruit: string, action: UnitAction) {
    const entry = unitsOnMap(game).find(({ unit }) => unit.recruit === recruit);
    return !!entry && entry.unit.actions.some(({ kind }) => kind.$kind === action);
}

/**
 * Whether a unit still has an action of the kind it can spend: one with `uses` of `null`
 * (unlimited) or above zero. `Unit.perform_grenade` and the like take the first such.
 */
export const hasUsesLeft = (
    unit: { actions: readonly { uses: number | null; kind: { $kind: string } }[] },
    action: UnitAction,
) => unit.actions.some(({ kind, uses }) => kind.$kind === action && (uses === null || uses > 0));

/**
 * A unit's chain actions as the engine carries them: each kind by its catalog id
 * (the `ActionKind` variant name), with its uses left, in the unit's order.
 */
export function unitActions(
    actions: readonly { uses: number | null; kind: { $kind: string } }[],
): { kind: string; uses: number | null }[] {
    // a tag this client's schema doesn't name yet goes on as `#<tag>`
    return actions.map(({ uses, kind }) => ({
        kind: kind.$kind.replace(/^Unknown(\d+)$/, "#$1"),
        uses,
    }));
}

/** The units on the map with the tiles they stand on. */
export function unitsOnMap(game: ChainGame) {
    return game.map.grid.grid.flatMap((tiles, row) =>
        tiles.flatMap(({ unit }, col) => (unit ? [{ row, col, unit }] : [])),
    );
}

/** What `gameEvents` needs to know about the field as it stands. */
export interface FieldView {
    bounds: Bounds;
    /** The side of this player. */
    side: number;
    /** The unit standing on a cell. */
    unitAt(cell: Cell): string | undefined;
    isCover(cell: Cell): boolean;
    /** Whether a unit arriving on a cell would take cover there. */
    coverAt(cell: Cell): boolean;
    /** What a blast at a cell does to the props around it. */
    blast(cell: Cell): Extract<GameEvent, { type: "grenade" }>["environment"];
}

/** The order `Map.explode` visits tiles in: its neighbors, then the center. */
function blastTiles(row: number, col: number, radius: number): [number, number][] {
    const cells: [number, number][] =
        radius === 1
            ? [
                  [row - 1, col],
                  [row, col - 1],
                  [row + 1, col],
                  [row, col + 1],
              ]
            : radius === 2
              ? [
                    [row - 2, col],
                    [row, col - 2],
                    [row - 1, col],
                    [row, col - 1],
                    [row + 1, col],
                    [row, col + 1],
                    [row + 2, col],
                    [row, col + 2],
                    [row - 1, col - 1],
                    [row - 1, col + 1],
                    [row + 1, col - 1],
                    [row + 1, col + 1],
                ]
              : [];
    return [...cells, [row, col]];
}

/**
 * The records of a game as engine events. Lazy on purpose: positions are read
 * from `field` as each record comes up, so ingest an event before asking for
 * the next one. Records with nothing to show (deployment) are skipped.
 */
export function* gameEvents(records: ChainRecord[], field: FieldView): Generator<GameEvent> {
    const { bounds } = field;
    let i = 0;

    /** One unit's share of an attack: `Dodged`, or the damage and `[UnitKIA]`. */
    const takeHit = () => {
        const dodged = records[i]?.$kind === "Dodged";
        if (dodged) {
            i++;
            // games recorded before a dodge became a single record follow it with `Damage(0)`
            const next = records[i];
            if (next?.$kind === "Damage" && next.Damage === 0) i++;
            return { dodged, crit: false, damage: 0, killed: false };
        }
        const record = records[i];
        const crit = record?.$kind === "CriticalHit";
        let damage = 0;
        if (record?.$kind === "Damage") damage = record.Damage;
        else if (record?.$kind === "CriticalHit") damage = record.CriticalHit;
        if (record?.$kind === "Damage" || crit) i++;
        const killed = records[i]?.$kind === "UnitKIA";
        if (killed) i++;
        return { dodged, crit, damage, killed };
    };

    /** The blast at `records[i]`: who is in it, in the order the records name them. */
    const takeBlast = () => {
        const blast = records[i++];
        if (blast?.$kind !== "Explosion") return { at: null, casualties: [] };
        const [row, col, radius] = blast.Explosion;
        const casualties: { unit: string; damage: number; killed: boolean }[] = [];
        for (const tile of blastTiles(row, col, radius)) {
            const unit = field.unitAt(toCell(tile, bounds));
            if (!unit) continue;
            const { damage, killed } = takeHit();
            casualties.push({ unit, damage, killed });
        }
        return { at: toCell([row, col], bounds), casualties };
    };

    while (i < records.length) {
        const record = records[i];
        switch (record.$kind) {
            case "Move": {
                i++;
                const path = decodePath(record.Move, bounds);
                const unit = field.unitAt(path[0]);
                if (!unit) break;
                const end = path[path.length - 1];
                yield {
                    type: "move",
                    unit,
                    path,
                    vault: path.some((cell) => field.isCover(cell)),
                    cover: field.coverAt(end),
                };
                break;
            }
            case "Reload": {
                i++;
                const unit = field.unitAt(toCell(record.Reload, bounds));
                if (unit) yield { type: "reload", unit };
                break;
            }
            case "Attack": {
                i++;
                const unit = field.unitAt(toCell(record.Attack.origin, bounds));
                const at = toCell(record.Attack.target, bounds);
                const target = field.unitAt(at);
                if (!unit) break;

                // an area weapon's hit reads as a blast, whatever stands on the tile
                if (records[i]?.$kind === "Explosion") {
                    const { casualties } = takeBlast();
                    yield { type: "grenade", unit, at, casualties, environment: field.blast(at) };
                    break;
                }
                if (records[i]?.$kind === "Miss") {
                    i++;
                    if (target) {
                        yield {
                            type: "shot",
                            unit,
                            target,
                            hit: false,
                            crit: false,
                            damage: 0,
                            killed: false,
                            reaction: false,
                        };
                    } else yield { type: "grenade", unit, at, casualties: [] };
                    break;
                }
                if (!target) break;
                const { dodged, crit, damage, killed } = takeHit();
                yield {
                    type: "shot",
                    unit,
                    target,
                    hit: !dodged,
                    crit,
                    damage,
                    killed,
                    reaction: false,
                };
                break;
            }
            case "Grenade": {
                i++;
                const unit = field.unitAt(toCell(record.Grenade.origin, bounds));
                const at = toCell(record.Grenade.target, bounds);
                const { casualties } = takeBlast();
                if (unit)
                    yield { type: "grenade", unit, at, casualties, environment: field.blast(at) };
                break;
            }
            case "Flashbang":
            case "SmokeGrenade": {
                i++;
                const { origin, target } =
                    record.$kind === "Flashbang" ? record.Flashbang : record.SmokeGrenade;
                const unit = field.unitAt(toCell(origin, bounds));
                // what it did follows as one `EffectStart` per unit in the burst, read as they come
                if (unit)
                    yield {
                        type: record.$kind === "Flashbang" ? "flashbang" : "smoke-grenade",
                        unit,
                        at: toCell(target, bounds),
                    };
                break;
            }
            case "EffectStart": {
                i++;
                const [row, col, effect] = record.EffectStart;
                const unit = field.unitAt(toCell([row, col], bounds));
                if (unit)
                    yield {
                        type: "effect-start",
                        unit,
                        effect: { kind: effectId(effectKind(effect)), turns: effectTurns(effect) },
                    };
                break;
            }
            case "EffectEnd": {
                i++;
                const [row, col, kind] = record.EffectEnd;
                const unit = field.unitAt(toCell([row, col], bounds));
                if (unit) yield { type: "effect-end", unit, kind: effectId(kind) };
                break;
            }
            case "NextTurn": {
                i++;
                const turn = record.NextTurn;
                yield turn % 2 === field.side
                    ? { type: "turn", turn: Math.floor(turn / 2) }
                    : { type: "hostile-phase" };
                break;
            }
            default:
                i++;
        }
    }
}
