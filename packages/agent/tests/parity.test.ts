// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The sandbox against Move. `fixtures.ts` holds the `Game` after each step of a scripted match
 * Move played (`gameScript0` to `gameScript10`, from `fixtures-printer.move.txt`): both
 * grenades, a refresh, expiries and a kill of an affected unit. The sandbox plays the same
 * script from the same units, and has to end up with the same records and the same units.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeGame } from "../src/bcs.ts";
import type { Backend } from "../src/backend.ts";
import { parseAction, replayEffects } from "../src/rules.ts";
import { createSandbox, type SquadUnit } from "../src/sandbox.ts";
import type { GameRecord, GameState, Unit } from "../src/types.ts";
import { FIXTURES } from "./fixtures.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

type Step = `gameScript${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;
const move = (step: number) => decodeGame(bytes(FIXTURES[`gameScript${step}` as Step]), "1");

/** Spawn positions as the Move printer lists them: each side's squad takes them from the back. */
const POSITIONS: [number, number][] = [
    [2, 6],
    [2, 5],
    [2, 4],
    [2, 1],
    [7, 7],
    [5, 5],
    [6, 3],
    [6, 1],
];

/** Records with the recruit of a kill left out: its id is the chain's, the sandbox makes its own. */
const anonymous = (records: GameRecord[]) =>
    records.map((r) => (r.kind === "kia" ? { ...r, recruit: "fallen" } : r));

/** What a view of a game keeps: everything the two must agree on, with ids and clocks left out. */
function view(state: GameState) {
    const key = (unit: Unit) => unit.x * state.cols + unit.y;
    return {
        turn: state.turn,
        active: state.active,
        status: state.status.kind,
        missed: state.missed,
        fallen: state.fallen.length,
        tiles: state.tiles,
        units: [...state.units].sort((a, b) => key(a) - key(b)).map(({ recruit, owner, ...u }) => u),
        history: anonymous(state.history),
    };
}

/** The sandbox, set up as the Move script was: the same units on the same tiles, Bob's moves scripted. */
async function sandbox(bob: string[][]) {
    const start = move(0);
    // each side's squad in the order its positions are used, from the back
    const squad = (side: number): SquadUnit[] =>
        POSITIONS.slice(side * 4, side * 4 + 4)
            .reverse()
            .map(([x, y]) => {
                const unit = start.units.find((u) => u.x === x && u.y === y)!;
                assert.equal(unit.side, side);
                return { stats: unit.stats, actions: unit.actions };
            });
    const turns = [...bob];
    const backend: Backend = createSandbox({
        seated: true,
        squads: [squad(0), squad(1)],
        positions: POSITIONS,
        tiles: start.tiles,
        now: () => 1000,
        opponent: () => turns.shift() ?? ["next_turn"],
    });
    await backend.createAccount();
    await backend.hireSquad();
    await backend.findGame();
    await backend.acceptSeat();
    const account = (await backend.account())!;
    assert.equal(account.search.kind, "playing");
    const id = account.search.kind === "playing" ? account.search.game : "";
    return {
        play: async (...ids: string[]) => {
            const game = (await backend.game(id))!;
            const receipt = await backend.submit(game, ids.map(parseAction));
            return { receipt, game: (await backend.game(id))! };
        },
    };
}

const BOB_TURNS = [["smoke_grenade:6,1:4,1", "flashbang:6,3:5,4", "next_turn"], ["next_turn"]];

test("the sandbox plays Move's scripted match to the same records and the same units", async () => {
    const { play } = await sandbox(BOB_TURNS);
    const delta = (from: number, to: number) => move(to).history.slice(move(from).history.length);

    // deploying: Bob first, as the opponent does, then Alice
    let { game } = await play("deploy");
    assert.deepEqual(view(game), view(move(0)));

    // Alice's smoke thrown at (3, 2) reaches only her own smoker
    let result = await play("smoke_grenade:2,1:3,2");
    assert.deepEqual(result.receipt.records, delta(0, 1));
    assert.deepEqual(view(result.game), view(move(1)));

    // she ends her turn, and Bob's script runs: smoke refreshing Alice's, a flashbang, his end
    result = await play("next_turn");
    assert.deepEqual(view(result.game), view(move(5)));
    assert.deepEqual(
        anonymous(result.game.history.slice(move(1).history.length)),
        anonymous(delta(1, 5)),
        "the records of the turn change, then of Bob's two throws and his turn change",
    );

    // three frags at the dazed recruit on (5, 5): the third kills it, daze and all
    result = await play("grenade:2,4:5,5");
    assert.deepEqual(anonymous(result.receipt.records), anonymous(delta(5, 6)));
    assert.deepEqual(view(result.game), view(move(6)));
    result = await play("grenade:2,5:5,5");
    assert.deepEqual(view(result.game), view(move(7)));
    result = await play("grenade:2,6:5,5");
    assert.deepEqual(anonymous(result.receipt.records), anonymous(delta(7, 8)));
    assert.deepEqual(view(result.game), view(move(8)));
    assert.equal(result.game.fallen.length, 1);

    // her turn change runs the rest of the effects out; Bob's ends too
    result = await play("next_turn");
    assert.deepEqual(view(result.game), view(move(10)));
    assert.equal(result.game.history.length, move(10).history.length);
});

test("a client rebuilds every unit's effects from the history alone, at every step", async () => {
    for (let step = 0; step <= 10; step++) {
        const state = move(step);
        const rebuilt = replayEffects(state.history)
            .map(({ x, y, effects }) => ({ x, y, effects }))
            .sort((a, b) => a.x - b.x || a.y - b.y);
        const carried = state.units
            .filter((unit) => unit.effects.length > 0)
            .map(({ x, y, effects }) => ({ x, y, effects }));
        // a unit that fell in the step still has its effects in `Map.fallen`, which the history
        // ends with `UnitKIA`: only units on the map are compared
        assert.deepEqual(rebuilt, carried, `after step ${step}`);
    }
});
