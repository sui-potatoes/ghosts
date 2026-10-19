// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Local game preferences: audio levels and display options. Saved on this
 * device, applied at startup, changed from the Settings screen. Nothing here
 * touches the chain or the account.
 */

import { useSyncExternalStore } from "react";

import { ACTIONS, DEFAULT_BINDINGS, actionOf, type Action, type Bindings } from "./keys";

export type Settings = {
    audio: { master: number; music: number; sfx: number; voice: number; muted: boolean };
    display: { scanlines: boolean; vignette: boolean; reduceMotion: boolean; batterySaver: boolean };
    controls: { bindings: Bindings };
};

export const DEFAULTS: Settings = {
    audio: { master: 80, music: 60, sfx: 80, voice: 80, muted: false },
    display: { scanlines: true, vignette: true, reduceMotion: false, batterySaver: true },
    controls: { bindings: DEFAULT_BINDINGS },
};

const KEY = "ghosts:settings";
const LISTENERS = new Set<() => void>();

function level(v: unknown, fallback: number): number {
    return typeof v === "number" && Number.isFinite(v)
        ? Math.max(0, Math.min(100, Math.round(v)))
        : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}

function keys(v: unknown, fallback: string[]): string[] {
    if (!Array.isArray(v)) return fallback;
    const list = v.filter((k): k is string => typeof k === "string" && k.length > 0);
    return list.length > 0 ? list : fallback;
}

function bindings(v: unknown): Bindings {
    const b = (v ?? {}) as Partial<Record<Action, unknown>>;
    const out = {} as Bindings;
    for (const action of ACTIONS) out[action] = keys(b[action], DEFAULT_BINDINGS[action]);
    return out;
}

/** Fill in anything missing or malformed from a stored object. */
function sanitize(raw: unknown): Settings {
    const r = (raw ?? {}) as {
        audio?: Record<string, unknown>;
        display?: Record<string, unknown>;
        controls?: Record<string, unknown>;
    };
    const a = r.audio ?? {};
    const d = r.display ?? {};
    const c = r.controls ?? {};
    return {
        audio: {
            master: level(a.master, DEFAULTS.audio.master),
            music: level(a.music, DEFAULTS.audio.music),
            sfx: level(a.sfx, DEFAULTS.audio.sfx),
            voice: level(a.voice, DEFAULTS.audio.voice),
            muted: flag(a.muted, DEFAULTS.audio.muted),
        },
        display: {
            scanlines: flag(d.scanlines, DEFAULTS.display.scanlines),
            vignette: flag(d.vignette, DEFAULTS.display.vignette),
            reduceMotion: flag(d.reduceMotion, DEFAULTS.display.reduceMotion),
            batterySaver: flag(d.batterySaver, DEFAULTS.display.batterySaver),
        },
        controls: { bindings: bindings(c.bindings) },
    };
}

function load(): Settings {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? sanitize(JSON.parse(raw)) : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
}

let current: Settings = load();

/** Push display options to the document so global CSS can react to them. */
function applyDisplay(s: Settings) {
    const h = document.documentElement;
    h.dataset.scanlines = s.display.scanlines ? "on" : "off";
    h.dataset.vignette = s.display.vignette ? "on" : "off";
    h.dataset.reduceMotion = s.display.reduceMotion ? "on" : "off";
}

// Keep same-origin game frames and tabs in sync with the shared preferences.
window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    current = load();
    applyDisplay(current);
    for (const listener of LISTENERS) listener();
});

/** Call once at startup, before the first render. */
export function initSettings() {
    applyDisplay(current);
}

export function getSettings(): Settings {
    return current;
}

/** The action a key event maps to under the current bindings. */
export function currentAction(e: Parameters<typeof actionOf>[0]): Action | null {
    return actionOf(e, current.controls.bindings);
}

export function updateSettings(patch: (s: Settings) => Settings) {
    current = sanitize(patch(current));
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch (e) {
        console.warn("localStorage write failed:", e);
    }
    applyDisplay(current);
    for (const listener of LISTENERS) listener();
}

export function subscribeSettings(listener: () => void): () => void {
    LISTENERS.add(listener);
    return () => LISTENERS.delete(listener);
}

/** Current settings and an updater, re-rendering on change. */
export function useSettings(): [Settings, typeof updateSettings] {
    const s = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
    return [s, updateSettings];
}
