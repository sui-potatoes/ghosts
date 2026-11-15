// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { demoLevels, importLevel, newLevel, type Level } from "@ghosts/engine/editor";

/**
 * The level editor's drafts on this device: one per base ("scratch" and each
 * shipped demo), saved as the editor's export file under its own key, and the
 * slot last open. The editor writes them; a playtest (`/demo?level=<slot>`)
 * reads the same draft, so what plays is what was on the board.
 */

export const SLOT_KEY = "ghosts:editor-slot";

/** Every slot: a blank board, then the shipped demos as editable bases. */
export const SLOTS = [
    { id: "scratch", name: "Scratch" },
    ...demoLevels.map((d) => ({ id: d.id, name: d.name })),
];

export const isSlot = (slot: string | null): slot is string => SLOTS.some((s) => s.id === slot);

export const draftKey = (slot: string) =>
    slot === "scratch" ? "ghosts:editor-level" : `ghosts:editor-level:${slot}`;

/** A saved draft, or null when there is none (or it does not read). `migrated`: an old single deployment list. */
export function loadDraft(slot: string): { level: Level; migrated: boolean } | null {
    try {
        const raw = localStorage.getItem(draftKey(slot));
        if (!raw) return null;
        const { level, migrated } = importLevel(JSON.parse(raw));
        return { level, migrated };
    } catch {
        return null;
    }
}

/** A slot's base: the shipped demo rebuilt, or a blank board. */
export function buildBase(slot: string): { level: Level; dropped: number } {
    const demo = demoLevels.find((d) => d.id === slot);
    return demo ? demo.build() : { level: newLevel(), dropped: 0 };
}

/** What a slot holds on this device: its draft, else its base. */
export const slotLevel = (slot: string): Level => loadDraft(slot)?.level ?? buildBase(slot).level;

/** The slot the editor last had open. */
export function savedSlot(): string {
    try {
        const slot = localStorage.getItem(SLOT_KEY);
        return isSlot(slot) ? slot : "scratch";
    } catch {
        return "scratch";
    }
}

/** The playtest route for a slot's draft, and the editor route back to it. */
export const playtestPath = (slot: string) => `/demo?level=${encodeURIComponent(slot)}`;
export const editorPath = (slot: string) => `/editor?slot=${encodeURIComponent(slot)}`;
