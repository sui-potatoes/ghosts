// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every word Basics says, in one place: edit wording here and nowhere else.
 *
 * Each step has a title, up to two short lines for each input (`keys`: a
 * keyboard and mouse; `pad`: a controller; `touch`: a finger, never a key or a
 * button glyph) and an `ack`, said as the next step comes in so the player
 * knows the last one registered. Each stage has a short controls reminder.
 * Controls in a line are tokens the card draws as the player's own binding,
 * switching live with the input in use:
 *
 * - `{key:<action>}` a combat key (`fire`, `confirm`, `next-operator`, …, as in
 *   `keys.ts`), with the player's binding;
 * - `{pad:<button>}` a pad button (`a`, `b`, `y`, `dpad`, `ls`, `rs`, `lt`,
 *   `rt`) or a bindable pad action (`fire`, `grenade`, `reload`, `wheel`,
 *   `next-operator`, `grid`, `focus`), with the player's binding;
 * - `{cap:<text>}` a literal key cap (the squad numbers).
 *
 * House style: sentence case, imperative, no trailing full stop on a line, no
 * exclamation marks, every number with what it counts.
 */
import type { Briefing, Contract, Scenario } from "../../scenario.ts";
import type { Lines, StepCopy } from "../types.ts";

/** The briefing the pause menu opens, the location and the field's objective lines. */
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
    setting: "Tactical simulation. One room, rebuilt for every lesson.",
    contract: [
      "The simulation outlines what every piece does. The glowing line on the floor marks the side a piece protects. White is a wall: it stops movement, sight and fire. Cyan is high cover, dim cyan low cover. Everything but the walls breaks under a grenade.",
      "Orders arrive one at a time on the card. Each one waits until it is carried out.",
    ],
    rules:
      "Two action points per operator each turn. A move costs one, a shot spends what is left. Low cover takes 25 off the hit chance of a shot it faces, high cover and walls 50.",
    facts: [
      ["SQUAD", "VEX · GHOST · BISHOP"],
      ["LESSONS", "4"],
      ["TARGETS", "SIMULATED"],
      ["WIN", "NO TARGET STANDING"],
    ],
  },
  contract: { employer: "GHOSTS", division: "TRAINING", value: "₡ 0", threat: "NONE", threatLevel: 0 },
  location: { sector: "TACTICAL SIMULATION", coordinates: ["00° 00′ N", "000° 00′ E"], code: "SIM–00.001" },
  objectives: {
    secure: { title: "Clear the room", detail: "Clear the room", order: "Clear the room" },
    eliminate: { title: "Clear the room", order: "Clear the room" },
  },
  lines: { opening: "Simulation online", secured: "Room clear", securedStamp: "ROOM CLEAR" },
};

/** The stages' names, in order (the card's lesson list). */
export const STAGE_TITLES: Record<string, string> = {
  contact: "Contact",
  cover: "Cover",
  grenade: "Grenade",
  squad: "Squad",
};

/** The 2 to 4 inputs each stage needs, always on the card. */
export const STAGE_CONTROLS: Record<string, Lines> = {
  contact: {
    keys: ["Drag or {key:rotate-left} {key:rotate-right} turn · Scroll zooms · {cap:W} {cap:A} {cap:S} {cap:D} pan", "{key:fire} aims · {key:confirm} fires or ends the turn"],
    pad: ["{pad:rs} turns · {pad:ls} pans · {pad:lt} {pad:rt} zoom", "{pad:fire} aims · {pad:a} fires · {pad:wheel} has End turn"],
    touch: ["Drag turns · Pinch zooms · Two fingers pan", "Fire weapon aims, Fire shoots, End turn ends it"],
  },
  cover: {
    keys: ["Click a tile to move · {key:fire} aims · {key:confirm} fires", "{key:confirm} ends the turn · {key:cancel} cancels"],
    pad: ["{pad:dpad} picks a tile · {pad:a} moves · {pad:fire} aims", "{pad:wheel} has End turn · {pad:b} cancels"],
    touch: ["Tap a tile to move · Fire weapon aims", "End turn ends it · Cancel backs out"],
  },
  grenade: {
    keys: ["{key:reload} reloads · {key:grenade} arms the grenade", "Click to aim the landing · {key:confirm} throws"],
    pad: ["{pad:reload} reloads · {pad:grenade} arms the grenade", "{pad:dpad} aims the landing · {pad:a} throws"],
    touch: ["Reload · Grenade arms it", "Tap to aim the landing, Throw throws"],
  },
  squad: {
    keys: ["{key:next-operator} or {cap:1} {cap:2} {cap:3} picks an operator", "{key:flashbang} flashbang · {key:grenade} grenade · {key:fire} aims"],
    pad: ["{pad:next-operator} picks an operator", "{pad:grenade} throws what they carry · {pad:fire} aims"],
    touch: ["Tap an operator in the squad list", "Their orders are in the bar"],
  },
};

