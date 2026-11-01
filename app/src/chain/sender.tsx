// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Exposes transaction sending through the mounted TransactionSender.
 * Sends are serialized and default to the connected account as sender.
 * With session-key support, a missing session is authorized through the
 * wallet before sending. Otherwise the wallet signs the transaction.
 * `{ passkey: true }` selects the wallet signer directly.
 */

import {
    CurrentAccountSigner,
    useCurrentAccount,
    useCurrentClient,
    useDAppKit,
    type DAppKit,
} from "@mysten/dapp-kit-react";
import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
import { useEffect } from "react";

import { activeSessionSigner, authorizeDevice, expireSessionKey } from "./alias";
import type { ExecutedTransaction } from "./executor";
import { supportsSessionKeys } from "./session-key";

export interface SendOptions {
    /** Use the wallet signer directly, bypassing session authorization. */
    passkey?: boolean;
}

type Send = (tx: Transaction, opts?: SendOptions) => Promise<ExecutedTransaction>;

let send: Send | null = null;

/**
 * Queue `tx` through the mounted sender, selecting or authorizing a session
 * signer unless `passkey` is set or session keys are unsupported. Returns
 * null when no sender is mounted; rejects if authorization or sending fails.
 */
export function sendTransaction(
    tx: Transaction,
    opts?: SendOptions,
): Promise<ExecutedTransaction> | null {
    return send ? send(tx, opts) : null;
}

/** Whether a wallet is connected to sign with right now. */
export function canSendTransactions(): boolean {
    return send !== null;
}

/** Mount once; while a wallet is connected it serves `sendTransaction`. */
export function TransactionSender() {
    const client = useCurrentClient();
    const account = useCurrentAccount();
    const dAppKit = useDAppKit();

    useEffect(() => {
        if (!account) {
            send = null;
            return;
        }
        const owner = account.address;
        // One sweep per connect: a key past its lifetime removes its own alias.
        void expireSessionKey(client, owner).catch(() => {});
        let tail: Promise<unknown> = Promise.resolve();
        const wallet = () => new CurrentAccountSigner(dAppKit as unknown as DAppKit);
        const execute = async (tx: Transaction, signer: Signer) => {
            tx.setSenderIfNotSet(owner);
            const result = await client.core.signAndExecuteTransaction({
                transaction: tx,
                signer,
                include: { effects: true, events: true, objectTypes: true },
            });
            if (result.FailedTransaction) {
                throw new Error(
                    `Transaction failed: ${result.FailedTransaction.status.error?.message}`,
                );
            }
            return result.Transaction;
        };
        const run = async (tx: Transaction, opts?: SendOptions): Promise<ExecutedTransaction> => {
            if (opts?.passkey) return execute(tx, wallet());
            let session = await activeSessionSigner(client, owner);
            if (!session && (await supportsSessionKeys())) {
                // No authorized session: authorizing this device is the passkey's
                // one job, and the transaction itself then signs with the fresh
                // session key. A declined ceremony aborts the transaction too —
                // it would otherwise just be prompted for again.
                session = await authorizeDevice(client, owner, async (authTx) => {
                    await execute(authTx, wallet());
                });
            }
            return execute(tx, session ?? wallet());
        };
        send = (tx, opts) => {
            const turn = tail.then(() => run(tx, opts));
            tail = turn.catch(() => {});
            return turn;
        };
        return () => {
            send = null;
        };
    }, [client, account, dAppKit]);

    return null;
}
