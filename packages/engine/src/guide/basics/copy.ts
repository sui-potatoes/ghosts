// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every word Basics says, in one place: edit wording here and nowhere else.
 *
 * Each step has a title and up to two short lines for each input: `keys` (a
 * keyboard and mouse), `pad` (a controller) and `touch` (a finger; never a key
 * or a button glyph). Controls in a line are tokens the card draws as the
 * player's own binding, switching live with the input in use:
 *
 * - `{key:<action>}` a combat key (`fire`, `confirm`, `next-operator`, …, as in
 *   `keys.ts`), with the player's binding;
 * - `{pad:<button>}` a pad button (`a`, `b`, `dpad`, `ls`, `rs`) or a bindable
 *   pad action (`fire`, `grenade`, `reload`, `wheel`, `next-operator`), with the
 *   player's binding;
 * - `{cap:<text>}` a literal key cap (the squad numbers).
 *
 * House style: sentence case, imperative, no trailing full stop on a line, no
 * exclamation marks, every number with what it counts.
 */
import type { Briefing, Contract, Scenario } from "../../scenario.ts";
import type { StepCopy } from "../types.ts";

/** The deployment briefing, the location and the field's objective lines. */
export const BRIEFING: {
  briefing: Briefing;
  contract: Contract;
  location: Scenario["location"];
  objectives: Scenario["objectives"];
  lines: Scenario["lines"];
} = {
  briefing: {
    issuer: "GHOSTS / TRAINING",
    title: "Basics",
    setting: "Training yard, Kōra Industrial District. Two operators against two Wraiths.",
    contract: [
      "Two Wraith operators hold the north end of the yard. Clear them with VEX and GHOST.",
      "Orders arrive one at a time at the top of the screen. Each one waits until it is carried out.",
    ],
    rules:
      "Two action points per operator each turn. A move costs one, a shot spends what is left. Low cover takes 25 off the hit chance against whoever stands behind it.",
    facts: [
      ["SQUAD", "VEX · GHOST"],
      ["OPPOSITION", "2 WRAITHS"],
      ["GROUND", "12 × 10 TILES"],
      ["WIN", "NO HOSTILE STANDING"],
    ],
  },
  contract: { employer: "GHOSTS", division: "TRAINING", value: "₡ 0", threat: "LOW", threatLevel: 1 },
  location: { sector: "TRAINING YARD / KŌRA", coordinates: ["35° 41′ N", "139° 41′ E"], code: "TR–01.001" },
  objectives: {
    secure: { title: "Hold the yard", detail: "Clear the yard", order: "Hold the yard" },
    eliminate: { title: "Clear the yard", order: "Clear the yard" },
  },
  lines: {
    opening: "Squad deployed. Training yard",
    secured: "Yard clear",
    securedStamp: "YARD CLEAR",
  },
};

