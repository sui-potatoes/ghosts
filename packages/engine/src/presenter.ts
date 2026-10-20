// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { audio } from "./audio";
import { pad2 } from "./html";
import type { GameEvent } from "./events";
import { session } from "./session";

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
