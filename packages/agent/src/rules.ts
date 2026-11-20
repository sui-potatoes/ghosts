// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The encounter rules as an agent needs them, ported from `ghosts::map` and
 * `ghosts::unit` so legal actions and hit chances cost no RPC. The chain stays
 * the authority: `Backend.submit` simulates every order before paying for it,
 * so a difference between this port and Move costs a refusal, not gas.
 *
 * Nothing here is random. Rolling dice is the chain's job (and the sandbox's).
 */

import {
    ActionError,
    type Action,
    type EffectKind,
    type GameRecord,
    type GameState,
    type Stats,
    type Tile,
    type Unit,
    type UnitAction,
    type UnitEffect,
} from "./types.ts";

export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;

const NO_DIRECTION = 0;
const LOW_COVER = 1;
const HIGH_COVER = 2;
const DEFENSE_BONUS = 25;
const MAX_RANGE_OFFSET = 3;
const DISTANCE_BONUS = 5;
const DISTANCE_PENALTY = 10;

/**
 * `map::perform_grenade`: the numbers of a throw are the grenade action's, not an item's. The
 * range and the radius are the same for the frag grenade, the flashbang and the smoke grenade;
 * the damage is the frag grenade's alone.
 */
export const GRENADE_RANGE = 5;
export const GRENADE_RADIUS = 2;
export const GRENADE_DAMAGE = 4;

/** The three throws, each an action of its own: the frag grenade, the flashbang and the smoke. */
export const THROWS = ["grenade", "flashbang", "smoke_grenade"] as const;
export type ThrowKind = (typeof THROWS)[number];
export type ThrowAction = Extract<Action, { kind: ThrowKind }>;
/** A throw that rolls nothing and deals no damage: it only puts an effect on units it reaches. */
export type EffectThrowKind = Exclude<ThrowKind, "grenade">;
export type EffectThrowAction = Extract<Action, { kind: EffectThrowKind }>;

export const isThrow = (kind: Action["kind"]): kind is ThrowKind =>
    (THROWS as readonly string[]).includes(kind);
export const isEffectThrow = (kind: Action["kind"]): kind is EffectThrowKind =>
    kind === "flashbang" || kind === "smoke_grenade";

/** `effect`: what each throw puts on the units it reaches, and for how long. */
export const THROW_EFFECT: Record<EffectThrowKind, EffectKind> = {
    flashbang: "daze",
    smoke_grenade: "smoke",
};
/** `effect::DAZE_TURNS` and `effect::SMOKE_TURNS`: the turn changes an effect lasts. */
export const EFFECT_TURNS: Record<EffectKind, number> = { daze: 2, smoke: 2 };
/** `effect::SMOKE_AIM_PENALTY` and `effect::SMOKE_DEFENSE`. */
export const SMOKE_AIM_PENALTY = 30;
export const SMOKE_DEFENSE = 30;
/** `stats::add` caps a modified value at 127. */
const MODIFIED_MAX = 127;

/** `effect::modifier`: the signed change an effect makes to the stats it touches. */
const MODIFIERS: Record<EffectKind, Partial<Record<"aim" | "dodge" | "defense", number>>> = {
    daze: { aim: -127, dodge: -127 },
    smoke: { aim: -SMOKE_AIM_PENALTY, defense: SMOKE_DEFENSE },
};

/**
 * `unit::effective_stats`: the base stats with the modifier of each effect added in order, as
 * `stats::add` does it: a stat never goes below 0, and one a modifier touches is capped at 127.
 * Only aim, dodge and defense change today. A daze takes all the aim and all the dodge, which
 * smoke does not give back.
 */
export function effectiveStats(unit: Pick<Unit, "stats" | "effects">): Stats {
    if (unit.effects.length === 0) return unit.stats;
    const stats = { ...unit.stats };
    for (const { kind } of unit.effects) {
        for (const [name, change] of Object.entries(MODIFIERS[kind])) {
            const stat = name as "aim" | "dodge" | "defense";
            const base = stats[stat];
            const value = change < 0 ? base - Math.min(-change, base) : base + change;
            stats[stat] = Math.min(value, MODIFIED_MAX);
        }
    }
    return stats;
}

/** The effect of the kind on the unit, if it has one. */
export const effectOf = (unit: Pick<Unit, "effects">, kind: EffectKind) =>
    unit.effects.find((effect) => effect.kind === kind);

/** Whether the unit has an action of the kind, whatever uses are left. */
export const hasAction = (unit: Unit, kind: UnitAction) =>
    unit.actions.some((action) => action.kind === kind);

/**
 * Whether an action of the kind can still be spent: unlimited (`uses` of `null`) or with a use
 * left. The unit-level functions take the first such entry of the kind.
 */
export const hasUsesLeft = (unit: Unit, kind: UnitAction) =>
    unit.actions.some((action) => action.kind === kind && (action.uses === null || action.uses > 0));

/**
 * `unit::spend_use`: take a use of the first action of the kind that has one left. Unlimited
 * actions (`uses` of `null`) have none to take.
 */
