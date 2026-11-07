// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { Encounter } from "../../packages/engine/src/game.ts";
import { blackRain, type Scenario } from "../../packages/engine/src/scenario.ts";
import {
    blastCells,
    coverBonus,
    decodePath,
    earningsFor,
    encodePath,
    gameEvents,
    hitChance,
    isOver,
    lineOfSight,
    lineOfThrow,
    outcomeFor,
    rankWith,
    terrainAt,
    toCell,
    toTile,
    type Bounds,
    type FieldView,
} from "../src/chain/match-rules.ts";

const ORIGIN: Bounds = { minX: 0, minZ: 0 };
const { bounds } = blackRain.map;
const [UP, RIGHT, DOWN, LEFT] = [1, 2, 4, 8];

// Plain as they come out of BCS; only the fields the rules read.
const record = (kind: string, value: unknown = true) => ({ $kind: kind, [kind]: value }) as never;

/** Two operators a side on an open stretch of Black Rain, with the rules behind them. */
function fixture(side = 0) {
    const scenario: Scenario = {
        ...blackRain,
        versus: true,
        units: [
            { id: "a1", name: "A1", full: "A1", role: "ASSAULT", pos: [0, 2], color: "#fff" },
            { id: "a2", name: "A2", full: "A2", role: "ASSAULT", pos: [1, 2], color: "#fff" },
            {
                id: "b1",
                name: "B1",
                full: "B1",
                role: "ASSAULT",
                pos: [0, 0],
                color: "#000",
                enemy: true,
            },
            {
                id: "b2",
                name: "B2",
                full: "B2",
                role: "ASSAULT",
                pos: [4, 2],
                color: "#000",
                enemy: true,
            },
        ],
    };
    const rules = new Encounter(scenario);
    const field: FieldView = {
        bounds,
        side,
        unitAt: ([x, z]) =>
            rules.units.find((u) => u.hp > 0 && u.pos[0] === x && u.pos[1] === z)?.id,
        isCover: (cell) => rules.map.isCover(cell),
        coverAt: (cell) => rules.coverAt(cell),
        blast: () => [],
        weaponAt: () => "Plasma Rifle",
    };
    /** The events of some records, taken into the rules one by one, as the driver does. */
    const play = (records: never[]) => {
        const events = [];
        for (const event of gameEvents(records, field)) {
            rules.ingest(event);
            events.push(event);
        }
        return events;
    };
    return { rules, play };
}

const at = (cell: [number, number]) => toTile(cell, bounds);

test("a path reads the same on chain and in the scene", () => {
    // Bob's walk in `ghosts::test_full_game`, tile by tile
    const bytes = [6, 5, UP, UP, LEFT, LEFT, LEFT, LEFT, UP];
    const path = decodePath(bytes, ORIGIN);
    assert.deepEqual(path[0], [5, 6]);
    assert.deepEqual(path.at(-1), [1, 3]);
    assert.deepEqual(encodePath(path, ORIGIN), bytes);

    // and around a scene's center: a step east is a step right, south is down
    const around = encodePath(
        [
            [-2, -3],
            [-1, -3],
            [-1, -2],
        ],
        bounds,
    );
    assert.deepEqual(around, [...toTile([-2, -3], bounds), RIGHT, DOWN]);
    assert.deepEqual(toCell(toTile([-2, -3], bounds), bounds), [-2, -3]);
});

test("a move walks the unit, and the rules follow", () => {
    const { rules, play } = fixture();
    const [event] = play([record("Move", [...at([0, 2]), DOWN, RIGHT])]);

    assert.equal(event.type, "move");
    assert.equal(event.type === "move" && event.unit, "a1");
    assert.deepEqual(rules.unit("a1")!.pos, [1, 3]);
});

