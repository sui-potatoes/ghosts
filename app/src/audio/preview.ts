// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Preview sounds for the audio sliders: a voice line on the dialogue level, a
 * weapon effect on the effects level, a burst of rain and city on the
 * ambience level, at the level just set. One channel, so dragging a slider
 * restarts the preview instead of stacking copies, and a new preview of any
 * kind cuts off the last. The lists come from the engine's own sound tables
 * through `@ghosts/engine/sounds`, a path with no three.js behind it, so the
 * settings chunk stays small; the ambience comes from the engine's
 * soundscape, loaded with the first ambience preview.
 */

import type { AmbiencePlan, Soundscape } from "@ghosts/engine/audition";
import { EFFECTS, effectUrl, lineUrl, PHRASES, RECORDED } from "@ghosts/engine/sounds";
import { audioFocused } from "./focus";
import { channelLevel } from "./levels";

/** Short lines, every recorded voice; longer barks would outstay a slider drag. */
const VOICE_LINES = [
    ...new Set([...PHRASES.select, ...PHRASES.move, ...PHRASES.fire, ...PHRASES.kill]),
].flatMap((phrase) => RECORDED.map((voice) => lineUrl(phrase, voice)));

/** Single shots and bursts. */
const EFFECT_TAKES = [...EFFECTS.pistol, ...EFFECTS.rifle, ...EFFECTS.sniper].map(effectUrl);

let current: HTMLAudioElement | null = null;
const last = new Map<string[], string>();

/** A take that is not the one used last time; the new one stops the current. */
function play(takes: string[], volume: number) {
    if (volume <= 0) return;
    const fresh = takes.length > 1 ? takes.filter((url) => url !== last.get(takes)) : takes;
    const url = fresh[Math.floor(Math.random() * fresh.length)];
    if (!url) return;
    last.set(takes, url);
    stopPreview();
    current = new Audio(url);
    current.volume = Math.min(1, volume);
    current.play().catch(() => {});
}

/** A squad voice line at the dialogue level just set. */
export function previewDialogue() {
    play(VOICE_LINES, channelLevel("voice"));
}

/** One line per recorded voice, the same phrase for all so they compare like for like. */
const AUDITIONS = new Map(
    RECORDED.map((voice) => [`${voice.sex}-${voice.index}`, [lineUrl("commander", voice)]]),
);

/**
 * A recruit's voice saying the audition line, at the dialogue level. Voice ids
 * are the chain's: even ids male, odd female, `id >> 1` the take index. Voices
 * without recordings stay silent.
 */
export function previewVoice(id: number) {
    const takes = AUDITIONS.get(`${id % 2 === 1 ? "female" : "male"}-${(id >> 1) + 1}`);
    if (takes) play(takes, channelLevel("voice"));
}

/** Cut off the preview playing now, e.g. an audition whose recruit is no longer shown. */
export function stopPreview() {
    current?.pause();
    current = null;
    stopAmbience();
}

// === Ambience ===

/** The beds the burst plays: a rainy night's rain and city, as the street has them. */
const AMBIENCE_BEDS = ["ambience.rain.bed.a", "ambience.rain.bed.b", "ambience.city.bed"] as const;
/** How long the burst holds before it fades (ms); the beds fade in and out quickly on their own. */
const AMBIENCE_HOLD = 1600;
/** The context is closed this long after the last burst (ms): nothing stays open in the menus. */
const AMBIENCE_IDLE = 8000;

let scape: Soundscape | null = null;
let plan: AmbiencePlan | null = null;
let loading: Promise<void> | null = null;
let stops: (() => void)[] = [];
let burst = 0;
/** Bursts started, for the idle close: any new one keeps the context open. */
let started = 0;
let holdTimer = 0;
let idleTimer = 0;

function stopAmbience() {
    burst++;
    for (const stop of stops) stop();
    stops = [];
    window.clearTimeout(holdTimer);
}

/** The soundscape the burst plays through: the field's own ambience bus, curve and air filter. */
function load(): Promise<void> {
    loading ??= import("@ghosts/engine/audition").then((m) => {
        scape = new m.Soundscape(() => ({
            combat: channelLevel("sfx"),
            ambience: channelLevel("ambience"),
        }));
        plan = m.ambiencePlan("street", { time: "night", weather: "heavy-rain" });
    });
    return loading;
}

/** A short burst of rain and the city at the ambience level just set; silent when muted, at zero or unfocused. */
export function previewAmbience() {
    if (channelLevel("ambience") <= 0 || !audioFocused()) {
        stopPreview();
        return;
    }
    const mine = ++burst;
    void load().then(() => {
        if (mine !== burst || !scape || !plan) return;
        stopPreview();
        const ticket = burst;
        scape.open();
        scape.applyLevels(true);
        for (const id of AMBIENCE_BEDS) {
            const stop = scape.audition(id, { plan });
            if (stop) stops.push(stop);
        }
        holdTimer = window.setTimeout(() => {
            if (ticket === burst) stopAmbience();
        }, AMBIENCE_HOLD);
        const count = ++started;
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            if (count === started) scape?.close();
        }, AMBIENCE_IDLE);
    });
}

/** A weapon sound at the effects level just set. */
export function previewEffect() {
    play(EFFECT_TAKES, channelLevel("sfx"));
}
