// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Encounter } from "../game.ts";
/** Dev-only visual fixture; imported behind import.meta.env.DEV. */
export function prepareDebriefReview(game: Encounter, variant: string) {
    game.turn = 6;
    game.kills = { v: 1, g: 2 };
    if (variant === "debrief-defeat") {
        for (const u of game.units.filter((u) => !u.enemy)) u.hp = 0;
    } else {
        game.secured = true;
        for (const u of game.enemies) u.hp = 0;
        if (variant !== "debrief-clean") game.units.find((u) => u.id === "e")!.hp = 0;
    }
}
