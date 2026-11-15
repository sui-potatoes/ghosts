// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for recruitment, in builds made with `VITE_RECRUIT_QA=1` only
 * (the route is not registered otherwise, see `App.tsx`): the real
 * `HeadquartersView` over fixture recruits, no chain, no sign-in. A hire
 * lands the missing recruits after a short wait, as the listing lags the
 * transaction. `?case=empty|partial|gap|full`, `&delay=MS` before the hire
 * lands, `&fail=1` for a hire that is refused.
 */

import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { encodeVisuals } from "@ghosts/squad/appearance/codec";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import { useMemo, useRef, useState } from "react";

import type { ChainRecruit } from "../../../chain";
import { HeadquartersView, type HqData, type HqOps } from "./HeadquartersView";

const NAMES = ["Mara Voss", "Idris Kane", "Tove Hale", "Ren Okoye"];
const RANKS = ["Rookie", "Rookie", "Corporal", "Rookie"] as const;

const recruit = (i: number): ChainRecruit => {
    const preset = presets[(i * 3) % presets.length];
    const look = normalize({ ...fromPreset(preset), name: NAMES[i] }, schema);
    const stats = {} as ChainRecruit["stats"];
    return {
        objectId: `0xqa${i}`,
        id: `0xqa${i}`,
        metadata: {
            name: NAMES[i],
            visuals: encodeVisuals(look, DEFAULT_ARMOR_COLORS),
            voice: i,
        },
        rank: { $kind: RANKS[i], [RANKS[i]]: true },
        xp: 0,
        stats,
        weapon: { id: `0xqw${i}`, name: "Standard Rifle", stats, upgrades: [] },
        armor: null,
        utilities: [],
        leader: "0x0",
    } as unknown as ChainRecruit;
};

export default function RecruitQa() {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("case") ?? "empty";
    const delay = Number(params.get("delay") ?? 900);
    const fail = params.get("fail") === "1";
    const start = useMemo<(ChainRecruit | null)[]>(
        () =>
            kind === "full"
                ? [0, 1, 2, 3].map(recruit)
                : kind === "partial"
                  ? [recruit(0), recruit(1), null, null]
                  : kind === "gap"
                    ? [recruit(0), null, recruit(2), null]
                    : [null, null, null, null],
        [kind],
    );
    const [slots, setSlots] = useState(start);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const hires = useRef(0);

    const ops: HqOps = {
        async hireSquad() {
            hires.current++;
            setBusy(true);
            await new Promise((r) => setTimeout(r, delay));
            setBusy(false);
            if (fail) {
                setError("The squad could not be hired. Try again.");
                return false;
            }
            setSlots((s) => s.map((x, i) => x ?? recruit(i)));
            return true;
        },
        issue: async () => true,
        unequip: async () => true,
        equipUtility: async () => true,
        unequipUtility: async () => true,
        dismiss: async () => true,
        saveLooks: async () => true,
        signIn: () => {},
    };
    const data: HqData = {
        gate: null,
        accountId: "0xqa",
        rating: 1500,
        slots,
        onFile: slots.filter(Boolean).length,
        storage: { weapons: [], armors: [], utilities: [] },
        busy,
        error,
        clearError: () => setError(""),
        saving: busy,
        match: { searchingSince: null, playing: false, cancel: () => {} },
    };
    return <HeadquartersView data={data} ops={ops} />;
}
