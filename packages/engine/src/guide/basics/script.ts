// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics as one continuous run through a simulation room that reconfigures
 * around the player (`level.ts`): four stages, each a short burst that ends in
 * something happening, the next one materialising straight after. The words
 * are in `copy.ts`; this file gives the order, the pointers, what completes a
 * step, what it lets the player do, the dice of the lesson shots and what the
 * targets do on their turn. Nothing can be failed into a dead end: moves go to
 * marked tiles, the lesson shots land as the words say, and the targets act
 * as the lesson needs.
 *
 * 1. Contact: turn, zoom and pan the view, select VEX, aim, fire: the first
 *    target goes down; end the turn.
 * 2. Cover: stand on the wrong side of a crate and get hit, vault to the right
 *    side and watch the shot miss, flank the shooter and drop it.
 * 3. Grenade: reload, blow away the crates boxing a target in, end the turn
 *    (its shot misses VEX in cover), finish it in the open.
 * 4. Squad: switch operators, daze the flanker with GHOST's flashbang, VEX's
 *    frag on the pair, BISHOP and GHOST finish them, the dazed flanker misses,
 *    down it to win.
 */
import { GRENADE_RADIUS } from "../../action-registry.ts";
import type { Command, GameEvent } from "../../events.ts";
import { distance, type Cell, type Encounter } from "../../game.ts";
import type { StepSpec } from "../director.ts";
import { fixShot, type ShotOutcome } from "../dice.ts";
import type { GuideScript } from "../run.ts";
import type { GuideIntent, GuideSnapshot, GuideUnit, Pointer } from "../types.ts";
import { STAGE_CONTROLS, STAGE_TITLES, STEPS } from "./copy.ts";
import { cell, roomCells, type StageId } from "./level.ts";

/** The operators and the targets, by the ids every stage deploys them under. */
export const VEX = "v";
export const GHOST = "g";
export const BISHOP = "b";
export const T1 = "h1";
export const T2 = "h2";
export const T3 = "h3";

const same = (a: Cell | null | undefined, b: Cell) => !!a && a[0] === b[0] && a[1] === b[1];
const unit = (now: GuideSnapshot, id: string): GuideUnit | undefined => now.units.find((u) => u.id === id);
const at = (now: GuideSnapshot, id: string, c: Cell) => same(unit(now, id)?.pos, c);
const since = (now: GuideSnapshot, start: GuideSnapshot): readonly GameEvent[] => now.events.slice(start.events.length);
const did = (now: GuideSnapshot, start: GuideSnapshot, type: GameEvent["type"], by: string) =>
  since(now, start).some((e) => e.type === type && "unit" in e && e.unit === by);
const down = (now: GuideSnapshot, id: string) => (unit(now, id)?.hp ?? 0) <= 0;

const arming = (i: GuideIntent, id: string, order: string) => i.type === "arm" && i.unit === id && i.order === order;
const moving = (i: GuideIntent, id: string, to: Cell) => i.type === "move" && i.unit === id && same(i.to, to);
/** Selecting one of the stage's operators (the others wait outside the room). */
const selectingOf = (ids: string[]) => (i: GuideIntent) => i.type === "select" && ids.includes(i.unit);

/** A burst at `p` that catches every target in `ids` still standing and no operator. */
export function burstFits(now: GuideSnapshot, p: Cell | null, ids: string[]): boolean {
  if (!p) return false;
  const hit = now.units.filter((u) => u.hp > 0 && distance(u.pos, p) <= GRENADE_RADIUS);
  return ids.every((id) => down(now, id) || hit.some((u) => u.id === id)) && !hit.some((u) => !u.enemy);
}

/** How far each camera step wants the view turned (radians), zoomed (share of the distance) or panned (metres). */
const CAMERA = { turned: 0.35, zoomed: 0.15, panned: 1.2 };

/** One camera control, confirmed by itself. */
const cameraStep = (id: "turn" | "zoom" | "pan", index: 0 | 1 | 2): StepSpec => {
  const key = (["turned", "zoomed", "panned"] as const)[index];
  return {
    id,
    frame: false,
    passable: true,
    done: (now, start) => now.camera[key] - start.camera[key] >= CAMERA[key],
    permits: () => false,
  };
};

