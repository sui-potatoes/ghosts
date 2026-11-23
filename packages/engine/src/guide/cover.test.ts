// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The simulation's cover reading against the rules (`ChainGround`), and the chapter bookkeeping. */
import assert from "node:assert/strict";
import test from "node:test";
import { ChainGround } from "../chain-ground.ts";
import type { GameEvent } from "../events.ts";
import type { Cell } from "../map.ts";
import { coverPieces, coverRelation, groundAfter, tileAt } from "./cover.ts";
import { allDone, nextChapter, openingChapter, withChapter } from "./chapters.ts";
import { stageScenario } from "./basics/scenario.ts";
import { TILES } from "./basics/script.ts";

/** Every stage's grid, one after another: the pieces the run uses. */
const grounds = (["contact", "cover", "grenade", "squad"] as const).map((id) => stageScenario(id).ground!);
const ground = grounds[0];

/** Every standable cell of the simulation level. */
function cells(g: ChainGround): Cell[] {
  const out: Cell[] = [];
  g.tiles.forEach((row, r) =>
    row.forEach((tile, c) => {
      if (tile.t === "empty" || tile.t === "cover") out.push([c + ground.minX, r + ground.minZ]);
    }),
  );
  return out;
}

test("the cover a relation names is the rules' cover_bonus, for every pair of standing cells", () => {
  let covered = 0;
  for (const ground of grounds) {
    const g = new ChainGround(ground);
    const all = cells(g);
    for (const from of all)
      for (const at of all) {
        const relation = coverRelation(g, from, at);
        assert.equal(relation.value, g.cover(from, at), `${from} → ${at}`);
        assert.equal(!!relation.edge, relation.value > 0);
        if (relation.value) covered++;
      }
  }
  assert.ok(covered > 100, "the stages have cover to read");
});

test("the edge a relation names is a side that really carries that cover", () => {
  for (const ground of grounds) {
    const g = new ChainGround(ground);
    for (const from of cells(g))
      for (const at of cells(g)) {
        const { value, edge } = coverRelation(g, from, at);
        if (!edge) continue;
        const tile = tileAt(g, edge.cell)!;
        const level = tile.t === "cover" ? tile.sides[["left", "top", "right", "bottom"].indexOf(edge.side)] : tile.t === "wall" ? 2 : 1;
        assert.equal(level * 25, value);
      }
  }
});

test("pieces are read by what they are; a grenade clears the cover and obstacles in reach, never a wall", () => {
  const kinds = new Set(
    grounds.flatMap((gr) => coverPieces(new ChainGround(gr), gr.minX, gr.minZ)).map((p) => (p.kind === "edge" ? `edge${p.level}` : p.kind)),
  );
  assert.deepEqual([...kinds].sort(), ["edge1", "edge2", "obstacle", "wall"]);
  const box = grounds[2];
  const pieces = coverPieces(new ChainGround(box), box.minX, box.minZ);
  const blast: GameEvent = { type: "grenade", unit: "v", at: TILES.grenade.target, casualties: [] };
  const after = groundAfter(box, [blast]);
  for (const c of TILES.grenade.boxes) assert.equal(tileAt(after, c)?.t, "empty", "the crates boxing the target in are gone");
  assert.equal(coverPieces(after, box.minX, box.minZ).length < pieces.length, true);
  const wall = pieces.find((p) => p.kind === "wall")!;
  const wallBlast: GameEvent = { type: "grenade", unit: "v", at: [wall.cell[0] + 1, wall.cell[1]], casualties: [] };
  assert.equal(tileAt(groundAfter(box, [wallBlast]), wall.cell)?.t, "wall", "walls never break");
});

test("chapters: open the asked one or the first not done; done only when all are", () => {
  const chapters = ["A", "B", "C"].map((id) => ({ id, title: id }));
  assert.equal(openingChapter(chapters, []), "A");
  assert.equal(openingChapter(chapters, ["A"]), "B");
  assert.equal(openingChapter(chapters, ["A", "B", "C"]), "A");
  assert.equal(openingChapter(chapters, ["A"], "C"), "C");
  assert.equal(openingChapter(chapters, ["A"], "Z"), "B");
  assert.equal(nextChapter(chapters, "A"), "B");
  assert.equal(nextChapter(chapters, "C"), null);
  assert.deepEqual(withChapter(chapters, ["C"], "A"), ["A", "C"]);
  assert.deepEqual(withChapter(chapters, ["A"], "A"), ["A"]);
  assert.ok(!allDone(chapters, ["A", "C"]));
  assert.ok(allDone(chapters, ["C", "B", "A"]));
});
