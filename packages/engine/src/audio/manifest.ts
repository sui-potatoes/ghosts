// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The sound manifest: every sound the game plays, by slot. A slot names its
 * source (files in `app/public/sounds/`, or a procedural generator), its
 * level, pitch variance, looping, how it sits in the scene and which bus it
 * plays on. Nothing outside this file names a sound file; swapping a sound is
 * a file in the sounds folder and one line here (see `README.md`).
 *
 * Plain data with type-only imports: it runs in node, and the shell imports
 * it through `@ghosts/engine/sounds` without three.js.
 */

/** Where a slot plays: each bus has its own level and its own part in the reactive mix. */
export type Bus = "ambience" | "combat" | "voice" | "interface" | "music";

/**
 * Procedural sources, and which side implements them: the engine's are in
 * `audio/generators.ts`, the shell's (interface gestures built from the tick
 * sample) in `app/src/audio/ui.ts` and `lamp.ts`.
 */
export const GENERATORS = {
  // Combat tones that never had a recording.
  "tone.click": "engine",
  "tone.lock": "engine",
  "tone.smoke": "engine",
  "tone.ring": "engine",
  // Ambience beds: seamless loops rendered once per context.
  "bed.rain.a": "engine",
  "bed.rain.b": "engine",
  "bed.city": "engine",
  "bed.wind": "engine",
  "bed.room": "engine",
  // Ambience one-shots.
  "shot.siren": "engine",
  "shot.train": "engine",
  "shot.thunder": "engine",
  "shot.drip": "engine",
  "shot.gust": "engine",
  "shot.knock": "engine",
  "shot.relay": "engine",
  // The field's own sounds.
  "unit.step": "engine",
  "unit.vault": "engine",
  "unit.hit": "engine",
  "unit.miss": "engine",
  "unit.down": "engine",
  "unit.gear": "engine",
  "field.debris": "engine",
  "field.turn": "engine",
  // Interface gestures, layered on the tick sample.
  "ui.confirm": "app",
  "ui.back": "app",
  "ui.deny": "app",
  "ui.hold": "app",
  "ui.count": "app",
  "ui.resolve": "app",
  "ui.lamp": "app",
} as const;

export type GeneratorName = keyof typeof GENERATORS;
export type EngineGeneratorName = { [K in GeneratorName]: (typeof GENERATORS)[K] extends "engine" ? K : never }[GeneratorName];
export type AppGeneratorName = Exclude<GeneratorName, EngineGeneratorName>;

export type Source =
  /**
   * Files under `/sounds/`; several are takes, varied without an immediate
   * repeat. `{voice}` stands for a squad voice (`male-01`). `fallback` is a
   * second encoding of the same sound for browsers that can't decode the first.
   */
  | { file: readonly string[]; fallback?: string }
  | { generator: GeneratorName };

export interface Spatial {
  /** Metres within which the source plays at full level. */
  ref: number;
  /** How fast it falls off past `ref` (inverse model: ref / (ref + rolloff × (d − ref))). */
  rolloff: number;
  /** Metres past which it gets no quieter. */
  max: number;
}

export interface Slot {
  source: Source;
  bus: Bus;
  /** Linear gain on top of the bus level. */
  gain: number;
  /** Random rate change per play, ± this share (0.03 = ±3 %). */
  pitch?: number;
  /** Loops; with points, loops between them (seconds into the file). */
  loop?: boolean | { start: number; end: number };
  /** Positioned in the scene and heard from the camera; absent: plays unpositioned. */
  spatial?: Spatial;
  /** A stand-in until a designed sound lands; the audition screen marks it. */
  placeholder: boolean;
  /** What it is, for the audition screen. */
  note: string;
}

/** The tactics camera sits high and far: shots stay audible across the map, the fall-off is gentle. */
export const COMBAT_SPACE: Spatial = { ref: 30, rolloff: 0.5, max: 160 };
/** World one-shots sit out past the field: softer still with distance. */
export const WORLD_SPACE: Spatial = { ref: 40, rolloff: 0.35, max: 220 };

const recorded = (note: string, file: string[], extra: Partial<Slot> = {}): Slot => ({
  source: { file },
  bus: "combat",
  gain: 1,
  spatial: COMBAT_SPACE,
  placeholder: false,
  note,
  ...extra,
});

