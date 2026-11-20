// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { SceneClock } from "./clock";

/**
 * Shot results over the target in the 3D scene: MISS, CRIT, and the damage as
 * a number; and RELOADED over a unit whose magazine is full again. A callout is a DOM node in the plates' layer, projected over the
 * target every frame, popped in, risen and faded out on the scene clock, so it
 * follows the replay's speed, holds while it is paused and is cleared by a seek.
 *
 * No three.js here: the rules of a callout (what each outcome says, how
 * simultaneous ones stack, how long one lives) are tested in node.
 */

export type CalloutKind = "miss" | "hit" | "crit" | "reload";

/**
 * Whether the damage is shown: "−3" on a hit, "CRIT −8" on a critical. Set to
 * false and only MISS and CRIT are called out (an ordinary hit shows nothing).
 */
export const SHOW_DAMAGE = true;

/** Scene seconds a callout lives, from its pop to its last fade. */
export const CALLOUT_SECONDS = 1.1;
/** Scene seconds each stacked callout on the same target waits after the one under it. */
export const CALLOUT_STAGGER = 0.12;
/** Pixels a callout rises over its life. */
export const CALLOUT_RISE = 28;
/** Pixels between stacked callouts on one target, and how far each shifts sideways. */
export const CALLOUT_LINE = 24;
export const CALLOUT_SHIFT = 12;
/** Metres over the unit's feet the callout is anchored at: about the chest. */
export const CALLOUT_HEIGHT = 1.3;
/** Pixels to the right of the anchor: beside the body, clear of the plate that sits over the head. */
export const CALLOUT_SIDE = 38;

export interface Callout {
  kind: CalloutKind;
  text: string;
}

/** The slice of a shot (or one grenade casualty) a callout is made from. */
export interface ShotResult {
  hit: boolean;
  crit?: boolean;
  damage: number;
}

/** What a result says over the target; null when nothing is shown for it. */
export function calloutFor(result: ShotResult, showDamage = SHOW_DAMAGE): Callout | null {
  if (!result.hit) return { kind: "miss", text: "MISS" };
  const damage = `−${result.damage}`;
  if (result.crit) return { kind: "crit", text: showDamage ? `CRIT ${damage}` : "CRIT" };
  return showDamage ? { kind: "hit", text: damage } : null;
}

/** What a finished reload says over the unit that reloaded. */
export function reloadCallout(): Callout {
  return { kind: "reload", text: "RELOADED" };
}

/** Where the `slot`-th simultaneous callout on a target stands, relative to the first: up, and alternately aside. */
export function stackOffset(slot: number): { x: number; y: number } {
  return { x: (slot % 2) * CALLOUT_SHIFT, y: slot * -CALLOUT_LINE + 0 };
}

/** The curve of a callout at progress `t` (0..1 of its life): scale, rise in pixels and opacity. */
export function calloutLook(t: number, reduced: boolean): { scale: number; rise: number; opacity: number } {
  const opacity = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
  if (reduced) return { scale: 1, rise: 0, opacity };
  const pop = t < 0.14 ? t / 0.14 : 1;
  // Overshoot a little, then settle.
  const scale = t < 0.14 ? 0.55 + 0.6 * pop : t < 0.3 ? 1.15 - 0.15 * ((t - 0.14) / 0.16) : 1;
  const rise = CALLOUT_RISE * (1 - (1 - t) * (1 - t));
  return { scale, rise, opacity };
}

/** The part of a DOM node a callout touches: a `div` is one. */
export interface CalloutNode {
  className: string;
  textContent: string | null;
  dataset: Record<string, string | undefined>;
  style: { transform: string; opacity: string; display: string };
  remove(): void;
}

export interface CalloutHost {
  create(): CalloutNode;
  append(node: CalloutNode): void;
}

/** Where a world point lands on screen, in pixels from the field's corner; `visible` false when behind the camera or off it. */
export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

export type Projector = (anchor: Anchor, lift: number, out: Projected) => void;

/** A point in the world that may move (a rig's root): read each frame. */
export interface Anchor {
  x: number;
  y: number;
  z: number;
}

