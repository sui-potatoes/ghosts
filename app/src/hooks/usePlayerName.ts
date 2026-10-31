// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useSyncExternalStore } from "react";

import { useAssignedName } from "../chain/names";
import { getPlayerName, subscribePlayerName, type PlayerName } from "../player/name";

const SIGNED_OUT: PlayerName = { name: "", source: null };

/**
 * The signed-in player's name, re-rendering when it changes. Renames go
 * through `useSubmitNameChange` (`src/chain/names.tsx`).
 *
 * The name the address assigned to itself on chain is the source of truth on
 * any device. The device's own copy wins while it exists — it is written when
 * the chain accepts a change, or by an offline rename — then the assigned
 * name serves, then the generated fallback.
 */
export function usePlayerName(): PlayerName {
    const address = useCurrentAccount()?.address;
    const assigned = useAssignedName(address);

    // Snapshot as a string so React can compare by value; the object is
    // rebuilt below.
    const snapshot = useSyncExternalStore(
        subscribePlayerName,
        () => (address ? JSON.stringify(getPlayerName(address)) : ""),
        () => "",
    );

    const stored: PlayerName = snapshot ? JSON.parse(snapshot) : SIGNED_OUT;
    return stored.source === "local" || !assigned ? stored : { name: assigned, source: "suins" };
}
