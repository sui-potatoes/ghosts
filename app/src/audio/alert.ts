// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Calling a player back to a tab they left: one of the squad's voices asking for
 * the commander, and a blinking tab title until they return. The one sound that
 * plays without the window owning audio, since that is what it is for; it still
 * follows the mute and the dialogue level.
 */

import { lineUrl, RECORDED } from "@ghosts/engine/sounds";

import { audioFocused, subscribeAudioFocus } from "./focus";
import { channelLevel } from "./levels";

const BLINK_MS = 1000;

function callOut() {
    const level = channelLevel("voice");
    if (level <= 0) return;
    const voice = RECORDED[Math.floor(Math.random() * RECORDED.length)];
    const line = new Audio(lineUrl("commander", voice));
    line.volume = Math.min(1, level);
    line.play().catch(() => {});
}

let stopBlinking: (() => void) | null = null;

function blinkTitle(message: string) {
    stopBlinking?.();
    const title = document.title;
    let shown = false;
    const timer = window.setInterval(() => {
        shown = !shown;
        document.title = shown ? message : title;
    }, BLINK_MS);
    document.title = message;
    shown = true;
    const unsubscribe = subscribeAudioFocus(() => {
        if (audioFocused()) stopBlinking?.();
    });
    stopBlinking = () => {
        window.clearInterval(timer);
        unsubscribe();
        document.title = title;
        stopBlinking = null;
    };
}

/** Let the player know, wherever they are looking; the title only if it isn't here. */
export function callPlayerBack(message: string) {
    callOut();
    if (!audioFocused()) blinkTitle(message);
}
