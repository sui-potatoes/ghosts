// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

import { useAssignedName, useNameTaken, useSaveFirstName } from "../../chain";
import { NETWORK } from "../../constants";
import { getPlayerName, subscribePlayerName } from "../../player/name";
import { NameStepView } from "./NameStepView";
import { askNow, skip, wasSkipped } from "./rules";

const store = (() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})();

/**
 * Mount once in the shell. A signed-in address with no name (nothing assigned
 * on chain, nothing kept on this device) and no "Later" on this device is asked
 * for one, over whatever menu screen it is on: the screen underneath is not
 * touched, so whatever the player was doing is where they left it. Never in a
 * match, the viewer or the editor: it waits for a menu screen.
 */
export function NameStep() {
    const address = useCurrentAccount()?.address ?? null;
    const assigned = useAssignedName(address ?? undefined);
    const { pathname } = useLocation();
    const localName = useSyncExternalStore(
        subscribePlayerName,
        () => !!address && getPlayerName(address).source === "local",
        () => false,
    );
    const [skipped, setSkipped] = useState<string | null>(null);
    const ask =
        !!address &&
        skipped !== address &&
        askNow(
            { address, assigned, localName, skipped: wasSkipped(store, NETWORK, address) },
            pathname,
        );
    if (!ask || !address) return null;
    return (
        <Live
            key={address}
            later={() => {
                skip(store, NETWORK, address);
                setSkipped(address);
            }}
        />
    );
}

function Live({ later }: { later: () => void }) {
    const taken = useNameTaken();
    const save = useSaveFirstName();
    const deps = useMemo(
        // Saving writes the name, which closes the step by itself (a name now exists).
        () => ({ taken, save, done: () => {}, later }),
        [taken, save, later],
    );
    return <NameStepView deps={deps} />;
}
