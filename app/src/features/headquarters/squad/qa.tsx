// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for recruitment, in builds made with `VITE_RECRUIT_QA=1` only
 * (the route is not registered otherwise, see `App.tsx`): the real
 * `HeadquartersView` over fixture recruits, no chain, no sign-in. A hire
 * lands the missing recruits after a short wait, as the listing lags the
 * transaction. `?case=empty|partial|gap|full`, `&delay=MS` before the hire
 * lands, `&fail=1` for a hire that is refused, `&storage=1` for three rifles, two armors and a grenade in
 * storage (equips are logged on `window.__issued`); `?view=armory` is the Armory bench.
 */

import { fromPreset, normalize, presets } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { encodeVisuals } from "@ghosts/squad/appearance/codec";
import { DEFAULT_ARMOR_COLORS } from "@ghosts/squad/armor-colors";
import { useMemo, useRef, useState } from "react";

import { scheduleLamp } from "../../../audio/lamp";

import type { ChainRecruit } from "../../../chain";
import type { ArmoryData, ArmoryOps } from "../armory/types";
import { ArmoryView } from "../armory/ArmoryView";
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

/** Offline render of the switch-on cue at unit level: its peak and audible length. */
(window as unknown as { __lamp: unknown }).__lamp = async (index: number, last: boolean) => {
    const rate = 44100;
    const offline = new OfflineAudioContext(1, rate, rate);
    scheduleLamp(offline, offline.destination, 0, { index, last });
    const data = (await offline.startRendering()).getChannelData(0);
    let peak = 0;
    let end = 0;
    for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        peak = Math.max(peak, v);
        if (v > 0.002) end = i;
    }
    return { peak, seconds: end / rate };
};

/** `?view=armory`: the Armory bench over fixtures; every write is logged on `window.__issued`. */
function ArmoryQa() {
    const log = (...entry: unknown[]) => {
        ((window as unknown as { __issued?: unknown[] }).__issued ??= []).push(entry);
        return Promise.resolve(true);
    };
    const gear = (id: string, name: string, extra: object = {}) => ({
        objectId: id,
        id,
        name,
        stats: { value: "0" },
        upgrades: [],
        actions: [],
        ...extra,
    });
    const data = {
        gate: null,
        accountId: "0xqa",
        recruits: [0, 1].map((i) => {
            const r = recruit(i);
            return { ...r, weapon: { ...r.weapon!, stats: { value: "0" } } };
        }),
        storage: {
            weapons: [gear("0xqs0", "Standard Rifle"), gear("0xqs1", "Standard Rifle")],
            armors: [gear("0xqa0armor", "Medium Armor")],
            utilities: [gear("0xqu0", "Frag Grenade")],
            upgrades: ["Basic Scope", "Advanced Scope", "Basic Stock", "Basic Laser Sight"].map(
                (name, i) => gear(`0xqm${i}`, name),
            ),
        },
        busy: false,
        error: "",
        clearError: () => {},
        saving: false,
        match: { searchingSince: null, playing: false, cancel: () => {} },
    } as unknown as ArmoryData;
    const ops = {
        requisition: async (order: unknown) => log("requisition", order),
        applyFittings: async (w: { id: string }, carrier: unknown, desired: unknown) =>
            log("fit", w.id, carrier, desired),
        applyAll: async () => true,
        issue: async (...args: unknown[]) => log("issue", ...args),
        unequip: async (...args: unknown[]) => log("unequip", ...args),
        issueUtility: async (...args: unknown[]) => log("utility", ...args),
        unequipUtility: async (...args: unknown[]) => log("unequipUtility", ...args),
        signIn: () => {},
    } as unknown as ArmoryOps;
    return <ArmoryView data={data} ops={ops} />;
}

export default function RecruitQa() {
    if (new URLSearchParams(window.location.search).get("view") === "armory") return <ArmoryQa />;
    return <RecruitHq />;
}

function RecruitHq() {
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
        issue: async (...args) => {
            ((window as unknown as { __issued?: unknown[] }).__issued ??= []).push(args);
            return true;
        },
        unequip: async () => true,
        equipUtility: async (...args) => {
            ((window as unknown as { __issued?: unknown[] }).__issued ??= []).push([
                "utility",
                ...args,
            ]);
            return true;
        },
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
        storage: {
            weapons: params.get("storage")
                ? ["Standard Rifle", "Standard Rifle", "Standard Rifle"].map((name, i) => ({
                      objectId: `0xqs${i}`,
                      id: `0xqs${i}`,
                      name,
                      stats: {},
                      upgrades: [],
                  }))
                : [],
            armors: params.get("storage")
                ? ["Medium Armor", "Heavy Armor"].map((name, i) => ({
                      objectId: `0xqa${i}armor`,
                      id: `0xqa${i}armor`,
                      name,
                      stats: { value: "0" },
                  }))
                : [],
            utilities: params.get("storage")
                ? [
                      {
                          objectId: "0xqu0",
                          id: "0xqu0",
                          name: "Frag Grenade",
                          stats: { value: "0" },
                          actions: [],
                      },
                  ]
                : [],
        } as unknown as HqData["storage"],
        busy,
        error,
        clearError: () => setError(""),
        saving: busy,
        match: { searchingSince: null, playing: false, cancel: () => {} },
    };
    return <HeadquartersView data={data} ops={ops} />;
}
