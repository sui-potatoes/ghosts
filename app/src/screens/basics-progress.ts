// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Which chapters of Basics this device has completed. Kept in localStorage;
 * pure parsing is tested in `tests/basics-progress.test.ts`. The training list
 * marks Basics done only once every chapter is (`markTrainingDone`).
 */

export const BASICS_CHAPTERS_KEY = "ghosts:basics-chapters";

/** The completed chapter ids in a stored record of any shape; nothing for a record that does not read. */
export function parseChapters(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const done = (JSON.parse(raw) as { done?: unknown })?.done;
        return Array.isArray(done) ? done.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

/** The record for `done`. */
export const serializeChapters = (done: readonly string[]) => JSON.stringify({ done: [...done] });

export function completedChapters(): string[] {
    try {
        return parseChapters(localStorage.getItem(BASICS_CHAPTERS_KEY));
    } catch {
        return [];
    }
}

export function saveChapters(done: readonly string[]) {
    try {
        localStorage.setItem(BASICS_CHAPTERS_KEY, serializeChapters(done));
    } catch {
        // No storage (private mode): chapters simply show as not done.
    }
}
