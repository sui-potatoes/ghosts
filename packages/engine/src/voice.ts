/**
 * Operative voice lines. Recordings live in `public/sounds` as
 * `<phrase>-<sex>-<NN>.mp3`; a voice is a sex plus a two-digit index, so a
 * character can later be given a different voice of the same sex. The player
 * asks for its level on every line; `audio.ts` answers from the shell settings.
 */

import type { AudioLevels } from "./settings.ts";

export type Sex = "male" | "female";
export interface Voice {
  sex: Sex;
  index: number;
}

export type VoiceEvent =
  | "select"
  | "move"
  | "cover"
  | "fire"
  | "kill"
  | "grenade"
  | "hunker"
  | "overwatch"
  | "hit";

/** Phrases per event; several means the player varies them. */
export const PHRASES: Record<VoiceEvent, string[]> = {
  select: ["commander", "copy"],
  move: ["onit", "copy"],
  cover: ["taking-cover"],
  fire: ["taking-the-shot"],
  kill: ["target-neutralised"],
  grenade: ["frag-out", "fire-in-the-hole"],
  hunker: ["understood-holding-corner"],
  overwatch: ["staying-on-target-firing"],
  hit: ["panting-im-hit"],
};

/** Voices with recordings on disk. Others stay silent until their files land. */
export const RECORDED: Voice[] = [
  { sex: "male", index: 1 },
  { sex: "female", index: 1 },
];

export const DEFAULT_VOICE_INDEX = 1;

export function voiceKey(v: Voice): string {
  return `${v.sex}-${String(v.index).padStart(2, "0")}`;
}

export function isRecorded(v: Voice): boolean {
  return RECORDED.some((r) => r.sex === v.sex && r.index === v.index);
}

export function lineUrl(phrase: string, voice: Voice): string {
  return `/sounds/${phrase}-${voiceKey(voice)}.mp3`;
}

/** A phrase for `event` that is not the one used last time, when there is a choice. */
export function pickPhrase(
  event: VoiceEvent,
  last: string | null,
  random: () => number = Math.random,
): string | null {
  const options = PHRASES[event];
  if (!options?.length) return null;
  const fresh = options.length > 1 ? options.filter((p) => p !== last) : options;
  return fresh[Math.floor(random() * fresh.length)] ?? null;
}

/** Effects: master × effects. */
export function effectVolume(s: AudioLevels): number {
  return s.muted ? 0 : (s.master / 100) * (s.sfx / 100);
}

/** Voice lines: master × dialogue. */
export function voiceVolume(s: AudioLevels): number {
  return s.muted ? 0 : (s.master / 100) * (s.voice / 100);
}

/** One voice channel: a new line stops the one playing. */
export class VoicePlayer {
  private last = new Map<VoiceEvent, string>();
  private current: HTMLAudioElement | null = null;
  private paused = false;

  private readonly level: () => number;

  /** `level` is the current dialogue volume, 0 to 1. */
  constructor(level: () => number) {
    this.level = level;
  }

  speak(event: VoiceEvent, voice: Voice | null): string | null {
    if (!voice || !isRecorded(voice)) return null;
    const volume = this.level();
    if (volume <= 0) return null;
    const phrase = pickPhrase(event, this.last.get(event) ?? null);
    if (!phrase) return null;
    this.last.set(event, phrase);
    this.stop();
    const audio = new Audio(lineUrl(phrase, voice));
    audio.volume = volume;
    this.current = audio;
    document.body.dataset.voiceLine = `${phrase}:${voiceKey(voice)}`;
    audio.onended = () => {
      if (this.current === audio) this.current = null;
    };
    if (!this.paused) audio.play().catch(() => {});
    return phrase;
  }

  stop() {
    this.current?.pause();
    this.current = null;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!this.current) return;
    if (paused) this.current.pause();
    else this.current.play().catch(() => {});
  }
}
