// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useState } from "react";

import { useFocusState } from "../../ui";
import { openingMission, type Mission } from "./model";
import { missionOfNode, queueId } from "./OpsQueue";

/**
 * Which mission the console is on: the queue line under the cursor, whether
 * keys, a pad, a click or the pointer coming to rest put it there. The board,
 * the briefing and the commit all follow it, so they can never name different
 * missions (`locked` and `shown` are the same; both names are kept for callers).
 *
 * The cursor opens on `asked` when it is on the board, else the next mission.
 */
export function useLockedMission(missions: Mission[], asked?: string | null) {
    const store = useFocusState();
    const [locked, setLocked] = useState(() => openingMission(missions, asked));
    useLayoutEffect(() => {
        const opening = openingMission(missions, asked);
        if (opening) store.focus(queueId({ id: opening }), false);
        // Once, on arrival.
    }, [store]);
    const subject = missionOfNode(store.subject);
    if (subject && subject !== locked && missions.some((m) => m.id === subject)) setLocked(subject);
    // The queue's cursor is the selection: a line the pointer comes to rest on is
    // taken as if reached by keys, so the board, the briefing and the commit
    // never name different missions.
    const previewed = missionOfNode(store.preview);
    useEffect(() => {
        if (previewed && previewed !== missionOfNode(store.subject))
            store.focus(queueId({ id: previewed }), false);
    }, [store, previewed]);
    const find = (id: string | null) => missions.find((m) => m.id === id) ?? null;
    const shown = find(previewed) ?? find(subject ?? locked);
    return { locked: shown, shown };
}
