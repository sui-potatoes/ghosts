// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { audio } from "./audio";
import type { Command, GameEvent } from "./events";
import { Encounter, type Cell } from "./game";
import { applyDeploymentNames } from "./squad-bridge";
// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "./mpfb-characters.js";
import { present, presentShot, presentThrow } from "./presenter";
import { session } from "./session";
import { bestShotTarget, damagePreview, defaultGrenadeTarget, grenadeBlockReason } from "./targeting";

/**
 * Everything that changes the encounter: player orders, the hostile phase,
 * the reset. Orders go to the rules as commands; what comes back is played
 * event by event, redrawing after each.
 */

const notify: typeof session.notify = (message, tone) => session.notify(message, tone);

/**
 * Bring the scene in line with the session: selection, the range or throw
 * overlay, and the aim camera that goes with the targeting mode.
 */
function syncScene() {
  const s = session;
  const { game, battlefield } = s;
  battlefield.invalidate();
  s.settleSelection();
  battlefield.showDropped((game.authority?.dropped() ?? []).map((d) => d.cell));
  const u = s.selectedUnit(),
    t = s.targetUnit();
  battlefield.sync();
  // The aimed hostile's plate carries the odds and the predicted hp cut.
  const aimed = u && s.mode === "fire" && !game.result ? t : undefined;
  battlefield.setAimReadout(
    aimed ?? null,
    u && aimed && { chance: game.chance(u, aimed), ...damagePreview(u, aimed) },
  );
  battlefield.showRange(u, s.mode === "move" && !s.busy);
  if (u && s.mode === "grenade" && !s.busy) battlefield.showGrenadeRange(u);
  battlefield.setHover(false);
  battlefield.showPath(undefined);
  if (!u || s.mode === "move" || game.result) void battlefield.leaveAim();
  else if (s.mode === "fire" && t) void battlefield.aimAt(u, t.pos, "fire");
  else if (s.mode === "grenade") {
    // Keep the overhead camera while choosing the landing point; shoulder shot begins on throw.
    if (!s.busy) void battlefield.leaveAim();
    if (s.grenadeTarget) battlefield.showPath([u.pos, s.grenadeTarget], true);
  }
}

/** Redraw scene and UI, and open the debrief once the encounter has ended. */
export function refresh() {
  const s = session;
  if (s.state !== "ready") return;
  syncScene();
  if (s.game.result && !s.game.scenario.versus && !s.busy && !s.resultShown && !s.dialogOpen) {
    s.resultShown = true;
    s.debrief = true;
  }
  s.changed();
}

/** Open the briefing; `deploy` adds the squad and the Deploy button. */
export function showBriefing(panel: "intel" | "deploy") {
  session.panel = panel;
  session.changed();
}

/** The briefing closed: back to the field, and on to the debrief if the encounter is over. */
export function closeBriefing() {
  session.panel = null;
  refresh();
}

/**
 * The debrief closed. Its close event arrives after a Redeploy has already
 * reset the encounter, so it clears only the debrief.
 */
export function closeDebrief() {
  session.debrief = false;
  refresh();
}

/** Present events in order, redrawing after each; the iterable may be lazy or async. */
async function play(events: Iterable<GameEvent> | AsyncIterable<GameEvent>) {
  for await (const event of events) {
    await present(event);
    session.battlefield.sync();
    refresh();
  }
}

/** Ask the driver what an order does; `resolving` is up while a transaction may be in flight. */
async function resolve(command: Command): Promise<GameEvent[]> {
  const s = session;
  s.resolving = true;
  s.changed();
  try {
    return await s.driver.resolve(command);
  } finally {
    s.resolving = false;
  }
}

/** Send an order for the selected unit and play the result; false when the rules refuse it. */
async function order(command: Command): Promise<boolean> {
  const events = await resolve(command);
  await play(events);
  return events.length > 0;
}

