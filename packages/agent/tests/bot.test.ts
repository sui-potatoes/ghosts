// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The reference bot's turn shape, by explicit positions: move into cover at range and shoot from
 * there, keep off point blank, throw frags from a stand-off for what they catch and the cover
 * they take, press cover to cover, fall back when dazed. Then whole sandbox games for legality.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { referencePolicy } from "../src/bot.ts";
import {
    applyDeterministic,
    blastUnits,
    coverBonus,
    GRENADE_RADIUS,
    legalActions,
    manhattan,
    MAX_TURNS,
    parseAction,
    refusal,
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

/** An empty `rows` x `cols` map with side 0 to act. */
function arena(rows = 11, cols = 12): GameState {
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
        actions?: UnitActionEntry[];
        stats?: Partial<Stats>;
        ap?: number;
        hp?: number;
        dazed?: boolean;
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
        hp: options.hp ?? 10,
        hpMax: 10,
        ammo: 3,
        ammoMax: 3,
        stats: { ...BASE, ...options.stats },
        actions: options.actions ?? acts("move", "attack", "reload"),
        effects: options.dazed ? [{ kind: "daze", turns: 1 }] : [],
    };
    state.units.push(unit);
    return unit;
}

const acts = (...kinds: UnitActionEntry["kind"][]): UnitActionEntry[] =>
    kinds.map((kind) => ({ kind, uses: kind === "grenade" ? 1 : null }));

/** An enemy that cannot move: what it threatens is plain. */
const turret = (
    state: GameState,
    x: number,
    y: number,
    options: Parameters<typeof place>[4] = {},
) => place(state, 1, x, y, { actions: acts("attack", "reload"), ...options });

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

/**
 * Side 0's whole turn as the bot plays it, every shot a miss (only the AP and the ammo change) and
 * a frag applied without its damage: the orders and the state the turn ends in.
 */
function turn(state: GameState): { orders: Action[]; state: GameState } {
    const orders: Action[] = [];
    for (let i = 0; i < 12; i++) {
        const order = next(state);
        if (order.kind === "next_turn") break;
        orders.push(order);
        if (order.kind === "attack" || order.kind === "grenade") {
            state = structuredClone(state);
            const unit = state.units.find((u) => u.x === order.x && u.y === order.y)!;
            if (order.kind === "attack") [unit.ap, unit.ammo] = [0, unit.ammo - 1];
            else {
                unit.ap -= 1;
                unit.actions = unit.actions.filter((a) => a.kind !== "grenade");
            }
        } else state = applyDeterministic(state, order);
    }
    return { orders, state };
}

/** Whether no enemy that sees `(x, y)` gets a shot at it without cover. */
const covered = (state: GameState, x: number, y: number) =>
    state.units
        .filter((u) => u.side === 1)
        .every(
            (e) =>
                shotChance(state, e.stats, e.x, e.y, x, y, 0) === null ||
                coverBonus(state, e.x, e.y, x, y) > 0,
        );

const nearestEnemy = (state: GameState, x: number, y: number) =>
    Math.min(...state.units.filter((u) => u.side === 1).map((e) => manhattan(e.x, e.y, x, y)));

const unitOf = (state: GameState, recruit: string) =>
    state.units.find((u) => u.recruit === recruit)!;

test("opening: in the open with an enemy at long range, a unit moves into cover, then shoots", () => {
    const state = arena();
    const me = place(state, 0, 6, 1);
    const enemy = turret(state, 6, 7);
    obstacle(state, 5, 4);
    const standing = shotChance(state, me.stats, 6, 1, 6, 7, 0)!;
    assert.ok(standing >= 35, `a shot to take from the spawn: ${standing}`);
    assert.ok(!covered(state, 6, 1), "and no cover there");

    const { orders, state: after } = turn(state);
    assert.equal(orders[0].kind, "move", "the first order is the move, not the shot");
    const end = unitOf(after, me.recruit);
    assert.ok(covered(after, end.x, end.y), `ends covered on (${end.x}, ${end.y})`);
    assert.ok(nearestEnemy(after, end.x, end.y) > 2, "at range, not point blank");
    const shot = orders[1];
    assert.equal(shot?.kind, "attack", "and shoots from the cover");
    assert.deepEqual(shot.kind === "attack" && [shot.tx, shot.ty], [enemy.x, enemy.y]);
});

