// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the shell's sound audition screen needs, without three.js: the
 * manifest, a soundscape of its own to play engine slots, the switch, and
 * the mounted encounter's soundscape for a live readout.
 */

export * from "./manifest.ts";
export { Soundscape } from "./soundscape.ts";
export { setSoundscapeEnabled, soundscapeEnabled, subscribeSoundscape } from "./switch.ts";
export { ambiencePlan, type AmbiencePlan } from "./ambience-model.ts";
export { measure, type Loudness } from "./loudness.ts";
export { measureSlot } from "./measure.ts";
