// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { audio } from "./audio";
import { hostilePhase } from "./ai";
import type { Command, GameEvent } from "./events";
import { Encounter, type Cell } from "./game";
import { applyDeploymentNames } from "./squad-bridge";
// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "./mpfb-characters.js";
import { present } from "./presenter";
import { session } from "./session";
import { bestShotTarget, defaultGrenadeTarget, grenadeBlockReason } from "./targeting";

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
  const u = s.selectedUnit(),
    t = s.targetUnit();
  battlefield.sync();
  battlefield.showRange(u, s.mode === "move" && !s.busy);
  if (s.mode === "grenade" && !s.busy) battlefield.showGrenadeRange(u);
  battlefield.setHover(false);
  battlefield.showPath(undefined);
  if (s.mode === "move" || game.result) void battlefield.leaveAim();
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
  if (s.game.result && !s.busy && !s.resultShown && !s.dialogOpen) {
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

/** Present events in order, redrawing after each; the iterable may be lazy. */
async function play(events: Iterable<GameEvent>) {
  for (const event of events) {
    await present(event);
    session.battlefield.sync();
    refresh();
  }
}

/** Send an order for the selected unit and play the result; false when the rules refuse it. */
async function order(command: Command): Promise<boolean> {
  const events = session.game.apply(command);
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
    s.mode = "fire";
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
  if (!b) return;
  await perform(async () => {
    const [shot] = s.game.apply({ type: "fire", unit: a.id, target: b.id });
    if (shot?.type !== "shot") {
      notify("NO SHOT AVAILABLE");
      return;
    }
    await play([shot]);
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
  if (!s.grenadeTarget) return;
  const at: Cell = [...s.grenadeTarget],
    u = s.selectedUnit();
  await perform(async () => {
    if (!(await order({ type: "grenade", unit: u.id, at }))) {
      notify(grenadeBlockReason(s.game, u, at) ?? "THROW UNAVAILABLE");
      return;
    }
    s.grenadeTarget = null;
    s.mode = "move";
    await s.battlefield.leaveAim();
  });
}

const STANDING_ORDERS = ["reload", "hunker", "overwatch", "secure"] as const;

export async function action(name: string) {
  const s = session;
  if (s.busy || !s.game.canAct(s.selectedUnit())) return;
  const u = s.selectedUnit();
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
  if (s.mode === "grenade") {
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
    select(id);
    return;
  }
  if (s.mode === "move") {
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
  await perform(() => play(hostilePhase(game)));
}

/** A fresh encounter with the same deployed squad, then the deployment briefing. */
export function reset() {
  const s = session;
  if (s.busy) return;
  void s.battlefield.leaveAim();
  audio.stopVoice();
  s.game = new Encounter(s.game.scenario);
  applyDeploymentNames(s.game.units, deployment);
  s.battlefield.redeploy(s.game);
  s.resetSelection();
  s.battlefield.select(s.selected);
  s.debrief = false;
  refresh();
  notify("OPERATION RESET / SQUAD DEPLOYED");
  showBriefing("deploy");
}
