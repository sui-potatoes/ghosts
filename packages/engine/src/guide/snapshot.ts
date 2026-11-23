// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The field as the guide reads it: the rules' units and journal, and what the player has in hand. */
import type { Cell, Encounter } from "../game.ts";
import type { CameraTravel, GuideSnapshot } from "./types.ts";

export interface FieldState {
  selected: string;
  mode: string;
  target: string;
  grenadeTarget: Cell | null;
  busy: boolean;
  /** A dialog covers the field, or the host has it paused. */
  covered: boolean;
}

export function snapshotOf(game: Encounter, field: FieldState, camera: CameraTravel, number: number): GuideSnapshot {
  return {
    game: number,
    turn: game.turn,
    phase: game.phase,
    result: game.result,
    busy: field.busy,
    covered: field.covered,
    selected: field.selected,
    mode: field.mode,
    target: field.target,
    throwAt: field.grenadeTarget ? [...field.grenadeTarget] : null,
    units: game.units.map((u) => ({
      id: u.id,
      enemy: u.enemy,
      pos: [...u.pos],
      hp: u.hp,
      ap: u.ap,
      ammo: u.ammo,
      clip: u.clip,
      effects: u.effects.filter((e) => e.turns > 0).map((e) => e.kind),
    })),
    // A copy: the journal grows in place, and a step compares against the one it began on.
    events: game.events.slice(),
    camera: { ...camera },
  };
}
