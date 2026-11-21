// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A slot's loudness as the player gets it: rendered offline through the
 * soundscape's own buses (the audition's path, which is the field's), then
 * measured (`loudness.ts`). Browser only: it needs an `OfflineAudioContext`.
 */

import type { AmbiencePlan } from "./ambience-model.ts";
import { measure, type Loudness } from "./loudness.ts";
import { SLOTS, type Slot, type SlotId } from "./manifest.ts";
import { Soundscape, type Levels } from "./soundscape.ts";

export interface MeasureOptions {
  /** The bus levels (amplitudes) to render at: the defaults, for a like-for-like table. */
  levels: Levels;
  /** Extra gain, for buses the engine does not level (voice, interface, music). */
  gain?: number;
  /** Metres from the camera for a positioned slot. */
  distance?: number;
  /** The ambience plan a bed or one-shot plays under (its level and air). */
  plan?: AmbiencePlan;
  /** Render length; default 10 s for loops, 12 s for the rest. */
  seconds?: number;
}

const RATE = 48000;

export async function measureSlot(id: SlotId, options: MeasureOptions): Promise<Loudness | null> {
  const s = SLOTS[id] as Slot;
  const seconds = options.seconds ?? (s.loop ? 10 : 12);
  const ctx = new OfflineAudioContext(2, RATE * seconds, RATE);
  const scape = new Soundscape(() => options.levels);
  scape.open(ctx);
  await scape.ready(id);
  const played = scape.audition(id, { distance: options.distance, gain: options.gain, plan: options.plan, take: 0 });
  if (!played) return null;
  const out = await ctx.startRendering();
  return measure([out.getChannelData(0), out.getChannelData(1)], RATE);
}
