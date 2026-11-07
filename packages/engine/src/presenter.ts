// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { audio } from "./audio";
import type { PropDamage } from "./environment";
import { pad2 } from "./html";
import type { GameEvent } from "./events";
import type { Cell, Unit } from "./game";
import { session } from "./session";

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
  await battlefield.fire(a, b, outcome.then((shot) => !!shot?.hit));
  const shot = await outcome;
  if (shot?.killed) audio.speak("kill", a);
  else if (shot?.hit) audio.speak("hit", b);
}

/** A throw whose casualties are still on their way: it flies and goes off now, they react when the answer comes. */
export async function presentThrow(u: Unit, at: Cell, environment: PropDamage[], answer: Promise<unknown>) {
  const { battlefield } = session;
  await battlefield.aimAt(u, at, "grenade");
  audio.speak("grenade", u);
  audio.tone("pin");
  await battlefield.throwAt(u, at, environment, answer);
  audio.tone("grenade");
  session.notify("FRAGMENTATION / AREA IMPACT");
}

/**
 * Plays one event: the scene animates it, operatives voice it, the status line
 * announces it. Nothing here changes the encounter; the rules already have.
 */
export async function present(event: GameEvent) {
  const { game, battlefield } = session;
  const notify: typeof session.notify = (message, tone) => session.notify(message, tone);
  const unit = "unit" in event ? game.unit(event.unit)! : undefined;
  switch (event.type) {
    case "move":
      if (event.vault && !unit!.enemy) notify("TRAVERSING LOW COVER");
      audio.speak(event.cover ? "cover" : "move", unit!);
      await battlefield.play(event);
      if (!unit!.enemy && game.weaponAt(unit!.pos)) notify(`${game.weaponAt(unit!.pos)!.toUpperCase()} ON THE GROUND`);
      return;
    case "shot": {
      const target = game.unit(event.target)!;
      if (event.reaction) {
        notify(`${unit!.name} / OVERWATCH`);
        audio.speak("overwatch", unit!);
      } else if (!unit!.enemy) {
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
      if (!unit!.enemy) notify(`${unit!.name} / MAGAZINE READY`);
      return;
    case "pick-up":
      audio.tone("reload", unit!.weapon);
      await battlefield.play(event);
      notify(`${unit!.name} / ${event.weapon.toUpperCase()} TAKEN`);
      return;
    case "grenade":
      await battlefield.aimAt(unit!, event.at, "grenade");
      audio.speak("grenade", unit!);
      audio.tone("pin");
      await battlefield.play(event);
      audio.tone("grenade");
      notify("FRAGMENTATION / AREA IMPACT");
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
      notify("HOSTILE ACTIVITY / STAND BY", "miss");
      return;
    case "turn":
      notify(`TURN ${pad2(event.turn)} / YOUR INITIATIVE`);
      return;
  }
}
