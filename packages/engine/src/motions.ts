// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Motion } from "@ghosts/squad/motion/catalog";
import type { Unit, Weapon } from "./game.ts";

/** The captured action catalog lives in the squad package; one copy, one truth. */
export { motions, type Motion } from "@ghosts/squad/motion/catalog";
export function reloadMotion(weapon: Weapon, covered: boolean): Motion {
  return weapon === "pistol"
    ? "pistol_reload"
    : covered
      ? "crouch_reload"
      : "reload";
}
export function restMotion(
  u: Pick<Unit, "hunkered" | "overwatch" | "weapon">,
  covered: boolean,
): Motion {
  return u.hunkered
    ? "hunker_down"
    : u.overwatch
      ? "overwatch_ready"
      : covered
        ? "rifle_crouch_idle"
        : u.weapon === "pistol"
          ? "pistol_ready"
          : "rifle_idle";
}
export function reactionMotion(
  dead: boolean,
  covered: boolean,
  heavy: boolean,
): Motion {
  return dead
    ? covered
      ? "crouch_death"
      : heavy
        ? "death_backward"
        : "death"
    : covered
      ? "crouch_hit"
      : heavy
        ? "heavy_hit"
        : "take_damage";
}