export function spendUse(unit: Unit, kind: UnitAction): void {
    const spent = unit.actions.find(
        (action) => action.kind === kind && (action.uses === null || action.uses > 0),
    );
    if (spent && spent.uses !== null) spent.uses -= 1;
}

/** The most orders one transaction may carry. */
export const MAX_BATCH = 8;

/** `ghosts::ghosts`: how long a player has for their turn. */
export const TURN_LIMIT_MS = 90_000;
/** `ghosts::ghosts`: how long the first turn lasts, as the scene is still loading. */
export const FIRST_TURN_MS = 120_000;
/** How long turn number `turn` lasts. */
export const turnLimitMs = (turn: number) => (turn === 0 ? FIRST_TURN_MS : TURN_LIMIT_MS);
/** `ghosts::ghosts`: how long the players have to pick their squads once matched. */
export const DEPLOY_LIMIT_MS = 120_000;
/** `ghosts::account`: the squad an account can always hold for free. */
export const FREE_RECRUITS = 4;
/**
 * How many recruits a side deploys: as many as it has spawn positions left, and in a friendly game
 * no more than its size (`deploy_squad`: `ENoPositions`, `ESquadTooLarge`).
 */
export function deployLimit(state: Pick<GameState, "mode" | "positions">, side: number): number {
    const open = state.positions[side]?.length ?? 0;
    if (state.mode.kind === "ranked") return 0;
    return state.mode.kind === "friendly" ? Math.min(open, state.mode.size) : open;
}

/** `ghosts::ghosts`: how long before anyone but its owner can cancel a search. */
export const SEARCH_TIMEOUT_MS = 120_000;
/**
 * `ghosts::ghosts::TICKET_TTL_MS`: how long a ticket stays in any queue. An older one is dropped
 * when a search next walks its bucket, and its player is sent a notice.
 */
export const TICKET_TTL_MS = 300_000;
/** `ghosts::ghosts`: how long an account can't search after misbehaving. */
export const SUSPENSION_MS = 60_000;
/** `ghosts::ghosts`: how many turns in a row a side can miss before it counts as abandoning. */
export const MAX_MISSED_TURNS = 3;
/** `ghosts::ghosts`: a game still going at this turn ends in a draw. */
export const MAX_TURNS = 60;

const STEPS: Record<number, [number, number]> = {
    [UP]: [-1, 0],
    [RIGHT]: [0, 1],
    [DOWN]: [1, 0],
    [LEFT]: [0, -1],
};
const INVERSE: Record<number, number> = { [UP]: DOWN, [DOWN]: UP, [LEFT]: RIGHT, [RIGHT]: LEFT };
const LETTERS: Record<number, string> = { [UP]: "u", [RIGHT]: "r", [DOWN]: "d", [LEFT]: "l" };
const FROM_LETTER: Record<string, number> = { u: UP, r: RIGHT, d: DOWN, l: LEFT };

// === Tiles ===

function inBounds(state: GameState, x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < state.rows && y < state.cols;
}

/** `is_walkable!`: a step may go onto the tile, an obstacle (passed over) included. */
const isWalkable = (tile: Tile) =>
    tile.kind === "empty" || tile.kind === "cover" || tile.kind === "obstacle";

/** `is_standable!`: a unit may stand on the tile, or end a path there. Never an obstacle. */
export const isStandable = (tile: Tile) => tile.kind === "empty" || tile.kind === "cover";

/** `side_cover!`: the cover a tile holds on its side facing `direction`. */
function sideCover(tile: Tile, direction: number): number {
    if (tile.kind !== "cover") return 0;
    if (direction === UP) return tile.top;
    if (direction === DOWN) return tile.bottom;
    if (direction === LEFT) return tile.left;
    return tile.right;
}

/** `is_edge_high_cover!`. */
function edgeHighCover(from: Tile, to: Tile, direction: number): boolean {
    return (
        sideCover(from, direction) === HIGH_COVER ||
        sideCover(to, INVERSE[direction]) === HIGH_COVER
    );
}

export function unitAt(state: GameState, x: number, y: number): Unit | undefined {
    return state.units.find((unit) => unit.x === x && unit.y === y);
}

export function manhattan(x0: number, y0: number, x1: number, y1: number): number {
    return Math.abs(x0 - x1) + Math.abs(y0 - y1);
}

// === Movement ===

/** `map::EPathUnwalkable`, `ETileIsObstacle` and `EObstaclesInARow`: why a path is refused. */
export const PATH_BLOCKED = 3;
export const TILE_IS_OBSTACLE = 11;
export const OBSTACLES_IN_A_ROW = 12;

