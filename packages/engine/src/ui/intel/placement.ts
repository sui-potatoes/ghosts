// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** A screen rectangle in CSS pixels, origin top left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "right" | "left" | "above" | "below";

export interface Placement {
  x: number;
  y: number;
  side: Side;
  /** The leader line, from the unit's box to the card's near edge. */
  leader: [x1: number, y1: number, x2: number, y2: number];
}

/** Room between the unit's box and the card, where the leader line runs. */
export const GAP = 28;
/** Space kept clear along the viewport's edges. */
export const MARGIN = 12;

const ORDER: Side[] = ["right", "left", "above", "below"];

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The card on `side` of `anchor`, centred on it along the other axis, kept inside `view`. */
function candidate(side: Side, anchor: Rect, card: { w: number; h: number }, view: { w: number; h: number }): Rect {
  const cx = anchor.x + anchor.w / 2;
  // Beside the unit the card centres on its upper body, where the eye is.
  const cy = anchor.y + anchor.h * 0.38;
  const fitX = (x: number) => clamp(x, MARGIN, view.w - MARGIN - card.w);
  const fitY = (y: number) => clamp(y, MARGIN, view.h - MARGIN - card.h);
  switch (side) {
    case "right":
      return { x: anchor.x + anchor.w + GAP, y: fitY(cy - card.h / 2), ...card };
    case "left":
      return { x: anchor.x - GAP - card.w, y: fitY(cy - card.h / 2), ...card };
    case "above":
      return { x: fitX(cx - card.w / 2), y: anchor.y - GAP - card.h, ...card };
    case "below":
      return { x: fitX(cx - card.w / 2), y: anchor.y + anchor.h + GAP, ...card };
  }
}

/** How far a rectangle sticks out of the viewport's safe area, in px². */
function outside(r: Rect, view: { w: number; h: number }) {
  const safe = { x: MARGIN, y: MARGIN, w: view.w - 2 * MARGIN, h: view.h - 2 * MARGIN };
  return r.w * r.h - overlap(r, safe);
}

/**
 * Where the readout goes: beside the unit it describes, never over that unit
 * or any rectangle in `avoid` (the player's selected unit, the HUD's chrome),
 * inside the viewport, and off the other units (`soft`) where it can be.
 * Right of the unit by default, flipping left near the right edge, above or
 * below when neither side has room. `prefer` keeps the side used last unless
 * another is clearly better, so a moving unit does not make the card jump.
 */
export function placeCard(
  anchor: Rect,
  card: { w: number; h: number },
  view: { w: number; h: number },
  avoid: readonly Rect[] = [],
  prefer?: Side,
  soft: readonly Rect[] = [],
): Placement {
  const scored = ORDER.map((side) => {
    const rect = candidate(side, anchor, card, view);
    // Covering the described unit is worst, the selected one and the HUD next, leaving the
    // screen as bad, another unit least. Whole pixels: float noise never counts.
    const cost = Math.round(
      overlap(rect, anchor) * 4 +
        avoid.reduce((sum, r) => sum + overlap(rect, r) * 2, 0) +
        outside(rect, view) * 2 +
        soft.reduce((sum, r) => sum + overlap(rect, r), 0),
    );
    return { rect, side, cost };
  });
  let best = scored[0];
  for (const s of scored) if (s.cost < best.cost) best = s;
  // Stay on the side used last while it is nearly as good: no flicker from small moves.
  const kept = prefer && scored.find((s) => s.side === prefer);
  if (kept && kept.cost <= best.cost + STICKY * card.w * card.h * 0.01) best = kept;
  const { rect, side } = best;
  return { x: rect.x, y: rect.y, side, leader: leaderLine(anchor, rect, side) };
}

/** How much worse (in percent of the card's area covered) the last side may be before the card moves. */
const STICKY = 6;

/** From the unit's box edge facing the card to the card's facing edge, at the card's level. */
function leaderLine(anchor: Rect, card: Rect, side: Side): Placement["leader"] {
  if (side === "right" || side === "left") {
    const y = clamp(anchor.y + anchor.h * 0.38, card.y + 10, card.y + card.h - 10);
    const from = side === "right" ? anchor.x + anchor.w : anchor.x;
    const to = side === "right" ? card.x : card.x + card.w;
    return [from, anchor.y + anchor.h * 0.38, to, y];
  }
  const x = clamp(anchor.x + anchor.w / 2, card.x + 10, card.x + card.w - 10);
  const from = side === "above" ? anchor.y : anchor.y + anchor.h;
  const to = side === "above" ? card.y + card.h : card.y;
  return [anchor.x + anchor.w / 2, from, x, to];
}

export const rectsOverlap = (a: Rect, b: Rect) => overlap(a, b) > 0;
