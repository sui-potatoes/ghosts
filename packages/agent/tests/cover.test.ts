// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The reference bot in a fight: it seeks cover by expected value. Small arenas with explicit
 * positions for each rule, then whole sandbox games for legality.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { referencePolicy } from "../src/bot.ts";
import {
    applyDeterministic,
    coverBonus,
    legalActions,
    MAX_TURNS,
    parseAction,
    refusal,
    RIGHT,
    shotChance,
} from "../src/rules.ts";
import { autoSquad, unitFromLoadout } from "../src/ranked.ts";
import { createSandbox, SANDBOX_RULES, type SquadUnit } from "../src/sandbox.ts";
import type { Action, GameState, Stats, Tile, Unit, UnitActionEntry } from "../src/types.ts";

/** `stats::default()` with a standard rifle: aim 65, range 4, 10 health. */
const BASE: Stats = {
    mobility: 7,
    aim: 65,
    health: 10,
    armor: 0,
    dodge: 0,
    defense: 0,
    damage: 4,
    spread: 2,
    plusOne: 10,
    critChance: 10,
    canBeDodged: 1,
    areaSize: 0,
    envDamage: 0,
    range: 4,
    ammo: 3,
};

const acts = (...kinds: UnitActionEntry["kind"][]): UnitActionEntry[] =>
    kinds.map((kind) => ({ kind, uses: null }));

/** An empty `rows` x `cols` map with side 0 to act. */
function arena(rows = 10, cols = 10): GameState {
    return {
        id: "0x1",
        version: "1",
        rows,
        cols,
        turn: 0,
        active: 0,
        players: ["0xa", "0xb"],
        squads: [[], []],
        fallen: [],
        positions: [[], []],
        history: [],
        missed: [0, 0],
        abandonedBy: null,
        deadlineMs: 1_000_000,
        status: { kind: "active" },
        mode: { kind: "stakes" },
        tiles: Array.from({ length: rows }, () =>
            Array.from({ length: cols }, (): Tile => ({ kind: "empty" })),
        ),
        units: [],
    };
}

function place(
    state: GameState,
    side: number,
    x: number,
    y: number,
    options: {
        actions?: UnitActionEntry["kind"][];
        stats?: Partial<Stats>;
        ap?: number;
        ammo?: number;
    } = {},
): Unit {
    const unit: Unit = {
        recruit: `0x${side}${x}${y}`,
        owner: state.players[side],
        side,
        x,
        y,
        ap: options.ap ?? 2,
        apMax: 2,
        hp: 10,
        hpMax: 10,
        ammo: options.ammo ?? 3,
        ammoMax: 3,
        stats: { ...BASE, ...options.stats },
        actions: acts(...(options.actions ?? ["move", "attack", "reload"])),
        effects: [],
    };
    state.units.push(unit);
    return unit;
}

/** An enemy that cannot move: what it threatens is plain, the rule under test is not blurred. */
const turret = (state: GameState, x: number, y: number, stats: Partial<Stats> = {}) =>
    place(state, 1, x, y, { actions: ["attack", "reload"], stats });

const obstacle = (state: GameState, x: number, y: number) => {
    state.tiles[x][y] = { kind: "obstacle" };
};

/** The reference bot's next order for side 0, checked legal. */
function next(state: GameState): Action {
    const legal = legalActions(state, 0, 0);
    const [id] = referencePolicy({ state, side: 0, legal, nowMs: 0 }) as string[];
    const action = parseAction(id);
    assert.equal(refusal(state, 0, action, 0), null, `${id} is legal`);
    return action;
}

/** Where a move order ends. */
const endOf = (state: GameState, action: Action) => {
    const after = applyDeterministic(state, action);
    const unit = after.units.find((u) => u.recruit === state.units[0].recruit)!;
    return [unit.x, unit.y];
};

/** The cover `unit` on `(x, y)` has against a shot from `enemy`. */
const coverAgainst = (state: GameState, enemy: Unit, x: number, y: number) =>
    coverBonus(state, enemy.x, enemy.y, x, y);