test("already in good cover with a worthwhile shot, a unit shoots without moving", () => {
    const state = arena();
    place(state, 0, 5, 3);
    turret(state, 6, 7);
    obstacle(state, 5, 4);
    assert.ok(covered(state, 5, 3));
    const order = next(state);
    assert.equal(order.kind, "attack");
    assert.deepEqual(order.kind === "attack" && [order.x, order.y], [5, 3]);
});

test("a second unit takes a covered firing position at range, not point blank", () => {
    const state = arena();
    // the front unit has fired already, from cover
    place(state, 0, 4, 4, { ap: 0 });
    obstacle(state, 4, 5);
    const second = place(state, 0, 5, 1);
    // an enemy in the open that can move: point blank gives 80%, the cover beside (6, 5) 45%,
    // the open at three tiles 70% (taken: the enemy has no cover to shoot back from either)
    place(state, 1, 5, 9);
    obstacle(state, 6, 5);

    const { orders, state: after } = turn(state);
    const end = unitOf(after, second.recruit);
    const distance = nearestEnemy(after, end.x, end.y);
    assert.ok(distance > 2, `ends ${distance} tiles from the enemy on (${end.x}, ${end.y})`);
    assert.ok(orders.some((o) => o.kind === "attack"), "and shoots from there");
});

test("closing to point blank is allowed for a likely kill", () => {
    const state = arena();
    const me = place(state, 0, 5, 1);
    // a wounded enemy in cover from range: only a close shot is likely enough to finish it
    turret(state, 5, 9, { hp: 1, stats: { defense: 25 } });

    const { orders, state: after } = turn(state);
    assert.equal(orders[0].kind, "move");
    const end = unitOf(after, me.recruit);
    assert.ok(nearestEnemy(after, end.x, end.y) <= 2, `closes in to (${end.x}, ${end.y})`);
    assert.equal(orders[1]?.kind, "attack", "and takes the shot");
});

test("no frag from within the stand-off, and none with a squadmate in the blast", () => {
    // two enemies side by side, two tiles from the thrower: a throw from here is point blank
    const close = arena();
    place(close, 0, 5, 4, { actions: acts("move", "attack", "reload", "grenade") });
    turret(close, 5, 6);
    turret(close, 4, 6);
    const legal = legalActions(close, 0, 0);
    assert.ok(legal.some((a) => a.kind === "grenade" && !a.alliesHit), "a throw is on offer");
    for (const order of turn(close).orders) {
        if (order.kind !== "grenade") continue;
        const blast = blastUnits(close, order.tx, order.ty, GRENADE_RADIUS);
        for (const enemy of blast.filter((u) => u.side === 1)) {
            const distance = manhattan(enemy.x, enemy.y, order.x, order.y);
            assert.ok(distance >= 3, `thrown from a stand-off: ${distance}`);
        }
    }

    // a squadmate next to the pair: no throw that catches it
    const mixed = arena();
    place(mixed, 0, 5, 1, { actions: acts("move", "attack", "reload", "grenade") });
    place(mixed, 0, 6, 6, { ap: 0 });
    turret(mixed, 5, 6);
    turret(mixed, 4, 6);
    for (const order of turn(mixed).orders) {
        if (order.kind !== "grenade") continue;
        const blast = blastUnits(mixed, order.tx, order.ty, GRENADE_RADIUS);
        assert.ok(!blast.some((u) => u.side === 0), `${order.tx},${order.ty} catches none of mine`);
    }
});

test("a frag that catches two enemies beats one that catches either alone", () => {
    const state = arena();
    // no shot worth taking (every enemy behind cover), a frag and two enemies close together
    const me = place(state, 0, 5, 1, { actions: acts("move", "attack", "reload", "grenade") });
    turret(state, 3, 6);
    turret(state, 5, 7);
    turret(state, 8, 3, { stats: { range: 1 } });
    obstacle(state, 3, 5);
    obstacle(state, 5, 6);
    const order = next(state);
    assert.equal(order.kind, "grenade", `throws: ${JSON.stringify(order)}`);
    if (order.kind !== "grenade") return;
    const caught = blastUnits(state, order.tx, order.ty, GRENADE_RADIUS);
    assert.equal(caught.filter((u) => u.side === 1 && u.x !== 8).length, 2, "both of the pair");
    assert.equal(order.x, me.x);
});