/** End the turn and watch theirs: done when it is the player's turn again and the scene is still. */
const endTurn = (id: string): StepSpec => ({
  id,
  done: (now, start) => now.phase === "player" && now.turn > start.turn,
  permits: (i) => i.type === "end-turn",
  point: () => [{ hud: "end-turn" }],
});

/** Select `who`. */
const select = (id: string, who: string, active: string[]): StepSpec => ({
  id,
  done: (now) => now.selected === who,
  permits: selectingOf(active),
  point: () => [{ unit: who }, { hud: `member:${who}` }],
});

/** Move `who` to `to`. */
const moveTo = (id: string, who: string, to: Cell, active: string[], extra: Pointer[] = []): StepSpec => ({
  id,
  unit: who,
  done: (now) => at(now, who, to),
  permits: (i) => selectingOf(active)(i) || moving(i, who, to),
  point: () => [{ tiles: [to], tone: "go" }, ...extra],
  cursor: () => to,
});

/** Aim `who` at `target`, then fire: one step, two inputs; done when the shot is taken. */
const fire = (id: string, who: string, target: string, active: string[], done?: StepSpec["done"]): StepSpec => ({
  id,
  unit: who,
  done: done ?? ((now, start) => did(now, start, "shot", who)),
  permits: (i) =>
    selectingOf(active)(i) || arming(i, who, "fire") || (i.type === "fire" && i.unit === who && i.target === target),
  point: (now) =>
    now.mode === "fire" ? [{ hud: "odds" }, { hud: "confirm" }, { unit: target }] : [{ hud: "command:Attack" }, { unit: target }],
});

/**
 * Fire `who` at any of `targets`: the aim may open on another target, so the
 * step points at the right ones and at stepping the aim until one is held.
 */
const fireAny = (id: string, who: string, targets: string[], active: string[], done: StepSpec["done"]): StepSpec => ({
  id,
  unit: who,
  done,
  permits: (i) =>
    selectingOf(active)(i) ||
    i.type === "select" ||
    arming(i, who, "fire") ||
    (i.type === "fire" && i.unit === who && targets.includes(i.target)),
  point: (now) => {
    const open = targets.filter((t) => !down(now, t));
    if (now.mode !== "fire") return [{ hud: "command:Attack" }, ...open.map((t) => ({ unit: t }))];
    return open.includes(now.target) ? [{ hud: "odds" }, { hud: "confirm" }] : [{ hud: "aim-next" }, ...open.map((t) => ({ unit: t }))];
  },
});

/** Arm and throw `order` with `who` so the burst catches `ids` and no operator; `landing` is the marked tile. */
const toss = (
  id: string,
  who: string,
  order: "grenade" | "flashbang",
  kind: string,
  ids: string[],
  landing: (now: GuideSnapshot) => Cell,
  active: string[],
): StepSpec => ({
  id,
  unit: who,
  done: (now, start) => did(now, start, order, who),
  permits: (i, now) =>
    selectingOf(active)(i) ||
    arming(i, who, order) ||
    (i.type === "throw" && i.unit === who && i.order === order && burstFits(now, i.at, ids)),
  point: (now) =>
    now.mode !== order
      ? [{ hud: `command:${kind}` }]
      : burstFits(now, now.throwAt, ids)
        ? [{ hud: "confirm" }, { tiles: [now.throwAt!], tone: "blast" }]
        : [{ tiles: [landing(now)], tone: "blast" }],
  cursor: (now) => (now.mode === order && !burstFits(now, now.throwAt, ids) ? landing(now) : null),
});

/** A stage: where everyone stands, the steps, the dice of the player's shots and the targets' turn. */
export interface StageSpec {
  id: StageId;
  /** Operators and targets in the room, by id; the rest wait outside. */
  allies: Record<string, Cell>;
  hostiles: Record<string, Cell>;
  /** Health of the targets that should not take a recruit's 10. */
  hp?: Record<string, number>;
  /** VEX's rounds, when the stage starts on an empty magazine. */
  ammo?: Record<string, number>;
  steps: StepSpec[];
  /** The player's shots: plain hits, as the aim readout's HIT names them. */
  dice?(game: Encounter, command: Command): ShotOutcome | null;
  /** The targets' turn, as the lesson needs it. */
  turn?(game: Encounter): Generator<GameEvent, void, void>;
}

