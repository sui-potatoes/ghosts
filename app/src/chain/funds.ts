// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Test SUI for the signed-in player, with no control to press: it is asked for
 * after sign-in (`<FundsOnSignIn />`), before every game, before a write and after
 * every transaction: under 1 SUI tops up to 2 SUI. The rules are in `funds-core.ts`; this binds them to the
 * chain client, the faucet and the browser.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { NETWORK } from "../constants";
import { requestTestnetSui } from "./faucet.ts";
import { createFunds } from "./funds-core.ts";

type Client = ReturnType<typeof useCurrentClient>;

/** What the singleton last bound to: the chain client and cache of the mounted shell. */
let bound: { client: Client; queryClient: QueryClient } | null = null;

const storage = (() => {
    try {
        const local = window.localStorage;
        return {
            get: (key: string) => local.getItem(key),
            set: (key: string, value: string) => local.setItem(key, value),
        };
    } catch {
        return null;
    }
})();

const readBalance = async (address: string): Promise<bigint> => {
    if (!bound) throw new Error("no client");
    const { balance } = await bound.client.core.getBalance({ owner: address });
    return BigInt(balance.balance);
};

const funds = createFunds({
    request: (address) => requestTestnetSui({ address, balance: () => readBalance(address) }),
    balance: readBalance,
    now: Date.now,
    storage,
    refreshed: (address) =>
        void bound?.queryClient.invalidateQueries({ queryKey: ["balance", address] }),
});

const testnet = NETWORK === "testnet";

/** Before a write: tops the balance up in the background; waits only when it cannot pay, and rejects with one line when it still cannot. */
export async function ensureGas(address: string) {
    if (testnet) await funds.ensureGas(address);
}

/** Before a game: the same check, so the queue is never in the way of a balance that can pay. */
export async function beforeGame(address: string) {
    if (testnet) await funds.beforeGame(address);
}

/** After a transaction was sent: tops the balance back up in the background. */
export function afterTransaction(address: string) {
    if (testnet) void funds.afterTransaction(address);
}

/** True while an action waits for SUI: the screens call it "Preparing". */
export function useFundsWaiting(): boolean {
    return useSyncExternalStore(funds.subscribe, funds.waiting);
}

/**
 * Mount once in the shell. Whatever way the player signed in (passkey, Google,
 * a connected wallet, a device session), the app learns one active address; the
 * first time it appears this session, a balance under `ENOUGH` asks the faucet.
 */
export function FundsOnSignIn() {
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    const address = useCurrentAccount()?.address;
    useEffect(() => {
        if (!address || !testnet) return;
        bound = { client, queryClient };
        void funds.signedIn(address);
    }, [address, client, queryClient]);
    return null;
}
