// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Perceptual volume. The sliders are loudness (0–100 as the ear judges it),
 * element volume is amplitude — and hearing is roughly logarithmic in
 * amplitude, so mapping the two linearly packs every audible change into the
 * bottom of the slider and makes the top half do nothing. The square of the
 * slider (Stevens' loudness law has amplitude ≈ loudness^1.7; x² is the
 * next-door curve that is exactly 0 at 0 and 1 at 100) keeps steps sounding
 * even: 50 plays at −12 dB, about half as loud, not half the voltage.
 *
 * This module is the one home of that math. The theme, the previews and the
 * levels handed to the engine (which multiplies them linearly and must stay
 * that way — it is handed amplitudes, see `index.ts`) all read it from here.
 */

import { getSettings } from "../settings/store";

/** Amplitude (0–1) for a 0–100 loudness slider. */
export function gain(level: number): number {
    const x = Math.max(0, Math.min(100, level)) / 100;
    return x * x;
}

/** The amplitude one channel plays at under the saved sliders; muted is silence. */
export function channelLevel(channel: "music" | "sfx" | "voice" | "ui"): number {
    const a = getSettings().audio;
    return a.muted ? 0 : gain(a.master) * gain(a[channel]);
}