/** Run one animated order with the UI locked; `busy` gates every other input. */
async function perform(fn: () => Promise<void>) {
  if (session.busy || session.game.result) return;
  session.busy = true;
  refresh();
  try {
    await fn();
  } catch (error) {
    // A driver that could not answer (a failed transaction) leaves the rules unchanged.
    console.error(error);
    notify("ORDER FAILED / LINK DOWN", "miss");
  } finally {
    session.busy = false;
    refresh();
  }
}

export function select(id: string) {
  const s = session;
  if (s.busy) return;
  const u = s.game.units.find((u) => u.id === id);
  if (!u || u.hp <= 0) return;
  if (u.enemy) {
    if (s.mode === "grenade") {
      void pick(u.pos, u.id);
      return;
    }
    s.target = id;
    // With nobody selected there is no shooter: the hostile is only marked.
    if (s.selected) s.mode = "fire";
  } else {
    if (s.selected !== id) audio.speak("select", u);
    s.selected = id;
    s.battlefield.select(id);
    s.mode = "move";
    s.grenadeTarget = null;
  }
  audio.tone("click");
  refresh();
}

/** Stand the selected operator down: nobody takes orders until the next pick. */
export function deselect() {
  const s = session;
  if (s.busy || !s.selected) return;
  s.selected = "";
  s.battlefield.select("");
  s.mode = "move";
  s.grenadeTarget = null;
  audio.tone("click");
  refresh();
}

export function cancelTargeting() {
  if (session.busy) return;
  session.mode = "move";
  session.grenadeTarget = null;
  refresh();
}

export async function fire() {
  const s = session;
  const a = s.selectedUnit(),
    b = s.targetUnit();
  if (!a || !b) return;
  await perform(async () => {
    const command: Command = { type: "fire", unit: a.id, target: b.id };
    let shot: GameEvent | undefined;
    if (s.driver.remote) {
      // The order goes out and the operator opens fire at once; only what the
      // shot did waits for the answer.
      const answer = resolve(command).then(([e]) => (e?.type === "shot" ? e : null));
      await presentShot(a, b, answer);
      shot = (await answer) ?? undefined;
      s.battlefield.sync();
      refresh();
      if (!shot) {
        s.mode = "move";
        await s.battlefield.leaveAim();
        notify("ORDER REFUSED", "miss");
        return;
      }
    } else {
      [shot] = await resolve(command);
      if (shot?.type !== "shot") {
        notify("NO SHOT AVAILABLE");
        return;
      }
      await play([shot]);
    }
    s.mode = "move";
    await s.battlefield.leaveAim();
    notify(
      shot.hit
        ? `${shot.crit ? "CRITICAL HIT" : "CONFIRMED HIT"} / −${shot.damage} HP${shot.killed ? " / TARGET DOWN" : ""}`
        : "SHOT MISSED",
      shot.hit ? "hit" : "miss",
    );
  });
}

export async function throwGrenade() {
  const s = session;
  const u = s.selectedUnit();
  if (!s.grenadeTarget || !u) return;
  const at: Cell = [...s.grenadeTarget];
  await perform(async () => {
    const command: Command = { type: "grenade", unit: u.id, at };
    if (s.driver.remote) {
      // The throw and the blast are certain; only who it hurt waits for the answer.
      const environment = s.game.map.blastProps(at);
      const answer = resolve(command);
      await presentThrow(u, at, environment, answer);
      const thrown = (await answer).length > 0;
      s.battlefield.sync();
      refresh();
      if (!thrown) notify("ORDER REFUSED", "miss");
    } else if (!(await order(command))) {
      notify(grenadeBlockReason(s.game, u, at) ?? "THROW UNAVAILABLE");
      return;
    }
    s.grenadeTarget = null;
    s.mode = "move";
    await s.battlefield.leaveAim();
  });
}

const STANDING_ORDERS = ["reload", "pick-up", "hunker", "overwatch", "secure"] as const;

/** Orders the bundled rules have and a game against a player does not. */
const VERSUS_OFF = ["overwatch", "hunker", "secure"];