test("a shot reads hit, crit, dodge and kill off the records after it", () => {
    const attack = (from: [number, number], to: [number, number]) =>
        record("Attack", { origin: at(from), target: at(to) });

    const { rules, play } = fixture();
    const [miss, hit, crit, dodged] = play([
        attack([0, 2], [0, 0]),
        record("Miss"),
        attack([0, 2], [0, 0]),
        record("Damage", 3),
        attack([0, 2], [0, 0]),
        record("CriticalHit", 4),
        attack([0, 2], [0, 0]),
        record("Dodged"),
        record("Damage", 0),
    ]);

    assert.deepEqual(
        { type: miss.type, hit: miss.type === "shot" && miss.hit },
        { type: "shot", hit: false },
    );
    assert.equal(hit.type === "shot" && hit.damage, 3);
    assert.equal(crit.type === "shot" && crit.crit, true);
    assert.equal(crit.type === "shot" && crit.damage, 4);
    assert.equal(dodged.type === "shot" && dodged.hit, false);
    assert.equal(rules.unit("b1")!.hp, rules.unit("b1")!.maxHp - 7);

    const { rules: other, play: playOther } = fixture();
    const [kill] = playOther([
        attack([0, 2], [0, 0]),
        record("Damage", other.unit("b1")!.hp),
        record("UnitKIA", "b1"),
    ]);
    assert.equal(kill.type === "shot" && kill.killed, true);
    assert.equal(other.unit("b1")!.hp, 0);
    assert.equal(other.enemies.length, 1);
});

test("a blast names its casualties in the order the map visits them", () => {
    const { play } = fixture();
    // around (0, 1): a1 at (0, 2) is south of it, b1 at (0, 0) north, a2 at (1, 2) a diagonal
    const center = at([0, 1]);
    const [event] = play([
        record("Grenade", { origin: at([4, 2]), target: center }),
        record("Explosion", [center[0], center[1], 2]),
        record("Damage", 4), // the row above: b1
        record("Damage", 3), // the row below: a1
        record("Damage", 2), // the diagonal: a2
    ]);

    assert.equal(event.type, "grenade");
    assert.equal(event.type === "grenade" && event.unit, "b2");
    assert.deepEqual(event.type === "grenade" && event.casualties, [
        { unit: "b1", damage: 4, killed: false },
        { unit: "a1", damage: 3, killed: false },
        { unit: "a2", damage: 2, killed: false },
    ]);
});

test("the next turn reads from the player's side", () => {
    const first = fixture(0).play([record("NextTurn", 1), record("NextTurn", 2)]);
    assert.deepEqual(first, [{ type: "hostile-phase" }, { type: "turn", turn: 1 }]);

    const second = fixture(1).play([record("NextTurn", 1)]);
    assert.deepEqual(second, [{ type: "turn", turn: 0 }]);
});

test("records with nothing to show are skipped", () => {
    assert.deepEqual(fixture().play([record("RecruitPlaced", [0, 0])]), []);
});

const game = (overrides: object) =>
    ({
        map: { turn: 0 },
        players: ["a", "b"],
        squads: [["x"], ["y"]],
        fallen: [[], []],
        missed: [0, 0],
        kills: [{ contents: [] }, { contents: [] }],
        dropped: [],
        deploying: false,
        abandonedBy: null,
        ...overrides,
    }) as never;

test("a game ends on an empty squad, after deployment only, or at the last turn", () => {
    assert.equal(isOver(game({})), false);
    assert.equal(isOver(game({ squads: [[], ["y"]] })), true);
    assert.equal(isOver(game({ squads: [[], []], deploying: true })), false);
    assert.equal(isOver(game({ deploying: true, abandonedBy: "a" })), true);
    assert.equal(isOver(game({ map: { turn: 59 } })), false);
    assert.equal(isOver(game({ map: { turn: 60 } })), true);
});

test("how it ended, for each side", () => {
    const won = game({ squads: [["x"], []], fallen: [[], ["tag"]] });
    assert.equal(outcomeFor(won, 0), "victory");
    assert.equal(outcomeFor(won, 1), "defeat");

    const wiped = game({ squads: [[], []], fallen: [["tag"], ["tag"]] });
    assert.equal(outcomeFor(wiped, 0), "draw");

    assert.equal(outcomeFor(game({ map: { turn: 60 } }), 0), "stalemate");

    const left = game({ abandonedBy: "a" });
    assert.equal(outcomeFor(left, 0), "abandoned");
    assert.equal(outcomeFor(left, 1), "opponent-abandoned");
});

test("a side that never deployed is the one to blame, even when both didn't", () => {
    const skipped = game({ squads: [[], ["y"]] });
    assert.equal(outcomeFor(skipped, 0), "no-show");
    assert.equal(outcomeFor(skipped, 1), "opponent-no-show");

    const nobody = game({ squads: [[], []] });
    assert.equal(outcomeFor(nobody, 0), "no-show");
    assert.equal(outcomeFor(nobody, 1), "no-show");
});

