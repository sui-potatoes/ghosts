// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
  DEFAULT_COMBAT_BINDINGS,
  DEFAULT_PAD_COMBAT_BINDINGS,
  type CombatBindings,
  type PadCombatBindings,
} from "./keys.ts";

/** Levels 0–100, as the shell's audio settings keep them. */
export interface AudioLevels {
  muted: boolean;
  master: number;
  sfx: number;
  voice: number;
}

/**
 * What the engine needs from the player's preferences. The host app owns
 * storage and the settings screens; the engine only reads, and re-reads on
 * `subscribe`.
 */
export interface EngineSettings {
  audio(): AudioLevels;
  /** Lower render cadence and resolution. */
  batterySaver(): boolean;
  combatKeys(): CombatBindings;
  /** The pad's combat bindings; the fixed buttons never appear in the record. */
  padCombat(): PadCombatBindings;
  subscribe(listener: () => void): () => void;
}

/** Defaults for a host that keeps no preferences. */
export const defaultSettings: EngineSettings = {
  audio: () => ({ muted: false, master: 80, sfx: 80, voice: 80 }),
  batterySaver: () => true,
  combatKeys: () => DEFAULT_COMBAT_BINDINGS,
  padCombat: () => DEFAULT_PAD_COMBAT_BINDINGS,
  subscribe: () => () => {},
};

let current = defaultSettings;

/** The settings in force; set once per mounted encounter. */
export function engineSettings(): EngineSettings {
  return current;
}

export function provideSettings(settings: EngineSettings) {
  current = settings;
}

// This module is live mutable state: a hot re-execution would hand the UI a
// fresh instance while the running encounter still drives the old one (dead
// input, unselectable units). Edits here reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