/** A plain hit for the shooter's own damage stat less armour. */
const plainHit = (game: Encounter, command: Command): ShotOutcome | null => {
  if (command.type !== "fire") return null;
  const a = game.unit(command.unit),
    b = game.unit(command.target);
  return a && b ? { hit: true, damage: Math.max(1, a.damage - b.armor) } : null;
};

/** A target's shot: a hit for 3 on an operator in the open, a miss on one in cover. */
function* targetShot(game: Encounter, from: string, to: string): Generator<GameEvent, void, void> {
  const a = game.unit(from),
    b = game.unit(to);
  if (!a || !b || a.hp <= 0 || b.hp <= 0 || !game.inRange(a, b)) return;
  const command: Command = { type: "fire", unit: from, target: to };
  fixShot(game, command, game.cover(b, a) > 0 || game.chance(a, b) < 20 ? { hit: false } : { hit: true, damage: 3 });
  yield* game.apply(command);
}

/** The cells each stage names. */
export const TILES = {
  contact: { vex: cell(3, 6), target: cell(3, 2) },
  cover: { vex: cell(1, 6), shooter: cell(5, 1), crate: cell(3, 3), wrong: cell(3, 2), right: cell(3, 4), flank: cell(7, 1) },
  grenade: { vex: cell(4, 6), target: cell(4, 1), boxes: [cell(4, 2), cell(3, 1), cell(5, 1)] },
  squad: {
    vex: cell(2, 5),
    ghost: cell(4, 6),
    bishop: cell(5, 5),
    pair: [cell(2, 1), cell(3, 1)] as Cell[],
    flanker: cell(6, 1),
    flash: cell(6, 3),
    flank: cell(6, 4),
  },
};

const ONE = [VEX];
const ALL = [VEX, GHOST, BISHOP];

export const STAGES: StageSpec[] = [
  {
    id: "contact",
    allies: { [VEX]: TILES.contact.vex },
    hostiles: { [T1]: TILES.contact.target },
    hp: { [T1]: 4 },
    dice: plainHit,
    steps: [
      { ...cameraStep("turn", 0), stage: "contact" },
      cameraStep("zoom", 1),
      cameraStep("pan", 2),
      select("select", VEX, ONE),
      fire("fire", VEX, T1, ONE),
      endTurn("end-turn"),
    ],
  },
  {
    id: "cover",
    allies: { [VEX]: TILES.cover.vex },
    hostiles: { [T1]: TILES.cover.shooter },
    hp: { [T1]: 4 },
    dice: plainHit,
    turn: function* (game) {
      yield* game.beginEnemy();
      yield* targetShot(game, T1, VEX);
      if (!game.result) yield* game.nextTurn();
    },
    steps: [
      { ...moveTo("wrong", VEX, TILES.cover.wrong, ONE, [{ unit: T1 }]), stage: "cover" },
      endTurn("hit"),
      {
        ...moveTo("right", VEX, TILES.cover.right, ONE, [{ tiles: [TILES.cover.crate], tone: "prop" }]),
        done: (now, start) =>
          at(now, VEX, TILES.cover.right) && since(now, start).some((e) => e.type === "move" && e.unit === VEX && e.vault),
      },
      endTurn("miss"),
      moveTo("flank", VEX, TILES.cover.flank, ONE, [{ unit: T1 }]),
      fire("drop", VEX, T1, ONE, (now) => down(now, T1)),
    ],
  },
  {
    id: "grenade",
    allies: { [VEX]: TILES.grenade.vex },
    hostiles: { [T1]: TILES.grenade.target },
    hp: { [T1]: 6 },
    ammo: { [VEX]: 0 },
    dice: plainHit,
    turn: function* (game) {
      yield* game.beginEnemy();
      yield* targetShot(game, T1, VEX);
      if (!game.result) yield* game.nextTurn();
    },
    steps: [
      {
        id: "reload",
        stage: "grenade",
        unit: VEX,
        done: (now, start) => did(now, start, "reload", VEX),
        permits: (i) => selectingOf(ONE)(i) || arming(i, VEX, "reload"),
        point: () => [{ hud: "command:Reload" }, { hud: "unit-ammo" }],
      },
      toss("frag", VEX, "grenade", "Grenade", [T1], () => TILES.grenade.target, ONE),
      endTurn("their-shot"),
      fire("finish", VEX, T1, ONE, (now) => down(now, T1)),
    ],
  },
  {
    id: "squad",
    allies: { [VEX]: TILES.squad.vex, [GHOST]: TILES.squad.ghost, [BISHOP]: TILES.squad.bishop },
    hostiles: { [T1]: TILES.squad.pair[0], [T2]: TILES.squad.pair[1], [T3]: TILES.squad.flanker },
    hp: { [T1]: 6, [T2]: 6, [T3]: 4 },
    dice: plainHit,
    // The dazed flanker comes round VEX's barrier and fires: daze took its aim, it misses.
    turn: function* (game) {
      yield* game.beginEnemy();
      const flanker = game.unit(T3);
      if (flanker && flanker.hp > 0) {
        yield* game.apply({ type: "move", unit: T3, to: TILES.squad.flank });
        yield* targetShot(game, T3, VEX);
      }
      if (!game.result) yield* game.nextTurn();
    },
    steps: [
      { ...select("switch", GHOST, ALL), stage: "squad" },
      toss("flash", GHOST, "flashbang", "Flashbang", [T3], () => TILES.squad.flash, ALL),
      toss("pair", VEX, "grenade", "Grenade", [T1, T2], () => TILES.squad.pair[0], ALL),
      fireAny("bishop", BISHOP, [T1, T2], ALL, (now) => down(now, T1) || down(now, T2)),
      fireAny("ghost", GHOST, [T1, T2], ALL, (now) => down(now, T1) && down(now, T2)),
      { ...endTurn("flanked"), relation: () => [T3, VEX] },
      // Free: whatever the player does from here, the flanker can be finished; nothing is held back.
      { id: "win", done: (now) => now.result === "victory", point: () => [{ unit: T3 }] },
    ],
  },
];

