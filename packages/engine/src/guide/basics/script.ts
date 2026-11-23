// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics, step by step: the order of the lessons, what each points at, what
 * completes it and what it lets the player do meanwhile. The words are in
 * `copy.ts`. The run is scripted so every lesson is always possible: the
 * player's moves go to the marked tiles, the shots that teach land as the text
 * says (`dice`), and the one hostile turn is played the same way every time
 * (`hostileTurn`): WRAITH–01 misses VEX behind the crate, WRAITH–02 hits GHOST
 * in the open for 3.
 *
 * Turn 1: look around, select GHOST, move, vault, switch to VEX, take cover,
 * aim, fire (a critical hit: 6 off WRAITH–01's 10 HP), end the turn, watch the Wraiths.
 * Turn 2: read the damage, reload, the grenade (WRAITH–01 down, WRAITH–02 at
 * 6, both crates gone), GHOST's flashbang, GHOST's shot (WRAITH–02 down: won).
 */
import { GRENADE_RADIUS } from "../../action-registry.ts";
import type { Command, GameEvent } from "../../events.ts";
import { distance, type Cell, type Encounter } from "../../game.ts";
import type { StepSpec } from "../director.ts";
import { fixShot, type ShotOutcome } from "../dice.ts";
import type { GuideIntent, GuideSnapshot, GuideUnit, Pointer } from "../types.ts";
import { levelOrigin } from "../../editor/playtest.ts";
import type { GuideScript } from "../run.ts";
import { STEPS } from "./copy.ts";
import { basicsLevel, MARKS } from "./level.ts";

const [ox, oz] = levelOrigin(basicsLevel());
/** A level cell as the scene's cell. */
const scene = ([x, z]: Cell): Cell => [x + ox, z + oz];

/** The yard's tiles, in scene cells. */
export const TILES = {
  ghostMove: scene(MARKS.ghostMove as Cell),
  pallets: scene(MARKS.pallets as Cell),
  ghostVault: scene(MARKS.ghostVault as Cell),
  vexCover: scene(MARKS.vexCover as Cell),
  vexCrate: scene(MARKS.vexCrate as Cell),
  crates: (MARKS.crates as Cell[]).map(scene),
  blast: scene(MARKS.blast as Cell),
};

/** The units, by the ids the yard deploys them under. */
export const VEX = "v";
export const GHOST = "g";
export const WRAITH_1 = "h1";
export const WRAITH_2 = "h2";

const same = (a: Cell | null | undefined, b: Cell) => !!a && a[0] === b[0] && a[1] === b[1];
const unit = (now: GuideSnapshot, id: string): GuideUnit | undefined => now.units.find((u) => u.id === id);
const standing = (now: GuideSnapshot, id: string) => (unit(now, id)?.hp ?? 0) > 0;
const at = (now: GuideSnapshot, id: string, cell: Cell) => same(unit(now, id)?.pos, cell);
/** The events since the step began. */
const since = (now: GuideSnapshot, start: GuideSnapshot): readonly GameEvent[] => now.events.slice(start.events.length);
const did = (now: GuideSnapshot, start: GuideSnapshot, type: GameEvent["type"], by: string) =>
  since(now, start).some((e) => e.type === type && "unit" in e && e.unit === by);

const selecting = (i: GuideIntent) => i.type === "select";
const moving = (i: GuideIntent, id: string, to: Cell) => i.type === "move" && i.unit === id && same(i.to, to);
const arming = (i: GuideIntent, id: string, order: string) => i.type === "arm" && i.unit === id && i.order === order;

/** Who a burst at `p` catches, by id. */
const caught = (now: GuideSnapshot, p: Cell) =>
  now.units.filter((u) => u.hp > 0 && distance(u.pos, p) <= GRENADE_RADIUS);
/** A burst that catches every hostile in `ids`, every tile in `cells` (the cover it is meant to break) and none of the squad. */
const burstFits = (now: GuideSnapshot, p: Cell | null, ids: string[], cells: Cell[] = []) => {
  if (!p) return false;
  const hit = caught(now, p);
  return (
    ids.every((id) => !standing(now, id) || hit.some((u) => u.id === id)) &&
    cells.every((c) => distance(c, p) <= GRENADE_RADIUS) &&
    !hit.some((u) => !u.enemy)
  );
};

/** Point at a command, then (once armed) at what it is aimed with, then at the landing tile and the confirm. */
function throwPointers(now: GuideSnapshot, order: string, kind: string, fits: boolean, aim: Pointer[]): Pointer[] {
  if (now.mode !== order) return [{ hud: `command:${kind}` }];
  return fits && now.throwAt ? [{ hud: "confirm" }, { tiles: [now.throwAt], tone: "blast" }] : aim;
}

/** How far the first step wants the view turned (radians), zoomed (share of the distance) and panned (metres). */
const CAMERA = { turned: 0.3, zoomed: 0.12, panned: 1.2 };
const travel = (now: GuideSnapshot, start: GuideSnapshot) => [
  now.camera.turned - start.camera.turned >= CAMERA.turned,
  now.camera.zoomed - start.camera.zoomed >= CAMERA.zoomed,
  now.camera.panned - start.camera.panned >= CAMERA.panned,
];

/** The steps, in order. The last one is the closing card: it never completes. */
export const STEP_SPECS: StepSpec[] = [
  {
    id: "camera",
    ticks: travel,
    done: (now, start) => travel(now, start).every(Boolean),
    permits: () => false,
  },
  {
    id: "select",
    done: (now) => now.selected === GHOST,
    permits: selecting,
    point: () => [{ unit: GHOST }, { hud: `member:${GHOST}` }],
  },
  {
    id: "move",
    unit: GHOST,
    done: (now) => at(now, GHOST, TILES.ghostMove),
    permits: (i) => selecting(i) || moving(i, GHOST, TILES.ghostMove),
    point: () => [{ tiles: [TILES.ghostMove], tone: "go" }],
  },
  {
    id: "vault",
    unit: GHOST,
    done: (now, start) =>
      at(now, GHOST, TILES.ghostVault) && since(now, start).some((e) => e.type === "move" && e.unit === GHOST && e.vault),
    permits: (i) => selecting(i) || moving(i, GHOST, TILES.ghostVault),
    point: () => [
      { tiles: [TILES.ghostVault], tone: "go" },
      { tiles: [TILES.pallets], tone: "prop" },
    ],
  },
  {
    id: "switch",
    done: (now) => now.selected === VEX,
    permits: selecting,
    point: () => [{ hud: `member:${VEX}` }, { unit: VEX }],
  },
  {
    id: "cover",
    unit: VEX,
    done: (now) => at(now, VEX, TILES.vexCover),
    permits: (i) => selecting(i) || moving(i, VEX, TILES.vexCover),
    point: () => [
      { tiles: [TILES.vexCover], tone: "go" },
      { tiles: [TILES.vexCrate], tone: "prop" },
      { unit: WRAITH_1 },
    ],
  },
  {
    id: "aim",
    unit: VEX,
    done: (now) => now.selected === VEX && now.mode === "fire" && now.target === WRAITH_1,
    permits: (i) => selecting(i) || arming(i, VEX, "fire"),
    point: () => [{ hud: "command:Attack" }, { unit: WRAITH_1 }],
  },
  {
    id: "shoot",
    unit: VEX,
    done: (now, start) => did(now, start, "shot", VEX),
    permits: (i) =>
      selecting(i) || arming(i, VEX, "fire") || (i.type === "fire" && i.unit === VEX && i.target === WRAITH_1),
    point: (now) => (now.mode === "fire" ? [{ hud: "odds" }, { hud: "confirm" }] : [{ hud: "command:Attack" }]),
  },
  {
    id: "end-turn",
    busy: true,
    done: (now, start) => now.phase === "enemy" || now.turn > start.turn,
    permits: (i) => i.type === "end-turn",
    point: () => [{ hud: "end-turn" }],
  },
  {
    id: "enemy",
    done: (now, start) => now.phase === "player" && now.turn > start.turn,
    permits: () => false,
  },
  {
    id: "hit",
    confirm: true,
    permits: selecting,
    point: () => [{ hud: `member:${GHOST}` }, { unit: GHOST }],
  },
  {
    id: "reload",
    unit: VEX,
    done: (now, start) => did(now, start, "reload", VEX),
    permits: (i) => selecting(i) || arming(i, VEX, "reload"),
    point: () => [{ hud: "command:Reload" }, { hud: "unit-ammo" }],
  },
  {
    id: "grenade",
    unit: VEX,
    done: (now, start) => did(now, start, "grenade", VEX),
    permits: (i, now) =>
      selecting(i) ||
      arming(i, VEX, "grenade") ||
      (i.type === "throw" && i.unit === VEX && i.order === "grenade" && burstFits(now, i.at, [WRAITH_1, WRAITH_2], TILES.crates)),
    point: (now) =>
      throwPointers(now, "grenade", "Grenade", burstFits(now, now.throwAt, [WRAITH_1, WRAITH_2], TILES.crates), [
        { tiles: [TILES.blast], tone: "blast" },
      ]),
  },
  {
    id: "flash",
    unit: GHOST,
    done: (now, start) => did(now, start, "flashbang", GHOST),
    permits: (i, now) =>
      selecting(i) ||
      arming(i, GHOST, "flashbang") ||
      (i.type === "throw" && i.unit === GHOST && i.order === "flashbang" && burstFits(now, i.at, [WRAITH_2])),
    point: (now) =>
      throwPointers(now, "flashbang", "Flashbang", burstFits(now, now.throwAt, [WRAITH_2]), [{ unit: WRAITH_2 }]),
  },
  {
    id: "finish",
    unit: GHOST,
    done: (now) => now.result === "victory",
    permits: (i) =>
      selecting(i) || arming(i, GHOST, "fire") || (i.type === "fire" && i.unit === GHOST && i.target === WRAITH_2),
    point: (now) =>
      now.mode === "fire" ? [{ hud: "confirm" }, { unit: WRAITH_2 }] : [{ hud: "command:Attack" }, { unit: WRAITH_2 }],
  },
  {
    id: "done",
    permits: () => false,
  },
];

/**
 * The dice a player's shot is taken with. The lesson's shots land as the
 * critical hit the aim readout offers ("CRIT −6", "CRIT −7"): VEX's leaves
 * WRAITH–01 at 4 for the grenade to finish, GHOST's downs WRAITH–02 (6 HP
 * after the grenade). Null: the rules roll as they would.
 */
export function shotDice(game: Encounter, command: Command): ShotOutcome | null {
  if (command.type !== "fire") return null;
  const target = game.unit(command.target);
  if (!target) return null;
  const crit = Math.max(1, Math.floor(1.5 * game.unit(command.unit)!.damage) - target.armor);
  if (command.unit === VEX && command.target === WRAITH_1) return { hit: true, crit: true, damage: crit };
  if (command.unit === GHOST && command.target === WRAITH_2) return { hit: true, crit: true, damage: crit };
  return null;
}

/** The hostile turn's shots: who fires at whom, and how it comes out. */
const HOSTILE_SHOTS: { from: string; at: string; want: ShotOutcome }[] = [
  { from: WRAITH_1, at: VEX, want: { hit: false } },
  { from: WRAITH_2, at: GHOST, want: { hit: true, damage: 3 } },
];

/**
 * The first hostile turn as the lesson needs it: WRAITH–01 fires at VEX and
 * misses, WRAITH–02 fires at GHOST and hits for 3; nobody moves. A shot the
 * field no longer allows is left out. Null after the first turn: the rules'
 * own hostiles play.
 */
export function hostileTurn(game: Encounter): Iterable<GameEvent> | null {
  if (game.turn !== 1) return null;
  return (function* () {
    if (game.result || game.phase !== "player") return;
    yield* game.beginEnemy();
    for (const { from, at: to, want } of HOSTILE_SHOTS) {
      const a = game.unit(from),
        b = game.unit(to);
      if (!a || !b || a.hp <= 0 || b.hp <= 0 || !game.inRange(a, b)) continue;
      const command: Command = { type: "fire", unit: from, target: to };
      fixShot(game, command, want);
      yield* game.apply(command);
    }
    if (!game.result) yield* game.nextTurn();
  })();
}

/** The script the guide runs: steps, words, dice and the hostile turn. */
export const basicsScript: GuideScript = {
  steps: STEP_SPECS,
  copy: STEPS,
  dice: shotDice,
  hostileTurn,
};
