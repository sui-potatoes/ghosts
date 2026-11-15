// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The cue for a podium light striking on (recruitment): a heavy lamp or relay
 * catching, synthesised with Web Audio, no samples. Four layers, all low:
 *
 * - thunk: a sine falling 110 Hz -> 46 Hz in 0.11 s, 3 ms attack, decaying to
 *   silence by 0.16 s (0.22 s on the last podium);
 * - strike: white noise through a band-pass (Q 1.4) sweeping 1400 -> 380 Hz in
 *   0.09 s and a 3 kHz low-pass, 2 ms attack, gone by 0.1 s;
 * - hum: a 50 Hz sawtooth through a 240 Hz low-pass, 12 ms swell to 0.16,
 *   decaying with a 0.09 s time constant, stopped at 0.38 s;
 * - re-strike: a smaller thunk (80 -> 45 Hz, 0.06 s) at +0.07 s, the lamp
 *   catching again as the light flickers.
 *
 * Each podium detunes the pitches (x0.94, 0.98, 1.03, 1.07) and the last is a
 * little fuller (1.2 x level, a longer thunk). The whole cue is at most 0.4 s,
 * on the interface channel under the loudness curve, silent when muted or when
 * the window does not own audio.
 */

import { audioFocused } from "./focus";
import { channelLevel } from "./levels";

const DETUNE = [0.94, 0.98, 1.03, 1.07];
/** Overall headroom so the layers never clip. */
const MASTER = 0.5;

export interface LampVariant {
    /** Which podium struck (0-based); detunes the cue. */
    index: number;
    /** The last of the squad: a touch fuller. */
    last?: boolean;
}

let noise: AudioBuffer | null = null;

/** Schedule one cue on `ctx` into `out` at time `at`. Returns its length in seconds. */
export function scheduleLamp(
    ctx: BaseAudioContext,
    out: AudioNode,
    at: number,
    { index, last = false }: LampVariant,
): number {
    const d = DETUNE[index % DETUNE.length];
    const full = last ? 1.2 : 1;
    const end = last ? 0.4 : 0.38;
    const master = new GainNode(ctx, { gain: MASTER * full });
    master.connect(out);

    const thunk = (
        from: number,
        to: number,
        fall: number,
        peak: number,
        decay: number,
        t0: number,
    ) => {
        const osc = new OscillatorNode(ctx, { type: "sine", frequency: from * d });
        osc.frequency.setValueAtTime(from * d, at + t0);
        osc.frequency.exponentialRampToValueAtTime(to * d, at + t0 + fall);
        const env = new GainNode(ctx, { gain: 0 });
        env.gain.setValueAtTime(0, at + t0);
        env.gain.linearRampToValueAtTime(peak, at + t0 + 0.003);
        env.gain.exponentialRampToValueAtTime(0.001, at + t0 + decay);
        osc.connect(env).connect(master);
        osc.start(at + t0);
        osc.stop(at + t0 + decay + 0.02);
    };
    thunk(110, 46, 0.11, 0.9, last ? 0.22 : 0.16, 0);
    thunk(80, 45, 0.06, 0.35, 0.07, 0.07);

    if (!noise || noise.sampleRate !== ctx.sampleRate) {
        noise = new AudioBuffer({
            length: Math.ceil(ctx.sampleRate * 0.12),
            sampleRate: ctx.sampleRate,
        });
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const burst = new AudioBufferSourceNode(ctx, { buffer: noise });
    const band = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1400, Q: 1.4 });
    band.frequency.setValueAtTime(1400 * d, at);
    band.frequency.exponentialRampToValueAtTime(380 * d, at + 0.09);
    const soft = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3000 });
    const bang = new GainNode(ctx, { gain: 0 });
    bang.gain.setValueAtTime(0, at);
    bang.gain.linearRampToValueAtTime(0.45, at + 0.002);
    bang.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
    burst.connect(band).connect(soft).connect(bang).connect(master);
    burst.start(at);

    const hum = new OscillatorNode(ctx, { type: "sawtooth", frequency: 50 * d });
    const cut = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 240 });
    const swell = new GainNode(ctx, { gain: 0 });
    swell.gain.setValueAtTime(0, at);
    swell.gain.linearRampToValueAtTime(0.16, at + 0.012);
    swell.gain.setTargetAtTime(0, at + 0.04, 0.09);
    hum.connect(cut).connect(swell).connect(master);
    hum.start(at);
    hum.stop(at + end);
    return end;
}

let ctx: AudioContext | null = null;

/** A podium's light struck on. */
export function uiLampOn(index: number, last = false) {
    const level = channelLevel("ui");
    if (level <= 0 || !audioFocused()) return;
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const out = new GainNode(ctx, { gain: level });
    out.connect(ctx.destination);
    const length = scheduleLamp(ctx, out, ctx.currentTime + 0.005, { index, last });
    window.setTimeout(() => out.disconnect(), (length + 0.1) * 1000);
}