/** The closing card: it never completes. */
const CLOSING: StepSpec = { id: "done", permits: () => false };

/** Every step of the run, in order; each stage's first step names the stage. */
export const STEP_SPECS: StepSpec[] = [...STAGES.flatMap((s) => s.steps), CLOSING];

/** The stage an encounter plays: its scenario id is `basics-<stage>` (`scenario.ts`). */
export const stageOfGame = (game: Encounter) => STAGES.find((s) => `basics-${s.id}` === game.scenario.id);

/** The run's script; `scenario` builds a stage's encounter (`scenario.ts`), passed in to keep this file free of it. */
export function basicsScript(scenarios: (id: StageId) => import("../../scenario.ts").Scenario): GuideScript {
  return {
    steps: STEP_SPECS,
    copy: STEPS,
    stages: STAGES.map((s) => ({ id: s.id, title: STAGE_TITLES[s.id] })),
    stageScenario: (id) => scenarios(id as StageId),
    dice: (game, command) => stageOfGame(game)?.dice?.(game, command) ?? null,
    hostileTurn: (game) => {
      const stage = stageOfGame(game);
      return stage?.turn ? stage.turn(game) : passiveTurn(game);
    },
    controls: STAGE_CONTROLS,
    frame: roomCells(),
    relations: true,
    simulation: true,
    prepare: (game) => {
      const stage = stageOfGame(game);
      if (!stage) return;
      for (const [id, hp] of Object.entries(stage.hp ?? {})) {
        const u = game.unit(id);
        if (u) u.hp = u.maxHp = hp;
      }
      for (const [id, ammo] of Object.entries(stage.ammo ?? {})) {
        const u = game.unit(id);
        if (u) u.ammo = ammo;
      }
    },
  };
}

/** The targets' turn when nothing is scripted: it passes. */
export function* passiveTurn(game: Encounter): Generator<GameEvent, void, void> {
  if (game.result || game.phase !== "player") return;
  yield* game.beginEnemy();
  if (!game.result) yield* game.nextTurn();
}
