// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What the command bar draws for a set of commands under the input in use.
 * Pure, so `tests/gui-touch.test.ts` can pin it. A hint that only names keys
 * (the arrows' "Move": a finger moves the cursor by tapping) has no tap
 * target, so it is dropped when the glyph set is `none`; every other command
 * stays, as a labelled button.
 */

import type { Command, CommandAction } from "./focus";
import type { GlyphSet } from "./glyph-model";

/** Fixed slot order, left to right; Back always closes the row. */
const ORDER: CommandAction[] = ["reset", "confirm"];

export type BarModel = {
    /** Key-only direction hints: never on touch. */
    nav: Command[];
    /** Reset, then Confirm. */
    slots: Command[];
    back: Command;
};

export function barModel(commands: Command[], back: Command, set: GlyphSet): BarModel {
    const slots = ORDER.map((action) => commands.find((c) => c.action === action)).filter(
        (c): c is Command => !!c,
    );
    const nav = set === "none" ? [] : commands.filter((c) => c.action === "nav");
    return { nav, slots, back };
}
