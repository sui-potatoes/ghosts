// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Interface sounds, one per gesture. The base is one percussion sample — the
 * commander menu click from Sui Potatoes — sliced to its knock and run
 * through a band-pass, so it reads as a mechanical detent rather than a drum:
 * the move tick is that knock, pitched by how high the row sits. The other
 * gestures layer a little synthesis on it (no other assets): confirm is a
 * latch (a bright catch, the deep knock, a low body), a refusal a dull thud,
 * back a soft release. Every play is detuned a touch so repeats never sound
 * identical and leans toward the row's side of the screen. Everything plays
 * on the Interface channel under the loudness curve, only while the window
 * owns audio, and ticks pass a rate gate so a sweep never chatters.
 *
 * Hover and activation are delegated once at the window, the way commander
 * wired its `.interactive` hovers: any house menu control ticks on enter and
 * knocks on click, whichever input produced the click (a menu's confirm
 * presses the focused button, so it lands here too). Setting lists are not
 * on the list — their rows move a cursor instead, and the list itself calls
 * `uiTick`/`uiConfirm` from its own handlers.
 */

import { slotFiles, soundUrl } from "@ghosts/engine/sounds";
import { holdRate } from "../ui/tactile-model";
import { audioFocused } from "./focus";
import { channelLevel } from "./levels";
import { COUNT_GAP_MS, jitter, panFor, pitchFor, RateGate, TICK_GAP_MS } from "./ui-model";

const SRC = soundUrl(slotFiles("ui.tick")[0]);
/** The audible window of the sample: skip the attack, keep the knock. */
const OFFSET = 0.02;
const LENGTH = 0.08;
/** Gain multiplier applied after the band-pass filter. */
const MAKEUP = 2;

let ctx: AudioContext | null = null;
let clip: AudioBuffer | null = null;
let noise: AudioBuffer | null = null;
let loading = false;

const ticks = new RateGate(TICK_GAP_MS);
const counts = new RateGate(COUNT_GAP_MS);

/** Create or resume the context and start loading the clip; the context, or null. */
function ensure(): AudioContext | null {
    ctx ??= new AudioContext();
    // Created before the first gesture the context sits suspended; keep asking.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!clip && !loading) {
        loading = true;
        fetch(SRC)
            .then((res) => res.arrayBuffer())
            .then((data) => ctx!.decodeAudioData(data))
            .then((buffer) => void (clip = buffer))
            .catch(() => void (loading = false));
    }
    return ctx;
}

