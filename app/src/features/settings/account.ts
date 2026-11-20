// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";

import {
    retireSessionKey,
    useBalance,
    useSessions,
    useSubmitNameChange,
    type Sessions,
} from "../../chain";
import { NETWORK } from "../../constants";
import { usePlayerName } from "../../hooks/usePlayerName";
import { useSignInMethod } from "../../hooks/useSignInMethod";
import { requestSignIn } from "../../signIn";
import { forgetPasskey } from "../../wallets/passkey";

/**
 * What the Player and Account categories show and do, as one value, so a
 * fixture harness can stand in for a signed-in account. Every write is the
 * classic panels' own: `useSubmitNameChange` for the name, the device
 * sessions' removal and authorization from `chain/sessions.tsx`, and sign out
 * retiring this browser's session key before the wallet disconnects.
 */
export type AccountBits = {
    /** Null while signed out. */
    address: string | null;
    name: string;
    /** The name is the generated fallback, never chosen. */
    generated: boolean;
    submitName: (name: string) => Promise<void>;
    namePending: boolean;
    /** How the account is held: `Passkey`, `Google · zkLogin`. */
    method: string | null;
    balance: { state: "pending" } | { state: "error" } | { state: "ok"; mist: bigint };
    network: string;
    signIn: () => void;
    signOut: () => Promise<void>;
    /** Sign out, then forget the passkey this device remembers. Absent in fixtures. */
    forgetDevice?: () => Promise<void>;
    sessions: Sessions;
};

export function useAccountBits(): AccountBits {
    const dAppKit = useDAppKit();
    const account = useCurrentAccount();
    const client = useCurrentClient();
    const player = usePlayerName();
    const { submit, pending } = useSubmitNameChange();
    const method = useSignInMethod();
    const balance = useBalance();
    const sessions = useSessions();
    const address = account?.address ?? null;
    const signOut = async () => {
        // Leave nothing signable behind: the session key removes its own
        // alias and is wiped (best effort — it never blocks sign-out).
        if (address) await retireSessionKey(client, address);
        await dAppKit.disconnectWallet();
    };
    return {
        address,
        name: player.name,
        generated: player.source === null,
        submitName: submit,
        namePending: pending,
        method: method?.label ?? null,
        balance: balance.isPending
            ? { state: "pending" }
            : balance.isError || balance.data === undefined
              ? { state: "error" }
              : { state: "ok", mist: balance.data },
        network: NETWORK,
        signIn: requestSignIn,
        signOut,
        forgetDevice: async () => {
            await signOut();
            forgetPasskey();
        },
        sessions,
    };
}
