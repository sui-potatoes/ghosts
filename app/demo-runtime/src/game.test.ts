import { test } from "node:test";
import assert from "node:assert/strict";
import { Encounter, covers, distance, key, type Cell } from "./game.ts";

test("movement costs one AP and cannot end inside a barrier or on an occupied tile", () => {
  const g = new Encounter(),
    u = g.allies[0];
  const start = [...u.pos];
  assert.equal(g.move(u, covers[0]), null);
  assert.deepEqual(u.pos, start);
  assert.equal(g.move(u, g.allies[1].pos), null);
  assert.ok(g.move(u, [-3, 3]));
  assert.equal(u.ap, 1);
  assert.deepEqual(u.pos, [-3, 3]);
});
test("vault paths can cross low barriers without ending on them", () => {
  const g = new Encounter(),
    u = g.allies[0];
  u.pos = [-3, 3];
  const paths = g.paths(u);
  const path = paths.get("-3,1");
  assert.ok(path);
  assert.ok(path.some((p) => key(p) === "-3,2"));
  assert.equal(path.length - 1, 2);
  assert.equal(paths.has("-3,2"), false);
});
test("all reachable paths stay in mobility budget and land on walkable tiles", () => {
  const g = new Encounter();
  for (const u of g.allies)
    for (const path of g.paths(u).values()) {
      assert.ok(path.length - 1 <= u.mobility);
      assert.ok(g.walkable(path.at(-1)!, u));
    }
});
test("rifle attacks consume remaining AP and one round; dead targets reject shots", () => {
  const g = new Encounter(),
    a = g.allies[0],
    b = g.enemies[0];
  a.pos = [1, -2];
  const result = g.attack(a, b);
  assert.ok(result);
  assert.equal(a.ap, 0);
  assert.equal(a.ammo, 2);
  assert.equal(g.attack(a, b), null);
  a.ap = 2;
  b.hp = 0;
  assert.equal(g.attack(a, b), null);
});
test("pistols cost one AP and switching guns preserves separate magazines", () => {
  const g = new Encounter(),
    a = g.allies[0],
    b = g.enemies[0];
  a.pos = [1, -2];
  g.switchWeapon(a, "pistol");
  assert.equal(a.ammo, 6);
  g.attack(a, b);
  assert.equal(a.ap, 1);
  assert.equal(a.ammo, 5);
  g.switchWeapon(a, "sniper");
  assert.equal(a.ammo, 3);
  g.switchWeapon(a, "pistol");
  assert.equal(a.ammo, 5);
  assert.ok(g.reload(a));
  assert.equal(a.ammo, 6);
  assert.equal(a.ap, 0);
});
test("reload rejects full magazine, wrong phase, and zero AP", () => {
  const g = new Encounter(),
    u = g.allies[0];
  assert.equal(g.reload(u), false);
  u.ammo = 1;
  g.beginEnemy();
  assert.equal(g.reload(u), false);
  g.nextTurn();
  u.ap = 0;
  assert.equal(g.reload(u), false);
  u.ap = 2;
  assert.equal(g.reload(u), true);
  assert.equal(u.ap, 1);
});
test("range and directional cover change shot chance", () => {
  const g = new Encounter(),
    a = g.allies[0],
    b = g.enemies[0];
  a.pos = [-3, 5];
  b.pos = [-3, 1];
  assert.equal(g.cover(b, a), 25);
  const covered = g.chance(a, b);
  g.hunker(b);
  b.hunkered = true;
  assert.equal(g.chance(a, b), covered - 25);
  b.pos = [8, -7];
  assert.equal(g.chance(a, b), 0);
  assert.equal(g.attack(a, b), null);
});
test("grenade has bounded range, one use, armor mitigation, and friendly fire", () => {
  const g = new Encounter(),
    u = g.allies[0],
    ally = g.allies[1],
    enemy = g.enemies[0];
  u.pos = [0, 0];
  ally.pos = [1, 0];
  enemy.pos = [2, 0];
  assert.equal(g.throwGrenade(u, [8, 0]), false);
  assert.equal(u.ap, 2);
  assert.equal(g.throwGrenade(u, [1, 0]), true);
  assert.equal(u.ap, 1);
  assert.equal(ally.hp, 7);
  assert.equal(enemy.hp, 4);
  assert.equal(g.throwGrenade(u, [1, 0]), false);
});
test("hunker and overwatch spend AP and reset next round", () => {
  const g = new Encounter(),
    u = g.allies[0];
  assert.ok(g.hunker(u));
  assert.equal(u.ap, 0);
  assert.equal(u.hunkered, true);
  g.beginEnemy();
  g.nextTurn();
  assert.equal(u.hunkered, false);
  assert.equal(u.ap, 2);
  assert.ok(g.watch(u));
  assert.equal(u.overwatch, true);
  assert.equal(u.ap, 0);
  g.nextTurn();
  assert.equal(u.overwatch, false);
});
test("mission requires both core extraction and hostile elimination", () => {
  const g = new Encounter(),
    u = g.allies[0];
  assert.equal(g.secure(u), false);
  for (const e of g.enemies) e.hp = 0;
  assert.equal(g.result, null);
  u.pos = [0, -1];
  assert.equal(g.secure(u), true);
  assert.equal(g.result, "victory");
  assert.equal(g.move(u, [1, -1]), null);
});
test("no living allies ends the encounter in defeat", () => {
  const g = new Encounter();
  g.allies.forEach((u) => (u.hp = 0));
  assert.equal(g.result, "defeat");
});

import {
  bestShotTarget,
  shotBlockReason,
  grenadeBlockReason,
  defaultGrenadeTarget,
} from "./targeting.ts";
test("opening fire defaults to a shootable hostile instead of the first out-of-range enemy", () => {
  const g = new Encounter(),
    u = g.allies[0],
    target = bestShotTarget(g, u)!;
  assert.equal(target.id, "h3");
  assert.equal(shotBlockReason(g, u, target), null);
  assert.ok(g.attack(u, target));
  assert.equal(u.ammo, 2);
});
test("all three weapons can execute their selected target and retain independent magazines", () => {
  for (const weapon of ["rifle", "sniper", "pistol"] as const) {
    const g = new Encounter(),
      u = g.allies[0];
    g.switchWeapon(u, weapon);
    const target = bestShotTarget(g, u)!;
    assert.equal(shotBlockReason(g, u, target), null);
    const before = u.ammo;
    assert.ok(g.attack(u, target));
    assert.equal(u.ammo, before - 1);
  }
});
test("default grenade is reachable and avoids friendly blast damage at deployment", () => {
  const g = new Encounter(),
    u = g.allies[0],
    p = defaultGrenadeTarget(g, u);
  assert.equal(grenadeBlockReason(g, u, p), null);
  assert.ok(g.allies.every((a) => distance(a.pos, p) > 2));
  assert.ok(g.throwGrenade(u, p));
  assert.equal(u.ap, 1);
  assert.equal(u.grenade, true);
  assert.equal(grenadeBlockReason(g, u, p), "Grenade already used");
});
test("grenade targeting rejects both off-map and out-of-range tiles", () => {
  const g = new Encounter(),
    u = g.allies[0];
  assert.equal(
    grenadeBlockReason(g, u, [99, 99]),
    "Target is outside the district",
  );
  assert.match(grenadeBlockReason(g, u, g.enemies[0].pos)!, /throw range/);
});
