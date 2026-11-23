// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The soundscape's hold on a mounted field: the camera as the ear on every
 * rendered frame, shot impacts, and the session's state (location, look,
 * aiming, the held unit dazed, the end of the match) as the mix and the
 * ambience read it. The same in a match, training, spectating and replays:
 * they all mount the same field.
 */

import { audio } from "../audio.ts";
import { CELL, type Cell } from "../map.ts";
import type { Session } from "../session.ts";
import { mixInputsOf } from "./mix-model.ts";
import { soundscapeEnabled } from "./switch.ts";

/** Where a unit's sound comes from above its cell (m): chest high. */
const CHEST = 1.2;
/** From a fatal hit to the body landing (ms). */
const FALL_MS = 450;

/** `ghosts:soundscape-debug` = `1` on this device: the live soundscape at `window.__ghostsSoundscape`, for QA. */
function exposeForQa() {
  try {
    if (localStorage.getItem("ghosts:soundscape-debug") === "1")
      (globalThis as { __ghostsSoundscape?: unknown }).__ghostsSoundscape = audio.scape;
  } catch {
    // No storage: nothing exposed.
  }
}

/** Hear the session's field; returns the teardown. */
export function hearField(s: Session): () => void {
  const battlefield = s.battlefield;
  const b = s.game.map.bounds;
  const location = battlefield.indoors ? "office" : "street";
  audio.attachField({
    camera: () => battlefield.camera.matrixWorld.elements,
    location,
    bounds: { minX: b.minX * CELL, maxX: b.maxX * CELL, minZ: b.minZ * CELL, maxZ: b.maxZ * CELL },
    locate: ([cx, cz]: Cell) => {
      const x = cx * CELL,
        z = cz * CELL;
      return { x, y: s.game.map.surfaceHeight(x, z) + CHEST, z };
    },
  });
  exposeForQa();
  const frame = () => audio.scape.frame();
  battlefield.frameHooks.add(frame);
  // Any other shot (a reaction, the other side, a viewer's) dips as its shooter settles.
  battlefield.onShotSteady = () => audio.beginShot();
  battlefield.onShotImpact = (at, hit, broke) => {
    audio.shotImpact();
    if (broke) audio.cue("field.debris", at);
    // A hit strikes the target; a miss snaps past it and strikes behind. An outcome still on its way sounds when it comes.
    void Promise.resolve(hit).then((landed) => audio.cue(landed ? "unit.hit" : "unit.miss", at));
  };
  // The blast or the smoke where the throw lands, as it lands.
  battlefield.onThrowImpact = (kind, at) => audio.tone(kind === "smoke-grenade" ? "smoke" : "grenade", undefined, at);
  battlefield.onUnitStep = (at, kind) => audio.cue(kind === "vault" ? "unit.vault" : "unit.step", at);
  // The hit itself sounds at the shot's impact (a frag's in its blast); a fall lands partway through.
  battlefield.onUnitReaction = (at, down) => {
    if (!down) return;
    const point = { x: at.x, y: at.y + 0.3, z: at.z };
    setTimeout(() => audio.cue("unit.down", point), FALL_MS);
  };
  const sync = () => {
    const scape = audio.scape;
    scape.setScene(location, s.look);
    if (!soundscapeEnabled()) return;
    if (s.game.result) {
      scape.resetMix();
      return;
    }
    scape.setField(mixInputsOf(s.mode, s.selectedUnit()));
  };
  const unsubscribe = s.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    battlefield.frameHooks.delete(frame);
    battlefield.onShotSteady = battlefield.onShotImpact = battlefield.onThrowImpact = undefined;
    battlefield.onUnitStep = battlefield.onUnitReaction = undefined;
    audio.resetMix();
  };
}
