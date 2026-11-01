// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Maps 0–100 volume sliders to amplitude by clamping, dividing by 100 and
 * squaring. Channel levels multiply the master and channel amplitudes;
 * muting returns zero.
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
