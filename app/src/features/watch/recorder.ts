// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { EncounterRules } from "@ghosts/engine";
import type { Recruit } from "@ghosts/squad/types";
import { useCallback, useEffect, useRef } from "react";

import { deviceStorage, newJournalId, saveJournal, type LocalJournal } from "./journal";

/** How long the recorder waits after an event before writing: a burst of events is one write. */
const SAVE_DELAY_MS = 600;

/**
 * Record the demo as it is played, for the viewer (`/watch/local`): hand the
 * returned callback to `<Encounter onJournal>`. Each encounter (a restart
 * starts a new one) is its own recording, written once it has an event and
 * after every burst of events, and again as the screen goes. A null
 * `scenario` records nothing (an editor playtest).
 */
export function useJournalRecorder(scenario: string | null, squad: readonly Recruit[] | null) {
    const current = useRef<{
        game: EncounterRules | null;
        journal: LocalJournal | null;
        timer: number;
    }>({
        game: null,
        journal: null,
        timer: 0,
    });

    const flush = useCallback(() => {
        const { game, journal } = current.current;
        window.clearTimeout(current.current.timer);
        if (!game || !journal || !game.events.length) return;
        journal.events = [...game.events];
        journal.updatedAt = Date.now();
        journal.result = game.result;
        saveJournal(deviceStorage(), journal);
    }, []);

    useEffect(() => {
        window.addEventListener("pagehide", flush);
        return () => {
            window.removeEventListener("pagehide", flush);
            flush();
        };
    }, [flush]);

    return useCallback(
        (game: EncounterRules) => {
            if (!scenario) return;
            const now = current.current;
            if (game !== now.game) {
                // A restart: the last encounter's recording is written out, the next one starts.
                flush();
                now.game = game;
                now.journal = null;
            }
            if (!game.events.length) return;
            now.journal ??= {
                v: 1,
                id: newJournalId(),
                scenario,
                squad: squad ? [...squad] : null,
                events: [],
                startedAt: Date.now(),
                updatedAt: Date.now(),
                result: null,
            };
            window.clearTimeout(now.timer);
            now.timer = window.setTimeout(flush, SAVE_DELAY_MS);
        },
        [scenario, squad, flush],
    );
}
