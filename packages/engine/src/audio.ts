// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "./mpfb-characters.js";
import { EffectPlayer, type EffectKind } from "./sfx";
import {
  DEFAULT_VOICE_INDEX,
  effectVolume,
  voiceVolume,
  VoicePlayer,
  type Voice,
  type VoiceEvent,
} from "./voice";
import type { Unit, Weapon } from "./game";
import { engineSettings } from "./settings";

const effects = () => effectVolume(engineSettings().audio());

/**
 * Everything the encounter plays: recorded effects, operative voice lines and
 * the synthesized tones that remain for kinds without a recording. Levels
 * come from the shell's saved audio settings on every play.
 */
export class CombatAudio {
  private readonly voice = new VoicePlayer(() => voiceVolume(engineSettings().audio()));
  private readonly sfx = new EffectPlayer(effects);
  private context: AudioContext | undefined;

  /** The deployed look decides the voice: its sex, and its chosen index when it has one. */
  voiceFor(u: Unit): Voice | null {
    const look = deployment.get(u.id);
    if (!look || u.enemy) return null;
    return { sex: look.appearance.sex, index: look.voice ?? DEFAULT_VOICE_INDEX };
  }

  speak(event: VoiceEvent, u: Unit) {
    this.voice.speak(event, this.voiceFor(u));
  }

  stopVoice() {
    this.voice.stop();
  }

  prepareVoice() { this.voice.preload(); }

  unlockVoice = () => { this.voice.unlock(); };

  /** A recorded effect when there is one; otherwise a synthesized tone. */
  tone(kind: EffectKind, weapon?: Weapon) {
    if (this.sfx.play(kind, weapon)) return;
    if (kind === "pin" || kind === "aim") return;
    // Synthesized tones sit on the same effects level as the recordings.
    const level = effects();
    if (level <= 0) return;
    const audio = (this.context ??= new AudioContext());
    void audio.resume();
    const duration =
      kind === "smoke" ? 1.4 : kind === "grenade" ? 0.6 : kind === "sniper" ? 0.3 : kind === "click" ? 0.05 : 0.13;
    const buffer = audio.createBuffer(1, audio.sampleRate * duration, audio.sampleRate);
    const data = buffer.getChannelData(0);
    // The smoke's hiss swells and settles; every other tone is a decaying burst.
    for (let i = 0; i < data.length; i++)
      data[i] =
        (Math.random() * 2 - 1) *
        (kind === "smoke" ? Math.sin((Math.PI * i) / data.length) * 0.6 : Math.pow(1 - i / data.length, 3));
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = kind === "smoke" ? "highpass" : "lowpass";
    filter.frequency.value =
      kind === "smoke" ? 2400 : kind === "grenade" ? 240 : kind === "sniper" ? 700 : kind === "click" ? 2800 : 1500;
    const gain = audio.createGain();
    gain.gain.value = (kind === "click" ? 0.03 : 0.12) * level;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }

  private lockedAt = 0;
  private paused = false;

  /**
   * The unit readout locking on: one short, soft, filtered tick (a 30 ms noise
   * burst through a band-pass near 650 Hz) on the effects level, no tone.
   * Sweeping the pointer across a squad plays it at most every 150 ms.
   */
  lock() {
    const level = effects();
    const now = performance.now();
    if (level <= 0 || this.paused || now - this.lockedAt < 150) return;
    this.lockedAt = now;
    const audio = (this.context ??= new AudioContext());
    void audio.resume();
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.03), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 650;
    filter.Q.value = 0.7;
    const gain = audio.createGain();
    gain.gain.value = 0.05 * level;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }

  /** Silence everything and release the audio context; the next encounter starts fresh. */
  stop() {
    this.voice.dispose();
    this.sfx.setPaused(true);
    this.voice.setPaused(false);
    this.sfx.setPaused(false);
    void this.context?.close();
    this.context = undefined;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.voice.setPaused(paused);
    this.sfx.setPaused(paused);
    if (!this.context) return;
    if (paused) void this.context.suspend();
    else void this.context.resume();
  }
}

export const audio = new CombatAudio();