test("a player who ran out of turns forfeited, one who left abandoned", () => {
    const gone = game({ abandonedBy: "a", missed: [3, 0] });
    assert.equal(outcomeFor(gone, 0), "forfeited");
    assert.equal(outcomeFor(gone, 1), "opponent-forfeited");

    const left = game({ abandonedBy: "a", missed: [2, 1] });
    assert.equal(outcomeFor(left, 0), "abandoned");
    assert.equal(outcomeFor(left, 1), "opponent-abandoned");
});

// Tiles by letter: `.` empty, `l` low cover on all sides, `h` high, `#` wall, `x` unwalkable.
const board = (...rows: string[]) => {
    const tile = (c: string) => {
        const cover = (level: number) => ({
            $kind: "Cover",
            Cover: { left: level, top: level, right: level, bottom: level },
        });
        if (c === "l") return cover(1);
        if (c === "h") return cover(2);
        return { $kind: c === "#" ? "Wall" : c === "x" ? "Unwalkable" : "Empty" };
    };
    const grid = rows.map((row) => [...row].map((c) => ({ tileType: tile(c), unit: null })));
    return { map: { turn: 0, grid: { grid, rows: grid.length, cols: grid[0].length } } } as never;
};

test("cover reads the side facing the shot, then the neighbor's on the way in", () => {
    // the same cases as `cover_bonus` in `ghosts::map`
    const low = board("l..", "...", "...");
    assert.equal(coverBonus(low, [2, 0], [0, 0]), 25);
    assert.equal(coverBonus(low, [0, 2], [0, 0]), 25);
    assert.equal(coverBonus(low, [2, 2], [0, 0]), 25);

    const high = board("h..", "...", "...");
    assert.equal(coverBonus(high, [2, 0], [0, 0]), 50);

    // the tile in front of the target covers it from this side, and not from behind
    const front = board(".", "l", ".");
    assert.equal(coverBonus(front, [2, 0], [0, 0]), 25);
    assert.equal(coverBonus(front, [0, 0], [2, 0]), 25);

    // a wall next to the target is high cover on that side
    assert.equal(coverBonus(board(".", "#", "."), [2, 0], [0, 0]), 50);
    assert.equal(coverBonus(board("...", "...", "..."), [2, 2], [0, 0]), 0);
});

test("the dominant axis alone decides which side counts", () => {
    // mostly along the columns: only the side facing them
    const beside = board("...", ".l.", "...");
    assert.equal(coverBonus(beside, [0, 0], [1, 1]), 25, "a true diagonal");
    assert.equal(coverBonus(board("....", ".l..", "...."), [0, 3], [1, 1]), 25);
});

test("walls stop shots and throws, high cover only shots, and only in the middle", () => {
    const walled = board(".#.");
    assert.equal(lineOfSight(walled, [0, 0], [0, 2]), false);
    assert.equal(lineOfThrow(walled, [0, 0], [0, 2]), false);

    const covered = board("..h..");
    assert.equal(lineOfSight(covered, [0, 0], [0, 4]), false);
    assert.equal(lineOfThrow(covered, [0, 0], [0, 4]), true);
    // cover next to either end is cover, not a wall
    assert.equal(lineOfSight(board(".h."), [0, 0], [0, 2]), true);

    const low = board("..l..");
    assert.equal(lineOfSight(low, [0, 0], [0, 4]), true);
    assert.equal(lineOfSight(board(".x."), [0, 0], [0, 2]), true);

    // a throw can't land on a wall
    assert.equal(lineOfThrow(board("..#"), [0, 0], [0, 2]), false);
});

test("a corner is clear if either way around it is", () => {
    assert.equal(lineOfSight(board(".#", ".."), [0, 0], [1, 1]), true);
    assert.equal(lineOfSight(board("..", "#."), [0, 0], [1, 1]), true);
    assert.equal(lineOfSight(board(".#", "#."), [0, 0], [1, 1]), false);
});

test("the ground reads as the contract treats it", () => {
    const ground = board(".lx#");
    assert.equal(terrainAt(ground, [0, 0]), "open");
    assert.equal(terrainAt(ground, [0, 1]), "cover");
    assert.equal(terrainAt(ground, [0, 2]), "blocked");
    assert.equal(terrainAt(ground, [0, 3]), "blocked");
    assert.equal(terrainAt(ground, [5, 5]), "blocked");
});

