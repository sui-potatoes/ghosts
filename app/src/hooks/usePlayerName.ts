// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useCallback, useSyncExternalStore } from "react";

import { getPlayerName, setPlayerName, subscribePlayerName, type PlayerName } from "../player/name";

const SIGNED_OUT: PlayerName = { name: "", source: null };

/**
 * The signed-in player's name, re-rendering when it changes. `setName` throws
 * with a human-readable message when the name breaks the rules.
 */
export function usePlayerName(): PlayerName & { setName: (name: string) => void } {
    const address = useCurrentAccount()?.address;

    // Snapshot as a string so React can compare by value; the object is
    // rebuilt below.
    const snapshot = useSyncExternalStore(
        subscribePlayerName,
        () => (address ? JSON.stringify(getPlayerName(address)) : ""),
        () => "",
    );

    const setName = useCallback(
        (name: string) => {
            if (!address) throw new Error("Sign in to set a name.");
            setPlayerName(address, name);
        },
        [address],
    );

    const value: PlayerName = snapshot ? JSON.parse(snapshot) : SIGNED_OUT;
    return { ...value, setName };
}
