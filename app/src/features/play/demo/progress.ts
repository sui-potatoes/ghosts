// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Which trainings this device has completed, by scenario id: the training list
 * marks them done. Kept in localStorage; pure parsing is tested in
 * `tests/training-progress.test.ts`.
 */

export const TRAINING_STORAGE_KEY = "ghosts:training";

/** The completed ids in a stored record of any shape; nothing for a record that does not read. */
export function parseProgress(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const done = (JSON.parse(raw) as { done?: unknown })?.done;
        return Array.isArray(done) ? done.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

/** The record with `id` completed, each id once. */
export function withCompleted(raw: string | null, id: string): string {
    const done = parseProgress(raw);
    return JSON.stringify({ done: done.includes(id) ? done : [...done, id] });
}

/** The trainings completed on this device. */
export function completedTrainings(): string[] {
    try {
        return parseProgress(localStorage.getItem(TRAINING_STORAGE_KEY));
    } catch {
        return [];
    }
}

/** Remember that `id` was completed on this device. */
export function markTrainingDone(id: string) {
    try {
        localStorage.setItem(
            TRAINING_STORAGE_KEY,
            withCompleted(localStorage.getItem(TRAINING_STORAGE_KEY), id),
        );
    } catch {
        // No storage (private mode): the list simply shows it as not done.
    }
}
