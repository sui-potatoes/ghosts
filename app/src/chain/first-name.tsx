// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The first name, bound to the chain: the lookup behind "This name is taken"
 * and the one save that registers the name and, for a player with no `Account`
 * yet, creates it in the same transaction (one signature, one `sendTransaction`).
 * The rules are in `first-name-core.ts`.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { setPlayerName } from "../player/name";
import { GAS_POLL_MS, saveFirstName, waitForGas } from "./first-name-core.ts";
import { ensureGas } from "./funds";
import { createAccountTx, fetchAccountId, ghostsEnabled } from "./ghosts";
import {
    ASSIGNED_NAME_KEY,
    leafTarget,
    NameRefusal,
    nameChangeTransaction,
    refusal,
} from "./names";
import { sendTransaction } from "./sender";

/** Whether `name` already resolves to another address; false for a free name or one of the player's own. */
export function useNameTaken(): (name: string) => Promise<boolean> {
    const client = useCurrentClient();
    const address = useCurrentAccount()?.address;
    return useCallback(
        async (name) => {
            const target = await leafTarget(client, name);
            return !!target && target !== address;
        },
        [client, address],
    );
}

/**
 * Save the name: waits for gas first (the top-up sign-in asked for), then one
 * transaction. Rejects with a line fit for the prompt.
 */
export function useSaveFirstName(): (name: string) => Promise<void> {
    const client = useCurrentClient();
    const address = useCurrentAccount()?.address;
    const queryClient = useQueryClient();
    return useCallback(
        async (name) => {
            if (!address) throw new Error("Could not save the name");
            const accountKey = ["ghosts", "account-id", address];
            try {
                await saveFirstName(
                    {
                        gas: () =>
                            waitForGas({
                                balance: async () => {
                                    try {
                                        const { balance } = await client.core.getBalance({
                                            owner: address,
                                        });
                                        return BigInt(balance.balance);
                                    } catch {
                                        return null;
                                    }
                                },
                                ensure: () => ensureGas(address),
                                now: Date.now,
                                sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                                pollMs: GAS_POLL_MS,
                            }),
                        hasAccount: async () =>
                            !ghostsEnabled ||
                            !!(
                                queryClient.getQueryData(accountKey) ??
                                (await fetchAccountId(client, address))
                            ),
                        build: async (n, withAccount) => {
                            const tx = await nameChangeTransaction(client, address, n);
                            return withAccount ? createAccountTx(tx) : tx;
                        },
                        send: async (tx) => {
                            const sent = sendTransaction(tx);
                            if (!sent) throw new Error("Could not save the name");
                            return sent;
                        },
                        saved: async (n, withAccount) => {
                            setPlayerName(address, n);
                            queryClient.setQueryData([ASSIGNED_NAME_KEY, address], n);
                            if (!withAccount) return;
                            const id = await fetchAccountId(client, address, true);
                            if (id) queryClient.setQueryData(accountKey, id);
                            else await queryClient.invalidateQueries({ queryKey: accountKey });
                        },
                    },
                    name,
                );
            } catch (e) {
                if (e instanceof NameRefusal) throw e;
                console.warn("Saving the first name failed:", e);
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(refusal(message) ?? "Could not save the name", { cause: e });
            }
        },
        [client, address, queryClient],
    );
}