test("in the open with a good shot, a unit moves beside an obstacle first, then shoots", () => {
    let state = arena();
    // a short move: the trade is cover against a closer shot in the open, not a point-blank one
    const me = place(state, 0, 5, 2, { stats: { mobility: 2 } });
    const enemy = turret(state, 5, 7);
    obstacle(state, 4, 4);
    const standing = shotChance(state, me.stats, 5, 2, 5, 7, 0)!;
    assert.ok(standing >= 35, `a good shot where it stands: ${standing}`);
    assert.equal(coverAgainst(state, enemy, 5, 2), 0, "and no cover there");

    const move = next(state);
    assert.equal(move.kind, "move");
    const [x, y] = endOf(state, move);
    assert.deepEqual([x, y], [4, 3], "beside the obstacle, two tiles away");
    assert.equal(coverAgainst(state, enemy, x, y), 25, "covered against the enemy");
    const kept = shotChance(state, me.stats, x, y, enemy.x, enemy.y, 0)!;
    assert.ok(kept >= standing - 15, `the shot is kept: ${kept} against ${standing}`);

    state = applyDeterministic(state, move);
    const shot = next(state);
    assert.equal(shot.kind, "attack", "the shot comes on the next call");
    assert.deepEqual(
        shot.kind === "attack" && [shot.x, shot.y, shot.tx, shot.ty],
        [4, 3, enemy.x, enemy.y],
    );
});

test("a unit already covered against its only threat, with a good shot, shoots without moving", () => {
    const state = arena();
    place(state, 0, 4, 3);
    const enemy = turret(state, 5, 7);
    obstacle(state, 4, 4);
    assert.equal(coverAgainst(state, enemy, 4, 3), 25);
    const order = next(state);
    assert.equal(order.kind, "attack");
    assert.deepEqual(order.kind === "attack" && [order.x, order.y], [4, 3]);
});

test("with no shot this turn, a unit walks to a covered tile that sees the enemy, not an open one", () => {
    let state = arena();
    // an empty weapon: no shot this turn, whatever the tile; it reloads after the move
    place(state, 0, 5, 2, { ammo: 0 });
    const enemy = turret(state, 5, 8);
    obstacle(state, 3, 5);
    obstacle(state, 7, 5);

    const move = next(state);
    assert.equal(move.kind, "move");
    const [x, y] = endOf(state, move);
    assert.ok(coverAgainst(state, enemy, x, y) > 0, `covered on (${x}, ${y})`);
    assert.notEqual(shotChance(state, BASE, x, y, enemy.x, enemy.y, 0), null, "and sees the enemy");
    // an open tile as far from the enemy was in reach: (5, 4) is as far as (3, 4) or (7, 4)
    assert.equal(coverAgainst(state, enemy, 5, 4), 0);

    state = applyDeterministic(state, move);
    assert.equal(next(state).kind, "reload", "the AP left reloads");
});

test("with 1 AP and no shot worth taking, a unit in the open steps into the cover beside it", () => {
    const state = arena();
    // a short rifle (no shot at the enemy) and one tile of mobility: the step is the question
    place(state, 0, 4, 2, { ap: 1, stats: { range: 2, mobility: 1 } });
    const enemy = turret(state, 4, 9, { range: 6 });
    obstacle(state, 4, 4);
    assert.equal(coverAgainst(state, enemy, 4, 2), 0);
    const move = next(state);
    assert.equal(move.kind, "move");
    const [x, y] = endOf(state, move);
    assert.deepEqual([x, y], [4, 3]);
    assert.equal(coverAgainst(state, enemy, x, y), 25);
});

test("an empty weapon with 1 AP reloads where stepping saves little, steps where it saves much", () => {
    const empty = (damage: number) => {
        const state = arena();
        place(state, 0, 4, 2, { ap: 1, ammo: 0, stats: { mobility: 1 } });
        turret(state, 4, 9, { range: 6, damage });
        obstacle(state, 4, 4);
        return next(state);
    };
    assert.equal(empty(4).kind, "reload", "a light rifle: the step saves under a hit point");
    const step = empty(8);
    assert.equal(step.kind, "move", "a heavy one: the step into cover saves more");
    assert.deepEqual(step.kind === "move" && step.path, [RIGHT]);
});

test("a unit flanks a target behind an obstacle: the shot that does not cross it, then fire", () => {
    let state = arena();
    const me = place(state, 0, 5, 2);
    const enemy = turret(state, 5, 6);
    obstacle(state, 5, 5);
    assert.equal(coverBonus(state, 5, 2, 5, 6), 25, "covered against a shot from here");

    const move = next(state);
    assert.equal(move.kind, "move");
    const [x, y] = endOf(state, move);
    assert.equal(coverBonus(state, x, y, enemy.x, enemy.y), 0, `no cover for it from (${x}, ${y})`);
    const from = shotChance(state, me.stats, x, y, enemy.x, enemy.y, 0)!;
    assert.ok(from > shotChance(state, me.stats, 5, 2, 5, 6, 0)!, "a better shot");

    state = applyDeterministic(state, move);
    assert.equal(next(state).kind, "attack");
});