/** `trace_path`: the end tile of a walkable path, or the abort code Move would give. */
export function tracePath(
    state: GameState,
    x0: number,
    y0: number,
    directions: number[],
): { end: [number, number] } | { abort: number } {
    if (!inBounds(state, x0, y0)) return { abort: PATH_BLOCKED };
    let [x, y] = [x0, y0];
    let source = state.tiles[x][y];
    let over = false;
    if (directions.length > 0 && !isStandable(source)) return { abort: PATH_BLOCKED };

    for (const direction of directions) {
        const step = STEPS[direction];
        if (!step) return { abort: PATH_BLOCKED };
        const [nx, ny] = [x + step[0], y + step[1]];
        if (!inBounds(state, nx, ny)) return { abort: PATH_BLOCKED };
        const target = state.tiles[nx][ny];
        if (unitAt(state, nx, ny) || !isWalkable(target)) return { abort: PATH_BLOCKED };
        if (edgeHighCover(source, target, direction)) return { abort: PATH_BLOCKED };
        // a unit passing over an obstacle lands on the next tile
        const obstacle = target.kind === "obstacle";
        if (over && obstacle) return { abort: OBSTACLES_IN_A_ROW };
        [x, y, source, over] = [nx, ny, target, obstacle];
    }
    return over ? { abort: TILE_IS_OBSTACLE } : { end: [x, y] };
}

/** `check_path`: the end tile of a walkable path, or null. Directions are orthogonal. */
export function checkPath(
    state: GameState,
    x0: number,
    y0: number,
    directions: number[],
): [number, number] | null {
    const traced = tracePath(state, x0, y0, directions);
    return "end" in traced ? traced.end : null;
}

/**
 * Every tile the unit can stand on after one move, with a shortest path to each. Every step is a
 * tile of distance, the one onto an obstacle included; an obstacle is only passed over: the next
 * step must land on ground to stand on, and obstacles are searched through but never listed.
 */
export function reachable(state: GameState, unit: Unit): Map<string, number[]> {
    const paths = new Map<string, number[]>();
    let frontier: { x: number; y: number; path: number[] }[] = [{ x: unit.x, y: unit.y, path: [] }];
    const seen = new Set([`${unit.x},${unit.y}`]);

    for (let distance = 0; distance < effectiveStats(unit).mobility; distance++) {
        const next: typeof frontier = [];
        for (const { x, y, path } of frontier) {
            const from = state.tiles[x][y];
            for (const direction of [UP, RIGHT, DOWN, LEFT]) {
                const [nx, ny] = [x + STEPS[direction][0], y + STEPS[direction][1]];
                const key = `${nx},${ny}`;
                if (seen.has(key) || !inBounds(state, nx, ny)) continue;
                const target = state.tiles[nx][ny];
                if (unitAt(state, nx, ny) || !isWalkable(target)) continue;
                if (from.kind === "obstacle" && target.kind === "obstacle") continue;
                if (edgeHighCover(from, target, direction)) continue;
                seen.add(key);
                const longer = [...path, direction];
                if (isStandable(target)) paths.set(key, longer);
                next.push({ x: nx, y: ny, path: longer });
            }
        }
        frontier = next;
    }
    return paths;
}

// === Line of Sight ===

/** `step_blocks`. */
function stepBlocks(
    from: Tile,
    to: Tile,
    direction: number,
    inner: boolean,
    highCoverBlocks: boolean,
): boolean {
    if (to.kind === "wall") return true;
    if (!highCoverBlocks || !inner) return false;
    return edgeHighCover(from, to, direction);
}

/** `trace_line`: an Amanatides-Woo walk over tile edges, in integers like the Move code. */
function traceLine(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    highCoverBlocks: boolean,
): boolean {
    const [dx, dy] = [Math.abs(x0 - x1), Math.abs(y0 - y1)];
    const edges = dx + dy;
    const [downward, rightward] = [x1 > x0, y1 > y0];
    const sx = downward ? DOWN : UP;
    const sy = rightward ? RIGHT : LEFT;
    let [x, y] = [x0, y0];
    let current = state.tiles[x0][y0];
    let [i, j] = [0, 0];

    while (i + j < edges) {
        const k = i + j;
        const [tRow, tCol] = [(2 * i + 1) * dy, (2 * j + 1) * dx];
        const nx = downward ? x + 1 : x - 1;
        const ny = rightward ? y + 1 : y - 1;

        if (tRow < tCol) {
            const next = state.tiles[nx][y];
            if (stepBlocks(current, next, sx, k > 0 && k + 1 < edges, highCoverBlocks))
                return false;
            [current, x] = [next, nx];
            i++;
        } else if (tCol < tRow) {
            const next = state.tiles[x][ny];
            if (stepBlocks(current, next, sy, k > 0 && k + 1 < edges, highCoverBlocks))
                return false;
            [current, y] = [next, ny];
            j++;
        } else {
            const [a, b, c] = [state.tiles[nx][y], state.tiles[x][ny], state.tiles[nx][ny]];
            const [inner1, inner2] = [k > 0, k + 2 < edges];
            const viaRow =
                !stepBlocks(current, a, sx, inner1, highCoverBlocks) &&
                !stepBlocks(a, c, sy, inner2, highCoverBlocks);
            const viaCol =
                !stepBlocks(current, b, sy, inner1, highCoverBlocks) &&
                !stepBlocks(b, c, sx, inner2, highCoverBlocks);
            if (!viaRow && !viaCol) return false;
            [current, x, y] = [c, nx, ny];
            i++;
            j++;
        }
    }
    return true;
}

