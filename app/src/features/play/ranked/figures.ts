// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The builder's units as figurines for the podium diorama: each place's
 * loadout dressed the way the match dresses it (`virtualRecruits`), with a
 * face fixed per place so changing gear changes the kit, never the person.
 */

import type { Recruit } from "@ghosts/squad/types";

import { fieldKit, fieldRole, virtualRecruits, type Side } from "../match/model.ts";
import type { Loadout } from "../economy/index.ts";
import type { Stand } from "./model.ts";

/** A stand-in loadout for an empty place: it only fixes the face order. */
const PLACEHOLDER: Loadout = {
    preset: "recruit",
    weapon: "rifle-1",
    armor: "armor-1",
    utility: null,
};

export const unitNumber = (index: number): string => String(index + 1).padStart(2, "0");

export function standFigures(stands: Stand[], seed: number): (Recruit | null)[] {
    const loadouts = stands.map((s) => s ?? PLACEHOLDER);
    const kits = loadouts.map(fieldKit);
    const side: Side = {
        ids: loadouts.map((_, i) => `unit-${i + 1}`),
        loadouts,
        kits,
        roles: kits.map(fieldRole),
        callsigns: loadouts.map((_, i) => `UNIT ${unitNumber(i)}`),
        names: loadouts.map((_, i) => `Unit ${i + 1}`),
        types: loadouts.map((_, i) => `Unit ${i + 1}`),
    };
    const recruits = virtualRecruits(side, seed);
    return recruits.map((r, i) => (stands[i] ? r : null));
}
