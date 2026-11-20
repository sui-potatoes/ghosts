// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { audio } from "./audio";
import type { Command, GameEvent } from "./events";
import { ACTIONS, hasKind, isThrowOrder, REFUSAL_TEXT, refusalOf } from "./action-registry";
import { allows, Encounter, type Cell } from "./game";
import { applyDeploymentNames, applyLoadouts } from "./squad-bridge";
// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "./mpfb-characters.js";
import { present, presentShot, presentThrow } from "./presenter";
import { session, type Mode, type Panel } from "./session";
import { gameLook } from "./scene-look";
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
  settleAim();
  const u = s.selectedUnit(),
    t = s.targetUnit();
  battlefield.sync();
  // The aimed hostile's plate carries the odds and the predicted hp cut.
  const aimed = u && s.mode === "fire" && !game.result ? t : undefined;
  battlefield.setAimReadout(
    aimed ?? null,
    u && aimed && { chance: game.chance(u, aimed), ...damagePreview(u, aimed) },
  );
  // A viewer's selection is a readout, not an order: no reach on the ground.
  battlefield.showRange(u, !s.observer && s.mode === "move" && !s.busy && !!u && allows(u, "move"));
  if (u && isThrowOrder(s.mode) && !s.busy) battlefield.showGrenadeRange(u, s.mode);
  battlefield.setHover(false);
  battlefield.showPath(undefined);
  if (!u || s.mode === "move" || game.result) void battlefield.leaveAim();
  else if (s.mode === "fire" && t) void battlefield.aimAt(u, t.pos, "fire");
  else if (isThrowOrder(s.mode)) {
    // Keep the overhead camera while choosing the landing point; shoulder shot begins on throw.
    if (!s.busy) void battlefield.leaveAim();
    if (s.grenadeTarget) battlefield.showPath([u.pos, s.grenadeTarget], true);
  }
}

/**
 * Aiming stays on a hostile in range: should the target fall (or otherwise
 * leave range), the aim moves to the best one left in range, or ends.
 */
function settleAim() {
  const s = session;
  if (s.observer || s.mode !== "fire") return;
  const u = s.selectedUnit(),
    t = s.targetUnit();
  if (!u || (t && s.game.inRange(u, t))) return;
  const next = bestShotTarget(s.game, u);
  if (next) s.target = next.id;
  else s.mode = "move";
}

/** Redraw scene and UI, and open the debrief once the encounter has ended. */
export function refresh() {
  const s = session;
  if (s.state !== "ready") return;
  syncScene();
  if (s.game.result && !s.game.scenario.versus && !s.observer && !s.busy && !s.resultShown && !s.dialogOpen) {
    s.resultShown = true;
    s.debrief = true;
  }
  s.changed();
}

