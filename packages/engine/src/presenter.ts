// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ThrowOrder } from "./action-registry";
import { audio } from "./audio";
import type { PropDamage } from "./environment";
import { pad2 } from "./html";
import type { GameEvent } from "./events";
import type { Cell, Unit } from "./game";
import { turnLine } from "./observer";
import { session } from "./session";
import { leadIn } from "./throw-lead";

/**
 * A shot whose outcome is still on its way: the operator fires now, the target
 * reacts when the answer comes. `outcome` is null when the order was refused.
 */
export async function presentShot(
  a: Unit,
  b: Unit,
  outcome: Promise<Extract<GameEvent, { type: "shot" }> | null>,
) {
  const { battlefield } = session;
  await battlefield.aimReady;
  audio.speak("fire", a);
  audio.tone(a.weapon);
  await battlefield.fire(a, b, outcome.then((shot) => !!shot?.hit), outcome);
  const shot = await outcome;
  if (shot?.killed) audio.speak("kill", a);
  else if (shot?.hit) audio.speak("hit", b);
}

/** What the status line says as each grenade goes off. */
const THROW_LINE: Record<ThrowOrder, string> = {
  grenade: "FRAGMENTATION / AREA IMPACT",
  flashbang: "FLASHBANG / BURST DAZED",
  "smoke-grenade": "SMOKE / BURST COVERED",
};

/** The pin, the throw and the burst of any grenade, voiced and announced. */
async function playThrow(u: Unit, at: Cell, kind: ThrowOrder, go: () => Promise<void>) {
  const { battlefield, observer } = session;
  await leadIn(battlefield, !!observer, u, at);
  audio.speak(kind === "grenade" ? "grenade" : "utility", u);
  audio.tone("pin");
  await go();
  audio.tone(kind === "smoke-grenade" ? "smoke" : "grenade");
  session.notify(THROW_LINE[kind]);
}

/** A throw whose outcome is still on its way: it flies and goes off now, whoever it caught reacts when the answer comes. */
export async function presentThrow(
  u: Unit,
  at: Cell,
  environment: PropDamage[],
  answer: Promise<unknown>,
  kind: ThrowOrder = "grenade",
) {
  await playThrow(u, at, kind, () => session.battlefield.throwAt(u, at, environment, answer, kind));
}

/**
 * Plays one event: the scene animates it, operatives voice it, the status line
 * announces it. Nothing here changes the encounter; the rules already have.
 */
export async function present(event: GameEvent) {
  const { game, battlefield, observer } = session;
  // A viewer has no side: what the player hears of their own squad, it hears of both.
  const ours = (u: Unit) => !!observer || !u.enemy;
  const notify: typeof session.notify = (message, tone) => session.notify(message, tone);
  const unit = "unit" in event ? game.unit(event.unit)! : undefined;
  switch (event.type) {
    case "move":
      if (event.vault && ours(unit!)) notify("TRAVERSING LOW COVER");
      audio.speak(event.cover ? "cover" : "move", unit!);
      await battlefield.play(event);
      return;
    case "shot": {
      const target = game.unit(event.target)!;
      if (event.reaction) {
        notify(`${unit!.name} / OVERWATCH`);
        audio.speak("overwatch", unit!);
      } else if (ours(unit!)) {
        await battlefield.aimReady;
        audio.speak("fire", unit!);
      }
      audio.tone(unit!.weapon);
      await battlefield.play(event);
      if (event.killed) audio.speak("kill", unit!);
      else if (event.hit) audio.speak("hit", target);
      return;
    }
    case "reload":
      audio.tone("reload", unit!.weapon);
      await battlefield.play(event);
      return;
    case "grenade":
    case "flashbang":
    case "smoke-grenade":
      await playThrow(unit!, event.at, event.type, () => battlefield.play(event));
      return;
    case "effect-start":
    case "effect-end":
      // The marker over the unit and the lingering smoke follow on the sync after each event.
      return;
    case "hunker":
      audio.speak("hunker", unit!);
      await battlefield.play(event);
      notify("HUNKERED / DEFENSE INCREASED");
      return;
    case "overwatch":
      await battlefield.play(event);
      notify("OVERWATCH / REACTION FIRE ARMED");
      return;
    case "switch-weapon":
      audio.tone("click");
      return;
    case "watch-spent":
      // The spent watch shows on the marker sync; no line of its own.
      return;
    case "secure":
      notify(game.scenario.lines.securedStamp);
      return;
    case "hostile-phase":
      if (observer) notify(turnLine(observer.turn, observer.sides[1]));
      else notify("HOSTILE ACTIVITY / STAND BY", "miss");
      return;
    case "turn":
      if (observer) notify(turnLine(observer.turn, observer.sides[0]));
      else notify(`TURN ${pad2(event.turn)} / YOUR INITIATIVE`);
      return;
  }
}
