// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The first-visit intros' pure rules, tested in `tests/intro.test.ts`: which
 * intro a route is due, in what order, and how acceptance is kept on the
 * device. No React.
 */

import { menuRoute } from "../name-step/rules.ts";
import { INTROS, INTRO_ORDER, type IntroId } from "./intros.ts";

/** The device's record: a map of intro id to the version accepted. */
export const INTRO_KEY = "ghosts:intros";
/** The key the site welcome used alone, still read so nobody is asked twice. */
const LEGACY_WELCOME_KEY = "ghosts:welcome";

export type Accepted = Partial<Record<IntroId, number>>;

export interface IntroStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** Whether `pathname` is the screen an intro belongs to. */
export function introRoute(id: IntroId, pathname: string): boolean {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (id === "welcome") return menuRoute(path);
    if (id === "play") return path === "/play";
    return (
        (path === "/headquarters" || path.startsWith("/headquarters/")) && !path.includes("classic")
    );
}

export function readAccepted(store: IntroStore | null): Accepted {
    const out: Accepted = {};
    try {
        const legacy = store?.getItem(LEGACY_WELCOME_KEY);
        if (legacy && /^\d+$/.test(legacy)) out.welcome = Number(legacy);
        const raw = store?.getItem(INTRO_KEY);
        const map: unknown = raw ? JSON.parse(raw) : null;
        if (map && typeof map === "object") {
            for (const id of INTRO_ORDER) {
                const v = (map as Record<string, unknown>)[id];
                if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[id] = v;
            }
        }
    } catch {
        // unreadable: nothing accepted
    }
    return out;
}

/** `id` accepted at its current text's version. `saved` is false when the device would not keep it. */
export function accept(
    store: IntroStore | null,
    accepted: Accepted,
    id: IntroId,
): { accepted: Accepted; saved: boolean } {
    const next = { ...accepted, [id]: INTROS[id].version };
    try {
        if (!store) return { accepted: next, saved: false };
        store.setItem(INTRO_KEY, JSON.stringify(next));
        return { accepted: next, saved: true };
    } catch {
        return { accepted: next, saved: false };
    }
}

const done = (accepted: Accepted, id: IntroId) => (accepted[id] ?? -1) >= INTROS[id].version;

/**
 * The one intro to show on `pathname`, or null. The site welcome always comes
 * first (on any menu screen); a screen's own intro waits for it. Never two at
 * once. Not a menu screen (a match, the viewer, training scenes, the editor,
 * QA): nothing.
 */
export function dueIntro(pathname: string, accepted: Accepted): IntroId | null {
    for (const id of INTRO_ORDER) {
        // Welcome is first in the order: while it is due on a menu screen, nothing else is.
        if (introRoute(id, pathname) && !done(accepted, id)) return id;
    }
    return null;
}
