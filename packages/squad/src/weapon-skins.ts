// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Equipment } from "./types.ts";

/**
 * Weapon finishes (skins): baked colour, roughness and metalness for a gun's
 * texture atlas, shown on the Armory stage. Local to the device for now —
 * nothing about a skin is on chain. "factory" is the gun as built, untextured.
 * No three.js here, so screens can list skins without loading a renderer.
 */
export interface WeaponSkin {
  id: string;
  name: string;
  /** A few representative tones for a swatch, light to dark not required. */
  swatch: string[];
}

export const FACTORY_SKIN = "factory";

const FACTORY: WeaponSkin = {
  id: FACTORY_SKIN,
  name: "Factory",
  swatch: ["#2e3133", "#272f33", "#4b5256"],
};

/** Skins per weapon model, after Factory. Only the service rifle has any yet. */
const SKINS: Partial<Record<Equipment["model"], WeaponSkin[]>> = {
  rifle: [
    {
      id: "standard",
      name: "Standard",
      swatch: ["#3d4246", "#2b3338", "#8a9196"],
    },
    {
      id: "camo",
      name: "Camo",
      swatch: ["#4a4d3c", "#6f6a55", "#232520", "#5a6462"],
    },
    {
      id: "hardtest",
      name: "Hard Test",
      swatch: ["#d9d4c7", "#c8551e", "#111316"],
    },
    { id: "heavy", name: "Heavy", swatch: ["#3d4246", "#a3a8aa", "#2b3338"] },
  ],
};

/** Every finish a model can wear, Factory first; just Factory when it has no skins. */
export function skinsFor(model: Equipment["model"]): WeaponSkin[] {
  return [FACTORY, ...(SKINS[model] ?? [])];
}

/** `skin` when the model has it, else Factory (unknown or stale ids fall back). */
export function validSkin(
  model: Equipment["model"],
  skin: string | undefined,
): string {
  return skin && SKINS[model]?.some((s) => s.id === skin) ? skin : FACTORY_SKIN;
}
