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
import { soundscapeEnabled } from "./switch.ts";

/** Where a unit's sound comes from above its cell (m): chest high. */
const CHEST = 1.2;

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
  battlefield.onShotImpact = () => audio.shotImpact();
  const sync = () => {
    const scape = audio.scape;
    scape.setScene(location, s.look);
    if (!soundscapeEnabled()) return;
    if (s.game.result) {
      scape.resetMix();
      return;
    }
    const u = s.selectedUnit();
    scape.setField({
      aiming: s.mode !== "move" && !!u,
      dazed: !!u && u.hp > 0 && u.effects.some((e) => e.kind === "Daze"),
    });
  };
  const unsubscribe = s.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    battlefield.frameHooks.delete(frame);
    battlefield.onShotSteady = battlefield.onShotImpact = undefined;
    audio.resetMix();
  };
}