test("a unit in good cover with a good shot keeps its tile turn after turn: no walking back and forth", () => {
    let state = arena();
    place(state, 0, 4, 3);
    turret(state, 5, 7);
    obstacle(state, 4, 4);
    // two obstacles more, as good as the first: equal tiles to drift between
    obstacle(state, 2, 4);
    obstacle(state, 6, 4);
    const ends: number[][] = [];
    for (let round = 0; round < 4; round++) {
        state.units[0].ap = 2;
        for (let i = 0; i < 4; i++) {
            const order = next(state);
            if (order.kind === "next_turn") break;
            if (order.kind === "attack") {
                // a miss, so nothing changes but the AP and the ammo
                state.units[0].ap = 0;
                state.units[0].ammo -= 1;
            } else state = applyDeterministic(state, order);
        }
        ends.push([state.units[0].x, state.units[0].y]);
        state.units[0].ammo = Math.max(state.units[0].ammo, 1);
    }
    assert.deepEqual(ends, [[4, 3], [4, 3], [4, 3], [4, 3]]);
});

test("a game gone quiet makes units press on instead of waiting each other out", () => {
    const quietFor = (turns: number) => {
        const state = arena(10, 12);
        // hidden behind a wall, a short rifle: no shot anywhere in reach, and every tile closer
        // is in the sight of a turret
        place(state, 0, 5, 2, { stats: { mobility: 3, range: 1 } });
        turret(state, 5, 8);
        state.tiles[5][3] = { kind: "wall" };
        state.history = Array.from({ length: turns }, (_, turn) => ({
            kind: "next_turn" as const,
            turn,
        }));
        return next(state).kind;
    };
    assert.equal(quietFor(0), "next_turn", "in a game still being fought it waits in hiding");
    assert.equal(quietFor(2), "next_turn");
    assert.equal(quietFor(8), "move", "after eight quiet turn changes it closes in");
});

/** One sandbox game of auto squads with the reference bot on both sides, every order checked. */
async function sandboxGame(seed: number) {
    const squads = [0, 1].map((side) =>
        autoSquad(SANDBOX_RULES, 1 + (seed % 2), 3, { seed: seed * 2 + side }).squad.map(
            (loadout) => {
                const { stats, actions } = unitFromLoadout(loadout)!;
                return { stats, actions };
            },
        ),
    ) as unknown as [SquadUnit[], SquadUnit[]];
    const check = (state: GameState, side: number, ids: string[]) => {
        for (const id of ids) {
            const action = parseAction(id);
            assert.equal(refusal(state, side, action, 0), null, `seed ${seed}: ${id} is legal`);
            state = applyDeterministic(state, action);
        }
    };
    const backend = createSandbox({
        seed,
        seated: true,
        squads,
        now: () => 0,
        opponent: (input) => {
            const ids = referencePolicy(input) as string[];
            check(structuredClone(input.state), input.side, ids);
            return ids;
        },
    });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    await backend.acceptSeat();
    const account = (await backend.account())!;
    const id = account.search.kind === "playing" ? account.search.game : "";
    let game = (await backend.game(id))!;
    await backend.submit(game, [{ kind: "deploy" }]);
    game = (await backend.game(id))!;
    for (let turn = 0; turn <= MAX_TURNS && game.status.kind === "active"; turn++) {
        for (let i = 0; i < 16 && game.status.kind === "active" && game.active === 0; i++) {
            const legal = legalActions(game, 0, 0);
            const ids = referencePolicy({ state: game, side: 0, legal, nowMs: 0 }) as string[];
            check(structuredClone(game), 0, ids);
            await backend.submit(game, ids.map(parseAction));
            game = (await backend.game(id))!;
        }
    }
    return game;
}

test("whole sandbox games: every order is legal and the games end, nearly all by a side falling", async () => {
    const endings: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
        const game = await sandboxGame(seed);
        assert.equal(game.status.kind, "finished", `seed ${seed} ended`);
        if (game.status.kind === "finished") endings.push(game.status.ending.kind);
    }
    const won = endings.filter((kind) => kind === "won").length;
    assert.ok(won >= 17, `won by elimination in ${won} of 20: ${endings.join(" ")}`);
});
