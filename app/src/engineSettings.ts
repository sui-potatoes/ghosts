// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { EngineSettings } from "@ghosts/engine";
import { engineAudio } from "./audio";
import { getSettings, subscribeSettings } from "./settings/store";

/**
 * The player's saved preferences, as the encounter engine reads them. Audio
 * levels come from the app's audio module (`src/audio`), already curved,
 * focus-gated and muted; the rest reads the settings store directly.
 */
export const engineSettings: EngineSettings = {
    audio: engineAudio,
    batterySaver: () => getSettings().display.batterySaver,
    combatKeys: () => getSettings().controls.combat,
    padCombat: () => getSettings().controls.padCombat,
    subscribe: subscribeSettings,
};
