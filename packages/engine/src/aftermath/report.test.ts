import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter } from "../game.ts";
import { encounterReport } from "./report.ts";

test("direct fire and overwatch credit one hostile kill, never repeat a dead target", () => {
    const g = new Encounter(),
        a = g.allies[0],
        b = g.enemies[0];
    a.pos = [1, -2];
    a.aim = 100;
    b.hp = 1;
    g.random = () => 0;
    assert.ok(g.attack(a, b)?.hit);
    assert.equal(g.kills[a.id], 1);
    a.ap = 2;
    assert.equal(g.attack(a, b), null);
    assert.equal(g.kills[a.id], 1);
    // Overwatch uses the same attack path during the temporary player phase.
    const c = g.enemies[0];
    c.pos = [2, -3];
    c.hp = 1;
    a.overwatch = true;
    assert.ok(g.attack(a, c)?.hit);
    assert.equal(g.kills[a.id], 2);
});

test("grenade credits multiple hostile casualties but never friendly fire or existing bodies", () => {
    const g = new Encounter(),
        a = g.allies[0];
    a.pos = [0, 0];
    for (const u of g.enemies) {
        u.pos = [1, 0];
        u.hp = 1;
    }
    g.allies[1].pos = [1, 0];
    g.allies[1].hp = 1;
    g.enemies[2].hp = 0;
    assert.equal(g.throwGrenade(a, [1, 0]), true);
    assert.equal(g.kills[a.id], 2);
    assert.equal(g.throwGrenade(a, [1, 0]), false);
    assert.equal(g.kills[a.id], 2);
});

test("misses and nonlethal damage award no kills", () => {
    const g = new Encounter(),
        a = g.allies[0],
        b = g.enemies[0];
    a.pos = [1, -2];
    a.aim = 0;
    g.random = () => 0.99;
    g.attack(a, b);
    assert.deepEqual(g.kills, {});
    a.ap = 2;
    a.aim = 100;
    g.random = () => 0.5;
    g.attack(a, b);
    assert.ok(b.hp > 0);
    assert.deepEqual(g.kills, {});
});

test("report carries actual identity, wraps multi-level XP and excludes KIA from celebrations", () => {
    const g = new Encounter();
    g.kills = { v: 1, g: 2, e: 1 };
    g.units.find((u) => u.id === "e")!.hp = 0;
    g.allies[0].full = "<Mara & Vale>";
    g.secured = true;
    for (const u of g.enemies) u.hp = 0;
    const before = JSON.stringify(g);
    const report = encounterReport(g);
    assert.equal(report.recruits.length, 4);
    assert.equal(report.survivors, 3);
    assert.equal(report.victory, true);
    assert.deepEqual(
        report.recruits.map((r) => [r.xp, r.level, r.progress]),
        [
            [140, 2, 40],
            [240, 3, 40],
            [40, 1, 40],
            [0, 1, 0],
        ],
    );
    assert.equal(report.recruits[0].full, "<Mara & Vale>");
    assert.equal(report.recruits[3].kills, 1);
    assert.equal(report.recruits[3].kia, true);
    assert.equal(JSON.stringify(g), before);
    assert.deepEqual(encounterReport(g), report);
});

test("defeat preserves the entire fallen roster; a new playtest has no prior XP or kills", () => {
    const g = new Encounter();
    for (const u of g.allies) u.hp = 0;
    const r = encounterReport(g);
    assert.equal(r.victory, false);
    assert.equal(r.survivors, 0);
    assert.ok(r.recruits.every((u) => u.kia && u.xp === 0 && u.level === 1));
    assert.deepEqual(new Encounter().kills, {});
});
