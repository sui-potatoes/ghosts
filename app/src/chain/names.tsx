// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The on-chain side of the player name. The `commander-names` instance locks
 * `demo.ghosts.sui`; any address holds leaf records `<name>.demo.ghosts.sui`
 * resolving to itself, and its default SuiNS name among them is the name the
 * address assigned to itself — the one every device shows (`usePlayerName`).
 *
 * `useSubmitNameChange` turns a committed rename into one transaction shaped
 * by the current registry state: take back an own earlier leaf, move the
 * current one, or create the first one. The local copy is written only once
 * the chain accepted the change; signed out, a rename stays on this device.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { NAMES } from "../constants";
import { setPlayerName } from "../player/name";
import { canSendTransactions, sendTransaction } from "./sender";

const QUERY_KEY = "assigned-name";

type Client = ReturnType<typeof useCurrentClient>;

/** A refusal with a message written for the dialog, not for the console. */
class NameRefusal extends Error {}

/** `<name>` from `<name>.<domain>`; `null` for any other name. */
function nameUnderDomain(suinsName: string): string | null {
    const suffix = `.${NAMES.domain}`;
    if (!suinsName.endsWith(suffix)) return null;
    const name = suinsName.slice(0, -suffix.length);
    return name && !name.includes(".") ? name : null;
}

/** The address the leaf `<name>.<domain>` resolves to, `null` when free. */
async function leafTarget(client: Client, name: string): Promise<string | null> {
    const { address } = await client.core.resolveNameServiceAddress({
        name: `${name}.${NAMES.domain}`,
    });
    return address ?? null;
}

/** The name `address` assigned to itself: its default name under the domain. */
async function assignedName(client: Client, address: string): Promise<string | null> {
    const { data } = await client.core.defaultNameServiceName({ address });
    return data.name ? nameUnderDomain(data.name) : null;
}

/**
 * One committed rename as one transaction, shaped by the registry: the leaf
 * may already be the sender's from an earlier name (take it back), the sender
 * may hold a current leaf (move it), or this is the first one (create it).
 * Every shape ends by making the leaf the sender's default SuiNS name — the
 * assignment other devices read. Refuses before signing when the name
 * resolves to someone else.
 */
async function nameChangeTransaction(
    client: Client,
    sender: string,
    name: string,
): Promise<Transaction> {
    const [target, assigned] = await Promise.all([
        leafTarget(client, name),
        assignedName(client, sender),
    ]);
    if (target && target !== sender) throw new NameRefusal("That name is taken.");
    const old = assigned && assigned !== name ? assigned : null;
    // The old leaf can only be removed or renamed while it still resolves to
    // the sender; anything else is left where it is.
    const oldOwned = old !== null && (await leafTarget(client, old)) === sender;

    const tx = new Transaction();
    const instance = tx.object(NAMES.instance);
    const suins = tx.object(NAMES.suins);
    const call = (fn: string, ...args: TransactionArgument[]) =>
        tx.moveCall({
            target: `${NAMES.package}::commander_names::${fn}`,
            arguments: [instance, suins, ...args],
        });

    if (target === sender) {
        // Back to an earlier name: its leaf is still the sender's, so only
        // the current one has to go.
        if (oldOwned) call("remove", tx.pure.string(old!), tx.object.clock());
    } else if (oldOwned) {
        call("rename", tx.pure.string(old!), tx.pure.string(name), tx.object.clock());
    } else {
        call("register", tx.pure.string(name), tx.object.clock());
    }
    call("set_default", tx.pure.string(name));
    return tx;
}

/** The chain's refusal in the player's terms, `null` for anything unmapped. */
function refusal(message: string): string | null {
    const abort = message.match(/abort code: (\d+), in '[^']+::commander_names::/);
    if (abort) {
        if (abort[1] === "3") return "That name was taken a moment ago.";
        if (abort[1] === "5") return "That name belongs to another address.";
        return null;
    }
    if (/gas/i.test(message))
        return "Not enough SUI to pay the network fee. Add test funds under Account & Sessions.";
    return null;
}

/**
 * The name `address` assigned to itself on chain. `undefined` while signed
 * out or still loading, `null` when the address has no assigned name.
 */
export function useAssignedName(address?: string): string | null | undefined {
    const client = useCurrentClient();
    const { data } = useQuery({
        queryKey: [QUERY_KEY, address],
        enabled: !!address,
        queryFn: () => assignedName(client, address!),
    });
    return data;
}

/**
 * Commit a rename. Signed in, `submit` resolves only once the transaction is
 * built, signed and executed — the caller shows `pending` until then — and
 * the local copy is written after the chain accepted the change. With no
 * wallet to sign with, the rename stays on this device, silently. Rejects
 * with a message fit for the dialog.
 */
export function useSubmitNameChange(): {
    submit: (name: string) => Promise<void>;
    pending: boolean;
} {
    const client = useCurrentClient();
    const address = useCurrentAccount()?.address;
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);

    const submit = useCallback(
        async (name: string) => {
            if (!address) throw new Error("Sign in to set a name.");
            if (!canSendTransactions()) return setPlayerName(address, name);
            setPending(true);
            try {
                const sent = sendTransaction(await nameChangeTransaction(client, address, name));
                if (!sent) return setPlayerName(address, name);
                await sent;
                setPlayerName(address, name);
                queryClient.invalidateQueries({ queryKey: [QUERY_KEY, address] });
            } catch (e) {
                if (e instanceof NameRefusal) throw e;
                console.warn(`Changing the name to "${name}" on chain failed:`, e);
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(
                    refusal(message) ?? "The chain refused the change; the name is as it was.",
                );
            } finally {
                setPending(false);
            }
        },
        [client, address, queryClient],
    );

    return { submit, pending };
}