const takes = (stem: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${stem}-${String(i + 1).padStart(2, "0")}.mp3`);

const voiceLine = (phrase: string): Slot => ({
  source: { file: [`${phrase}-{voice}.mp3`] },
  bus: "voice",
  gain: 1,
  placeholder: false,
  note: `Squad line "${phrase}", one file per voice`,
});

const bed = (generator: GeneratorName, gain: number, note: string): Slot => ({
  source: { generator },
  bus: "ambience",
  gain,
  loop: true,
  placeholder: true,
  note,
});

const world = (generator: GeneratorName, gain: number, pitch: number, note: string): Slot => ({
  source: { generator },
  bus: "ambience",
  gain,
  pitch,
  spatial: WORLD_SPACE,
  placeholder: true,
  note,
});

/** A placeholder sound of the field, positioned at the unit or cell it comes from. */
const field = (generator: GeneratorName, gain: number, pitch: number, note: string): Slot => ({
  source: { generator },
  bus: "combat",
  gain,
  pitch,
  spatial: COMBAT_SPACE,
  placeholder: true,
  note,
});

const gesture = (generator: GeneratorName, note: string): Slot => ({
  source: { generator },
  bus: "interface",
  gain: 1,
  placeholder: false,
  note,
});

export const SLOTS = {
  // === Combat ===
  "weapon.rifle.shot": recorded("Rifle burst", takes("rifle-burst", 4)),
  "weapon.sniper.shot": recorded("Sniper shot", takes("sniper-rifle", 3)),
  "weapon.pistol.shot": recorded("Pistol shot", takes("pistol", 3)),
  "weapon.pistol.reload": recorded("Pistol reload", takes("pistol-reload", 3)),
  "weapon.rifle.reload": recorded("Rifle reload", takes("rifle-reload", 3)),
  // The sniper reuses the rifle reload until it has takes of its own.
  "weapon.sniper.reload": recorded("Sniper reload (the rifle's takes)", takes("rifle-reload", 3)),
  "weapon.pistol.raise": recorded("Pistol raised when fire mode opens", ["pistol-click-01.mp3"]),
  "grenade.pin": recorded("Grenade pin as it leaves the hand", ["grenade-safety-01.mp3"]),
  "grenade.blast": recorded("Frag and flashbang burst", ["grenade-explodes-01.mp3"]),
  "grenade.smoke": {
    source: { generator: "tone.smoke" },
    bus: "combat",
    gain: 0.6,
    spatial: COMBAT_SPACE,
    placeholder: true,
    note: "Smoke grenade hiss",
  },
  "combat.click": {
    source: { generator: "tone.click" },
    bus: "combat",
    gain: 1,
    placeholder: true,
    note: "Order click in the field",
  },
  "combat.lock": {
    source: { generator: "tone.lock" },
    bus: "combat",
    gain: 1,
    placeholder: true,
    note: "Unit readout locking on",
  },
  "combat.daze.ring": {
    source: { generator: "tone.ring" },
    bus: "combat",
    gain: 0.29,
    placeholder: true,
    note: "Ear ring when the held unit is dazed",
  },
  // Silent until a real footfall sample replaces the synthesized tick.
  "unit.step": field("unit.step", 0, 0.08, "Footsteps, one cell"),
  "unit.vault": field("unit.vault", 0.57, 0.06, "Vaulting low cover"),
  "unit.hit": field("unit.hit", 2, 0.06, "A round striking a unit"),
  "unit.miss": field("unit.miss", 0.65, 0.1, "A round missing: snap past and strike behind"),
  "unit.down": field("unit.down", 1, 0.05, "A unit falling"),
  "unit.gear": field("unit.gear", 0.21, 0.08, "Kit settling: hunker, overwatch"),
  "field.debris": field("field.debris", 0.78, 0.06, "Cover broken by fire"),
  "field.turn": {
    source: { generator: "field.turn" },
    bus: "combat",
    gain: 0.16,
    placeholder: true,
    note: "A side's turn starting",
  },

  // === Voice ===
  "voice.commander": voiceLine("commander"),
  "voice.copy": voiceLine("copy"),
  "voice.onit": voiceLine("onit"),
  "voice.taking-cover": voiceLine("taking-cover"),
  "voice.taking-the-shot": voiceLine("taking-the-shot"),
  "voice.target-neutralised": voiceLine("target-neutralised"),
  "voice.frag-out": voiceLine("frag-out"),
  "voice.fire-in-the-hole": voiceLine("fire-in-the-hole"),
  "voice.understood-holding-corner": voiceLine("understood-holding-corner"),
  "voice.staying-on-target-firing": voiceLine("staying-on-target-firing"),
  "voice.panting-im-hit": voiceLine("panting-im-hit"),

  // === Ambience: street ===
  "ambience.rain.bed.a": bed("bed.rain.a", 0.23, "Rain bed, first layer (left)"),
  "ambience.rain.bed.b": bed("bed.rain.b", 0.23, "Rain bed, second layer (right)"),
  "ambience.city.bed": bed("bed.city", 0.66, "Distant city rumble"),
  "ambience.wind.bed": bed("bed.wind", 0.33, "Wind between the blocks"),
  "ambience.city.oneshot.siren": world("shot.siren", 0.05, 0.06, "Far siren"),
  "ambience.city.oneshot.train": world("shot.train", 0.24, 0.05, "Elevated train passing far off"),
  "ambience.rain.oneshot.thunder": world("shot.thunder", 0.35, 0.08, "Distant thunder"),
  "ambience.rain.oneshot.drip": world("shot.drip", 0.09, 0.18, "Drip from a gutter"),
  "ambience.wind.oneshot.gust": world("shot.gust", 0.06, 0.1, "Wind gust"),

  // === Ambience: office ===
  "ambience.office.bed": bed("bed.room", 0.71, "Office room tone and air handling"),
  "ambience.office.oneshot.knock": world("shot.knock", 0.12, 0.08, "Pipe knock in the walls"),
  "ambience.office.oneshot.relay": world("shot.relay", 0.15, 0.05, "Relay clicking in a ceiling unit"),

  // === Interface ===
  "ui.tick": {
    source: { file: ["ui-tick.wav"] },
    bus: "interface",
    gain: 1,
    placeholder: false,
    note: "The detent knock every interface gesture is built on",
  },
  "ui.confirm": gesture("ui.confirm", "Confirm: a latch"),
  "ui.back": gesture("ui.back", "Back: a soft release"),
  "ui.deny": gesture("ui.deny", "Refusal: a dull thud"),
  "ui.hold": gesture("ui.hold", "Hold to confirm, one step"),
  "ui.count": gesture("ui.count", "Counter step"),
  "ui.resolve": gesture("ui.resolve", "Debrief podium settling"),
  "ui.lamp": gesture("ui.lamp", "Recruitment podium light striking on"),

  // === Music ===
  "music.title": {
    source: { file: ["title-theme.opus"], fallback: "title-theme.m4a" },
    bus: "music",
    gain: 1,
    loop: true,
    placeholder: false,
    note: "Title theme behind the menus",
  },
} as const satisfies Record<string, Slot>;

export type SlotId = keyof typeof SLOTS;

export const SLOT_IDS = Object.keys(SLOTS) as SlotId[];

/** Where the sounds folder is served. */
export const SOUNDS_PATH = "/sounds/";

export function slot(id: SlotId): Slot {
  return SLOTS[id];
}

/** A file of the sounds folder as a URL. */
export function soundUrl(file: string): string {
  return `${SOUNDS_PATH}${file}`;
}

/** A slot's takes as files, `{voice}` filled in when given. Empty for a generator. */
export function slotFiles(id: SlotId, voice?: string): string[] {
  const { source } = SLOTS[id] as Slot;
  if (!("file" in source)) return [];
  return source.file.map((f) => (voice ? f.replace("{voice}", voice) : f));
}

/** The voice-line slot for a phrase, when there is one. */
export function voiceSlot(phrase: string): SlotId | null {
  const id = `voice.${phrase}`;
  return id in SLOTS ? (id as SlotId) : null;
}

/** A file's name without its extension: the take names the effect tables use. */
export function stem(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

/**
 * Problems with the manifest: a file that isn't in the sounds folder, a
 * generator nobody implements, values out of range. `exists` answers for a
 * file name; `voices` fill `{voice}`; `generators` are the implemented names.
 */
export function validateManifest(
  exists: (file: string) => boolean,
  voices: readonly string[],
  generators: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const id of SLOT_IDS) {
    const s = SLOTS[id] as Slot;
    if ("file" in s.source) {
      if (!s.source.file.length) problems.push(`${id}: no files`);
      const files = [...s.source.file, ...(s.source.fallback ? [s.source.fallback] : [])];
      for (const f of files) {
        const names = f.includes("{voice}") ? voices.map((v) => f.replace("{voice}", v)) : [f];
        for (const name of names) if (!exists(name)) problems.push(`${id}: missing file ${name}`);
      }
    } else if (!(s.source.generator in GENERATORS)) {
      problems.push(`${id}: unknown generator ${s.source.generator}`);
    } else if (!generators.has(s.source.generator)) {
      problems.push(`${id}: generator ${s.source.generator} is not implemented`);
    }
    if (!(s.gain >= 0 && s.gain <= 4)) problems.push(`${id}: gain ${s.gain} out of range`);
    if (s.pitch !== undefined && !(s.pitch >= 0 && s.pitch < 0.5)) problems.push(`${id}: pitch ${s.pitch} out of range`);
    if (typeof s.loop === "object" && !(s.loop.end > s.loop.start && s.loop.start >= 0))
      problems.push(`${id}: loop points out of order`);
    if (s.spatial && !(s.spatial.ref > 0 && s.spatial.rolloff >= 0 && s.spatial.max >= s.spatial.ref))
      problems.push(`${id}: spatial parameters out of range`);
  }
  return problems;
}
