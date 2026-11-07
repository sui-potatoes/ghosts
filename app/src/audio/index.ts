// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The one place the app's audio goes through. The title theme, the settings
 * previews, the focus gate and the loudness curve live behind this module,
 * and it is the only reader of the saved audio sliders. The encounter's own
 * sounds sit behind the engine's `CombatAudio` facade; `engineAudio()` is
 * what hands that facade the current levels.
 */

import type { EngineSettings } from "@ghosts/engine";
import { getSettings } from "../settings/store";
import { audioFocused } from "./focus";
import { gain } from "./levels";

export { callPlayerBack } from "./alert";
export { audioFocused, subscribeAudioFocus } from "./focus";
export { previewDialogue, previewEffect, previewVoice } from "./preview";
export { playTheme, stopTheme } from "./theme";
export { uiConfirm, uiTick } from "./ui";

/**
 * The audio levels as the encounter engine reads them, on every play — so a
 * blurred window mutes the next sound without a notification. The sliders
 * are loudness and the engine multiplies its levels linearly, so each is
 * curved to an amplitude here: the engine is handed amplitudes, not slider
 * values.
 */
export function engineAudio(): ReturnType<EngineSettings["audio"]> {
    const a = getSettings().audio;
    return {
        muted: a.muted || !audioFocused(),
        master: 100 * gain(a.master),
        sfx: 100 * gain(a.sfx),
        voice: 100 * gain(a.voice),
    };
}