test("a frag that only takes the cover is thrown when it opens an enemy to a waiting squadmate", () => {
    const state = arena();
    // the thrower carries no rifle; the squadmate's shot crosses the obstacle the enemy hides
    // behind
    place(state, 0, 3, 3, { actions: acts("move", "grenade") });
    const mate = place(state, 0, 5, 3);
    const enemy = turret(state, 5, 8);
    obstacle(state, 5, 7);
    assert.equal(coverBonus(state, mate.x, mate.y, enemy.x, enemy.y), 25);

    const legal = legalActions(state, 0, 0);
    const coverOnly = legal.filter((a) => a.kind === "grenade" && a.enemiesHit === 0);
    assert.ok(coverOnly.length > 0, "cover-only throws are listed");

    const order = next(state);
    assert.equal(order.kind, "grenade", `throws for the cover: ${JSON.stringify(order)}`);
    if (order.kind !== "grenade") return;
    const reaches = manhattan(order.tx, order.ty, 5, 7) <= GRENADE_RADIUS;
    assert.ok(reaches, "the obstacle is in the blast");
    const after = structuredClone(state);
    after.tiles[5][7] = { kind: "empty" };
    assert.equal(coverBonus(after, mate.x, mate.y, enemy.x, enemy.y), 0, "and the enemy is open");
});

test("pressing in a quiet match goes cover to cover", () => {
    const quiet = (turns: number) => {
        const state = arena(10, 14);
        place(state, 0, 5, 1, { stats: { mobility: 4 } });
        turret(state, 5, 12);
        // the only cover in reach: (5, 5), behind the obstacle on (5, 6), seen by the turret
        obstacle(state, 5, 6);
        state.history = Array.from({ length: turns }, (_, turn) => ({
            kind: "next_turn" as const,
            turn,
        }));
        return turn(state);
    };
    const { state } = quiet(5);
    const end = state.units[0];
    assert.ok(nearestEnemy(state, end.x, end.y) < 11, `closes in to (${end.x}, ${end.y})`);
    assert.ok(covered(state, end.x, end.y), "onto a covered tile");
});

test("a dazed unit next to an enemy falls back into cover by its squad, and does not shoot", () => {
    const state = arena();
    const me = place(state, 0, 5, 6, { dazed: true });
    place(state, 0, 6, 1, { ap: 0 });
    place(state, 1, 5, 7);
    obstacle(state, 5, 2);

    const { orders, state: after } = turn(state);
    assert.ok(!orders.some((o) => o.kind === "attack"), "no shot at no aim");
    assert.equal(orders[0]?.kind, "move");
    const end = unitOf(after, me.recruit);
    assert.ok(nearestEnemy(after, end.x, end.y) > 2, `away from the enemy: (${end.x}, ${end.y})`);
    assert.ok(covered(after, end.x, end.y), "in cover");
    assert.ok(manhattan(end.x, end.y, 6, 1) <= 6, "near its squadmate");
});

test("a dazed unit with no enemy near holds its cover", () => {
    const state = arena(10, 24);
    place(state, 0, 5, 3, { dazed: true });
    turret(state, 5, 22);
    obstacle(state, 5, 4);
    const { orders } = turn(state);
    const acted = orders.some((o) => o.kind === "move" || o.kind === "attack");
    assert.ok(!acted, JSON.stringify(orders));
});

test("the same unit, not dazed, fights as usual", () => {
    const state = arena();
    place(state, 0, 5, 6);
    place(state, 0, 6, 1, { ap: 0 });
    place(state, 1, 5, 7);
    obstacle(state, 5, 2);
    const { orders } = turn(state);
    assert.ok(orders.some((o) => o.kind === "attack"), JSON.stringify(orders));
});

/** One sandbox game of auto squads with the reference bot on both sides, every order checked. */
async function sandboxGame(seed: number, tier: number) {
    const squads = [0, 1].map((side) =>
        autoSquad(SANDBOX_RULES, tier, 3, { seed: seed * 2 + side }).squad.map((loadout) => {
            const { stats, actions } = unitFromLoadout(loadout)!;
            return { stats, actions };
        }),
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

test("whole sandbox games at every tier: every order legal, every game won by a side", async () => {
    for (let tier = 0; tier <= 3; tier++) {
        for (let seed = 101; seed <= 106; seed++) {
            const game = await sandboxGame(seed, tier);
            assert.equal(game.status.kind, "finished", `tier ${tier} seed ${seed} ended`);
            if (game.status.kind === "finished") {
                const at = `tier ${tier} seed ${seed} turn ${game.turn}`;
                assert.equal(game.status.ending.kind, "won", at);
            }
        }
    }
});
