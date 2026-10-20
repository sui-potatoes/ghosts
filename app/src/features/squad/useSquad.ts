// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { initialSquad, restoreSquad, SQUAD_STORAGE_KEY } from "@ghosts/squad/model";
import type { SquadState } from "@ghosts/squad/types";
export function useSquad() {
    const [notice, setNotice] = useState("");
    const [state, setState] = useState<SquadState>(() => {
        try {
            const raw = localStorage.getItem(SQUAD_STORAGE_KEY);
            return raw ? restoreSquad(JSON.parse(raw)) : initialSquad();
        } catch {
            return initialSquad();
        }
    });
    function commit(next: SquadState) {
        setState(next);
        try {
            localStorage.setItem(SQUAD_STORAGE_KEY, JSON.stringify(next));
            setNotice("Saved on this device");
        } catch {
            setNotice("Browser storage unavailable — changes last for this session only.");
        }
    }
    return { state, commit, notice };
}
