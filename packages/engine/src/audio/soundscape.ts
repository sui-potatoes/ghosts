// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The soundscape: one audio context for the mounted encounter, the buses, the
 * camera as the ear, the layered ambience and the reactive mix. Everything it
 * plays is a manifest slot (`manifest.ts`).
 *
 *   combat ─────────────────────┐
 *   voice (the radio chain) ────┤
 *   ambience ─ air ─┐           ├─ world ─ low-pass ─ width ─ post ─ out
 *   music ──────────┴─ duck ────┘                               │
 *   ring (after the daze filter) ───────────────────────────────┘
 *
 * Panning: `PannerNode` with the equal-power model. HRTF convolves every voice
 * (real CPU per shot) and its front/back and height cues mean little from a
 * camera high over the field, on laptop speakers least of all; equal power is
 * a gain pair per voice and pans cleanly. The listener stays at the origin;
 * each positioned voice is placed in camera space every rendered frame
 * (`spatial-model.ts`), with a short glide so camera moves never zipper. The
 * scene only renders while something moves, so a still field costs nothing.
 *
 * Ambience: beds loop under the field and one-shots are timed by a seeded
 * scheduler at points around the map, both chosen by location and look
 * (`ambience-model.ts`). It fades in and out, crossfades when the look
 * changes, stops when its level is zero or the page loses audio, and the
 * context is suspended while the page is hidden.
 */

import type { SceneLook } from "../scene-look.ts";
import {
  ambiencePlan,
  CROSSFADE,
  FADE_IN,
  FADE_OUT,
  OneShotScheduler,
  RAIN_SPREAD,
  type AmbiencePlan,
  type BedSlot,
  type Bounds,
  type Location,
  type OneShotSlot,
} from "./ambience-model.ts";
import { ENGINE_GENERATORS, RENDER_RATE, type Generator } from "./generators.ts";
import { SLOTS, slotFiles, soundUrl, type Bus, type EngineGeneratorName, type GeneratorName, type Slot, type SlotId } from "./manifest.ts";
import { MixModel, widthGains, type MixInputs } from "./mix-model.ts";
import { pickVictim, POSITION_SMOOTH, toListener, VOICE_CAP, WORLD_VOICE_CAP, type Vec3, type VoiceInfo } from "./spatial-model.ts";

/** Amplitudes (0–1) the buses play at; read on every play and on every settings or focus change. */
export interface Levels {
  combat: number;
  ambience: number;
}

/** The field the soundscape hears. */
export interface Field {
  /** The camera's world matrix, column-major (three.js `matrixWorld.elements`). */
  camera(): ArrayLike<number>;
  location: Location;
  /** The playable area in world metres. */
  bounds: Bounds;
}

export interface PlayOptions {
  /** Where in the world (metres); positioned slots without it play unpositioned. */
  at?: { x: number; y: number; z: number } | null;
  /** Playback rate; default: the slot's pitch variance around 1. */
  rate?: number;
  /** Extra gain on top of the slot's. */
  gain?: number;
  /** A file slot's `{voice}`. */
  voice?: string;
}

interface Voice {
  id: SlotId;
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
  gain: GainNode;
  panner: PannerNode | null;
  x: number;
  y: number;
  z: number;
  started: number;
  /** 0: world one-shot, 1: combat. */
  priority: number;
  distance: number;
}

interface Bed {
  sources: AudioBufferSourceNode[];
  nodes: AudioNode[];
  gain: GainNode;
  target: number;
}

/** Level changes glide over this (s): a slider drag or a blur never clicks. */
const LEVEL_SMOOTH = 0.05;
/** A file slot still loading this long after it was asked for is dropped, not played late (s). */
const LATE = 0.4;
/** A mono source through an equal-power panner is 3 dB down at the centre; this brings it back. */
const MONO_MAKEUP = Math.SQRT2;
/** Voices stolen or stopped fade over this (s). */
const STEAL_FADE = 0.03;

/** The audio-thread time constant for a fade of `seconds`: it is all but done by then. */
const tc = (seconds: number) => seconds / 3;