/** The steps' words, by step id (`script.ts` gives the order, the pointers and what completes each). */
export const STEPS: Record<string, StepCopy> = {
  camera: {
    title: "Look around",
    lines: {
      keys: ["Drag to turn the view, scroll to zoom, right-drag to pan", "{key:rotate-left} {key:rotate-right} turn it too"],
      pad: ["{pad:rs} turns and tilts the view, {pad:ls} pans", "{pad:lt} {pad:rt} zoom"],
      touch: ["Drag to turn the view", "Pinch to zoom, drag two fingers to pan"],
    },
    ticks: ["Turn", "Zoom", "Pan"],
    nudge: "Look around first",
  },
  select: {
    title: "Select GHOST",
    lines: {
      keys: ["Click GHOST on the field or in the squad list, or press {cap:2}"],
      pad: ["Press {pad:next-operator} until GHOST is selected"],
      touch: ["Tap GHOST on the field or in the squad list"],
    },
    nudge: "Select GHOST",
  },
  move: {
    title: "Move",
    lines: {
      keys: ["Point at the marked tile to see the route, then click it", "Each operator has 2 AP a turn. A move costs 1 AP"],
      pad: ["Steer the cursor to the marked tile with {pad:dpad}, then press {pad:a}", "Each operator has 2 AP a turn. A move costs 1 AP"],
      touch: ["Tap the marked tile", "Each operator has 2 AP a turn. A move costs 1 AP"],
    },
    nudge: "Move GHOST to the marked tile",
  },
  vault: {
    title: "Vault",
    lines: {
      keys: ["Click the marked tile past the pallets: GHOST vaults them", "The pallets count as 1 tile of the move. It spends GHOST's last AP"],
      pad: ["Steer to the marked tile past the pallets and press {pad:a}: GHOST vaults them", "The pallets count as 1 tile of the move. It spends GHOST's last AP"],
      touch: ["Tap the marked tile past the pallets: GHOST vaults them", "The pallets count as 1 tile of the move. It spends GHOST's last AP"],
    },
    nudge: "Move GHOST to the marked tile",
  },
  switch: {
    title: "Switch operator",
    lines: {
      keys: ["GHOST has no AP left. Switch to VEX with {key:next-operator} or {cap:1}"],
      pad: ["GHOST has no AP left. Switch to VEX with {pad:next-operator}"],
      touch: ["GHOST has no AP left. Tap VEX in the squad list"],
    },
    nudge: "Select VEX",
  },
  cover: {
    title: "Take cover",
    lines: {
      keys: ["Move VEX to the marked tile, behind the crate", "Cover between you and a hostile takes 25 off its hit chance"],
      pad: ["Move VEX to the marked tile, behind the crate", "Cover between you and a hostile takes 25 off its hit chance"],
      touch: ["Tap the marked tile to move VEX behind the crate", "Cover between you and a hostile takes 25 off its hit chance"],
    },
    nudge: "Move VEX to the marked tile",
  },
  aim: {
    title: "Aim",
    lines: {
      keys: ["Press {key:fire} or click Fire to aim at WRAITH–01", "Red rings mark hostiles in range and in sight. The wall hides WRAITH–02"],
      pad: ["Press {pad:fire} to aim at WRAITH–01", "Red rings mark hostiles in range and in sight. The wall hides WRAITH–02"],
      touch: ["Tap Fire to aim at WRAITH–01", "Red rings mark hostiles in range and in sight. The wall hides WRAITH–02"],
    },
    nudge: "Aim at WRAITH–01",
  },
  shoot: {
    title: "Fire",
    lines: {
      keys: [
        "Hit chance: aim 65 at range 4 tiles, 25 off for the crate. Each tile closer adds 5, each tile further takes 10",
        "Press {key:confirm} or click Fire",
      ],
      pad: [
        "Hit chance: aim 65 at range 4 tiles, 25 off for the crate. Each tile closer adds 5, each tile further takes 10",
        "Press {pad:a} to fire",
      ],
      touch: [
        "Hit chance: aim 65 at range 4 tiles, 25 off for the crate. Each tile closer adds 5, each tile further takes 10",
        "Tap Fire",
      ],
    },
    nudge: "Fire at WRAITH–01",
  },
  "end-turn": {
    title: "End the turn",
    lines: {
      keys: ["A shot spends all of an operator's AP. Both are spent now", "Press {key:confirm} or click End turn"],
      pad: ["A shot spends all of an operator's AP. Both are spent now", "Press {pad:wheel} and pick End turn"],
      touch: ["A shot spends all of an operator's AP. Both are spent now", "Tap End turn"],
    },
    nudge: "End the turn",
  },
  enemy: {
    title: "Hostile turn",
    lines: {
      keys: ["The Wraiths act now. Watch the field"],
      pad: ["The Wraiths act now. Watch the field"],
      touch: ["The Wraiths act now. Watch the field"],
    },
  },
  hit: {
    title: "Damage",
    lines: {
      keys: ["GHOST was in the open and lost 3 HP. Armour took 1 off the hit", "VEX's crate held. An operator at 0 HP is down"],
      pad: ["GHOST was in the open and lost 3 HP. Armour took 1 off the hit", "VEX's crate held. An operator at 0 HP is down"],
      touch: ["GHOST was in the open and lost 3 HP. Armour took 1 off the hit", "VEX's crate held. An operator at 0 HP is down"],
    },
  },
  reload: {
    title: "Reload",
    lines: {
      keys: ["VEX has 2 of 3 rounds. Press {key:reload} or click Reload", "Reloading fills the magazine for 1 AP"],
      pad: ["VEX has 2 of 3 rounds. Press {pad:reload} to reload", "Reloading fills the magazine for 1 AP"],
      touch: ["VEX has 2 of 3 rounds. Tap Reload", "Reloading fills the magazine for 1 AP"],
    },
    nudge: "Reload",
  },
  grenade: {
    title: "Grenade",
    lines: {
      keys: ["Press {key:grenade}, aim at the marked tile, then {key:confirm}", "It hits everyone within 2 tiles and destroys the cover there"],
      pad: ["Press {pad:grenade}, steer to the marked tile with {pad:dpad} if needed, then {pad:a}", "It hits everyone within 2 tiles and destroys the cover there"],
      touch: ["Tap Grenade, check the marked tile, then tap Throw", "It hits everyone within 2 tiles and destroys the cover there"],
    },
    nudge: "Throw at the marked tile",
  },
  flash: {
    title: "Flashbang",
    lines: {
      keys: ["GHOST throws it. Press {key:flashbang}, aim at WRAITH–02, then {key:confirm}", "It dazes everyone within 2 tiles: aim and dodge drop to 0 for 2 turns"],
      pad: ["GHOST throws it. Press {pad:grenade}, steer to WRAITH–02, then {pad:a}", "It dazes everyone within 2 tiles: aim and dodge drop to 0 for 2 turns"],
      touch: ["GHOST throws it. Tap Flashbang, tap WRAITH–02, then Throw", "It dazes everyone within 2 tiles: aim and dodge drop to 0 for 2 turns"],
    },
    nudge: "Throw at WRAITH–02",
  },
  finish: {
    title: "Take the shot",
    lines: {
      keys: ["The throw cost 1 AP, so GHOST can still fire. Down WRAITH–02 to win", "Press {key:fire}, then {key:confirm}"],
      pad: ["The throw cost 1 AP, so GHOST can still fire. Down WRAITH–02 to win", "Press {pad:fire}, then {pad:a}"],
      touch: ["The throw cost 1 AP, so GHOST can still fire. Down WRAITH–02 to win", "Tap Fire, then Fire again"],
    },
    nudge: "Fire at WRAITH–02",
  },
  done: {
    title: "Yard clear",
    lines: {
      keys: ["Ranked and friendly matches are under Play", "Black Rain and Paper Trail, under Training, are full operations against the AI"],
      pad: ["Ranked and friendly matches are under Play", "Black Rain and Paper Trail, under Training, are full operations against the AI"],
      touch: ["Ranked and friendly matches are under Play", "Black Rain and Paper Trail, under Training, are full operations against the AI"],
    },
  },
};

/** The card's own words. */
export const CARD = {
  /** Before the step's lines, while the step's operator is not the one selected. */
  selectFirst: (name: string) => `Select ${name} first`,
  /** The tag on a step read back. */
  earlier: "Done",
  back: "Back",
  next: "Next",
  current: "Current",
  skip: "Skip",
  /** The skip, armed: a second press leaves. */
  leave: "Leave training",
  continue: "Continue",
  play: "Play",
  training: "Training",
};
