// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The one place transactions are signed and sent. `<TransactionSender />` is
 * mounted once in the shell; `sendTransaction` is callable from anywhere
 * without React context. Every transaction sends AS the connected account —
 * and signs with this device's session key whenever one is authorized in the
 * account's on-chain alias set, so a rename or a combat order costs no
 * passkey ceremony. Without an authorized key the wallet signs as before.
 * Session management itself passes `{ passkey: true }`: a session key must
 * never mint or remove sessions on its own.
 *
 * Sends are serialized: rapid transactions otherwise race for the same gas
 * coin and equivocate.
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
    /** Always the wallet ceremony — for anything that manages sessions. */
    passkey?: boolean;
}

type Send = (tx: Transaction, opts?: SendOptions) => Promise<ExecutedTransaction>;

let send: Send | null = null;

/**
 * Sign and send `tx` as the connected account — with the session key when
 * this device holds an authorized one, with the wallet otherwise — behind
 * any other transaction in flight. Returns `null` when no wallet is signed
 * in — callers treating on-chain work as optional skip silently — and
 * rejects when the transaction fails (in simulation or on chain).
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