/** Walls and high covers block a shot; units and unwalkable tiles do not. */
export const lineOfSight = (s: GameState, x0: number, y0: number, x1: number, y1: number) =>
    traceLine(s, x0, y0, x1, y1, true);

/** Only walls block a throw. */
export const lineOfThrow = (s: GameState, x0: number, y0: number, x1: number, y1: number) =>
    traceLine(s, x0, y0, x1, y1, false);

// === Attack Math ===

/** `grid::direction::direction!`: the dominant direction, diagonal on a tie. */
function direction(x0: number, y0: number, x1: number, y1: number): number {
    const [dx, dy] = [Math.abs(x0 - x1), Math.abs(y0 - y1)];
    if (dx === 0 && dy === 0) return NO_DIRECTION;
    const vertical = x0 < x1 ? DOWN : x0 > x1 ? UP : NO_DIRECTION;
    const horizontal = y0 < y1 ? RIGHT : y0 > y1 ? LEFT : NO_DIRECTION;
    if (vertical === NO_DIRECTION || dy > dx) return horizontal;
    if (horizontal === NO_DIRECTION || dx > dy) return vertical;
    return vertical | horizontal;
}

/** `tile_cover!`: a `Wall` counts as high cover on every side, an `Obstacle` as low. */
function tileCover(state: GameState, x: number, y: number) {
    const tile = state.tiles[x][y];
    if (tile.kind === "cover") return tile;
    const side = tile.kind === "wall" ? HIGH_COVER : tile.kind === "obstacle" ? LOW_COVER : 0;
    return { top: side, bottom: side, left: side, right: side };
}

/** `cover_bonus`: 0, 25 or 50 for a shot from `(x0, y0)` at `(x1, y1)`. */
export function coverBonus(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): number {
    const shot = direction(x0, y0, x1, y1);
    if (shot === NO_DIRECTION) return 0;

    const own = tileCover(state, x1, y1);
    const below = () => tileCover(state, x1 + 1, y1).top;
    const above = () => tileCover(state, x1 - 1, y1).bottom;
    const toRight = () => tileCover(state, x1, y1 + 1).left;
    const toLeft = () => tileCover(state, x1, y1 - 1).right;

    let cover: number;
    if (shot === UP) cover = own.bottom || below();
    else if (shot === DOWN) cover = own.top || above();
    else if (shot === LEFT) cover = own.right || toRight();
    else if (shot === RIGHT) cover = own.left || toLeft();
    else if (shot === (UP | LEFT))
        cover = Math.max(own.bottom, own.right) || Math.max(below(), toRight());
    else if (shot === (UP | RIGHT))
        cover = Math.max(own.bottom, own.left) || Math.max(below(), toLeft());
    else if (shot === (DOWN | LEFT))
        cover = Math.max(own.top, own.right) || Math.max(above(), toRight());
    else cover = Math.max(own.top, own.left) || Math.max(above(), toLeft());

    return cover * DEFENSE_BONUS;
}

/** The hit chance of `unit::perform_attack`, in percent. */
export function hitChance(stats: Stats, range: number, targetDefense: number): number {
    let chance = stats.aim;
    if (stats.range > range) {
        chance = Math.min(100, stats.aim + DISTANCE_BONUS * (stats.range - range));
    } else if (stats.range < range) {
        chance = stats.aim - Math.min(stats.aim, DISTANCE_PENALTY * (range - stats.range));
    }
    return chance - Math.min(chance, targetDefense);
}

/** A shot's chance to hit, or null when range or line of sight rule it out. */
export function shotChance(
    state: GameState,
    stats: Stats,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    naturalDefense: number,
): number | null {
    const range = manhattan(x0, y0, x1, y1);
    if (stats.range + MAX_RANGE_OFFSET < range) return null;
    if (!lineOfSight(state, x0, y0, x1, y1)) return null;
    if (stats.areaSize > 0) return hitChance(stats, range, 0);
    const cover = range > 0 ? coverBonus(state, x0, y0, x1, y1) : 0;
    return hitChance(stats, range, Math.min(100, cover + naturalDefense));
}

/** The damage a hit can apply to `target` after armor, as `{ min, max }`. */
export function damageRange(stats: Stats, target: Unit): { min: number; max: number } {
    const low = stats.damage - Math.min(stats.spread, stats.damage);
    const high =
        stats.damage +
        stats.spread +
        (stats.plusOne > 0 ? 1 : 0) +
        (stats.critChance > 0 ? Math.floor(stats.damage / 2) : 0);
    const afterArmor = (d: number) => (target.stats.armor >= d ? 1 : d - target.stats.armor);
    return { min: afterArmor(low), max: afterArmor(Math.min(high, 255)) };
}

/** Units in the blast diamond around `(x, y)`, center included. */
export function blastUnits(state: GameState, x: number, y: number, radius: number): Unit[] {
    return state.units.filter((unit) => manhattan(unit.x, unit.y, x, y) <= radius);
}

// === Action Ids ===

