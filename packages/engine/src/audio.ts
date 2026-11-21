// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "./mpfb-characters.js";
import { EffectPlayer, effectSlot, type EffectKind } from "./sfx";
import { Soundscape, type Field } from "./audio/soundscape";
import { soundscapeEnabled, subscribeSoundscape } from "./audio/switch";
import { ambienceVolume } from "./audio/levels";
import {
  DEFAULT_VOICE_INDEX,
  effectVolume,
  voiceVolume,
  VoicePlayer,
  type Voice,
  type VoiceEvent,
} from "./voice";
import type { Cell, Unit, Weapon } from "./game";
import { engineSettings } from "./settings";

const effects = () => effectVolume(engineSettings().audio());

/** The field as the soundscape hears it, plus where a cell is in the world. */
export interface HeardField extends Field {
  locate(cell: Cell): { x: number; y: number; z: number };
}

/**
 * Everything the encounter plays: recorded effects, operative voice lines and
 * the synthesized tones that remain for kinds without a recording. Levels
 * come from the shell's saved audio settings on every play.
 */
export class CombatAudio {
  /** Spatial combat sound, ambience and the reactive mix (`audio/soundscape.ts`), behind the switch. */
  readonly scape = new Soundscape(() => {
    const levels = engineSettings().audio();
    return { combat: effectVolume(levels), ambience: ambienceVolume(levels) };
  });
  private readonly voice = new VoicePlayer(
    () => voiceVolume(engineSettings().audio()),
    () => {
      const context = soundscapeEnabled() && this.field ? this.scape.context() : null;
      return context && this.scape.voiceBus ? { context, destination: this.scape.voiceBus } : null;
    },
  );
  private readonly sfx = new EffectPlayer(effects);
  private context: AudioContext | undefined;
  private field: HeardField | null = null;
  private unsubscribeSwitch: (() => void) | null = null;

  /** The mounted field: the soundscape starts hearing it (when the switch is on). */
  attachField(field: HeardField) {
    this.field = field;
    if (soundscapeEnabled()) this.scape.attach(field);
    this.unsubscribeSwitch?.();
    this.unsubscribeSwitch = subscribeSoundscape(() => {
      if (!this.field) return;
      if (soundscapeEnabled()) {
        this.scape.attach(this.field);
        this.scape.setEnabled(true);
      } else this.scape.setEnabled(false);
    });
  }

  /** Where a unit's sound comes from: its cell, chest high. */
  private where(at?: Unit | Cell) {
    if (!at || !this.field) return null;
    return this.field.locate("pos" in at ? at.pos : at);
  }

  /** A shot is about to land: the soundscape dips around it until `shotImpact`. */
  beginShot() {
    if (soundscapeEnabled()) this.scape.beginShot();
  }

  shotImpact() {
    this.scape.impact();
  }

  /** The moment is over (a seek, the end of a match): no duck, dip or daze outlives it. */
  resetMix() {
    this.scape.resetMix();
  }

  /** The deployed look decides the voice: its sex, and its chosen index when it has one. */
  voiceFor(u: Unit): Voice | null {
    const look = deployment.get(u.id);
    if (!look || u.enemy) return null;
    return { sex: look.appearance.sex, index: look.voice ?? DEFAULT_VOICE_INDEX };
  }

  /** Voice lines are off (a replay above 1x: lines would overlap, and their pitch can't follow). */
  voiceOff = false;
  /** Nothing plays (a replay's seek runs animations to their end in an instant). */
  quiet = false;

  speak(event: VoiceEvent, u: Unit) {
    if (this.voiceOff || this.quiet) return;
    this.voice.speak(event, this.voiceFor(u));
  }

  stopVoice() {
    this.voice.stop();
  }

  prepareVoice() { this.voice.preload(); }

  unlockVoice = () => {
    this.scape.unlock();
    this.voice.unlock();
  };

  /**
   * A recorded effect when there is one; otherwise a synthesized tone. `at`
   * places it in the scene when the soundscape is on: the unit (or cell) it
   * comes from.
   */
  tone(kind: EffectKind, weapon?: Weapon, at?: Unit | Cell) {
    if (this.quiet) return;
    if (soundscapeEnabled() && this.field) {
      const slot = effectSlot(kind, weapon);
      if (slot) {
        this.scape.unlock();
        this.scape.play(slot, { at: this.where(at) });
        return;
      }
    }
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
    if (soundscapeEnabled() && this.field) {
      this.scape.play("combat.lock");
      return;
    }
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
    this.voiceOff = this.quiet = false;
    this.voice.dispose();
    this.unsubscribeSwitch?.();
    this.unsubscribeSwitch = null;
    this.field = null;
    this.scape.close();
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
    this.scape.setPaused(paused);
    if (!this.context) return;
    if (paused) void this.context.suspend();
    else void this.context.resume();
  }
}

export const audio = new CombatAudio();
