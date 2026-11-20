// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Games played in `/demo`, recorded on the device to be watched again: the
 * scenario, the squad that went out (its looks and gear rebuild the same
 * start) and the encounter's own journal of events as it is played. The last
 * few are kept; the oldest goes first. Plain TypeScript, tested in
 * `tests/watch-viewer.test.ts`.
 */

import type { GameEvent } from "@ghosts/engine";
import type { Recruit } from "@ghosts/squad/types";

export const JOURNALS_KEY = "ghosts:watch:journals";

/** How many recorded games the device keeps. */
export const KEEP = 6;

export interface LocalJournal {
    v: 1;
    id: string;
    /** The scenario played (`scenarioById`). */
    scenario: string;
    /** The roster the encounter deployed, in squad order; null for the showcase squad. */
    squad: Recruit[] | null;
    events: GameEvent[];
    /** Epoch ms. */
    startedAt: number;
    updatedAt: number;
    /** How the field stood when the recording stopped: null while no side had won. */
    result: "victory" | "defeat" | null;
}

/** The storage the journals live in: `localStorage` in the app, a map in tests. */
export interface JournalStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function isJournal(value: unknown): value is LocalJournal {
    const j = value as LocalJournal | null;
    return (
        !!j &&
        j.v === 1 &&
        typeof j.id === "string" &&
        typeof j.scenario === "string" &&
        Array.isArray(j.events) &&
        typeof j.startedAt === "number" &&
        typeof j.updatedAt === "number" &&
        (j.squad === null || Array.isArray(j.squad))
    );
}

/** The kept journals, newest first; anything unreadable is dropped. */
export function readJournals(storage: JournalStorage | null): LocalJournal[] {
    try {
        const raw = storage?.getItem(JOURNALS_KEY);
        const list: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(list)
            ? list.filter(isJournal).sort((a, b) => b.updatedAt - a.updatedAt)
            : [];
    } catch {
        return [];
    }
}

export function journalById(storage: JournalStorage | null, id: string): LocalJournal | null {
    return readJournals(storage).find((j) => j.id === id) ?? null;
}

/**
 * Keep `journal` (replacing the one with its id), newest first, at most
 * `KEEP`. A full store drops the oldest until it fits. Returns whether it was kept.
 */
export function saveJournal(storage: JournalStorage | null, journal: LocalJournal): boolean {
    if (!storage) return false;
    let list = [journal, ...readJournals(storage).filter((j) => j.id !== journal.id)].slice(
        0,
        KEEP,
    );
    while (list.length) {
        try {
            storage.setItem(JOURNALS_KEY, JSON.stringify(list));
            return true;
        } catch {
            list = list.slice(0, -1);
        }
    }
    return false;
}

/** A fresh recording id: time and a random tail, safe in a path. */
export function newJournalId(now = Date.now()): string {
    return `${now.toString(36)}${Math.floor(Math.random() * 36 ** 4)
        .toString(36)
        .padStart(4, "0")}`;
}

/** The turns a journal holds: each side's go is one (as the viewer counts them). */
export function journalTurns(events: readonly GameEvent[]): number {
    return 1 + events.filter((e) => e.type === "turn" || e.type === "hostile-phase").length;
}

/** Units that fell in a journal. */
export function journalKills(events: readonly GameEvent[]): number {
    let kills = 0;
    for (const e of events) {
        if (e.type === "shot" && e.killed) kills++;
        if (e.type === "grenade") kills += e.casualties.filter((c) => c.killed).length;
    }
    return kills;
}

/** The browser's storage, or null where it is blocked. */
export function deviceStorage(): JournalStorage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}