/** Stable text form of an action: what `legalActions` lists and `act` takes. */
export function actionId(action: Action): string {
    switch (action.kind) {
        case "move":
            return `move:${action.x},${action.y}:${action.path.map((d) => LETTERS[d]).join("")}`;
        case "reload":
            return `reload:${action.x},${action.y}`;
        case "attack":
        case "grenade":
        case "flashbang":
        case "smoke_grenade":
            return `${action.kind}:${action.x},${action.y}:${action.tx},${action.ty}`;
        default:
            return action.kind;
    }
}

export function parseAction(id: string): Action {
    if (id === "deploy" || id === "next_turn" || id === "complete" || id === "abandon") {
        return { kind: id };
    }
    let match = /^move:(\d+),(\d+):([urdl]+)$/.exec(id);
    if (match) {
        const path = [...match[3]].map((letter) => FROM_LETTER[letter]);
        return { kind: "move", x: Number(match[1]), y: Number(match[2]), path };
    }
    match = /^reload:(\d+),(\d+)$/.exec(id);
    if (match) return { kind: "reload", x: Number(match[1]), y: Number(match[2]) };
    match = /^(attack|grenade|flashbang|smoke_grenade):(\d+),(\d+):(\d+),(\d+)$/.exec(id);
    if (match) {
        return {
            kind: match[1] as "attack" | ThrowKind,
            x: Number(match[2]),
            y: Number(match[3]),
            tx: Number(match[4]),
            ty: Number(match[5]),
        };
    }
    throw new ActionError("bad_action", `Not an action id: ${id.slice(0, 80)}`);
}

// === Legality ===

/** Why `side` cannot do `action` right now, or null when it can. */
export function refusal(
    state: GameState,
    side: number,
    action: Action,
    nowMs: number,
): string | null {
    const { status } = state;
    const late = nowMs > state.deadlineMs;
    if (action.kind === "complete") {
        return status.kind === "finished" ? null : "The game is not over.";
    }
    if (status.kind === "finished") return "The game is over: send complete.";
    if (action.kind === "abandon") return null;
    if (action.kind === "deploy") {
        if (state.mode.kind === "ranked") return "A ranked squad is revealed, not deployed.";
        if (status.kind !== "deploying" || late) return "The time to deploy is over.";
        if (state.squads[side]?.length) return "Your squad is already deployed.";
        return state.positions[side]?.length ? null : "This side has no spawn positions.";
    }
    if (action.kind === "next_turn") {
        if (status.kind === "deploying") return late ? null : "The players are still deploying.";
        if (state.active === side || late) return null;
        return "The opponent's turn clock is still running.";
    }
    if (status.kind !== "active") return "The players are still deploying.";
    if (state.active !== side) return "It is not your turn.";
    if (late) return "Your turn ran out of time: send next_turn.";

    const unit = unitAt(state, action.x, action.y);
    if (!unit) return `No unit at (${action.x}, ${action.y}).`;
    if (unit.side !== side) return `The unit at (${action.x}, ${action.y}) is not yours.`;
    if (!hasAction(unit, action.kind)) return `That unit cannot ${action.kind}.`;
    if (unit.ap <= 0) return "That unit has no AP left this turn.";

    switch (action.kind) {
        case "move": {
            if (action.path.length > effectiveStats(unit).mobility)
                return "The path exceeds the unit's mobility.";
            const traced = tracePath(state, action.x, action.y, action.path);
            if ("end" in traced) return null;
            if (traced.abort === TILE_IS_OBSTACLE) {
                return "The path ends on an obstacle: a unit passes over one, it cannot stand on it.";
            }
            if (traced.abort === OBSTACLES_IN_A_ROW) {
                return "The path steps from one obstacle onto another: the step after an obstacle must land on open ground.";
            }
            return "The path is blocked.";
        }
        case "reload":
            return unit.ammo < unit.ammoMax ? null : "The weapon is already full.";
        case "attack": {
            if (unit.ammo <= 0) return "The weapon is empty: reload.";
            if (!inBounds(state, action.tx, action.ty)) return "The target is off the map.";
            const target = unitAt(state, action.tx, action.ty);
            if (effectiveStats(unit).areaSize > 0) {
                if (state.tiles[action.tx][action.ty].kind === "wall")
                    return "Cannot target a wall.";
            } else {
                if (!target) return "There is no unit on the target tile.";
                if (target.side === side) return "That target is on your side.";
            }
            const chance = shotChance(
                state,
                effectiveStats(unit),
                action.x,
                action.y,
                action.tx,
                action.ty,
                target ? effectiveStats(target).defense : 0,
            );
            return chance === null ? "The target is out of range or out of sight." : null;
        }
        case "grenade":
        case "flashbang":
        case "smoke_grenade": {
            if (!hasUsesLeft(unit, action.kind)) return THROW_SPENT[action.kind];
            if (!inBounds(state, action.tx, action.ty)) return "The target is off the map.";
            if (manhattan(action.x, action.y, action.tx, action.ty) > GRENADE_RANGE) {
                return "The target is out of throwing range.";
            }
            if (state.tiles[action.tx][action.ty].kind === "wall") return "Cannot target a wall.";
            return lineOfThrow(state, action.x, action.y, action.tx, action.ty)
                ? null
                : "A wall blocks the throw.";
        }
    }
}