test("the odds are the contract's", () => {
    const rifle = { aim: 65, range: 4, areaSize: 0 };
    assert.equal(hitChance(rifle, 0, 4, 0), 65, "at range");
    assert.equal(hitChance(rifle, 0, 2, 0), 75, "a bonus for each tile closer");
    assert.equal(hitChance(rifle, 0, 6, 0), 45, "a penalty for each tile further");
    assert.equal(hitChance(rifle, 0, 8, 0), 0, "past the reach of the weapon");
    assert.equal(hitChance(rifle, 0, 4, 25), 40, "cover");
    assert.equal(hitChance(rifle, 10, 4, 25), 30, "natural defense counts too");
    assert.equal(hitChance(rifle, 50, 4, 50), 0, "never below zero");
    assert.equal(hitChance({ ...rifle, aim: 98 }, 0, 1, 0), 100, "never above a hundred");
    assert.equal(hitChance({ ...rifle, areaSize: 1 }, 10, 4, 50), 65, "area ignores both");
});

test("the blasts of a game, replayed in order, leave the scene as they did in play", () => {
    const { minX, maxX, minZ, maxZ } = bounds;
    const played = new Encounter(blackRain);
    const history: unknown[] = [];
    // grenades that do hit something, some of them on what an earlier one left
    let thrown = 0;
    for (let x = minX; x <= maxX && thrown < 6; x += 3) {
        for (let z = minZ; z <= maxZ && thrown < 6; z += 3) {
            const damage = played.map.blastProps([x, z]);
            if (!damage.length) continue;
            played.map.applyPropDamage(damage);
            history.push(record("Grenade"), record("Explosion", [...toTile([x, z], bounds), 2]));
            history.push(record("Damage", 3));
            thrown++;
        }
    }
    assert.ok(thrown > 0);

    const reopened = new Encounter(blackRain);
    const cells = blastCells({ history } as never, bounds);
    assert.equal(cells.length, thrown);
    for (const cell of cells) reopened.map.applyPropDamage(reopened.map.blastProps(cell));

    const state = (e: Encounter) => ({
        health: e.map.props.map((p) => e.map.health(p.id)),
        covers: e.map.covers,
    });
    assert.deepEqual(state(reopened), state(played));
    assert.notDeepEqual(state(reopened), state(new Encounter(blackRain)));
});

test("a weapon taken up reads as the unit standing there taking it", () => {
    const { play } = fixture();
    const [event] = play([record("PickUp", at([0, 2]))]);
    assert.deepEqual(event, { type: "pick-up", unit: "a1", weapon: "Plasma Rifle" });
});

test("what a game pays, as the contract works it out", () => {
    const kills = (n: number) => [
        { contents: n ? [{ key: "x", value: n }] : [] },
        { contents: [] },
    ];
    const earned = (overrides: object, side: number) => {
        const { credits, xpOf } = earningsFor(game(overrides), side);
        return [credits, xpOf("x")];
    };

    // a fight to the end, for the winner and the loser
    const won = { squads: [["x"], []], fallen: [[], ["tag"]], kills: kills(1), map: { turn: 8 } };
    assert.deepEqual(earned(won, 0), [120, 4]);
    assert.deepEqual(earned(won, 1), [40, 1]);

    // a draw at the last turn, and when both sides went down
    assert.deepEqual(earned({ map: { turn: 60 } }, 0), [60, 1]);
    const wiped = { squads: [[], []], fallen: [["tag"], ["tag"]], map: { turn: 8 } };
    assert.deepEqual(earned(wiped, 0), [60, 1]);

    // walking out: nothing for the one who left, a little for the one left behind
    const left = { abandonedBy: "a", map: { turn: 8 } };
    assert.deepEqual(earned(left, 0), [0, 0]);
    assert.deepEqual(earned(left, 1), [40, 1]);
    assert.deepEqual(earned({ abandonedBy: "a", map: { turn: 1 } }, 1), [0, 0]);

    // a no-show pays nobody
    const absent = { squads: [["x"], []], map: { turn: 0 } };
    assert.deepEqual(earned(absent, 0), [0, 0]);
    assert.deepEqual(earned(absent, 1), [0, 0]);
});

test("experience reaches the same ranks as the contract", () => {
    assert.equal(rankWith("Rookie", 2), "Rookie");
    assert.equal(rankWith("Rookie", 3), "Squaddie");
    assert.equal(rankWith("Rookie", 8), "Corporal");
    assert.equal(rankWith("Corporal", 26), "Lieutenant");
    assert.equal(rankWith("Major", 1000), "Colonel");
    assert.equal(rankWith("Colonel", 1000), "Colonel");
});
