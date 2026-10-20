// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { EngineSettings } from "@ghosts/engine";
import { getSettings, subscribeSettings } from "./settings/store";

/** The player's saved preferences, as the encounter engine reads them. */
export const engineSettings: EngineSettings = {
    audio: () => getSettings().audio,
    batterySaver: () => getSettings().display.batterySaver,
    combatKeys: () => getSettings().controls.combat,
    subscribe: subscribeSettings,
};
