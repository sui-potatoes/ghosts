/**
 * Recorded sound effects from `public/sounds/<name>.mp3`. An effect kind has
 * one or more takes; the player varies them without an immediate repeat.
 * Levels follow the same shell audio settings as voice lines. Kinds without
 * recordings fall back to the synthesized tones in `audio.ts`.
 */

export type EffectKind = "rifle" | "sniper" | "pistol" | "grenade" | "pin" | "click" | "reload" | "aim";
export type EffectWeapon = "rifle" | "sniper" | "pistol";

/**
 * Takes per effect key. A key is the kind, or `<kind>-<weapon>` when the sound
 * depends on the weapon (reloads). Only keys listed here are recorded.
 */
export const EFFECTS: Record<string, string[]> = {
  rifle: ["rifle-burst-01", "rifle-burst-02", "rifle-burst-03", "rifle-burst-04"],
  sniper: ["sniper-rifle-01", "sniper-rifle-02", "sniper-rifle-03"],
  pistol: ["pistol-01", "pistol-02", "pistol-03"],
  "reload-pistol": ["pistol-reload-01", "pistol-reload-02", "pistol-reload-03"],
  "reload-rifle": ["rifle-reload-01", "rifle-reload-02", "rifle-reload-03"],
  // The sniper reuses the rifle reload until it has takes of its own.
  "reload-sniper": ["rifle-reload-01", "rifle-reload-02", "rifle-reload-03"],
  // Raising the weapon when fire mode opens.
  "aim-pistol": ["pistol-click-01"],
  // The pin comes out as the grenade leaves the hand; the blast lands with it.
  pin: ["grenade-safety-01"],
  grenade: ["grenade-explodes-01"],
};

/** The recorded key for a kind, weapon-specific first, or null when neither exists. */
export function effectKey(kind: EffectKind, weapon?: EffectWeapon): string | null {
  if (weapon && EFFECTS[`${kind}-${weapon}`]) return `${kind}-${weapon}`;
  return EFFECTS[kind] ? kind : null;
}

export function effectUrl(name: string): string {
  return `/sounds/${name}.mp3`;
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
