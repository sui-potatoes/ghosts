// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { IntelSource } from "@ghosts/engine";
import { useCallback, useMemo, useRef } from "react";

import type { ChainGame } from "./bcs";
import { useGhostsAccount, type ChainRecruit } from "./ghosts";
import { chainUnitIntel, opponentIntel } from "./intel";
import { unitsOnMap } from "./match-rules";
import { useAssignedName } from "./names";

/**
 * The match's intel for `<Encounter intel opponent>`: a stable source over the
 * latest game and every recruit seen in it, and the opposing player, read once.
 * Nothing is requested per hover: the engine calls `intel` when the readout
 * opens or the encounter changes, and it only reads what is in memory.
 */
export function useMatchIntel(game: ChainGame, recruits: readonly ChainRecruit[], side: number) {
    const latest = useRef(game);
    latest.current = game;
    const known = useRef(new Map<string, ChainRecruit>());
    for (const recruit of recruits) known.current.set(recruit.objectId, recruit);

    const intel = useCallback<IntelSource>((unit, base) => {
        const entry = unitsOnMap(latest.current).find(({ unit: u }) => u.recruit === unit.id);
        return chainUnitIntel(base, known.current.get(unit.id), entry?.unit);
    }, []);

    const account = useGhostsAccount(game.players[1 - side]).data;
    const name = useAssignedName(account?.owner);
    const opponent = useMemo(
        () => (account ? opponentIntel(account, name) : null),
        [account, name],
    );
    return { intel, opponent };
}

/** The opposing player's assigned name, once read. */
export function useOpponentName(game: ChainGame, side: number): string | null {
    const account = useGhostsAccount(game.players[1 - side]).data;
    return useAssignedName(account?.owner) ?? null;
}
