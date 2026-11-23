// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The reactive mix's rules, no Web Audio: what the field's state asks of the
 * buses, and the pre-shot dip's lifetime. Tested in `mix-model.test.ts`.
 *
 * - Aiming (a shot or a throw being placed): ambience and music duck.
 * - The held unit dazed: the world is low-passed and narrowed toward mono.
 * - A shot about to land: ambience and music dip almost to silence, released
 *   on its impact, or by the backstop if the impact never comes.
 * - Anything that ends the moment (a cancel, a pause, the end of the match, a
 *   replay seek, the encounter torn down) restores the mix: `reset`.
 */

/** Ambience and music level while aiming (−6 dB). */
export const AIM_DUCK = 0.5;
/** Ambience and music level while a shot is about to land (−22 dB). */
export const SHOT_DIP = 0.08;
/** World low-pass while dazed, Hz; `OPEN_CUTOFF` is the filter wide open. */
export const DAZE_CUTOFF = 900;
export const OPEN_CUTOFF = 20000;
/** Stereo width while dazed (1 is full, 0 mono). */
export const DAZE_WIDTH = 0.3;
/** Time constants (s) of the ramps toward each target: attack going in, release coming out. */
export const RAMPS = {
  duck: { attack: 0.12, release: 0.35 },
  dip: { attack: 0.05, release: 0.18 },
  daze: { attack: 0.15, release: 0.45 },
} as const;
/** A dip whose impact never came is released after this long (s). */
export const DIP_BACKSTOP = 4;

export interface MixInputs {
  aiming: boolean;
  dazed: boolean;
}

/** The unit the mix follows, as far as the mix cares. */
export interface HeldUnit {
  hp: number;
  effects: readonly { kind: string }[];
}

/**
 * The mix's inputs from the field: aiming while a shot or a throw is being
 * placed by a held unit, dazed while the held unit carries a Daze.
 */
export function mixInputsOf(mode: string, held: HeldUnit | undefined): MixInputs {
  return {
    aiming: mode !== "move" && !!held,
    dazed: !!held && held.hp > 0 && held.effects.some((e) => e.kind === "Daze"),
  };
}

export interface MixTargets {
  /** Gain on the ambience and music buses. */
  duck: number;
  /** World low-pass cutoff, Hz. */
  cutoff: number;
  /** Stereo width of the world, 0 to 1. */
  width: number;
  /** Which ramp brings the duck there. */
  duckRamp: number;
  dazeRamp: number;
}

export const NEUTRAL: Readonly<MixTargets> = {
  duck: 1,
  cutoff: OPEN_CUTOFF,
  width: 1,
  duckRamp: RAMPS.duck.release,
  dazeRamp: RAMPS.daze.release,
};

/** The mix state; time is passed in (seconds), so it runs in node. */
export class MixModel {
  private inputs: MixInputs = { aiming: false, dazed: false };
  private dipUntil = -Infinity;
  private dipToken = 0;
  private last: MixTargets = { ...NEUTRAL };

  /** Update from the field; returns true when the targets changed. */
  set(inputs: MixInputs, now: number): boolean {
    this.inputs = { ...inputs };
    return this.refresh(now);
  }

  /** A shot is about to resolve: dip until `impact(token)` or the backstop. */
  beginShot(now: number): number {
    this.dipUntil = now + DIP_BACKSTOP;
    this.refresh(now);
    return ++this.dipToken;
  }

  /** The shot landed; a stale token (an earlier shot) is ignored. */
  impact(token: number, now: number): boolean {
    if (token !== this.dipToken) return false;
    this.dipUntil = -Infinity;
    return this.refresh(now);
  }

  /** Back to neutral: no aim, no daze, no dip. */
  reset(now: number): boolean {
    this.inputs = { aiming: false, dazed: false };
    this.dipUntil = -Infinity;
    this.dipToken++;
    return this.refresh(now);
  }

  dipping(now: number): boolean {
    return now < this.dipUntil;
  }

  /** Seconds until the backstop releases the current dip; null when none is pending. */
  dipLeft(now: number): number | null {
    return this.dipping(now) ? this.dipUntil - now : null;
  }

  get dazed() {
    return this.inputs.dazed;
  }

  targets(now: number): MixTargets {
    const dip = this.dipping(now);
    const { aiming, dazed } = this.inputs;
    const duck = dip ? SHOT_DIP : aiming ? AIM_DUCK : 1;
    const before = this.last.duck;
    return {
      duck,
      cutoff: dazed ? DAZE_CUTOFF : OPEN_CUTOFF,
      width: dazed ? DAZE_WIDTH : 1,
      duckRamp: duck < before ? (dip ? RAMPS.dip.attack : RAMPS.duck.attack) : before === SHOT_DIP ? RAMPS.dip.release : RAMPS.duck.release,
      dazeRamp: dazed ? RAMPS.daze.attack : RAMPS.daze.release,
    };
  }

  /** Recompute; true when anything audible changed. */
  refresh(now: number): boolean {
    const t = this.targets(now);
    const changed = t.duck !== this.last.duck || t.cutoff !== this.last.cutoff || t.width !== this.last.width;
    this.last = t;
    return changed;
  }

  get current(): Readonly<MixTargets> {
    return this.last;
  }
}

/**
 * Stereo width as a 2x2 mix: left' = a·L + b·R, right' = b·L + a·R, from
 * mid/side with the side scaled by `width`.
 */
export function widthGains(width: number): { a: number; b: number } {
  const w = Math.max(0, Math.min(1, width));
  return { a: (1 + w) / 2, b: (1 - w) / 2 };
}
