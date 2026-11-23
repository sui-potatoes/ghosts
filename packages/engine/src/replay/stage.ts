// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The playback's stage in the mounted encounter: events go through the same
 * presenter a game uses (`present`), a seek rebuilds the rules from the start
 * and snaps the field (`Battlefield.rebuild`), the speed is the scene clock's
 * time scale. Above 1x voice lines are off; sound effects follow the events.
 */

import { refresh } from "../actions";
import { audio } from "../audio";
import type { Encounter } from "../game";
// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "../mpfb-characters.js";
import { present } from "../presenter";
import { reducedMotion } from "../scene/effects";
import { session } from "../session";
import { applyDeploymentNames, applyLoadouts } from "../squad-bridge";
import type { PlaybackStage } from "./playback";
import { rebuildEncounter, sideInPhase, type RecordSource } from "./timeline";

export interface SceneStage extends PlaybackStage {
  /** The side whose turn the game opens on. */
  readonly firstSide: 0 | 1;
  /** The turn number it opens on, as a player's HUD shows it. */
  readonly firstRound: number;
}

export function sceneStage(source: RecordSource): SceneStage {
  /** The start as every rebuild makes it: the deployed names and gear, then the source's own. */
  const prepare = (game: Encounter) => {
    applyDeploymentNames(game.units, deployment);
    applyLoadouts(game.units, session.loadouts);
    source.prepare?.(game);
  };
  const s = session;
  const first = rebuildEncounter(s.game.scenario, [], 0, prepare);
  return {
    firstSide: sideInPhase(first),
    firstRound: first.turn,

    rebuild(events, index) {
      audio.stopVoice();
      // Sound design: no duck, dip or daze outlives a seek.
      audio.resetMix();
      const game = rebuildEncounter(s.game.scenario, events, index, prepare);
      s.game = game;
      s.driver = s.makeDriver(game);
      // The turn number a player sees: the encounter's own.
      if (s.observer) s.observer.turn = game.turn;
      s.busy = false;
      s.mode = "move";
      s.grenadeTarget = null;
      s.battlefield.rebuild(game);
      s.settleSelection();
      refresh();
    },

    async present(event) {
      s.game.ingest(event);
      if (s.observer) s.observer.turn = s.game.turn;
      s.busy = true;
      refresh();
      try {
        await present(event);
      } finally {
        s.busy = false;
        s.battlefield.sync();
        refresh();
      }
    },

    wait: (seconds) => (seconds > 0 ? s.battlefield.tween(seconds, () => {}) : Promise.resolve()),

    async finish(done) {
      audio.quiet = true;
      audio.stopVoice();
      try {
        await s.battlefield.finish(done);
      } finally {
        audio.quiet = false;
      }
    },

    setTimeScale(scale) {
      s.battlefield.timeScale = scale;
      // A held field holds its sound too: the voice line playing stops with it.
      if (scale === 0) audio.stopVoice();
    },

    reduced: reducedMotion,

    outcome() {
      const { result } = s.game;
      return result === "victory" ? { winner: 0 } : result === "defeat" ? { winner: 1 } : null;
    },

    setVoice(on) {
      audio.voiceOff = !on;
      if (!on) audio.stopVoice();
    },
  };
}
