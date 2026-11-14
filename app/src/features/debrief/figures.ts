// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Recruit } from "@ghosts/squad/types";

import type { ChainRecruit } from "../../chain";
import { toLocalRecruits } from "../headquarters/mapping";

/**
 * The figures for chain recruits, as they stood on the field: the mapping
 * hands a recruit without a weapon object the default rifle to look at, and
 * here (as in squad selection) an unarmed recruit stands unarmed.
 */
export function figuresOf(recruits: ChainRecruit[]): Recruit[] {
    return toLocalRecruits(recruits).map((local, i) =>
        recruits[i].weapon
            ? local
            : { ...local, equipment: { ...local.equipment, primary: null }, attachments: {} },
    );
}