export class Soundscape {
  private ctx: AudioContext | null = null;
  private buses!: Record<Bus, GainNode>;
  private world!: GainNode;
  private duck!: GainNode;
  private air!: BiquadFilterNode;
  private daze!: BiquadFilterNode;
  private widthGains!: { ll: GainNode; rl: GainNode; lr: GainNode; rr: GainNode };
  private ring!: GainNode;
  /** Everything ends here before the speakers; taps for instrumentation hang off it. */
  output!: GainNode;

  private field: Field | null = null;
  private readonly voices: Voice[] = [];
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly decoded = new Map<string, AudioBuffer>();
  private readonly rendered = new Map<GeneratorName, AudioBuffer>();
  private readonly lastTake = new Map<SlotId, string>();

  private readonly matrix = new Float64Array(16);
  private readonly point: Vec3 = { x: 0, y: 0, z: 0 };
  private moved = true;

  private plan: AmbiencePlan | null = null;
  private planKey = "";
  private readonly beds = new Map<BedSlot, Bed>();
  private scheduler: OneShotScheduler | null = null;
  private oneShotTimer = 0;
  private ambienceOn = false;

  readonly mix = new MixModel();
  private dipToken = 0;
  private dipTimer = 0;

  private paused = false;
  private hidden = false;
  private enabled = true;
  private readonly levels: () => Levels;

  constructor(levels: () => Levels) {
    this.levels = levels;
  }

  /** The context, made on first use; null once torn down until the next attach. */
  context(): AudioContext | null {
    return this.ctx;
  }

  /** The voice bus, for the radio chain. */
  get voiceBus(): AudioNode | null {
    return this.ctx ? this.buses.voice : null;
  }

  // === Lifecycle ===

