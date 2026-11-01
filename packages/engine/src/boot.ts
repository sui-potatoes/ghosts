// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { refresh, showBriefing } from "./actions";
import { audio } from "./audio";
import { bindControls } from "./controls";
import { bindPadCombat } from "./pad-combat";
import type { Cell } from "./game";
import { humanTextureStats, loadOperatives } from "./humans";
// @ts-ignore Native editor adapter is shared JavaScript.
import { loadNativeIdentities } from "./mpfb-characters.js";
import { Battlefield } from "./scene/battlefield";
import { loadDestruction } from "./scene/destruction";
import { mapView } from "./scene/maps";
import type { Recruit } from "@ghosts/squad/types";
import type { Session } from "./session";
import { deploymentLooks } from "./squad-bridge";
import { provideSettings, type EngineSettings } from "./settings";

export interface BootOptions {
  /** A fresh session (`newSession`), already the one the UI renders. */
  session: Session;
  /** The host's saved recruits in squad order; null deploys the showcase squad. */
  squad: readonly Recruit[] | null;
  settings: EngineSettings;
  viewport: HTMLElement;
  labels: HTMLElement;
  reticle: HTMLElement;
  onPause: () => void;
}

/** `?review=` fixtures for local combat and debrief QA; only in the dev server. */
const review =
  import.meta.env.MODE === "development" && import.meta.env.DEV
    ? new URLSearchParams(location.search).get("review")
    : null;

function placeReviewUnits(s: Session) {
  // The fixtures place Black Rain's units; other levels load as authored.
  if (s.game.scenario.id !== "black-rain") return;
  const unit = (id: string) => s.game.unit(id)!;
  if (review === "corner") {
    unit("v").pos = [4, -3];
    unit("h3").pos = [-1, -5];
  } else if (review === "bishop-wall") {
    unit("b").pos = [3, 4];
  } else if (review === "cover-axes") {
    const positions: Cell[] = [[-1, -4], [1, -4], [0, -3], [0, -5]];
    s.game.allies.forEach((u, i) => (u.pos = positions[i]));
  }
}

/**
 * Start an encounter in the given elements: the squad and the map loaded,
 * the scene built and warmed, portraits taken, controls bound, then the
 * deployment briefing. Returns the teardown, safe to call mid-load.
 */
export function boot(options: BootOptions): () => void {
  const { session: s, squad, settings, viewport, labels, reticle, onPause } = options;
  provideSettings(settings);
  const cleanups: (() => void)[] = [];
  let disposed = false;
  audio.prepareVoice();
  window.addEventListener("pointerdown", audio.unlockVoice);
  window.addEventListener("keydown", audio.unlockVoice);
  cleanups.push(() => {
    window.removeEventListener("pointerdown", audio.unlockVoice);
    window.removeEventListener("keydown", audio.unlockVoice);
  });

  void (async () => {
    try {
      if (import.meta.env.DEV) placeReviewUnits(s);
      const renderer = Battlefield.createRenderer();
      cleanups.push(() => {
        if (!s.battlefield) renderer.dispose();
      });
      await loadOperatives(renderer);
      await loadNativeIdentities(s.game.units, deploymentLooks(squad, s.game.units));
      await mapView(s.game.map.plan.id).load(renderer);
      await loadDestruction();
      if (disposed) return;
      viewport.dataset.humanTextures = JSON.stringify(humanTextureStats());
      const battlefield = new Battlefield({ viewport, labels, reticle, game: s.game, renderer });
      s.battlefield = battlefield;
      battlefield.setPaused(s.paused);
      cleanups.push(() => battlefield.dispose());
      const applyRenderMode = () => battlefield.setRenderMode(settings.batterySaver() ? "battery" : "smooth");
      applyRenderMode();
      cleanups.push(settings.subscribe(() => {
        applyRenderMode();
        s.changed();
      }));
      await battlefield.warmup();
      if (disposed) return;
      for (const u of s.game.units.filter((u) => !u.enemy)) s.portraits.set(u.id, battlefield.portrait(u));
      cleanups.push(bindControls({ onPause }));
      cleanups.push(bindPadCombat({ onPause }));
      if (import.meta.env.DEV && review?.startsWith("debrief")) {
        const { prepareDebriefReview } = await import("./aftermath/review");
        prepareDebriefReview(s.game, review);
      }
      s.state = "ready";
      // The briefing first: an encounter that is already over opens its debrief once it closes.
      showBriefing("deploy");
      refresh();
    } catch (error) {
      if (disposed) return;
      s.state = "failed";
      s.changed();
      console.error(error);
    }
  })();

  return () => {
    disposed = true;
    audio.stop();
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