/** Open the briefing; `deploy` adds the squad and the Deploy button. */
export function showBriefing(panel: Panel) {
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
  const u = s.game.units.find((u) => u.id === id);
  if (!u || u.hp <= 0) return;
  // A viewer holds any unit standing, either side, for its readout; it never waits on an animation.
  if (s.observer) {
    s.selected = id;
    s.battlefield.select(id);
    audio.tone("click");
    refresh();
    return;
  }
  if (s.busy) return;
  if (u.enemy) {
    if (isThrowOrder(s.mode)) {
      void pick(u.pos, u.id);
      return;
    }
    // With nobody selected there is no shooter: the hostile is only marked.
    const shooter = s.selectedUnit();
    if (shooter && allows(shooter, "fire")) {
      // Only a hostile in range is aimed at; aiming, if on, stays on its target.
      if (!s.game.inRange(shooter, u)) {
        audio.tone("click");
        notify("OUT OF RANGE", "miss");
        return;
      }
      s.mode = "fire";
    }
    s.target = id;
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
  if ((s.busy && !s.observer) || !s.selected) return;
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
  if (s.observer) return;
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

/** Throw the grenade being aimed (the frag, the flashbang or the smoke grenade: the mode says which). */
export async function throwGrenade() {
  const s = session;
  if (s.observer) return;
  const u = s.selectedUnit();
  const kind = s.mode;
  if (!s.grenadeTarget || !u || !isThrowOrder(kind)) return;
  const at: Cell = [...s.grenadeTarget];
  await perform(async () => {
    const command: Command = { type: kind, unit: u.id, at };
    if (s.driver.remote) {
      // The throw and the burst are certain; only who it caught waits for the answer.
      const environment = kind === "grenade" ? s.game.map.blastProps(at) : [];
      const answer = resolve(command);
      await presentThrow(u, at, environment, answer, kind);
      const events = await answer;
      s.battlefield.sync();
      refresh();
      if (!events.length) notify("ORDER REFUSED", "miss");
      // The effects it left, played once they are known (the throw itself already was).
      else if (kind !== "grenade") await play(events.filter((e) => e.type !== kind));
    } else if (!(await order(command))) {
      notify(grenadeBlockReason(s.game, u, at, kind) ?? "THROW UNAVAILABLE");
      return;
    }
    s.grenadeTarget = null;
    s.mode = "move";
    await s.battlefield.leaveAim();
  });
}

/**
 * Arm or carry out one of the selected unit's actions, by its engine order. What
 * the unit doesn't carry is never offered and does nothing; what it carries and
 * can't take now says why (the same reason the command bar shows).
 */
export async function action(name: string) {
  const s = session;
  const u = s.selectedUnit();
  if (s.busy || s.observer) return;
  if (!u) {
    notify("NO OPERATOR SELECTED");
    return;
  }
  const spec = ACTIONS.find((a) => a.order === name);
  // Never offered to this unit: no key, button or wheel entry gets past here.
  if (!spec || !hasKind(u, spec.id)) return;
  const refusal = refusalOf(s.game, u, spec.id);
  if (refusal) {
    audio.tone("click");
    notify(REFUSAL_TEXT[refusal].toUpperCase(), "miss");
    return;
  }
  audio.tone("click");
  if (spec.targeting.mode !== "none") {
    if (name === "fire" && s.mode === "fire") {
      await fire();
      return;
    }
    if (isThrowOrder(name) && s.mode === name && s.grenadeTarget) {
      await throwGrenade();
      return;
    }
    s.mode = name as Mode;
    s.grenadeTarget = isThrowOrder(name) ? defaultGrenadeTarget(s.game, u, name) : null;
    if (name === "fire") {
      s.target = bestShotTarget(s.game, u)?.id ?? "";
      audio.tone("aim", u.weapon);
    }
    refresh();
    return;
  }
  const type = spec.order as "reload" | "hunker" | "overwatch" | "secure";
  await perform(() => order({ type, unit: u.id }).then(() => {}));
}

/** A click on the field: a tile to move to or aim at, or a unit marker. */
export async function pick(p: Cell, id?: string) {
  const s = session;
  // A viewer's click only picks a unit to read; the ground is nobody's to move on.
  if (s.observer) {
    if (id && id === s.selected) deselect();
    else if (id) select(id);
    return;
  }
  if (s.busy || s.game.result) return;
  const u = s.selectedUnit();
  if (u && isThrowOrder(s.mode)) {
    const reason = grenadeBlockReason(s.game, u, p, s.mode);
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
  if (s.busy || s.observer || game.result || game.phase !== "player") return;
  s.mode = "move";
  s.grenadeTarget = null;
  await battlefield.leaveAim();
  await perform(() => play(s.driver.hostilePhase()));
}

/** Wait out the other side's turn: an encounter can open on it. */
export async function watchOpponent() {
  const s = session;
  if (s.observer) return;
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
  // A new game: an offline one draws a fresh look.
  if (s.game.scenario.look === "drawn") {
    s.look = gameLook(s.game.scenario);
    if (s.look) s.battlefield.setLook(s.look);
  }
  s.driver = s.makeDriver(s.game);
  applyDeploymentNames(s.game.units, deployment);
  applyLoadouts(s.game.units, s.loadouts);
  s.battlefield.redeploy(s.game);
  s.resetSelection();
  s.battlefield.select(s.selected);
  s.debrief = false;
  refresh();
  notify("OPERATION RESET / SQUAD DEPLOYED");
  showBriefing("deploy");
}
