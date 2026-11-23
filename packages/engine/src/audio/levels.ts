// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { AudioLevels } from "../settings.ts";

/** Ambience: master × ambience; a host without an ambience level gives it the effects level. */
export function ambienceVolume(s: AudioLevels): number {
  return s.muted ? 0 : (s.master / 100) * ((s.ambience ?? s.sfx) / 100);
}