const THROW_SPENT: Record<ThrowKind, string> = {
    grenade: "This unit has no grenade left.",
    flashbang: "This unit has no flashbang left.",
    smoke_grenade: "This unit has no smoke grenade left.",
};

/**
 * Orders that roll dice. Only transfers may follow `Random` in a transaction, so they go last.
 * The flashbang and the smoke grenade roll nothing.
 */
export const rollsDice = (action: Action) => action.kind === "attack" || action.kind === "grenade";

// === Effects ===

/** `Map.units` order: row-major by tile (`x * cols + y`). Effects land on units in this order. */
export function inUnitOrder(state: Pick<GameState, "cols">, units: Unit[]): Unit[] {
    return [...units].sort((a, b) => a.x * state.cols + a.y - (b.x * state.cols + b.y));
}

/**
 * `Unit.apply_effect`: put an effect of the kind on the unit, for the turns that kind lasts.
 * One it has already is refreshed to the longer of the two, in its place; a new one goes last.
 * Returns the effect as the unit now has it.
 */
export function applyEffect(unit: Unit, kind: EffectKind): UnitEffect {
    const turns = EFFECT_TURNS[kind];
    const has = effectOf(unit, kind);
    if (has) {
        has.turns = Math.max(has.turns, turns);
        return { ...has };
    }
    const effect = { kind, turns };
    unit.effects.push(effect);
    return { ...effect };
}

/**
 * `Map.spread_effect`: the effect on every unit within `GRENADE_RADIUS` of `(x, y)`, either
 * side's. Records an `EffectStart` per unit, in `Map.units` order.
 */
export function spreadEffect(state: GameState, x: number, y: number, kind: EffectKind) {
    const records: GameRecord[] = [];
    for (const unit of inUnitOrder(state, blastUnits(state, x, y, GRENADE_RADIUS))) {
        const { turns } = applyEffect(unit, kind);
        records.push({ kind: "effect_start", x: unit.x, y: unit.y, effect: kind, turns });
    }
    return records;
}

/**
 * `Map.perform_flashbang` and `Map.perform_smoke_grenade`: the throw costs 1 AP and a use, then
 * the header record and an `EffectStart` per unit in the burst. Nothing rolls, nothing is
 * damaged, covers stay. Changes `state`.
 */
export function throwEffect(state: GameState, action: EffectThrowAction): GameRecord[] {
    const unit = unitAt(state, action.x, action.y)!;
    unit.ap -= 1;
    spendUse(unit, action.kind);
    const header = { from: [action.x, action.y], to: [action.tx, action.ty] };
    return [
        { kind: action.kind, ...header },
        ...spreadEffect(state, action.tx, action.ty, THROW_EFFECT[action.kind]),
    ];
}

/**
 * `ghosts::next_turn` as it changes the map: the fallen are buried (but in a friendly game), the turn passes, and in a
 * single walk of `Map.units` every unit gets one turn off each effect, those at zero going,
 * while the units of the side whose turn begins get their AP back. Changes `state`.
 *
 * Records the `EffectEnd`s, unit by unit in `Map.units` order and in the order a unit had its
 * effects: the `NextTurn` record is the caller's, as it comes first. With `last` the game ends
 * on this turn change (`MAX_TURNS`): the chain stops before the walk.
 */
export function passTurn(state: GameState, last = false): GameRecord[] {
    // a friendly game keeps its fallen on the map until `complete_game` (`bury_fallen` is a no-op)
    if (state.mode.kind !== "friendly") state.fallen = [];
    state.turn += 1;
    state.active = state.turn % state.players.length;
    if (last) return [];
    const records: GameRecord[] = [];
    for (const unit of inUnitOrder(state, state.units)) {
        if (unit.side === state.active) unit.ap = unit.apMax;
        for (const effect of unit.effects) effect.turns -= 1;
        for (const effect of unit.effects.filter((e) => e.turns === 0)) {
            records.push({ kind: "effect_end", x: unit.x, y: unit.y, effect: effect.kind });
        }
        unit.effects = unit.effects.filter((effect) => effect.turns > 0);
    }
    return records;
}

/** What a unit carries, by the tile it stands on. */
export interface EffectsAt {
    x: number;
    y: number;
    effects: UnitEffect[];
}

/**
 * Rebuild the effects of every unit from the history alone, the way a client without the game
 * objects does: the tiles of the units that carry any, each with its effects in the order the
 * unit got them. `EffectStart` sets the effect of its kind, or adds it last; `NextTurn` takes a
 * turn off every effect; `EffectEnd` removes the kind, which must have run out; `Move` takes a
 * unit's effects along its path; `UnitKIA` ends them all. Throws if the history is not one a
 * game wrote: an effect that ran out and stayed, or ended with turns left or never was.
 */
