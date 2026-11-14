// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Settings screen's pure rules, tested in `tests/settings-gui.test.ts`:
 * the categories and their `?tab=` form, the rows each panel builds from the
 * settings schema (store keys, labels, the hint the command bar shows), the
 * level ⇄ slider mapping, what a panel reset would discard, and the custom
 * RPC endpoint form. No React, no browser: the store is a type import only.
 */

import { validateRpcUrl, type RpcUrlCheck } from "../../rpcUrl.ts";
import type { Settings } from "../../settings/store.ts";

// === Categories =============================================================

export const TABS = [
    { id: "player", label: "Player" },
    { id: "account", label: "Account" },
    { id: "audio", label: "Audio" },
    { id: "display", label: "Display" },
    { id: "controls", label: "Controls" },
    { id: "controller", label: "Controller" },
    { id: "network", label: "Network" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const FIRST_TAB: TabId = "player";

/** The category a `?tab=` value names; anything else is the first one. */
export function tabOf(param: string | null): TabId {
    return TABS.some((t) => t.id === param) ? (param as TabId) : FIRST_TAB;
}

/** The search params for a category: the first one keeps the URL bare. */
export function tabParams(tab: TabId): Record<string, string> {
    return tab === FIRST_TAB ? {} : { tab };
}

/** The category `step` away, wrapping (bumpers / Q·E). */
export function stepTab(tab: TabId, step: 1 | -1): TabId {
    const i = TABS.findIndex((t) => t.id === tab);
    return TABS[(i + step + TABS.length) % TABS.length].id;
}

// === Rows from the schema ===================================================

export type LevelKey = "master" | "music" | "sfx" | "voice" | "ui";

export type LevelRow = {
    key: LevelKey;
    label: string;
    hint: string;
    /** The sound a change plays at the new level; the Interface row's own tick is its preview. */
    preview?: "effect" | "dialogue";
};

export const LEVEL_ROWS: LevelRow[] = [
    { key: "master", label: "Master", hint: "Overall level; every channel scales under it" },
    { key: "music", label: "Music", hint: "Score and ambient music" },
    { key: "sfx", label: "Effects", hint: "Weapons and impacts", preview: "effect" },
    {
        key: "voice",
        label: "Dialogue",
        hint: "Squad chatter and mission dialogue",
        preview: "dialogue",
    },
    { key: "ui", label: "Interface", hint: "Menu ticks and clicks" },
];

/** Ten detents, like the classic list's blocks. */
export const LEVEL_SEGMENTS = 10;

/** A stored 0–100 level as the slider's 0–1 value. */
export function levelToSlider(level: number): number {
    return Math.max(0, Math.min(100, level)) / 100;
}

/** The slider's 0–1 value as a stored 0–100 level. */
export function sliderToLevel(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export type FlagKey = "batterySaver" | "scanlines" | "vignette" | "reduceMotion" | "wireframe";

export const FLAG_ROWS: { key: FlagKey; label: string; hint: string }[] = [
    {
        key: "batterySaver",
        label: "Battery saver",
        hint: "Lower frame rate and scene detail to save power",
    },
    { key: "scanlines", label: "Scanlines", hint: "Faint CRT scanlines over the picture" },
    { key: "vignette", label: "Vignette", hint: "Darkened frame edges for a low-light read" },
    { key: "reduceMotion", label: "Reduce motion", hint: "Interface animation kept to a minimum" },
    {
        key: "wireframe",
        label: "Wireframe models",
        hint: "Gear and recruit models as wireframes, with a triangle count",
    },
];

/** A two-state Stepper's options. */
export function switchOptions(off = "Off", on = "On"): [string, string][] {
    return [
        ["off", off],
        ["on", on],
    ];
}

export const onOff = (on: boolean) => (on ? "on" : "off");

// === Panel resets ===========================================================

/** What a panel's reset restores: its own store keys, nothing else. */
export const PANEL_KEYS = {
    audio: ["master", "music", "sfx", "voice", "ui", "muted"],
    display: ["batterySaver", "scanlines", "vignette", "reduceMotion", "wireframe"],
    controls: ["combat"],
    controller: ["padCombat"],
} as const satisfies {
    audio: (keyof Settings["audio"])[];
    display: (keyof Settings["display"])[];
    controls: (keyof Settings["controls"])[];
    controller: (keyof Settings["controls"])[];
};

/** The store section a panel's keys live in. */
function sectionOf(panel: keyof typeof PANEL_KEYS): "audio" | "display" | "controls" {
    return panel === "controller" ? "controls" : panel;
}

/** How many of a panel's own settings differ from their defaults. */
export function panelChanges<K extends keyof typeof PANEL_KEYS>(
    panel: K,
    settings: Settings,
    defaults: Settings,
): number {
    const section = sectionOf(panel);
    const keys = PANEL_KEYS[panel] as readonly string[];
    const current = settings[section] as Record<string, unknown>;
    const base = defaults[section] as Record<string, unknown>;
    if (panel === "controls" || panel === "controller") {
        // Bindings count per action, so the prompt can say how many go.
        const key = keys[0];
        const now = current[key] as Record<string, unknown>;
        const def = base[key] as Record<string, unknown>;
        return Object.keys(def).filter((a) => JSON.stringify(now[a]) !== JSON.stringify(def[a]))
            .length;
    }
    return keys.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(base[k])).length;
}

/** The patch a panel's reset writes: its own keys at their defaults. */
export function panelReset<K extends keyof typeof PANEL_KEYS>(
    panel: K,
    settings: Settings,
    defaults: Settings,
): Settings {
    const section = sectionOf(panel);
    const patch: Record<string, unknown> = {};
    for (const k of PANEL_KEYS[panel]) patch[k] = (defaults[section] as Record<string, unknown>)[k];
    return { ...settings, [section]: { ...settings[section], ...patch } };
}

// === The RPC endpoint form ==================================================

export type RpcProbeResult =
    { ok: true; latencyMs: number; chainId: string } | { ok: false; error: string };

export type RpcStatus =
    | { kind: "idle" }
    | { kind: "busy"; what: "test" | "save" }
    | { kind: "done"; result: RpcProbeResult };

export type RpcFormInput = {
    /** What the field holds. */
    draft: string;
    /** The saved override ("" = the default endpoint). */
    saved: string;
    status: RpcStatus;
    /** The endpoint the running clients were built with. */
    active: string;
    /** The network's public default. */
    fallback: string;
};

export type RpcFormView = {
    check: RpcUrlCheck;
    busy: boolean;
    /** The draft differs from what is saved: the header's "Unsaved". */
    unsaved: boolean;
    /** What is saved is not what the clients use: a reload applies it. */
    reload: boolean;
    /** Why each command is refused; undefined when it runs. */
    testDeny?: string;
    saveDeny?: string;
    resetDeny?: string;
    /** The line the command bar shows: the probe result, a URL problem, or nothing. */
    line: { text: string; tone: "ok" | "warn" } | null;
};

/** The endpoint shown for a URL: its host, or the default's. */
export function endpointHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

export function rpcForm({ draft, saved, status, active, fallback }: RpcFormInput): RpcFormView {
    const check = validateRpcUrl(draft);
    const busy = status.kind === "busy";
    const unsaved = !check.ok || check.url !== saved;
    const reload = (saved || fallback) !== active;
    const target = check.ok ? check.url || fallback : "";
    let line: RpcFormView["line"] = null;
    if (!check.ok) line = { text: check.error, tone: "warn" };
    else if (status.kind === "done")
        line = status.result.ok
            ? {
                  text: `OK: ${endpointHost(target)} answers in ${status.result.latencyMs} ms`,
                  tone: "ok",
              }
            : { text: status.result.error, tone: "warn" };
    return {
        check,
        busy,
        unsaved,
        reload,
        testDeny: busy ? "Testing" : !check.ok ? check.error : undefined,
        saveDeny: busy
            ? "Testing"
            : !check.ok
              ? check.error
              : !unsaved
                ? "Already saved"
                : undefined,
        resetDeny: busy ? "Testing" : !saved && !draft ? "Already the default" : undefined,
        line,
    };
}