interface Live {
  target: string;
  anchor: Anchor;
  node: CalloutNode;
  slot: number;
  /** Scene seconds lived; negative while it waits its turn in a stack. */
  age: number;
  reduced: boolean;
  dead: boolean;
  /** Half the node's width in pixels, for keeping it inside the field. */
  half: number;
  last: string;
}

/** Pixels a character of the mono face takes at the callout's size, tracking included. */
const CHAR = 9;
const PAD = 14;

export class Callouts {
  private live: Live[] = [];
  private readonly out: Projected = { x: 0, y: 0, visible: false };

  private readonly host: CalloutHost;
  private readonly clock: SceneClock;
  private readonly reduced: () => boolean;
  private readonly wake: () => void;

  constructor(host: CalloutHost, clock: SceneClock, reduced: () => boolean, wake: () => void = () => {}) {
    this.host = host;
    this.clock = clock;
    this.reduced = reduced;
    this.wake = wake;
  }

  /** Callouts in the air now (waiting ones included). */
  get count() {
    return this.live.length;
  }

  /** The result over `target`; false when it says nothing. Several at once stack, each a beat after the one below. */
  show(result: ShotResult, target: string, anchor: Anchor, showDamage = SHOW_DAMAGE): boolean {
    const callout = calloutFor(result, showDamage);
    if (!callout) return false;
    this.add(callout, target, anchor);
    return true;
  }

  /** A reload's notice over the unit that reloaded, on the same terms as a shot result. */
  reloaded(target: string, anchor: Anchor) {
    this.add(reloadCallout(), target, anchor);
  }

  private add(callout: Callout, target: string, anchor: Anchor) {
    const taken = new Set<number>();
    for (const c of this.live) if (c.target === target) taken.add(c.slot);
    let slot = 0;
    while (taken.has(slot)) slot++;
    const node = this.host.create();
    node.className = `shot-callout ${callout.kind}`;
    node.textContent = callout.text;
    node.dataset.target = target;
    node.dataset.slot = String(slot);
    node.style.display = "none";
    this.host.append(node);
    const item: Live = {
      target,
      anchor,
      node,
      slot,
      age: -slot * CALLOUT_STAGGER,
      reduced: this.reduced(),
      dead: false,
      half: (callout.text.length * CHAR) / 2 + PAD,
      last: "",
    };
    this.live.push(item);
    this.clock.run((dt) => {
      if (item.dead) return true;
      item.age += dt;
      if (item.age < CALLOUT_SECONDS) return false;
      this.drop(item);
      return true;
    });
    this.wake();
  }

  /** Every callout gone at once: a seek leaves none in the air. */
  clear() {
    for (const c of this.live) {
      c.dead = true;
      c.node.remove();
    }
    this.live = [];
  }

  /** Per frame: each callout over its target, at its point in the animation. */
  place(width: number, height: number, project: Projector) {
    const { out } = this;
    for (const c of this.live) {
      if (c.age < 0) continue;
      project(c.anchor, CALLOUT_HEIGHT, out);
      const t = Math.min(1, c.age / CALLOUT_SECONDS);
      const look = calloutLook(t, c.reduced);
      const stack = stackOffset(c.slot);
      const x = Math.min(Math.max(out.x + CALLOUT_SIDE + stack.x, c.half), Math.max(c.half, width - c.half));
      const y = Math.min(Math.max(out.y + stack.y - look.rise, 16), Math.max(16, height - 16));
      const hidden = !out.visible;
      const style = `${hidden ? 1 : 0}|${x.toFixed(1)}|${y.toFixed(1)}|${look.scale.toFixed(3)}|${look.opacity.toFixed(3)}`;
      if (style === c.last) continue;
      c.last = style;
      c.node.style.display = hidden ? "none" : "";
      c.node.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${look.scale.toFixed(3)})`;
      c.node.style.opacity = look.opacity.toFixed(3);
    }
  }

  private drop(item: Live) {
    item.dead = true;
    item.node.remove();
    this.live = this.live.filter((c) => c !== item);
  }
}