  /** Make the context and the buses; idempotent. */
  open(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = (this.ctx = new AudioContext());
    const gain = (value = 1) => new GainNode(ctx, { gain: value });
    this.output = gain();
    this.output.connect(ctx.destination);
    this.ring = gain(0);
    this.ring.connect(this.output);
    // Width: left' = a·L + b·R, right' = b·L + a·R.
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    const w = { ll: gain(1), rl: gain(0), lr: gain(0), rr: gain(1) };
    split.connect(w.ll, 0).connect(merge, 0, 0);
    split.connect(w.rl, 1).connect(merge, 0, 0);
    split.connect(w.lr, 0).connect(merge, 0, 1);
    split.connect(w.rr, 1).connect(merge, 0, 1);
    merge.connect(this.output);
    this.widthGains = w;
    this.daze = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.5 });
    this.daze.connect(split);
    this.world = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: "explicit" });
    this.world.connect(this.daze);
    this.duck = gain();
    this.duck.connect(this.world);
    this.air = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 16000, Q: 0.5 });
    this.air.connect(this.duck);
    this.buses = {
      combat: gain(0),
      voice: gain(),
      ambience: gain(0),
      music: gain(),
      interface: gain(),
    };
    this.buses.combat.connect(this.world);
    this.buses.voice.connect(this.world);
    this.buses.ambience.connect(this.air);
    this.buses.music.connect(this.duck);
    // The interface plays through the shell's own context; the bus is here for completeness.
    this.buses.interface.connect(this.output);
    this.hidden = typeof document !== "undefined" && document.hidden;
    this.applyLevels(true);
    return ctx;
  }

  /** Hear `field`: start the ambience, follow the camera. */
  attach(field: Field) {
    this.field = field;
    this.moved = true;
    this.enabled = true;
    const ctx = this.open();
    if (ctx.state === "suspended" && !this.paused && !this.hidden) void ctx.resume().catch(() => {});
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("blur", this.onFocus);
    document.addEventListener("visibilitychange", this.onFocus);
    this.preload();
    this.syncAmbience();
  }

  /** Stop everything, release the context; the next encounter opens a fresh one. */
  close() {
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("blur", this.onFocus);
    document.removeEventListener("visibilitychange", this.onFocus);
    this.stopAmbience(0);
    this.resetMix();
    clearTimeout(this.dipTimer);
    for (let i = this.voices.length - 1; i >= 0; i--) this.retire(this.voices[i]);
    this.field = null;
    this.plan = null;
    this.planKey = "";
    this.paused = false;
    void this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
    this.decoded.clear();
    this.rendered.clear();
  }

  /** The soundscape switch moved: off silences and stops it all, on brings the ambience back. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.stopAmbience(FADE_OUT);
      this.resetMix();
      for (const v of this.voices) this.fadeOut(v);
    } else this.syncAmbience();
  }

  /** Unlock on a gesture: a context made before one starts suspended. */
  unlock() {
    const ctx = this.ctx;
    if (ctx && ctx.state === "suspended" && !this.paused && !this.hidden) void ctx.resume().catch(() => {});
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    // A pause ends the moment: no dip or duck outlives it.
    if (paused) this.resetMix();
    this.applyRunning();
  }

  private applyRunning() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.paused || this.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  }

  private readonly onFocus = () => {
    // Hidden is decisive at once; a blur is read again once focus has settled (as `app/src/audio/focus.ts`).
    const apply = () => {
      if (!this.ctx) return;
      const hidden = document.hidden;
      if (hidden !== this.hidden) {
        this.hidden = hidden;
        this.applyRunning();
      }
      this.applyLevels();
    };
    if (document.hidden) apply();
    else setTimeout(apply);
  };

  /** Settings or focus changed: glide the buses to the new levels, start or stop the ambience. */
  applyLevels(now = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const { combat, ambience } = this.levels();
    const t = ctx.currentTime;
    const set = (param: AudioParam, value: number) => (now ? (param.value = value) : param.setTargetAtTime(value, t, LEVEL_SMOOTH));
    set(this.buses.combat.gain, combat);
    set(this.ring.gain, combat);
    set(this.buses.ambience.gain, this.enabled ? ambience : 0);
    this.syncAmbience();
  }

  // === Playing slots ===

  /** Fetch and decode the combat recordings ahead of the first shot. */
  private preload() {
    for (const id of Object.keys(SLOTS) as SlotId[]) {
      const s = SLOTS[id] as Slot;
      if (s.bus === "combat" && "file" in s.source) for (const f of slotFiles(id)) void this.load(soundUrl(f)).catch(() => {});
    }
  }

  private load(url: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(url);
    if (!pending) {
      const ctx = this.ctx!;
      pending = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Sound unavailable: ${url} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          this.decoded.set(url, buffer);
          return buffer;
        });
      this.buffers.set(url, pending);
      pending.catch(() => this.buffers.delete(url));
    }
    return pending;
  }

  /** A rendered generator's buffer, made once per context. */
  private render(name: GeneratorName, g: Generator & { kind: "render" }): AudioBuffer {
    let buffer = this.rendered.get(name);
    if (!buffer) {
      const data = g.render(RENDER_RATE);
      buffer = new AudioBuffer({ length: data.length, sampleRate: RENDER_RATE, numberOfChannels: 1 });
      buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.rendered.set(name, buffer);
    }
    return buffer;
  }

  /** A take that is not the one used last time. */
  private take(id: SlotId, voice?: string): string | null {
    const files = slotFiles(id, voice);
    if (!files.length) return null;
    const last = this.lastTake.get(id);
    const fresh = files.length > 1 ? files.filter((f) => f !== last) : files;
    const file = fresh[Math.floor(Math.random() * fresh.length)];
    this.lastTake.set(id, file);
    return file;
  }

  /** The buffer for a slot right now, a promise of it, or null when it has none (a shell generator). */
  private bufferFor(id: SlotId, voice?: string): AudioBuffer | Promise<AudioBuffer> | null {
    const s = SLOTS[id] as Slot;
    if ("generator" in s.source) {
      const g = ENGINE_GENERATORS[s.source.generator as EngineGeneratorName] as Generator | undefined;
      return g?.kind === "render" ? this.render(s.source.generator, g) : null;
    }
    const file = this.take(id, voice);
    if (!file) return null;
    const url = soundUrl(file);
    return this.decoded.get(url) ?? this.load(url);
  }

  /** Play a slot; false when it stays silent (no context, its bus at zero, the switch off). */
  play(id: SlotId, options: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return false;
    const s = SLOTS[id] as Slot;
    const levels = this.levels();
    if ((s.bus === "combat" && levels.combat <= 0) || (s.bus === "ambience" && (levels.ambience <= 0 || !this.ambienceOn))) return false;
    const rate = options.rate ?? (s.pitch ? 1 + (Math.random() * 2 - 1) * s.pitch : 1);
    if ("generator" in s.source) {
      const g = ENGINE_GENERATORS[s.source.generator as EngineGeneratorName] as Generator | undefined;
      if (!g) return false;
      if (g.kind === "play") {
        this.start(id, s, options, true, (out, at) => g.play(ctx, out, at));
        return true;
      }
    }
    const buffer = this.bufferFor(id, options.voice);
    if (!buffer) return false;
    const begin = (b: AudioBuffer) =>
      this.start(id, s, options, b.numberOfChannels === 1, (out, at) => {
        const source = new AudioBufferSourceNode(ctx, { buffer: b, playbackRate: rate });
        source.connect(out);
        source.start(at);
        return { source, nodes: [] };
      });
    if (buffer instanceof AudioBuffer) begin(buffer);
    else {
      const asked = ctx.currentTime;
      void buffer.then((b) => {
        if (this.ctx === ctx && ctx.currentTime - asked < LATE) begin(b);
      }, () => {});
    }
    return true;
  }

  private start(
    id: SlotId,
    s: Slot,
    options: PlayOptions,
    mono: boolean,
    make: (out: AudioNode, at: number) => { source: AudioScheduledSourceNode; nodes: AudioNode[] },
  ): Voice {
    const ctx = this.ctx!;
    const priority = s.bus === "ambience" ? 0 : 1;
    if (this.voices.length >= VOICE_CAP) this.steal();
    const at = s.spatial ? options.at : null;
    const gain = new GainNode(ctx, { gain: s.gain * (options.gain ?? 1) * (at && mono ? MONO_MAKEUP : 1) });
    let panner: PannerNode | null = null;
    const ring = id === "combat.daze.ring";
    const bus = ring ? this.ring : this.buses[s.bus];
    if (at && s.spatial && this.field) {
      panner = new PannerNode(ctx, {
        panningModel: "equalpower",
        distanceModel: "inverse",
        refDistance: s.spatial.ref,
        rolloffFactor: s.spatial.rolloff,
        maxDistance: s.spatial.max,
      });
      // The others are re-placed on the next frame if the camera moved since the last.
      if (this.readCamera()) this.moved = true;
      const d = this.place(panner, at.x, at.y, at.z, true);
      gain.connect(panner).connect(bus);
      const { source, nodes } = make(gain, ctx.currentTime);
      const voice: Voice = { id, source, nodes, gain, panner, x: at.x, y: at.y, z: at.z, started: ctx.currentTime, priority, distance: d };
      this.voices.push(voice);
      source.onended = () => this.retire(voice);
      return voice;
    }
    gain.connect(bus);
    const { source, nodes } = make(gain, ctx.currentTime);
    const voice: Voice = { id, source, nodes, gain, panner, x: 0, y: 0, z: 0, started: ctx.currentTime, priority, distance: 0 };
    this.voices.push(voice);
    source.onended = () => this.retire(voice);
    return voice;
  }

  // === Audition ===

  /**
   * Play any engine slot on its own, for the audition screen: loops loop
   * until stopped, positioned slots sit 40 m ahead and `side` × 30 m across
   * (−1 left, 1 right) of a camera at the origin. `gain` scales it (the
   * screen passes the channel's level for buses the engine does not level).
   * Returns the stop, or null when the slot is not the engine's to play.
   */
  audition(id: SlotId, side = 0, gain = 1): (() => void) | null {
    const ctx = this.open();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    this.field ??= AUDITION_FIELD;
    const s = SLOTS[id] as Slot;
    const options: PlayOptions = { at: s.spatial ? { x: side * 30, y: 0, z: -40 } : null, gain, voice: "male-01" };
    let voice: Voice | null = null;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (voice) this.fadeOut(voice);
    };
    if ("generator" in s.source) {
      const g = ENGINE_GENERATORS[s.source.generator as EngineGeneratorName] as Generator | undefined;
      if (!g) return null;
      if (g.kind === "play") {
        voice = this.start(id, s, options, true, (out, at) => g.play(ctx, out, at));
        return stop;
      }
    }
    const buffer = this.bufferFor(id, options.voice);
    if (!buffer) return null;
    const begin = (b: AudioBuffer) => {
      if (stopped || this.ctx !== ctx) return;
      voice = this.start(id, s, options, b.numberOfChannels === 1, (out, at) => {
        const source = new AudioBufferSourceNode(ctx, { buffer: b, loop: !!s.loop });
        if (typeof s.loop === "object") {
          source.loopStart = s.loop.start;
          source.loopEnd = s.loop.end;
        }
        source.connect(out);
        source.start(at);
        return { source, nodes: [] };
      });
    };
    if (buffer instanceof AudioBuffer) begin(buffer);
    else void buffer.then(begin, () => {});
    return stop;
  }

  /** Make room: the lowest priority, furthest and oldest voice fades out. */
  private steal() {
    const now = this.ctx!.currentTime;
    const info: VoiceInfo[] = this.voices.map((v) => ({ priority: v.priority, distance: v.distance, age: now - v.started }));
    const i = pickVictim(info);
    if (i >= 0) this.fadeOut(this.voices[i], true);
  }

  private fadeOut(v: Voice, drop = false) {
    const ctx = this.ctx!;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, STEAL_FADE / 3);
    try {
      v.source.stop(ctx.currentTime + STEAL_FADE * 2);
    } catch {
      // Not started yet or already stopped.
    }
    // A stolen voice leaves the count now; its tail ends on its own.
    if (drop) this.drop(v);
  }

  private drop(v: Voice) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private retire(v: Voice) {
    this.drop(v);
    v.source.disconnect();
    for (const n of v.nodes) n.disconnect();
    v.gain.disconnect();
    v.panner?.disconnect();
  }

  // === The ear ===

  /** Place a panner for world point (x, y, z) under the current camera; returns the distance. */
  private place(panner: PannerNode, x: number, y: number, z: number, snap: boolean): number {
    const p = this.point;
    toListener(this.matrix, x, y, z, p);
    if (snap) {
      panner.positionX.value = p.x;
      panner.positionY.value = p.y;
      panner.positionZ.value = p.z;
    } else {
      const t = this.ctx!.currentTime;
      panner.positionX.setTargetAtTime(p.x, t, POSITION_SMOOTH);
      panner.positionY.setTargetAtTime(p.y, t, POSITION_SMOOTH);
      panner.positionZ.setTargetAtTime(p.z, t, POSITION_SMOOTH);
    }
    return Math.sqrt(p.x * p.x + p.z * p.z);
  }

  /** Copy the camera's matrix; true when it moved since the last copy. */
  private readCamera(): boolean {
    const m = this.field!.camera();
    let changed = this.moved;
    for (let i = 0; i < 16; i++)
      if (this.matrix[i] !== m[i]) {
        this.matrix[i] = m[i];
        changed = true;
      }
    this.moved = false;
    return changed;
  }

  /** Every rendered frame: when the camera moved, re-place the positioned voices. No allocation. */
  frame() {
    if (!this.field || !this.ctx || !this.readCamera()) return;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.panner) v.distance = this.place(v.panner, v.x, v.y, v.z, false);
    }
  }

  // === Ambience ===

  /** Where and in what look the field is; the ambience crossfades to match. */
  setScene(location: Location, look: SceneLook | null) {
    const key = `${location}:${look?.time ?? ""}:${look?.weather ?? ""}`;
    if (this.field) this.field.location = location;
    if (key === this.planKey) return;
    this.planKey = key;
    this.plan = ambiencePlan(location, look);
    this.scheduler = new OneShotScheduler((look?.seed ?? 0x2b1d) ^ (location === "office" ? 0x5a5a : 0));
    if (this.ambienceOn) this.applyPlan(CROSSFADE);
    else this.syncAmbience();
  }

  /** Start or stop the ambience to match the switch, its level, the page and the field. */
  private syncAmbience() {
    const ctx = this.ctx;
    const want = !!ctx && !!this.field && !!this.plan && this.enabled && !this.hidden && this.levels().ambience > 0;
    if (want && !this.ambienceOn) {
      this.ambienceOn = true;
      this.applyPlan(FADE_IN);
      this.scheduleOneShot();
    } else if (!want && this.ambienceOn) this.stopAmbience(FADE_OUT);
  }

  private applyPlan(fade: number) {
    const ctx = this.ctx!;
    const plan = this.plan!;
    const t = ctx.currentTime;
    this.air.frequency.setTargetAtTime(plan.air, t, tc(fade));
    for (const [slot, bed] of this.beds)
      if (!(slot in plan.beds)) this.endBed(slot, bed, fade);
    let delay = 0;
    for (const [slot, level] of Object.entries(plan.beds) as [BedSlot, number][]) {
      const target = (SLOTS[slot] as Slot).gain * level;
      const bed = this.beds.get(slot);
      if (bed) {
        bed.target = target;
        bed.gain.gain.setTargetAtTime(target, t, tc(fade));
        continue;
      }
      // Rendering a bed is a few tens of milliseconds: one per task, so a frame never waits on two.
      const start = () => {
        if (!this.ambienceOn || this.ctx !== ctx || this.beds.has(slot) || !(slot in (this.plan?.beds ?? {}))) return;
        this.startBed(slot, (SLOTS[slot] as Slot).gain * (this.plan!.beds[slot] ?? 0), fade);
      };
      if (delay) setTimeout(start, delay);
      else start();
      delay += 40;
    }
  }

  private startBed(slot: BedSlot, target: number, fade: number) {
    const ctx = this.ctx!;
    const buffer = this.bufferFor(slot);
    if (!buffer) return;
    const gain = new GainNode(ctx, { gain: 0 });
    gain.connect(this.buses.ambience);
    const bed: Bed = { sources: [], nodes: [], gain, target };
    this.beds.set(slot, bed);
    const begin = (b: AudioBuffer) => {
      if (this.beds.get(slot) !== bed || this.ctx !== ctx) return;
      const s = SLOTS[slot] as Slot;
      // The rain's two layers are decorrelated takes, one each side; any other bed plays twice,
      // half its length apart, one each side, so a mono loop still fills the field.
      const layers: [offset: number, pan: number, level: number][] =
        slot === "ambience.rain.bed.a" ? [[0, -RAIN_SPREAD, 1]] :
        slot === "ambience.rain.bed.b" ? [[0, RAIN_SPREAD, 1]] :
        [[0, -0.5, Math.SQRT1_2], [b.duration / 2, 0.5, Math.SQRT1_2]];
      const t = ctx.currentTime;
      for (const [offset, pan, level] of layers) {
        const source = new AudioBufferSourceNode(ctx, { buffer: b, loop: true });
        if (typeof s.loop === "object") {
          source.loopStart = s.loop.start;
          source.loopEnd = s.loop.end;
        }
        const panner = new StereoPannerNode(ctx, { pan });
        const layer = new GainNode(ctx, { gain: level });
        source.connect(layer).connect(panner).connect(gain);
        source.start(t, offset % b.duration);
        bed.sources.push(source);
        bed.nodes.push(layer, panner);
      }
      gain.gain.setValueAtTime(0, t);
      gain.gain.setTargetAtTime(bed.target, t, tc(fade));
    };
    if (buffer instanceof AudioBuffer) begin(buffer);
    else void buffer.then(begin, () => {});
  }

  private endBed(slot: BedSlot, bed: Bed, fade: number) {
    const ctx = this.ctx!;
    this.beds.delete(slot);
    const t = ctx.currentTime;
    bed.gain.gain.setTargetAtTime(0, t, tc(fade));
    let left = bed.sources.length;
    const unhook = () => {
      for (const n of bed.nodes) n.disconnect();
      bed.gain.disconnect();
    };
    for (const source of bed.sources) {
      source.onended = () => {
        source.disconnect();
        if (--left === 0) unhook();
      };
      source.stop(t + fade * 1.2 + 0.05);
    }
    if (!left) unhook();
  }

  private stopAmbience(fade: number) {
    this.ambienceOn = false;
    clearTimeout(this.oneShotTimer);
    this.oneShotTimer = 0;
    if (!this.ctx) {
      this.beds.clear();
      return;
    }
    for (const [slot, bed] of this.beds) this.endBed(slot, bed, Math.max(fade, 0.02));
    for (const v of [...this.voices]) if (v.priority === 0) this.fadeOut(v);
  }

  private scheduleOneShot() {
    clearTimeout(this.oneShotTimer);
    const plan = this.plan,
      field = this.field,
      scheduler = this.scheduler;
    if (!this.ambienceOn || !plan || !field || !scheduler) return;
    const next = scheduler.next(plan, field.bounds, (slot: OneShotSlot) => (SLOTS[slot] as Slot).pitch ?? 0);
    if (!next) return;
    this.oneShotTimer = window.setTimeout(() => {
      let world = 0;
      for (const v of this.voices) if (v.priority === 0) world++;
      if (this.ambienceOn && world < WORLD_VOICE_CAP) this.play(next.slot, { at: next, rate: next.rate });
      this.scheduleOneShot();
    }, next.delay * 1000);
  }

  // === The reactive mix ===

  /** The field's state: aiming, the held unit dazed. A daze coming on rings the ears. */
  setField(inputs: MixInputs) {
    const wasDazed = this.mix.dazed;
    if (this.mix.set(inputs, wallClock())) this.applyMix();
    if (inputs.dazed && !wasDazed && this.enabled) this.play("combat.daze.ring");
  }

  /** A shot is about to land: everything around it drops away until `impact`. */
  beginShot() {
    if (!this.enabled) return;
    this.dipToken = this.mix.beginShot(wallClock());
    this.applyMix();
    clearTimeout(this.dipTimer);
    this.dipTimer = window.setTimeout(() => {
      if (this.mix.refresh(wallClock())) this.applyMix();
    }, (this.mix.dipLeft(wallClock()) ?? 0) * 1000 + 20);
  }

  /** The shot landed: the world comes back. */
  impact() {
    if (this.mix.impact(this.dipToken, wallClock())) this.applyMix();
    clearTimeout(this.dipTimer);
  }

  /** Back to neutral at once (a seek, the end of a match, a pause, a teardown). */
  resetMix() {
    clearTimeout(this.dipTimer);
    if (this.mix.reset(wallClock())) this.applyMix();
  }

  private applyMix() {
    const ctx = this.ctx;
    if (!ctx) return;
    const m = this.mix.current;
    const t = ctx.currentTime;
    this.duck.gain.setTargetAtTime(m.duck, t, m.duckRamp);
    this.daze.frequency.setTargetAtTime(m.cutoff, t, m.dazeRamp);
    const { a, b } = widthGains(m.width);
    const w = this.widthGains;
    w.ll.gain.setTargetAtTime(a, t, m.dazeRamp);
    w.rr.gain.setTargetAtTime(a, t, m.dazeRamp);
    w.rl.gain.setTargetAtTime(b, t, m.dazeRamp);
    w.lr.gain.setTargetAtTime(b, t, m.dazeRamp);
  }

  // === Instrumentation ===

  /** What is sounding and where the mix stands, for QA and the audition screen. */
  snapshot() {
    const ctx = this.ctx;
    return {
      state: ctx?.state ?? "closed",
      enabled: this.enabled,
      hidden: this.hidden,
      paused: this.paused,
      ambience: this.ambienceOn,
      plan: this.planKey,
      beds: [...this.beds.keys()],
      voices: this.voices.map((v) => ({
        id: v.id,
        world: [v.x, v.y, v.z],
        panner: v.panner ? [v.panner.positionX.value, v.panner.positionY.value, v.panner.positionZ.value] : null,
        distance: v.distance,
      })),
      gains: ctx
        ? {
            combat: this.buses.combat.gain.value,
            ambience: this.buses.ambience.gain.value,
            duck: this.duck.gain.value,
            cutoff: this.daze.frequency.value,
            width: this.widthGains.ll.gain.value - this.widthGains.rl.gain.value,
            air: this.air.frequency.value,
          }
        : null,
      mix: { ...this.mix.current },
    };
  }
}

const wallClock = () => performance.now() / 1000;

/** The audition's field: a camera at the origin looking down -z, a field around it. */
const AUDITION_FIELD: Field = {
  camera: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  location: "street",
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
};
