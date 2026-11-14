// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Equipment } from "./types.ts";
import { SKIN_RECIPES } from "./skin-recipes.ts";

/**
 * Weapon finishes (skins): baked colour, roughness and metalness for a gun's
 * texture atlas, from one recipe per skin (`skin-recipes.ts`), shown on the
 * Armory stage and in a recruit's hands at Headquarters. Local to the device for now —
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

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
/** The recipe's paint and pattern tones, for the picker's swatch. */
function swatch(id: string): string[] {
  const r = SKIN_RECIPES[id];
  const tones = r.pattern?.tones.map((t) => t.color) ?? [
    r.shell.color,
    r.frame.color,
  ];
  return [...new Set([...tones, r.wear?.color ?? r.ink])].map(hex);
}
const skin = (id: string, name: string): WeaponSkin => ({
  id,
  name,
  swatch: swatch(id),
});

/** The finishes every long gun wears, after Factory: one recipe each
 * (`skin-recipes.ts`), baked per gun. */
const LONG_GUN_SKINS: WeaponSkin[] = [
  skin("standard", "Standard"),
  skin("camo", "Woodland"),
  skin("desert", "Desert"),
  skin("urban", "Urban"),
  skin("arctic", "Arctic"),
  skin("worn", "Worn Steel"),
  skin("hardtest", "Hard Test"),
];

/** Skins per weapon model, after Factory. The sidearm has none. */
const SKINS: Partial<Record<Equipment["model"], WeaponSkin[]>> = {
  rifle: LONG_GUN_SKINS,
  sniper: LONG_GUN_SKINS,
  plasma: LONG_GUN_SKINS,
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