/** The same lines for every input. */
const all = (...lines: string[]) => ({ keys: lines, pad: lines, touch: lines });

/** The steps' words, by step id (`script.ts` gives the order, the pointers and what completes each). */
export const STEPS: Record<string, StepCopy> = {
  // 1. Contact
  turn: {
    title: "Turn the view",
    lines: {
      keys: ["Drag on the field, or press {key:rotate-left} or {key:rotate-right}", "VEX is behind a barrier. The target stands in the open"],
      pad: ["Push {pad:rs} left or right", "VEX is behind a barrier. The target stands in the open"],
      touch: ["Drag one finger across the field", "VEX is behind a barrier. The target stands in the open"],
    },
    ack: "Turned",
    nudge: "Turn the view first",
  },
  zoom: {
    title: "Zoom",
    lines: {
      keys: ["Scroll the mouse wheel, or two fingers on a trackpad", "Next if you'd rather move on"],
      pad: ["Hold {pad:lt} or {pad:rt}"],
      touch: ["Pinch with two fingers"],
    },
    ack: "Zoomed",
    nudge: "Zoom first",
  },
  pan: {
    title: "Pan",
    lines: {
      keys: ["Press {cap:W} {cap:A} {cap:S} {cap:D} or the arrow keys", "Right-drag on a mouse works too. Next if you'd rather move on"],
      pad: ["Push {pad:ls}"],
      touch: ["Drag two fingers across the field"],
    },
    ack: "Panned. The view comes back to the room on every order",
    nudge: "Pan first",
  },
  select: {
    title: "Select VEX",
    lines: {
      keys: ["Click VEX, or press {cap:1}"],
      pad: ["Press {pad:next-operator}"],
      touch: ["Tap VEX, or VEX's portrait in the squad list"],
    },
    ack: "VEX selected",
    nudge: "Select VEX",
  },
  fire: {
    title: "Fire",
    lines: {
      keys: ["Press {key:fire} to aim at the target, then {key:confirm} to fire", "The large number is the hit chance: 65% at range 4"],
      pad: ["Press {pad:fire} to aim at the target, then {pad:a} to fire", "The large number is the hit chance: 65% at range 4"],
      touch: ["Tap Fire weapon to aim at the target, then Fire", "The large number is the hit chance: 65% at range 4"],
    },
    ack: "Target down",
    nudge: "Fire at the target",
  },
  "end-turn": {
    title: "End the turn",
    lines: {
      keys: ["A shot spends all of VEX's action points (AP). Press {key:confirm} to end the turn", "Each operator gets 2 AP a turn"],
      pad: ["A shot spends all of VEX's action points (AP). Press {pad:wheel}, pick End turn, press {pad:a}", "Each operator gets 2 AP a turn"],
      touch: ["A shot spends all of VEX's action points (AP). Tap End turn", "Each operator gets 2 AP a turn"],
    },
    ack: "Turn over. The room rebuilds",
    nudge: "End the turn",
  },
  // 2. Cover
  wrong: {
    title: "Exposed",
    lines: {
      keys: ["Point at the marked tile to see the route, then click it. A move costs 1 AP", "The red line is the shooter's hit chance on VEX"],
      pad: ["Press {pad:dpad} to put the cursor on the marked tile, then {pad:a}. A move costs 1 AP", "The red line is the shooter's hit chance on VEX"],
      touch: ["Tap the marked tile. A move costs 1 AP", "The red line is the shooter's hit chance on VEX"],
    },
    ack: "Moved. The crate is behind VEX: flanked",
    nudge: "Move VEX to the marked tile",
  },
  hit: {
    title: "Their turn",
    lines: {
      keys: ["Nothing stands between them. Press {key:confirm} to end the turn and see", "Armour takes 1 off every hit"],
      pad: ["Nothing stands between them. Press {pad:wheel}, pick End turn, press {pad:a}", "Armour takes 1 off every hit"],
      touch: ["Nothing stands between them. Tap End turn and see", "Armour takes 1 off every hit"],
    },
    ack: "Hit: exposed",
    nudge: "End the turn",
  },
  right: {
    title: "Vault into cover",
    lines: {
      keys: ["Click the marked tile past the crate: VEX vaults it", "Now the crate is between them: 25 off the shooter's chance"],
      pad: ["{pad:dpad} to the marked tile past the crate, then {pad:a}: VEX vaults it", "Now the crate is between them: 25 off the shooter's chance"],
      touch: ["Tap the marked tile past the crate: VEX vaults it", "Now the crate is between them: 25 off the shooter's chance"],
    },
    ack: "In cover",
    nudge: "Move VEX to the marked tile",
  },
  miss: {
    title: "Their turn",
    lines: {
      keys: ["Press {key:confirm} to end the turn. Cover only counts on the side it faces"],
      pad: ["Press {pad:wheel}, pick End turn, press {pad:a}. Cover only counts on the side it faces"],
      touch: ["Tap End turn. Cover only counts on the side it faces"],
    },
    ack: "Missed: the crate took it",
    nudge: "End the turn",
  },
  flank: {
    title: "Flank",
    lines: {
      keys: ["The shooter hides behind its own crate. Move VEX to the marked tile, beside it", "From the side, its crate does not count"],
      pad: ["The shooter hides behind its own crate. {pad:dpad} to the marked tile, then {pad:a}", "From the side, its crate does not count"],
      touch: ["The shooter hides behind its own crate. Tap the marked tile, beside it", "From the side, its crate does not count"],
    },
    ack: "Flanked it",
    nudge: "Move VEX to the marked tile",
  },
  drop: {
    title: "Drop it",
    lines: {
      keys: ["Press {key:fire}, then {key:confirm}. No cover off: 75%"],
      pad: ["Press {pad:fire}, then {pad:a}. No cover off: 75%"],
      touch: ["Tap Fire weapon, then Fire. No cover off: 75%"],
    },
    ack: "Down. The room rebuilds",
    nudge: "Fire at the shooter",
  },
  // 3. Grenade
  reload: {
    title: "Reload",
    lines: {
      keys: ["VEX's magazine is empty. Press {key:reload} or click Reload", "It refills all 3 rounds for 1 AP"],
      pad: ["VEX's magazine is empty. Press {pad:reload}", "It refills all 3 rounds for 1 AP"],
      touch: ["VEX's magazine is empty. Tap Reload", "It refills all 3 rounds for 1 AP"],
    },
    ack: "Reloaded",
    nudge: "Reload",
  },
  frag: {
    title: "Grenade",
    lines: {
      keys: ["Crates cover the target on every side. Press {key:grenade}, click the marked tile, then {key:confirm}", "The lit tiles take 4 damage and lose their cover"],
      pad: ["Crates cover the target on every side. Press {pad:grenade}, {pad:dpad} to the marked tile, then {pad:a}", "The lit tiles take 4 damage and lose their cover"],
      touch: ["Crates cover the target on every side. Tap Grenade, the marked tile, then Throw", "The lit tiles take 4 damage and lose their cover"],
    },
    ack: "Cover gone",
    nudge: "Throw at the marked tile",
  },
  "their-shot": {
    title: "Their turn",
    lines: {
      keys: ["The grenade cost 1 AP and VEX has none left. Press {key:confirm} to end the turn"],
      pad: ["The grenade cost 1 AP and VEX has none left. Press {pad:wheel}, pick End turn, {pad:a}"],
      touch: ["The grenade cost 1 AP and VEX has none left. Tap End turn"],
    },
    ack: "Missed: VEX's crate held",
    nudge: "End the turn",
  },
  finish: {
    title: "Finish it",
    lines: {
      keys: ["The target is in the open now. Press {key:fire}, then {key:confirm}"],
      pad: ["The target is in the open now. Press {pad:fire}, then {pad:a}"],
      touch: ["The target is in the open now. Tap Fire weapon, then Fire"],
    },
    ack: "Down. Your squad joins",
    nudge: "Fire at the target",
  },
  // 4. Squad
  switch: {
    title: "Your squad",
    lines: {
      keys: ["Press {key:next-operator} to step to GHOST, or {cap:2}", "Each operator has 2 AP of their own"],
      pad: ["Press {pad:next-operator} until GHOST is selected", "Each operator has 2 AP of their own"],
      touch: ["Tap GHOST in the squad list", "Each operator has 2 AP of their own"],
    },
    ack: "GHOST selected",
    nudge: "Select GHOST",
  },
  flash: {
    title: "Flashbang",
    lines: {
      keys: ["Daze the flanker. Press {key:flashbang}, click the marked tile, then {key:confirm}", "Dazed: aim and dodge 0 for 2 turns. No damage"],
      pad: ["Daze the flanker. Press {pad:grenade}, {pad:dpad} to the marked tile, then {pad:a}", "Dazed: aim and dodge 0 for 2 turns. No damage"],
      touch: ["Daze the flanker. Tap Throw flashbang, the marked tile, then Throw", "Dazed: aim and dodge 0 for 2 turns. No damage"],
    },
    ack: "Flanker dazed",
    nudge: "Throw at the marked tile",
  },
  pair: {
    title: "Soften them",
    lines: {
      keys: ["Select VEX ({cap:1}). Press {key:grenade}, aim at the pair, then {key:confirm}", "A blast with one of yours in it is held back"],
      pad: ["Select VEX with {pad:next-operator}. Press {pad:grenade}, then {pad:a}", "A blast with one of yours in it is held back"],
      touch: ["Select VEX. Tap Grenade, then Throw", "A blast with one of yours in it is held back"],
    },
    ack: "Both hit, cover gone",
    nudge: "Throw VEX's grenade at the pair",
  },
  bishop: {
    title: "Pick the target",
    lines: {
      keys: ["Select BISHOP ({cap:3}) and press {key:fire}. The aim opens on the best odds", "Click TARGET–01 or TARGET–02, or Next, to aim there. Then click Fire"],
      pad: ["{pad:next-operator} to BISHOP, then {pad:fire}. The aim opens on the best odds", "{pad:dpad} left or right to TARGET–01 or TARGET–02, then {pad:a}"],
      touch: ["Select BISHOP, tap Fire weapon. The aim opens on the best odds", "Tap TARGET–01 or TARGET–02 (or Next), then Fire"],
    },
    ack: "One down",
    nudge: "Aim BISHOP at TARGET–01 or TARGET–02",
  },
  ghost: {
    title: "And the other",
    lines: {
      keys: ["GHOST has 1 AP left: enough to fire. Select GHOST, {key:fire}, aim at the other one, {key:confirm}"],
      pad: ["GHOST has 1 AP left: enough to fire. {pad:next-operator} to GHOST, {pad:fire}, {pad:dpad} to the other one, {pad:a}"],
      touch: ["GHOST has 1 AP left: enough to fire. Select GHOST, Fire weapon, tap the other one, Fire"],
    },
    ack: "Two down",
    nudge: "Fire with GHOST at the other one",
  },
  flanked: {
    title: "The flanker moves",
    lines: {
      keys: ["Press {key:confirm} to end the turn. It will come round VEX's barrier"],
      pad: ["Press {pad:wheel}, pick End turn, press {pad:a}. It will come round VEX's barrier"],
      touch: ["Tap End turn. It will come round VEX's barrier"],
    },
    ack: "Flanked VEX, but dazed: missed",
    nudge: "End the turn",
  },
  win: {
    title: "Finish the flanker",
    lines: {
      keys: ["Any operator: {key:fire}, then {key:confirm}. Down it to clear the room"],
      pad: ["Any operator: {pad:fire}, then {pad:a}. Down it to clear the room"],
      touch: ["Any operator: Fire weapon, then Fire. Down it to clear the room"],
    },
    nudge: "Fire at the flanker",
  },
  done: {
    title: "Simulation complete",
    lines: all("Ranked and friendly matches are under Play", "Black Rain and Paper Trail, under Training, are full operations against the AI"),
  },
};

/** The card's own words. */
export const CARD = {
  /** Before the step's lines, while the step's operator is not the one selected. */
  selectFirst: (name: string) => `Select ${name} first`,
  /** While the aim is on a target the step does not fire at: Fire stays locked. */
  heldTarget: (name: string) => `Fire is locked on ${name}. Next switches target`,
  /** The tag on a step read back. */
  earlier: "Done",
  back: "Back",
  next: "Next",
  current: "Current",
  skip: "Skip",
  /** The skip, armed: a second press leaves. */
  leave: "Leave training",
  continue: "Continue",
  lessons: "Lessons",
  /** The pad's way into the card's own commands, and out. */
  commands: "Card",
  close: "Close",
  done: "Done",
  lesson: (n: number, total: number, title: string) => `Lesson ${n} / ${total} · ${title}`,
  play: "Play",
  training: "Training",
  /** The cover line's label: who would hit whom, at what odds, and why. */
  relation: {
    label: (from: string, to: string, chance: number, why: string) => `${from} on ${to} · ${chance}% · ${why}`,
    low: "Low cover",
    high: "High cover",
    flanked: "Flanked",
    noLine: "No line",
    range: "Out of range",
  },
};