export function replayEffects(history: GameRecord[]): EffectsAt[] {
    const tiles: EffectsAt[] = [];
    const at = (x: number, y: number) => tiles.find((tile) => tile.x === x && tile.y === y);
    const drop = (tile: EffectsAt) => tiles.splice(tiles.indexOf(tile), 1);

    for (const record of history) {
        if (record.kind === "move") {
            const [x0, y0, ...path] = record.path;
            const tile = at(x0, y0);
            if (!tile) continue;
            let [x, y] = [x0, y0];
            for (const direction of path) {
                x += STEPS[direction][0];
                y += STEPS[direction][1];
            }
            [tile.x, tile.y] = [x, y];
        } else if (record.kind === "kia") {
            const tile = at(record.x, record.y);
            if (tile) drop(tile);
        } else if (record.kind === "next_turn") {
            for (const tile of tiles) for (const effect of tile.effects) effect.turns -= 1;
        } else if (record.kind === "effect_start") {
            const tile = at(record.x, record.y) ?? { x: record.x, y: record.y, effects: [] };
            if (!tiles.includes(tile)) tiles.push(tile);
            const has = tile.effects.find((effect) => effect.kind === record.effect);
            if (has) has.turns = record.turns;
            else tile.effects.push({ kind: record.effect, turns: record.turns });
        } else if (record.kind === "effect_end") {
            const tile = at(record.x, record.y);
            const has = tile?.effects.find((effect) => effect.kind === record.effect);
            if (!tile || !has || has.turns !== 0) {
                throw new Error(`The ${record.effect} on (${record.x}, ${record.y}) did not end.`);
            }
            tile.effects = tile.effects.filter((effect) => effect !== has);
            if (tile.effects.length === 0) drop(tile);
        }
    }
    for (const tile of tiles) {
        if (tile.effects.some((effect) => effect.turns <= 0)) {
            throw new Error(`An effect on (${tile.x}, ${tile.y}) ran out without an end.`);
        }
    }
    return tiles;
}

/** Apply an order that rolls no dice to a copy of the state. */
export function applyDeterministic(state: GameState, action: Action): GameState {
    const next = structuredClone(state);
    if (action.kind === "move") {
        const unit = unitAt(next, action.x, action.y)!;
        const end = checkPath(next, action.x, action.y, action.path)!;
        [unit.x, unit.y] = end;
        unit.ap -= 1;
    } else if (action.kind === "reload") {
        const unit = unitAt(next, action.x, action.y)!;
        unit.ammo = unit.ammoMax;
        unit.ap -= 1;
    } else if (isEffectThrow(action.kind)) {
        throwEffect(next, action as EffectThrowAction);
    } else if (action.kind === "next_turn") {
        passTurn(next);
    }
    return next;
}

/**
 * Check a whole batch against the state each order would find, and return it
 * parsed. A dice roll can only be the last order, since its result decides what
 * makes sense next, and so is a turn's end. A flashbang or a smoke grenade rolls
 * nothing, so orders can follow it.
 */
export function validateBatch(
    state: GameState,
    side: number,
    ids: string[],
    nowMs: number,
): Action[] {
    if (ids.length === 0) throw new ActionError("bad_action", "No actions given.");
    if (ids.length > MAX_BATCH) {
        throw new ActionError("bad_action", `At most ${MAX_BATCH} actions per call.`);
    }
    let cursor = state;
    return ids.map((id, i) => {
        const action = parseAction(id);
        const reason = refusal(cursor, side, action, nowMs);
        if (reason) throw new ActionError("illegal_action", `${id}: ${reason}`);
        const last = i === ids.length - 1;
        if (rollsDice(action) && !last) {
            throw new ActionError("illegal_action", `${id}: a dice roll must be the last action.`);
        }
        const plain = action.kind === "move" || action.kind === "reload";
        if (!rollsDice(action) && !plain && !isEffectThrow(action.kind) && !last) {
            throw new ActionError("illegal_action", `${id}: must be the last action.`);
        }
        cursor = applyDeterministic(cursor, action);
        return action;
    });
}

// === Enumeration ===

export interface LegalAction {
    id: string;
    kind: Action["kind"];
    unit?: [number, number];
    to?: [number, number];
    /** Chance in percent this shot lands (attack). */
    hitChance?: number;
    /** Damage a landed shot can deal to the target after armor (attack). */
    damage?: { min: number; max: number };
    /** The target's HP (attack). */
    targetHp?: number;
    /** Units in the blast (any throw, area attack). */
    enemiesHit?: number;
    alliesHit?: number;
    /** Best chance any enemy has of hitting this unit on the tile (move). */
    threat?: number;
    /** Best chance this unit has from the tile, if it can still shoot (move). */
    bestShot?: number;
    /** Tiles to the nearest enemy from the tile (move). */
    enemyDistance?: number;
}

