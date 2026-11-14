// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { MARGIN, placeCard, rectsOverlap, type Rect } from "./placement.ts";

const view = { w: 1280, h: 720 };
const card = { w: 230, h: 200 };
const unit = (x: number, y: number): Rect => ({ x, y, w: 40, h: 96 });
const cardRect = (p: { x: number; y: number }): Rect => ({ ...p, ...card });
const inside = (r: Rect) => r.x >= MARGIN - 0.5 && r.y >= MARGIN - 0.5 && r.x + r.w <= view.w - MARGIN + 0.5 && r.y + r.h <= view.h - MARGIN + 0.5;

test("the card sits right of the unit by default, inside the view, never over the unit", () => {
  const anchor = unit(500, 300);
  const p = placeCard(anchor, card, view);
  assert.equal(p.side, "right");
  assert.ok(inside(cardRect(p)));
  assert.ok(!rectsOverlap(cardRect(p), anchor));
});

test("near the right edge it flips left; near the left edge it stays right", () => {
  const right = placeCard(unit(1180, 300), card, view);
  assert.equal(right.side, "left");
  assert.ok(inside(cardRect(right)));
  const left = placeCard(unit(20, 300), card, view);
  assert.equal(left.side, "right");
});

test("hemmed in on both sides it goes above or below, still clear of the unit", () => {
  const narrow = { w: 420, h: 900 };
  const anchor = { x: 190, y: 400, w: 40, h: 96 };
  const p = placeCard(anchor, card, narrow);
  assert.ok(p.side === "above" || p.side === "below");
  assert.ok(!rectsOverlap(cardRect(p), anchor));
});

test("at the top and bottom edges the card is held inside the view", () => {
  for (const y of [0, 640]) {
    const p = placeCard(unit(500, y), card, view);
    assert.ok(inside(cardRect(p)), `unit at y=${y}`);
  }
});

test("it never covers the player's selected unit when there is another place", () => {
  const anchor = unit(500, 300);
  const selected = { x: 580, y: 260, w: 40, h: 96 };
  const p = placeCard(anchor, card, view, [selected]);
  assert.ok(!rectsOverlap(cardRect(p), selected));
  assert.ok(!rectsOverlap(cardRect(p), anchor));
  assert.equal(p.side, "left");
});

test("the side used last is kept while it still works", () => {
  const anchor = unit(500, 300);
  assert.equal(placeCard(anchor, card, view, [], "left").side, "left");
  // ...but not when it would leave the view.
  assert.equal(placeCard(unit(60, 300), card, view, [], "left").side, "right");
});

test("the leader line runs from the unit's box to the card's facing edge", () => {
  const anchor = unit(500, 300);
  const p = placeCard(anchor, card, view);
  const [x1, , x2] = p.leader;
  assert.equal(x1, anchor.x + anchor.w);
  assert.equal(x2, p.x);
});

test("fractional positions (projected units) do not push the card off its first choice", () => {
  const p = placeCard({ x: 331.3717874664306, y: 198.92719371317258, w: 30, h: 46 }, { w: 214, h: 206 }, { w: 844, h: 390 });
  assert.equal(p.side, "right");
});

test("it keeps off other units where it can, and does not jump sides for a small gain", () => {
  const anchor = unit(500, 300);
  const other = { x: 580, y: 280, w: 40, h: 96 };
  assert.equal(placeCard(anchor, card, view, [], undefined, [other]).side, "left");
  // A sliver of another unit under the card is not worth a flip.
  const sliver = { x: 755, y: 300, w: 40, h: 20 };
  assert.equal(placeCard(anchor, card, view, [], "right", [sliver]).side, "right");
});
