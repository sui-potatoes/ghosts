// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Gear as the Squad screen words it: slot names, effects, uses, mods. */

import { unpack, type Stats } from "@ghosts/squad/stats";

import type { ChainRecruit, ChainUtility } from "../../../chain";
import { actionLines } from "../../squad/utilities";
import { modifierParts } from "../fittings";
import type { GearSlot } from "./rules";

export { weaponName } from "./rules";

export const SLOT_NAMES: Record<GearSlot, string> = {
    primary: "Rifle",
    armor: "Armor",
    utility: "Utility",
};

export const packed = (s: { value: string | bigint }): Stats => unpack(BigInt(s.value));
export const effectOf = (s: { value: string | bigint }) =>
    modifierParts(packed(s))
        .map((p) => `${p.text} ${p.label.toLowerCase()}`)
        .join(" · ");
export const usesOf = (u: ChainUtility | ChainRecruit["utilities"][number]) =>
    actionLines(u.actions)
        .map((a) => `${a.name} · ${a.uses}`)
        .join(", ");
export const modsOf = (w: { upgrades: { name: string }[] }) =>
    w.upgrades.length ? w.upgrades.map((u) => u.name).join(" · ") : "No mods fitted";
export const utilityStats = (r: ChainRecruit) => {
    const u = r.utilities[0];
    return u ? { name: u.name, stats: packed(u.stats) } : undefined;
};
