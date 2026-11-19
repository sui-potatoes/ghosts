// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { createFlashbang, flashbangFinish } from "./flashbang.ts";
import { createFragGrenade, fragGrenadeFinish } from "./frag-grenade.ts";
import { createSmokeGrenade, smokeGrenadeFinish } from "./smoke-grenade.ts";
import type { Equipment } from "../types.ts";

/**
 * The utilities' models for the Armory stage only. Recruits, encounters and
 * the engine keep their own field-supply models through `EquipmentAssets`;
 * nothing here is reachable from them.
 *
 * A model is built once per kind and shared by reference count, like the
 * rifles in `armory-weapons.ts`. Objects are real size (an 11 cm grenade next
 * to a rifle of almost a metre), so the stage frames them by their own bounds.
 * The bands carry no stencil text: the builder only exports where the labels
 * go (`FRAG_GRENADE_STENCILS`), and the guns' stencils are applied by the
 * offline bake, which the stage does not run.
 */

/** Models the stage has a utility model for: the catalog's (`Equipment.model`)
 * and the Armory-only `smoke` and `flash`, which no recruit can carry. */
export type ArmoryUtility =
  Extract<Equipment["model"], "grenade"> | "smoke" | "flash";
const UTILITIES: readonly string[] = ["grenade", "smoke", "flash"];
export const isArmoryUtility = (model: string): model is ArmoryUtility =>
  UTILITIES.includes(model);

/** Upright, leaning a little away so lever, pin and band all show. */
const lean = (root: T.Group) => {
  root.rotation.set(0, 0, T.MathUtils.degToRad(-12));
  return root;
};

/** How each utility stands on the stage. */
const DISPLAY = {
  grenade: {
    build: () => {
      // The model's own dark finish reads well under the stage lighting.
      const root = createFragGrenade({
        detail: "high",
        finish: fragGrenadeFinish(),
      });
      // Upright, leaning a little away so lever, pin and band all show.
      root.rotation.set(0, 0, T.MathUtils.degToRad(-12));
      return root;
    },
  },
  smoke: {
    build: () =>
      lean(
        createSmokeGrenade({ detail: "high", finish: smokeGrenadeFinish() }),
      ),
  },
  flash: {
    build: () =>
      lean(createFlashbang({ detail: "high", finish: flashbangFinish() })),
  },
} satisfies Record<ArmoryUtility, { build(): T.Group }>;

interface Entry {
  group: T.Group;
  refs: number;
}
const cache = new Map<ArmoryUtility, Entry>();
/** Idle models kept for quick returns while browsing. */
const KEEP = 2;

function dispose(group: T.Group) {
  const materials = new Set<T.Material>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    o.geometry.dispose();
    materials.add(o.material);
  });
  materials.forEach((m) => {
    for (const v of Object.values(m)) if (v instanceof T.Texture) v.dispose();
    m.dispose();
  });
}

function trim() {
  const idle = [...cache].filter(([, e]) => e.refs === 0);
  while (idle.length > KEEP) {
    const [key, entry] = idle.shift()!;
    cache.delete(key);
    dispose(entry.group);
  }
}

export interface ArmoryUtilityModel {
  /** A clone sharing geometry and materials with the cached build. */
  model: T.Group;
  /** Call once when the stage lets go of the model. */
  release(): void;
}

/** The utility's stage model, shared per kind. */
export function acquireArmoryUtility(kind: ArmoryUtility): ArmoryUtilityModel {
  let entry = cache.get(kind);
  if (!entry) {
    entry = { group: DISPLAY[kind].build(), refs: 0 };
    cache.set(kind, entry);
  } else {
    // Re-insert so the idle list stays in least-recently-used order.
    cache.delete(kind);
    cache.set(kind, entry);
  }
  entry.refs++;
  const held = entry;
  let released = false;
  return {
    model: held.group.clone(),
    release() {
      if (released) return;
      released = true;
      held.refs--;
      trim();
    },
  };
}
