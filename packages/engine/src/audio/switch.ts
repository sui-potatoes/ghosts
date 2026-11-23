// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The one switch for the soundscape: spatial combat sounds, layered ambience
 * and the reactive mix. On by default; off, the encounter sounds exactly as
 * before it (recorded effects through media elements, unpositioned, no
 * ambience). Flipped at run time from the sound audition screen for A/B,
 * and kept on this device under `ghosts:soundscape`.
 */

const KEY = "ghosts:soundscape";
const listeners = new Set<() => void>();

function stored(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = stored();

export function soundscapeEnabled(): boolean {
  return enabled;
}

export function setSoundscapeEnabled(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  try {
    globalThis.localStorage?.setItem(KEY, on ? "on" : "off");
  } catch {
    // A private window: the switch holds for this page only.
  }
  for (const listener of listeners) listener();
}

export function subscribeSoundscape(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
