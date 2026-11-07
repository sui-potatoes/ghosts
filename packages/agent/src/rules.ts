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
    type GameState,
    type Stats,
    type Tile,
    type Unit,
} from "./types.ts";

export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;

const NO_DIRECTION = 0;
const HIGH_COVER = 2;
const DEFENSE_BONUS = 25;
const MAX_RANGE_OFFSET = 3;
const DISTANCE_BONUS = 5;
const DISTANCE_PENALTY = 10;

export const GRENADE_RANGE = 5;
export const GRENADE_RADIUS = 2;
export const GRENADE_DAMAGE = 4;

/** The most orders one transaction may carry. */
export const MAX_BATCH = 8;

/** `ghosts::ghosts`: how long a player has for their turn. */
export const TURN_LIMIT_MS = 90_000;
/** `ghosts::ghosts`: how long the players have to pick their squads once matched. */
export const DEPLOY_LIMIT_MS = 120_000;
/** `ghosts::ghosts`: how long a search stays in the queue. */
export const SEARCH_TIMEOUT_MS = 120_000;
/** `ghosts::ghosts`: how long an account can't search after misbehaving. */
export const SUSPENSION_MS = 3_600_000;
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

const isWalkable = (tile: Tile) => tile.kind === "empty" || tile.kind === "cover";

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

/** `check_path`: the end tile of a walkable path, or null. Directions are orthogonal. */
export function checkPath(
    state: GameState,
    x0: number,
    y0: number,
    directions: number[],
): [number, number] | null {
    if (!inBounds(state, x0, y0)) return null;
    let [x, y] = [x0, y0];
    let source = state.tiles[x][y];
    if (directions.length > 0 && !isWalkable(source)) return null;

    for (const direction of directions) {
        const step = STEPS[direction];
        if (!step) return null;
        const [nx, ny] = [x + step[0], y + step[1]];
        if (!inBounds(state, nx, ny)) return null;
        const target = state.tiles[nx][ny];
        if (unitAt(state, nx, ny) || !isWalkable(target)) return null;
        if (edgeHighCover(source, target, direction)) return null;
        [x, y, source] = [nx, ny, target];
    }
    return [x, y];
}

