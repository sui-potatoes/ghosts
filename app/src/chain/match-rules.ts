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

/** `MAX_TURNS` in `ghosts::ghosts`: a game that goes on this long ends in a draw. */
const MAX_TURNS = 60;

/** `MAX_MISSED_TURNS` in `ghosts::ghosts`: this many in a row abandon the game. */
export const MAX_MISSED_TURNS = 3;

/** A side's squad on this map: what is left of its spawn positions before it deploys. */
export const squadSize = (game: ChainGame, side: number) => game.positions[side].length;

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

export const activeSide = (game: ChainGame) => game.map.turn % game.players.length;

/**
 * A game ends when someone abandons it, when a side has nobody on the map after
 * deployment, or when it has gone on for `MAX_TURNS`.
 */
export const isOver = (game: ChainGame) =>
    game.abandonedBy !== null ||
    (!game.deploying &&
        (game.map.turn >= MAX_TURNS || game.squads.some((squad) => squad.length === 0)));

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

/** Whether the deployment ended with this side having nobody to show, fallen or alive. */
const noShow = (game: ChainGame, side: number) =>
    game.squads[side].length === 0 && game.fallen[side].length === 0;

/** How a game that is over ended for `side`. */
export function outcomeFor(game: ChainGame, side: number): Outcome {
    if (game.abandonedBy !== null) {
        const mine = game.abandonedBy === game.players[side];
        // the contract abandons for a player who ran out of missed turns
        const absent = game.missed[mine ? side : 1 - side] >= MAX_MISSED_TURNS;
        if (absent) return mine ? "forfeited" : "opponent-forfeited";
        return mine ? "abandoned" : "opponent-abandoned";
    }
    if (noShow(game, side)) return "no-show";
    if (noShow(game, 1 - side)) return "opponent-no-show";

    const mine = game.squads[side].length > 0;
    const theirs = game.squads[1 - side].length > 0;
    if (mine && theirs) return "stalemate";
    return mine === theirs ? "draw" : mine ? "victory" : "defeat";
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

/** `Unit.perform_attack`: the percent a shot hits, given the distance and the cover. */
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

const WIN_CREDITS = 100;
const DRAW_CREDITS = 60;
const LOSS_CREDITS = 40;
const WALKOVER_CREDITS = 40;
const KILL_CREDITS = 20;
const SURVIVAL_XP = 1;
const WIN_XP = 1;
const KILL_XP = 2;
const MIN_TURNS_TO_PAY = 2;

/** What a side earns from a game that is over: `earnings` in `ghosts::ghosts`. */
export function earningsFor(game: ChainGame, side: number) {
    const other = 1 - side;
    const kills = new Map(game.kills[side].contents.map(({ key, value }) => [key, value]));
    const blamed = (s: number) =>
        game.abandonedBy === game.players[s] || (!game.deploying && noShow(game, s));

    const [base, survival] = ((): [number, number] => {
        if (game.abandonedBy === game.players[other])
            return game.map.turn < MIN_TURNS_TO_PAY ? [0, 0] : [WALKOVER_CREDITS, SURVIVAL_XP];
        if (blamed(side) || blamed(other)) return [0, 0];
        const mine = game.squads[side].length > 0;
        const theirs = game.squads[other].length > 0;
        if (mine === theirs) return [DRAW_CREDITS, SURVIVAL_XP];
        return mine ? [WIN_CREDITS, SURVIVAL_XP + WIN_XP] : [LOSS_CREDITS, SURVIVAL_XP];
    })();

    const total = [...kills.values()].reduce((sum, n) => sum + n, 0);
    return {
        credits: base > 0 ? base + total * KILL_CREDITS : 0,
        /** The experience a recruit coming home earns. */
        xpOf: (recruit: string) => (base > 0 ? survival + (kills.get(recruit) ?? 0) * KILL_XP : 0),
    };
}

/** Where a game's blasts went off so far, oldest first. */
export const blastCells = (game: ChainGame, bounds: Bounds): Cell[] =>
    game.history.flatMap((record) =>
        record.$kind === "Explosion" ? [toCell(record.Explosion.slice(0, 2), bounds)] : [],
    );

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
    /** The name of a weapon lying on a cell, if there is one. */
    weaponAt(cell: Cell): string | null;
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

    /** One unit's share of an attack: `[Dodged]`, the damage, `[UnitKIA]`. */
    const takeHit = () => {
        const dodged = records[i]?.$kind === "Dodged";
        if (dodged) i++;
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
            case "PickUp": {
                i++;
                const cell = toCell(record.PickUp, bounds);
                const unit = field.unitAt(cell);
                if (unit) yield { type: "pick-up", unit, weapon: field.weaponAt(cell) ?? "weapon" };
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
