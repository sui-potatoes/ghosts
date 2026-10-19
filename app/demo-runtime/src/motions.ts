import type { Unit, Weapon } from "./game.ts";
export const motions = [
  ["rifle_idle", "Rifle ready idle", "Ready"],
  ["rifle_crouch_idle", "Rifle crouched idle", "Cover"],
  ["rifle_run", "Rifle combat run", "Movement"],
  ["idle", "Low-ready scan", "Ready"],
  ["idle_weight_shift", "Relaxed weight shift", "Ready"],
  ["pistol_idle", "Sidearm low ready", "Ready"],
  ["overwatch_ready", "Raise weapon", "Ready"],
  ["pistol_ready", "Sidearm ready", "Ready"],
  ["stand_cover_idle", "Standing cover", "Cover"],
  ["crouch_idle", "Crouched cover", "Cover"],
  ["crouch_enter", "Take a knee", "Cover"],
  ["crouch_exit", "Rise from cover", "Cover"],
  ["hunker_down", "Brace / hunker", "Cover"],
  ["cover_peek", "Reconnaissance peek", "Cover"],
  ["stand_cover_emerge", "Emerge to engage", "Cover"],
  ["cover_return", "Withdraw to cover", "Cover"],
  ["stand_cover_move", "Right cover step", "Movement"],
  ["cover_move_left", "Left cover step", "Movement"],
  ["run", "Tactical run", "Movement"],
  ["vault", "Low obstacle vault", "Movement"],
  ["shooting", "Assault fire", "Weapons"],
  ["rifle_burst", "Snap rifle shot", "Weapons"],
  ["crouch_shooting", "Crouched rifle fire", "Weapons"],
  ["sniper_shot", "Precision shot", "Weapons"],
  ["pistol_shot", "Sidearm recoil", "Weapons"],
  ["reload", "Rifle magazine change", "Weapons"],
  ["crouch_reload", "Covered reload", "Weapons"],
  ["pistol_reload", "Sidearm magazine change", "Weapons"],
  ["put_back_rifle", "Sling weapon", "Weapons"],
  ["draw_rifle", "Draw weapon", "Weapons"],
  ["toss_grenade", "Overarm grenade throw", "Combat"],
  ["melee_strike", "Rifle-butt strike", "Combat"],
  ["take_damage", "Standing hit", "Reactions"],
  ["heavy_hit", "Heavy stagger", "Reactions"],
  ["crouch_hit", "Crouched hit", "Reactions"],
  ["death", "Forward collapse", "Reactions"],
  ["death_backward", "Backward collapse", "Reactions"],
  ["crouch_death", "Crouched collapse", "Reactions"],
] as const;
export type Motion = (typeof motions)[number][0];
export function fireMotion(weapon: Weapon, covered: boolean): Motion {
  return weapon === "pistol"
    ? "pistol_shot"
    : weapon === "sniper"
      ? "sniper_shot"
      : covered
        ? "crouch_shooting"
        : "rifle_burst";
}
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
