import { DEFAULT_COMBAT_BINDINGS, type CombatBindings } from "./keys.ts";

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
  subscribe(listener: () => void): () => void;
}

/** Defaults for a host that keeps no preferences. */
export const defaultSettings: EngineSettings = {
  audio: () => ({ muted: false, master: 80, sfx: 80, voice: 80 }),
  batterySaver: () => true,
  combatKeys: () => DEFAULT_COMBAT_BINDINGS,
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
