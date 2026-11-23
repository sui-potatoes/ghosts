// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Recorded sound effects, as the sound manifest lists them
 * (`audio/manifest.ts`). An effect kind has one or more takes; the player
 * varies them without an immediate repeat. Levels follow the same shell
 * audio settings as voice lines. Kinds without recordings fall back to the
 * synthesized tones in `audio.ts`. With the soundscape on
 * (`audio/switch.ts`), `CombatAudio` plays the same slots positioned in the
 * scene instead of through `EffectPlayer`.
 */

import { slotFiles, soundUrl, stem, type SlotId } from "./audio/manifest.ts";

/** `smoke`: the smoke grenade's hiss, synthesized (no recording). */
export type EffectKind = "rifle" | "sniper" | "pistol" | "grenade" | "pin" | "click" | "reload" | "aim" | "smoke";
export type EffectWeapon = "rifle" | "sniper" | "pistol";

/** The manifest slot each effect key plays. */
const EFFECT_SLOTS: Record<string, SlotId> = {
  rifle: "weapon.rifle.shot",
  sniper: "weapon.sniper.shot",
  pistol: "weapon.pistol.shot",
  "reload-pistol": "weapon.pistol.reload",
  "reload-rifle": "weapon.rifle.reload",
  "reload-sniper": "weapon.sniper.reload",
  // Raising the weapon when fire mode opens.
  "aim-pistol": "weapon.pistol.raise",
  // The pin comes out as the grenade leaves the hand; the blast lands with it.
  pin: "grenade.pin",
  grenade: "grenade.blast",
};

/** Synthesized kinds, with no recording: slots only the sound manifest plays. */
const TONE_SLOTS: Partial<Record<EffectKind, SlotId>> = {
  smoke: "grenade.smoke",
  click: "combat.click",
};

/**
 * Takes per effect key, from the sound manifest (`audio/manifest.ts`). A key
 * is the kind, or `<kind>-<weapon>` when the sound depends on the weapon
 * (reloads). Only keys listed here are recorded.
 */
export const EFFECTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(EFFECT_SLOTS).map(([key, id]) => [key, slotFiles(id).map(stem)]),
);

/** The recorded key for a kind, weapon-specific first, or null when neither exists. */
export function effectKey(kind: EffectKind, weapon?: EffectWeapon): string | null {
  if (weapon && EFFECTS[`${kind}-${weapon}`]) return `${kind}-${weapon}`;
  return EFFECTS[kind] ? kind : null;
}

/** The manifest slot an effect plays, recorded or synthesized; null when it has none. */
export function effectSlot(kind: EffectKind, weapon?: EffectWeapon): SlotId | null {
  const key = effectKey(kind, weapon);
  return key ? EFFECT_SLOTS[key] : (TONE_SLOTS[kind] ?? null);
}

/** A take's URL: the manifest's file with that name. */
export function effectUrl(name: string): string {
  for (const id of Object.values(EFFECT_SLOTS)) {
    const file = slotFiles(id).find((f) => stem(f) === name);
    if (file) return soundUrl(file);
  }
  return soundUrl(name);
}

/** A take for `key` that is not the one used last time, or null when none is recorded. */
export function pickTake(
  key: string | null,
  last: string | null,
  random: () => number = Math.random,
): string | null {
  const takes = key ? EFFECTS[key] : undefined;
  if (!takes?.length) return null;
  const fresh = takes.length > 1 ? takes.filter((t) => t !== last) : takes;
  return fresh[Math.floor(random() * fresh.length)] ?? null;
}

/** Effects may overlap (two shots close together); pausing stops them all. */
export class EffectPlayer {
  private last = new Map<string, string>();
  private playing = new Set<HTMLAudioElement>();
  private paused = false;

  private readonly level: () => number;

  /** `level` is the current effects volume, 0 to 1. */
  constructor(level: () => number) {
    this.level = level;
  }

  /** Returns the take played, or null when the kind has no recording or audio is off. */
  play(kind: EffectKind, weapon?: EffectWeapon): string | null {
    const key = effectKey(kind, weapon);
    const take = pickTake(key, (key && this.last.get(key)) ?? null);
    if (!key || !take) return null;
    this.last.set(key, take);
    const volume = this.level();
    if (volume <= 0 || this.paused) return take;
    const audio = new Audio(effectUrl(take));
    audio.volume = volume;
    this.playing.add(audio);
    audio.onended = () => this.playing.delete(audio);
    document.body.dataset.sfx = take;
    audio.play().catch(() => this.playing.delete(audio));
    return take;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) return;
    for (const audio of this.playing) audio.pause();
    this.playing.clear();
  }
}