function moveOption(
    state: GameState,
    unit: Unit,
    x: number,
    y: number,
    path: number[],
): LegalAction {
    const enemies = state.units.filter((other) => other.side !== unit.side);
    const canShootAfter = hasAction(unit, "attack") && unit.ap > 1 && unit.ammo > 0;
    let [threat, bestShot, enemyDistance] = [0, 0, Infinity];
    const mine = effectiveStats(unit);
    for (const enemy of enemies) {
        enemyDistance = Math.min(enemyDistance, manhattan(x, y, enemy.x, enemy.y));
        const theirs = effectiveStats(enemy);
        const incoming = shotChance(state, theirs, enemy.x, enemy.y, x, y, mine.defense);
        threat = Math.max(threat, incoming ?? 0);
        if (canShootAfter) {
            const outgoing = shotChance(state, mine, x, y, enemy.x, enemy.y, theirs.defense);
            bestShot = Math.max(bestShot, outgoing ?? 0);
        }
    }
    return {
        id: actionId({ kind: "move", x: unit.x, y: unit.y, path }),
        kind: "move",
        unit: [unit.x, unit.y],
        to: [x, y],
        threat,
        bestShot,
        enemyDistance: Number.isFinite(enemyDistance) ? enemyDistance : undefined,
    };
}

/** How a move ranks: shots it opens, less danger it walks into, ties to the closer tile. */
export const moveScore = (move: LegalAction) =>
    (move.bestShot ?? 0) - (move.threat ?? 0) * 0.5 - (move.enemyDistance ?? 0);

/** Every order `side` can give now, with what an agent needs to weigh it. Best first per kind. */
export function legalActions(state: GameState, side: number, nowMs: number): LegalAction[] {
    const single = (kind: "deploy" | "complete" | "next_turn"): LegalAction[] =>
        refusal(state, side, { kind }, nowMs) === null ? [{ id: kind, kind }] : [];

    // Abandoning is always open and never listed: it should be a decision, not an option to rank.
    const expired = nowMs > state.deadlineMs;
    if (state.status.kind !== "active" || state.active !== side || expired) {
        return [...single("deploy"), ...single("complete"), ...single("next_turn")];
    }

    const options: LegalAction[] = [];
    const mine = state.units.filter((unit) => unit.side === side && unit.ap > 0);
    const enemies = state.units.filter((unit) => unit.side !== side);

    for (const unit of mine) {
        const { x, y } = unit;
        const stats = effectiveStats(unit);
        const attacks: LegalAction[] = [];
        if (hasAction(unit, "attack") && unit.ammo > 0) {
            for (const enemy of enemies) {
                const chance = shotChance(
                    state,
                    stats,
                    x,
                    y,
                    enemy.x,
                    enemy.y,
                    effectiveStats(enemy).defense,
                );
                if (chance === null) continue;
                const blast = blastUnits(state, enemy.x, enemy.y, stats.areaSize);
                attacks.push({
                    id: actionId({ kind: "attack", x, y, tx: enemy.x, ty: enemy.y }),
                    kind: "attack",
                    unit: [x, y],
                    to: [enemy.x, enemy.y],
                    hitChance: chance,
                    damage: damageRange(stats, enemy),
                    targetHp: enemy.hp,
                    ...(stats.areaSize > 0 && {
                        enemiesHit: blast.filter((other) => other.side !== side).length,
                        alliesHit: blast.filter((other) => other.side === side).length,
                    }),
                });
            }
        }
        options.push(...attacks.sort((a, b) => b.hitChance! - a.hitChance!));

        for (const kind of THROWS) {
            if (!hasUsesLeft(unit, kind)) continue;
            const throws: LegalAction[] = [];
            for (
                let tx = Math.max(0, x - GRENADE_RANGE);
                tx <= x + GRENADE_RANGE && tx < state.rows;
                tx++
            ) {
                for (
                    let ty = Math.max(0, y - GRENADE_RANGE);
                    ty <= y + GRENADE_RANGE && ty < state.cols;
                    ty++
                ) {
                    const blast = blastUnits(state, tx, ty, GRENADE_RADIUS);
                    const enemiesHit = blast.filter((other) => other.side !== side).length;
                    // a smoke grenade is for anyone in it, mine or theirs; the rest are for enemies
                    if (kind === "smoke_grenade" ? blast.length === 0 : enemiesHit === 0) continue;
                    const action: Action = { kind, x, y, tx, ty };
                    if (refusal(state, side, action, nowMs)) continue;
                    throws.push({
                        id: actionId(action),
                        kind,
                        unit: [x, y],
                        to: [tx, ty],
                        enemiesHit,
                        alliesHit: blast.length - enemiesHit,
                    });
                }
            }
            const value = (a: LegalAction) =>
                kind === "smoke_grenade"
                    ? a.alliesHit! * 2 - a.enemiesHit! * 3
                    : a.enemiesHit! * 2 - a.alliesHit! * 3;
            options.push(...throws.sort((a, b) => value(b) - value(a)));
        }

        if (hasAction(unit, "reload") && unit.ammo < unit.ammoMax) {
            options.push({
                id: actionId({ kind: "reload", x, y }),
                kind: "reload",
                unit: [x, y],
            });
        }

        const moves: LegalAction[] = [];
        for (const [key, path] of hasAction(unit, "move") ? reachable(state, unit) : []) {
            const [tx, ty] = key.split(",").map(Number);
            moves.push(moveOption(state, unit, tx, ty, path));
        }
        options.push(...moves.sort((a, b) => moveScore(b) - moveScore(a)));
    }

    return [...options, { id: "next_turn", kind: "next_turn" }];
}