/** Every tile the unit can walk to in one move, with a shortest path to each. */
export function reachable(state: GameState, unit: Unit): Map<string, number[]> {
    const paths = new Map<string, number[]>();
    let frontier: { x: number; y: number; path: number[] }[] = [{ x: unit.x, y: unit.y, path: [] }];
    const seen = new Set([`${unit.x},${unit.y}`]);

    for (let distance = 0; distance < unit.stats.mobility; distance++) {
        const next: typeof frontier = [];
        for (const { x, y, path } of frontier) {
            for (const direction of [UP, RIGHT, DOWN, LEFT]) {
                const [nx, ny] = [x + STEPS[direction][0], y + STEPS[direction][1]];
                const key = `${nx},${ny}`;
                if (seen.has(key) || !inBounds(state, nx, ny)) continue;
                if (unitAt(state, nx, ny) || !isWalkable(state.tiles[nx][ny])) continue;
                if (edgeHighCover(state.tiles[x][y], state.tiles[nx][ny], direction)) continue;
                seen.add(key);
                const longer = [...path, direction];
                paths.set(key, longer);
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

/** `tile_cover!`: a `Wall` counts as high cover on every side. */
function tileCover(state: GameState, x: number, y: number) {
    const tile = state.tiles[x][y];
    if (tile.kind === "cover") return tile;
    const side = tile.kind === "wall" ? HIGH_COVER : 0;
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
    match = /^(attack|grenade):(\d+),(\d+):(\d+),(\d+)$/.exec(id);
    if (match) {
        return {
            kind: match[1] as "attack" | "grenade",
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
    if (unit.ap <= 0) return "That unit has no AP left this turn.";

    switch (action.kind) {
        case "move": {
            if (action.path.length > unit.stats.mobility)
                return "The path exceeds the unit's mobility.";
            return checkPath(state, action.x, action.y, action.path)
                ? null
                : "The path is blocked.";
        }
        case "reload":
            return unit.ammo < unit.ammoMax ? null : "The weapon is already full.";
        case "attack": {
            if (unit.ammo <= 0) return "The weapon is empty: reload.";
            if (!inBounds(state, action.tx, action.ty)) return "The target is off the map.";
            const target = unitAt(state, action.tx, action.ty);
            if (unit.stats.areaSize > 0) {
                if (state.tiles[action.tx][action.ty].kind === "wall")
                    return "Cannot target a wall.";
            } else {
                if (!target) return "There is no unit on the target tile.";
                if (target.side === side) return "That target is on your side.";
            }
            const chance = shotChance(
                state,
                unit.stats,
                action.x,
                action.y,
                action.tx,
                action.ty,
                target?.stats.defense ?? 0,
            );
            return chance === null ? "The target is out of range or out of sight." : null;
        }
        case "grenade": {
            if (unit.grenadeUsed) return "This unit has used its grenade.";
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

/** Orders that roll dice. Only transfers may follow `Random` in a transaction, so they go last. */
export const rollsDice = (action: Action) => action.kind === "attack" || action.kind === "grenade";

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
    } else if (action.kind === "next_turn") {
        next.turn += 1;
        next.active = (next.active + 1) % next.players.length;
        for (const unit of next.units) unit.ap = unit.apMax;
    }
    return next;
}

/**
 * Check a whole batch against the state each order would find, and return it
 * parsed. A dice roll can only be the last order, since its result decides what
 * makes sense next, and so is a turn's end.
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
        if (!rollsDice(action) && action.kind !== "move" && action.kind !== "reload" && !last) {
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
    /** Units in the blast (grenade, area attack). */
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
    const canShootAfter = unit.ap > 1 && unit.ammo > 0;
    let [threat, bestShot, enemyDistance] = [0, 0, Infinity];
    for (const enemy of enemies) {
        enemyDistance = Math.min(enemyDistance, manhattan(x, y, enemy.x, enemy.y));
        const incoming = shotChance(state, enemy.stats, enemy.x, enemy.y, x, y, unit.stats.defense);
        threat = Math.max(threat, incoming ?? 0);
        if (canShootAfter) {
            const outgoing = shotChance(
                state,
                unit.stats,
                x,
                y,
                enemy.x,
                enemy.y,
                enemy.stats.defense,
            );
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
        const { x, y, stats } = unit;
        const attacks: LegalAction[] = [];
        if (unit.ammo > 0) {
            for (const enemy of enemies) {
                const chance = shotChance(
                    state,
                    stats,
                    x,
                    y,
                    enemy.x,
                    enemy.y,
                    enemy.stats.defense,
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

        if (!unit.grenadeUsed) {
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
                    if (enemiesHit === 0) continue;
                    const action: Action = { kind: "grenade", x, y, tx, ty };
                    if (refusal(state, side, action, nowMs)) continue;
                    throws.push({
                        id: actionId(action),
                        kind: "grenade",
                        unit: [x, y],
                        to: [tx, ty],
                        enemiesHit,
                        alliesHit: blast.length - enemiesHit,
                    });
                }
            }
            const value = (a: LegalAction) => a.enemiesHit! * 2 - a.alliesHit! * 3;
            options.push(...throws.sort((a, b) => value(b) - value(a)));
        }

        if (unit.ammo < unit.ammoMax) {
            options.push({
                id: actionId({ kind: "reload", x, y }),
                kind: "reload",
                unit: [x, y],
            });
        }

        const moves: LegalAction[] = [];
        for (const [key, path] of reachable(state, unit)) {
            const [tx, ty] = key.split(",").map(Number);
            moves.push(moveOption(state, unit, tx, ty, path));
        }
        options.push(...moves.sort((a, b) => moveScore(b) - moveScore(a)));
    }

    return [...options, { id: "next_turn", kind: "next_turn" }];
}