/** A short buffer of white noise, made once: the bright edge of a latch, the air of a release. */
function noiseBuffer(c: AudioContext): AudioBuffer {
    if (noise) return noise;
    const buffer = c.createBuffer(1, Math.round(c.sampleRate * 0.08), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return (noise = buffer);
}

/** The level an interface sound plays at now, or 0 when it must stay silent. */
function level(soft: number): number {
    if (!audioFocused()) return 0;
    return channelLevel("ui") * soft;
}

/** Where a sound sits: its row's pan and the rate its height gives. */
function place(el: Element | null | undefined): { pan: number; height: number } {
    if (!el || typeof window === "undefined") return { pan: 0, height: 1 };
    const box = el.getBoundingClientRect();
    return {
        pan: panFor(box.left + box.width / 2, window.innerWidth),
        height: pitchFor(box.top + box.height / 2, window.innerHeight),
    };
}

/** One voice's chain to the speakers through a panner; it unhooks itself when done. */
function voice(c: AudioContext, src: AudioScheduledSourceNode, nodes: AudioNode[], pan: number) {
    const panner = new StereoPannerNode(c, { pan });
    let at: AudioNode = src;
    for (const node of nodes) at = at.connect(node);
    at.connect(panner).connect(c.destination);
    src.onended = () => {
        src.disconnect();
        for (const node of nodes) node.disconnect();
        panner.disconnect();
    };
}

/** The sample's knock at `rate`, band-passed at `band`. */
function knock(rate: number, soft: number, pan: number, band = 300, delay = 0) {
    const gain = level(soft);
    const c = gain > 0 ? ensure() : null;
    if (!c || !clip) return;
    const src = new AudioBufferSourceNode(c, { buffer: clip, playbackRate: rate });
    voice(
        c,
        src,
        [
            new BiquadFilterNode(c, { type: "bandpass", frequency: band }),
            new GainNode(c, { gain: gain * MAKEUP }),
        ],
        pan,
    );
    src.start(c.currentTime + delay, OFFSET, LENGTH);
}

/** A sine body falling from `from` to `to` Hz over `length` s: weight under a knock. */
function body(from: number, to: number, length: number, soft: number, pan: number) {
    const gain = level(soft);
    const c = gain > 0 ? ensure() : null;
    if (!c) return;
    const t = c.currentTime;
    const osc = new OscillatorNode(c, { type: "sine", frequency: from });
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    const env = new GainNode(c, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    voice(c, osc, [env], pan);
    osc.start(t);
    osc.stop(t + length + 0.02);
}

/** A burst of filtered noise: `type` and `freq` shape it, `length` s long. */
function grain(
    type: BiquadFilterType,
    freq: number,
    length: number,
    soft: number,
    pan: number,
    delay = 0,
) {
    const gain = level(soft);
    const c = gain > 0 ? ensure() : null;
    if (!c) return;
    const t = c.currentTime + delay;
    const src = new AudioBufferSourceNode(c, { buffer: noiseBuffer(c) });
    const env = new GainNode(c, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
    voice(c, src, [new BiquadFilterNode(c, { type, frequency: freq, Q: 0.9 }), env], pan);
    src.start(t);
    src.stop(t + length + 0.02);
}

/** The cursor moved: a row, a value step, a category. A dry tick, pitched by height. */
export function uiTick(element: Element | null = document.activeElement) {
    if (!ticks.take(performance.now())) return;
    const { pan, height } = place(element);
    knock(jitter(height), 1, pan);
}

/** Something was activated: a latch. A bright catch, the deep knock, a low body. */
export function uiConfirm(element?: Element | null) {
    const { pan } = place(element);
    grain("bandpass", 2600, 0.012, 0.22, pan);
    knock(jitter(0.6), 1, pan, 300, 0.006);
    body(150, 70, 0.07, 0.3, pan);
}

/** A step back out of a menu or prompt: a soft release, lighter and higher than confirm. */
export function uiBack(element?: Element | null) {
    const { pan } = place(element);
    knock(jitter(0.85), 0.55, pan);
    grain("highpass", 1800, 0.05, 0.06, pan, 0.01);
}

/** A refused action: a dull thud, read as "no" without words. */
export function uiDeny(element?: Element | null) {
    const { pan } = place(element);
    body(105, 52, 0.12, 0.55, pan);
    knock(jitter(0.42), 0.7, pan, 200);
}

/** One step of a hold to confirm: the knock, climbing with each step. */
export function uiHoldStep(element: Element | null | undefined, step: number) {
    const { pan } = place(element);
    knock(holdRate(step), 0.5, pan);
}

/** A hold let go before it completed: the latch falls back, quietly. */
export function uiHoldCancel(element?: Element | null) {
    const { pan } = place(element);
    knock(jitter(0.5), 0.35, pan, 240);
}

/** A counter rolled one step: a small, high click, gated so a long roll never buzzes. */
export function uiCount() {
    if (!counts.take(performance.now())) return;
    knock(jitter(1.5), 0.3, 0, 900);
}

/**
 * A result settling into place (the debrief's podiums, one at a time): the
 * knock at half weight. Home is the confirm's pitch; a promotion lands a
 * touch brighter; a fallen operative is the lowest and quietest of the set.
 */
export function uiResolve(kind: "home" | "promoted" | "fallen") {
    if (kind === "fallen") knock(0.36, 0.4, 0);
    else knock(kind === "promoted" ? 0.8 : 0.6, 0.5, 0);
}

/** The house menu controls; `.set-row` is deliberately absent (see above). */
const INTERACTIVE = ".menu-item, .set-nav-item, .btn";
let hovered: Element | null = null;

if (typeof window !== "undefined") {
    window.addEventListener("mouseover", (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (el === hovered) return;
        hovered = el;
        if (el && !el.matches(":disabled")) uiTick(el);
    });
    window.addEventListener("click", (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (el && !el.matches(":disabled")) uiConfirm(el);
    });
}
