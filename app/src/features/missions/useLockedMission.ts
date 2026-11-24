// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useLayoutEffect, useState } from "react";

import { useFocusState } from "../../ui";
import { openingMission, type Mission } from "./model";
import { missionOfNode, queueId } from "./OpsQueue";

/**
 * Which mission the console is locked on, and which one the board shows.
 *
 * - `locked`: the queue line last reached by an explicit act (keys, pad, a
 *   click or tap, the opening focus), the store's subject. The commit acts on it.
 * - `shown`: the line the pointer rests on while it rests there, else the
 *   locked one, so sweeping the queue retargets the board without moving
 *   what the commit runs.
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
    const previewed = missionOfNode(store.preview);
    const find = (id: string | null) => missions.find((m) => m.id === id) ?? null;
    return {
        locked: find(subject ?? locked),
        shown: find(previewed) ?? find(subject ?? locked),
    };
}
