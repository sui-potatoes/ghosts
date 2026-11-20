// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A ranked game's units as the field and the debrief dress them: names from the
 * builder for the player's own squad (the names it sent, matched by gear), role
 * names for the opponent's, preset figures for both, a face per unit seeded by the
 * game so a reload dresses them alike. Tested in `tests/play-ranked.test.ts`.
 */

import type { Recruit } from "@ghosts/squad/types";

import type { ChainGame } from "../../../chain/bcs.ts";
import { unitsOnMap } from "../../../chain/match-rules.ts";
import { bytesOf, decodeSquad } from "../../../chain/ranked-core.ts";
import {
    hash,
    rankedSide,
    sideLooks,
    virtualRecruits,
    type ChainUnitLike,
    type Side,
} from "./kit.ts";

/** The names the builder gave the squad it sent: its bytes in hex, a label per unit. */
export type OwnNames = { squad: string; labels: string[] } | null;

export type RankedField = {
    /** Every unit's name, both sides, by unit id. */
    names: Map<string, string>;
    /** The player's units as the engine deploys them. */
    squad: Recruit[];
    /** The opponent's units' looks, by unit id. */
    looks: Map<string, ReturnType<typeof sideLooks>[number]>;
    mine: Side;
    theirs: Side;
};

/** The units of a side, sorted by id: the order every reader dresses them in. */
export const sideUnits = <U extends ChainUnitLike & { owner: string }>(
    units: readonly U[],
    owner: string,
): U[] => units.filter((u) => u.owner === owner).sort((a, b) => a.recruit.localeCompare(b.recruit));

/** The gear and names the builder sent, as `rankedSide` matches them. */
export function ownGear(own: OwnNames) {
    if (!own) return null;
    const units = decodeSquad(bytesOf(own.squad));
    return units ? { units, labels: own.labels } : null;
}

/**
 * A ranked game's two sides for `side`, from `units` (the units on the map, and
 * any seen before they fell): names, the player's figures, the opponent's looks.
 */
export function rankedField(
    game: Pick<ChainGame, "players">,
    gameId: string,
    side: number,
    units: readonly (ChainUnitLike & { owner: string })[],
    own: OwnNames,
): RankedField {
    const seed = hash(gameId);
    const mine = rankedSide(sideUnits(units, game.players[side]), ownGear(own));
    const theirs = rankedSide(sideUnits(units, game.players[1 - side]), null);
    const names = new Map<string, string>();
    for (const s of [mine, theirs]) s.ids.forEach((id, i) => names.set(id, s.names[i]));
    const looks = new Map(sideLooks(theirs, seed).map((look, i) => [theirs.ids[i], look]));
    return { names, squad: virtualRecruits(mine, seed), looks, mine, theirs };
}

/** The units on the map now, as `rankedField` takes them. */
export const mapUnits = (game: ChainGame) => unitsOnMap(game).map(({ unit }) => unit);
