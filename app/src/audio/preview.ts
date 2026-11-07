// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Preview sounds for the audio sliders: a voice line on the dialogue level, a
 * weapon effect on the effects level, at the level just set. One channel, so
 * dragging a slider restarts the preview instead of stacking copies. The
 * lists come from the engine's own sound tables through `@ghosts/engine/sounds`,
 * a path with no three.js behind it, so the settings chunk stays small.
 */

import { EFFECTS, effectUrl, lineUrl, PHRASES, RECORDED } from "@ghosts/engine/sounds";
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
    current?.pause();
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

/** A weapon sound at the effects level just set. */
export function previewEffect() {
    play(EFFECT_TAKES, channelLevel("sfx"));
}
