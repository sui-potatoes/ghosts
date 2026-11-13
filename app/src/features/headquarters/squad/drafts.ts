// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Unsaved looks and voice, one draft per recruit. A draft is unsaved while
 * its encoding differs from its baseline (what the chain holds, or a save in
 * flight), so a slider nudge below one quantization step is not a change.
 * Drafts are kept on the device (`ghosts:hq-drafts`, shared with the classic
 * screen) and come back still unsaved after a reload. Pure apart from the
 * storage helpers; tested in `tests/hq-squad.test.ts`.
 */

import { encodeVisuals, sameVisuals } from "@ghosts/squad/appearance/codec";
import type { Appearance, ArmorColors } from "@ghosts/squad/types";

export interface Draft {
    appearance: Appearance;
    armorColors: ArmorColors;
    voice: number;
}

export type Drafts = Record<string, Draft>;

/** The draft as `edit_recruit` takes it. */
export const encodeDraft = (d: Draft) => encodeVisuals(d.appearance, d.armorColors);

export const sameDraft = (a: Draft, b: Draft) =>
    a.voice === b.voice && sameVisuals(encodeDraft(a), encodeDraft(b));

/** Recruits whose draft differs from its baseline, in draft order. */
export function unsavedIds(drafts: Drafts, baseline: (id: string) => Draft | null): string[] {
    return Object.entries(drafts)
        .filter(([id, d]) => {
            const base = baseline(id);
            return !!base && !sameDraft(d, base);
        })
        .map(([id]) => id);
}

/**
 * Drafts still worth keeping once the squad is read: a recruit no longer on
 * file, or one the chain already matches, drops its draft (so a look changed
 * elsewhere is not undone). Returns `drafts` itself when nothing changed.
 */
export function pruneDrafts(drafts: Drafts, current: (id: string) => Draft | null): Drafts {
    const kept = Object.entries(drafts).filter(([id, d]) => {
        const base = current(id);
        return !!base && !sameDraft(d, base);
    });
    return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
}

export function withoutDraft(drafts: Drafts, id: string): Drafts {
    if (!(id in drafts)) return drafts;
    const next = { ...drafts };
    delete next[id];
    return next;
}

/**
 * After a save lands: the saved draft is gone, unless the player edited on
 * while it was in flight — then the newer edits stay as the next draft.
 */
export function settleSaved(drafts: Drafts, id: string, sent: Draft): Drafts {
    return drafts[id] && sameDraft(drafts[id], sent) ? withoutDraft(drafts, id) : drafts;
}

const DRAFTS_KEY = "ghosts:hq-drafts";

export function storedDrafts(): Drafts {
    try {
        return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}") as Drafts;
    } catch {
        return {};
    }
}

export function storeDrafts(drafts: Drafts) {
    try {
        if (Object.keys(drafts).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
        else localStorage.removeItem(DRAFTS_KEY);
    } catch {
        // storage unavailable: drafts last as long as the screen
    }
}
