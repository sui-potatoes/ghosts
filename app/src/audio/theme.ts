// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The title theme: one looping track behind the menu screens. The level
 * follows the saved audio settings (master × music) live, so the sliders
 * are audible as they move. Browsers refuse sound before a gesture (Safari
 * always; focus is also flaky right after navigation), so a refused start
 * rolls MUTED instead — muted autoplay is allowed — and the first click or
 * key only unmutes, which no policy gates. The theme only sounds while the
 * window has focus: it fades out on blur and resumes on return, so a second
 * tab never doubles it.
 */

import { subscribeSettings } from "../settings/store";
import { audioFocused, subscribeAudioFocus } from "./focus";
import { channelLevel } from "./levels";

const OPUS = "/sounds/title-theme.opus";
const AAC = "/sounds/title-theme.m4a";

/** Timing breadcrumbs for the dev console; production stays quiet. */
const debug = import.meta.env.DEV
    ? (line: string) => console.info(`[theme +${Math.round(performance.now())}ms] ${line}`)
    : () => {};

let audio: HTMLAudioElement | null = null;
/** The shell wants the theme on; whether it sounds also depends on focus. */
let wanted = false;
/** A gesture listener armed while the theme is wanted but not yet audible. */
let retry: (() => void) | null = null;
/** The running volume ramp; while one runs, settings changes leave the level alone. */
let fade: { raf: number; backstop: number } | null = null;

/** The one element id; whoever asks for a player adopts it before creating. */
const ELEMENT_ID = "ghosts-title-theme";

function player(): HTMLAudioElement {
    if (audio) return audio;
    // AT MOST ONE THEME: the element lives in the document under a known id,
    // so a second copy of this module (a hot re-execution, a stray
    // timestamped import) adopts the existing player instead of stacking
    // another track over it.
    const existing = document.getElementById(ELEMENT_ID);
    audio = existing instanceof HTMLAudioElement ? existing : new Audio();
    if (!existing) {
        audio.id = ELEMENT_ID;
        // Opus only on a confident yes: Safari answers "maybe" for Ogg/Opus
        // it then decodes poorly or not at all, while every browser that
        // actually ships it says "probably". AAC is the native fast path
        // everywhere else; a decode error swaps to it instead of silence.
        audio.src = audio.canPlayType("audio/ogg; codecs=opus") === "probably" ? OPUS : AAC;
        audio.loop = true;
        audio.preload = "auto";
        document.body.append(audio);
    }
    audio.onerror = () => {
        if (!audio || !audio.src.endsWith(OPUS)) return;
        audio.src = AAC;
        audio.load();
        sync();
    };
    subscribeSettings(() => {
        if (audio && !fade) audio.volume = channelLevel("music");
    });
    return audio;
}

function cancelFade() {
    if (!fade) return;
    cancelAnimationFrame(fade.raf);
    clearTimeout(fade.backstop);
    fade = null;
}

/** Ramp the element volume to `to` over `ms`, then `done`. */
function ramp(to: number, ms: number, done?: () => void) {
    cancelFade();
    const a = audio!;
    const from = a.volume;
    const start = performance.now();
    const finish = () => {
        cancelFade();
        a.volume = to;
        done?.();
    };
    const step = (now: number) => {
        // The first frame's timestamp can predate `start`; clamp both ends.
        const t = Math.max(0, Math.min(1, (now - start) / ms));
        a.volume = from + (to - from) * t;
        if (t < 1) fade!.raf = requestAnimationFrame(step);
        else finish();
    };
    fade = {
        raf: requestAnimationFrame(step),
        // Frames stop when the tab hides mid-ramp; a timer lands the ending.
        backstop: window.setTimeout(finish, ms + 200),
    };
}

function arm() {
    if (retry) return;
    retry = () => {
        // A real gesture: unmuting (or playing) here is never policy-gated.
        debug("gesture");
        disarm();
        sync();
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
}

function disarm() {
    if (!retry) return;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
    retry = null;
}

/** Bring playback in line with the route and the window focus. */
function sync() {
    const on = wanted && audioFocused();
    if (!audio && !on) return;
    const a = player();
    if (!on) {
        disarm();
        // Wanted but not focused yet (Safari keeps focus in the address bar
        // after navigation): the first gesture is also what focuses us.
        if (wanted) arm();
        if (a.paused) return;
        // A hidden tab gets no frames and keeps sounding; cut it at once.
        if (document.hidden) {
            cancelFade();
            a.pause();
        } else {
            ramp(0, 600, () => a.pause());
        }
        return;
    }
    if (!a.paused) {
        if (a.muted) {
            // Rolling silently under autoplay policy; sync runs from a
            // gesture or focus change — unmuting needs no permission.
            a.muted = false;
            a.volume = 0;
            debug("unmuted");
            disarm();
            ramp(channelLevel("music"), 500);
            return;
        }
        cancelFade();
        a.volume = channelLevel("music");
        return;
    }
    a.volume = 0;
    debug(`play() ${a.src.split("/").pop()}`);
    // The screen or focus may change while play() is pending; honor the latest.
    a.play().then(
        () => {
            debug("playing");
            if (wanted && audioFocused()) ramp(channelLevel("music"), a.currentTime > 0 ? 500 : 1200);
            else a.pause();
        },
        (refusal) => {
            debug(`refused: ${refusal?.name ?? refusal}`);
            if (!wanted) return;
            // Sound is gated on a gesture; roll muted meanwhile so the first
            // click only has to unmute, with the buffer already warm.
            arm();
            a.muted = true;
            a.play().then(
                () => debug("rolling muted"),
                () => {
                    a.muted = false;
                    debug("muted roll refused too");
                },
            );
        },
    );
}

subscribeAudioFocus(sync);

/** Start the theme, fading in; keeps playing if it already is. */
export function playTheme() {
    debug(`playTheme (focused: ${audioFocused()})`);
    wanted = true;
    sync();
}

/** Fade the theme out and pause it; it resumes from the same spot. */
export function stopTheme() {
    wanted = false;
    sync();
}

// The playing element is module state: a hot re-execution would stack a new
// track over it (the old module keeps playing with nothing to stop it). The
// outgoing instance goes silent and inert; the next route change restarts.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        wanted = false;
        disarm();
        cancelFade();
        audio?.pause();
        audio = null;
    });
}
