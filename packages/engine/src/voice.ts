// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

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

/** One radio channel. Decoded buffers avoid a fresh media-element autoplay gate per bark. */
export class VoicePlayer {
  private last = new Map<VoiceEvent, string>();
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private current: AudioBufferSourceNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private sequence = 0;
  private paused = false;

  private readonly level: () => number;
  constructor(level: () => number) { this.level = level; }

  private ensure() {
    if (this.context) return this.context;
    const context = this.context = new AudioContext();
    context.onstatechange = () => {
      if (this.current) document.body.dataset.voiceState = this.paused ? "paused" : context.state === "running" ? "playing" : "suspended";
    };
    const high = context.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 260;
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 3600;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -25;
    compressor.knee.value = 16;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.14;
    const drive = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    drive.curve = curve;
    drive.oversample = "2x";
    const output = this.output = context.createGain();
    high.connect(low).connect(compressor).connect(drive).connect(output).connect(context.destination);
    // Retain the radio input separately from the volume control.
    this.input = high;
    return context;
  }

  private input: AudioNode | null = null;

  /** Called directly from a pointer/key gesture, before asynchronous combat work. */
  unlock() {
    const context = this.ensure();
    if (!this.paused && context.state === "suspended") void context.resume().catch(() => {});
  }

  private load(url: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(url);
    if (!pending) {
      const context = this.ensure();
      pending = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Voice recording unavailable: ${url} (${response.status})`);
        return response.arrayBuffer();
      }).then((data) => context.decodeAudioData(data));
      this.buffers.set(url, pending);
      void pending.catch(() => this.buffers.delete(url));
    }
    return pending;
  }

  /** Preload the first response so selecting an operative speaks immediately. */
  preload() {
    for (const voice of RECORDED)
      for (const phrase of [...PHRASES.select, ...PHRASES.move])
        void this.load(lineUrl(phrase, voice)).catch(() => {});
  }

  speak(event: VoiceEvent, voice: Voice | null): string | null {
    if (!voice || !isRecorded(voice) || this.level() <= 0) return null;
    const phrase = pickPhrase(event, this.last.get(event) ?? null);
    if (!phrase) return null;
    this.last.set(event, phrase);
    this.stop();
    const sequence = this.sequence;
    this.unlock();
    document.body.dataset.voiceLine = `${phrase}:${voiceKey(voice)}`;
    document.body.dataset.voiceState = "loading";
    void this.load(lineUrl(phrase, voice)).then((buffer) => {
      if (sequence !== this.sequence || this.level() <= 0) return;
      const context = this.ensure();
      const source = context.createBufferSource();
      source.buffer = buffer;
      this.output!.gain.value = this.level() * 1.4;
      source.connect(this.input!);
      this.current = source;
      source.onended = () => {
        source.disconnect();
        if (this.current === source) {
          this.current = null;
          document.body.dataset.voiceState = "idle";
        }
      };
      source.start();
      document.body.dataset.voiceState = this.paused ? "paused" : context.state === "running" ? "playing" : "suspended";
    }).catch((error) => {
      if (sequence !== this.sequence) return;
      document.body.dataset.voiceState = "error";
      console.warn("Operative voice playback failed", error);
    });
    return phrase;
  }

  stop() {
    this.sequence++;
    this.current?.stop();
    this.current?.disconnect();
    this.current = null;
    document.body.dataset.voiceState = "idle";
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!this.context) return;
    if (paused) void this.context.suspend();
    else this.unlock();
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.input = this.output = null;
    this.buffers.clear();
  }
}
