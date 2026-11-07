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
import { FastLane, type ExecutedOrder, type Order } from "./fast-lane";
import { trackSaving } from "./saving";
import { supportsSessionKeys } from "./session-key";

export interface SendOptions {
    /** Use the wallet signer directly, bypassing session authorization. */
    passkey?: boolean;
}

type Send = (tx: Transaction, opts?: SendOptions) => Promise<ExecutedTransaction>;

let send: Send | null = null;
let sendOrderNow: ((order: Order) => Promise<ExecutedOrder>) | null = null;
let fastLane: FastLane | null = null;

/**
 * Queue a game order on the fast lane, in line with every other send. Null when
 * no sender is mounted; rejects when the chain refuses it or `order` throws.
 */
export function sendOrder(order: Order): Promise<ExecutedOrder> | null {
    return sendOrderNow ? sendOrderNow(order) : null;
}

/** Have the fast lane ready before the first order goes out. */
export function prepareOrders() {
    fastLane?.prepare();
}

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
            sendOrderNow = null;
            fastLane = null;
            return;
        }
        const owner = account.address;
        // One sweep per connect: a key past its lifetime removes its own alias.
        void expireSessionKey(client, owner).catch(() => {});
        let tail: Promise<unknown> = Promise.resolve();
        const wallet = () => new CurrentAccountSigner(dAppKit as unknown as DAppKit);
        const fast = new FastLane(client, owner);
        const execute = async (tx: Transaction, signer: Signer) => {
            tx.setSenderIfNotSet(owner);
            // This may spend the coin the fast lane is tracking.
            fast.forgetGas();
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
        const signerNow = async (): Promise<Signer> => {
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
            return session ?? wallet();
        };
        const run = async (tx: Transaction, opts?: SendOptions): Promise<ExecutedTransaction> =>
            execute(tx, opts?.passkey ? wallet() : await signerNow());
        const inLine = <T,>(job: () => Promise<T>): Promise<T> => {
            const turn = tail.then(job);
            tail = turn.catch(() => {});
            return trackSaving(turn);
        };
        send = (tx, opts) => inLine(() => run(tx, opts));
        sendOrderNow = (order) => inLine(async () => fast.execute(order, await signerNow()));
        fastLane = fast;
        return () => {
            send = null;
            sendOrderNow = null;
            fastLane = null;
        };
    }, [client, account, dAppKit]);

    return null;
}
