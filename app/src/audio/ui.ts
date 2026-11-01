// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Interface sounds: the short tick a menu makes as the cursor moves, and a
 * deeper take of the same knock when something is activated. One percussion
 * sample — the commander menu click from Sui Potatoes — sliced to its knock
 * and run through a band-pass, so it reads as a mechanical detent rather
 * than a drum. Plays on its own Interface channel under the loudness curve,
 * only while the window owns audio.
 *
 * Hover and activation are delegated once at the window, the way commander
 * wired its `.interactive` hovers: any house menu control ticks on enter and
 * knocks on click, whichever input produced the click (a menu's confirm
 * presses the focused button, so it lands here too). Setting lists are not
 * on the list — their rows move a cursor instead, and the list itself calls
 * `uiTick`/`uiConfirm` from its own handlers.
 */

import { audioFocused } from "./focus";
import { channelLevel } from "./levels";

const SRC = "/sounds/ui-tick.wav";
/** The audible window of the sample: skip the attack, keep the knock. */
const OFFSET = 0.02;
const LENGTH = 0.08;
/** Gain multiplier applied after the band-pass filter. */
const MAKEUP = 2;

let ctx: AudioContext | null = null;
let clip: AudioBuffer | null = null;
let loading = false;

/** Create or resume the context, start loading the clip, and report if it is loaded. */
function ensure(): boolean {
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
    return clip !== null;
}

function play(rate: number) {
    const level = channelLevel("ui");
    if (level <= 0 || !audioFocused() || !ensure() || !ctx || !clip) return;
    const source = new AudioBufferSourceNode(ctx, { buffer: clip, playbackRate: rate });
    const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 300 });
    const gain = new GainNode(ctx, { gain: level * MAKEUP });
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(0, OFFSET, LENGTH);
}

/** The cursor moved: a row, a value step, a category. */
export function uiTick() {
    play(1);
}

/** Something was activated: the same knock, deeper. */
export function uiConfirm() {
    play(0.6);
}

/** The house menu controls; `.set-row` is deliberately absent (see above). */
const INTERACTIVE = ".menu-item, .set-nav-item, .btn";
let hovered: Element | null = null;

if (typeof window !== "undefined") {
    window.addEventListener("mouseover", (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (el === hovered) return;
        hovered = el;
        if (el && !el.matches(":disabled")) uiTick();
    });
    window.addEventListener("click", (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (el && !el.matches(":disabled")) uiConfirm();
    });
}