export async function action(name: string) {
  const s = session;
  const u = s.selectedUnit();
  if (s.busy) return;
  if (!u) {
    notify("NO OPERATOR SELECTED");
    return;
  }
  if (!s.game.canAct(u)) return;
  if (s.game.scenario.versus && VERSUS_OFF.includes(name)) return;
  if (name === "pick-up" && !s.game.weaponAt(u.pos)) {
    notify("NO WEAPON HERE");
    return;
  }
  audio.tone("click");
  if (name === "move" || name === "fire" || name === "grenade") {
    if (name === "fire" && s.mode === "fire") {
      await fire();
      return;
    }
    if (name === "grenade" && s.mode === "grenade" && s.grenadeTarget) {
      await throwGrenade();
      return;
    }
    s.mode = name;
    s.grenadeTarget = name === "grenade" ? defaultGrenadeTarget(s.game, u) : null;
    if (name === "fire") {
      s.target = bestShotTarget(s.game, u)?.id ?? "";
      audio.tone("aim", u.weapon);
    }
    refresh();
    return;
  }
  const type = STANDING_ORDERS.find((o) => o === name);
  if (type) await perform(() => order({ type, unit: u.id }).then(() => {}));
}

/** A click on the field: a tile to move to or aim at, or a unit marker. */
export async function pick(p: Cell, id?: string) {
  const s = session;
  if (s.busy || s.game.result) return;
  const u = s.selectedUnit();
  if (u && s.mode === "grenade") {
    const reason = grenadeBlockReason(s.game, u, p);
    if (reason) {
      notify(reason);
      return;
    }
    s.grenadeTarget = p;
    refresh();
    s.battlefield.showPath([u.pos, p], true);
    return;
  }
  if (id) {
    // A second click on the operator taking orders stands them down.
    if (id === s.selected && s.mode === "move") deselect();
    else select(id);
    return;
  }
  if (u && s.mode === "move") {
    await perform(async () => {
      if (!(await order({ type: "move", unit: u.id, to: p })))
        notify("DESTINATION UNAVAILABLE");
    });
  }
}

export async function endTurn() {
  const s = session;
  const { game, battlefield } = s;
  if (s.busy || game.result || game.phase !== "player") return;
  s.mode = "move";
  s.grenadeTarget = null;
  await battlefield.leaveAim();
  await perform(() => play(s.driver.hostilePhase()));
}

/** Wait out the other side's turn: an encounter can open on it. */
export async function watchOpponent() {
  const s = session;
  await perform(() => play(s.driver.watch?.() ?? s.driver.hostilePhase()));
}

/**
 * The game moved on to the other side's turn without this player: follow it. Safe
 * to call at any time, and again: it waits for the scene, leaves a running phase
 * alone, picks up a watch that stopped, and never ends the player's own turn.
 */
export async function followOpponent() {
  const s = session;
  if (s.state !== "ready" || s.busy) return;
  await watchOpponent();
}

/**
 * The driver found the field out of line with what really happened, after an
 * order it had already answered was refused: play the way back, once the player
 * is out of what they are in the middle of, and say so.
 */
export async function correctEncounter(events: GameEvent[], message: string) {
  const s = session;
  while (s.busy) await new Promise((resolve) => setTimeout(resolve, 100));
  if (s.state !== "ready") return;
  await perform(() => play(events));
  refresh();
  notify(message, "miss");
}

/** A fresh encounter with the same deployed squad, then the deployment briefing. */
export function reset() {
  const s = session;
  if (s.busy) return;
  void s.battlefield.leaveAim();
  audio.stopVoice();
  s.game = new Encounter(s.game.scenario);
  s.driver = s.makeDriver(s.game);
  applyDeploymentNames(s.game.units, deployment);
  s.battlefield.redeploy(s.game);
  s.resetSelection();
  s.battlefield.select(s.selected);
  s.debrief = false;
  refresh();
  notify("OPERATION RESET / SQUAD DEPLOYED");
  showBriefing("deploy");
}
