// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The quick way to send a game order: one network call. Every input is resolved
 * up front, so there is nothing to look up, estimate or search for, and what the
 * order changed comes back in the response, so there is nothing to wait for or
 * read afterwards. Measured on testnet, 1.6s an order becomes 0.7s, nearly all of
 * it consensus and the network.
 *
 * The gas coin is tracked from each order's effects. Signed bytes can be sent
 * again safely when the network drops: the chain runs them once.
 */

import type { useCurrentClient } from "@mysten/dapp-kit-react";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";

/** What an order calls; every object in it is a resolved reference. */
export type Order = (tx: Transaction) => void;

/** What came of an order. */
export interface ExecutedOrder {
    digest: string;
    /** The contents of an object as the order left it. */
    contents(objectId: string): Uint8Array | undefined;
}

/** The most an order may cost; only what it uses is charged. */
const BUDGET = 100_000_000n;
const READ_MASK = [
    "digest",
    "effects",
    "objects.objects.object_id",
    "objects.objects.version",
    "objects.objects.contents",
];
const NETWORK_ERROR = /Failed to fetch|NetworkError|UNAVAILABLE|DEADLINE|timed? ?out|aborted/i;
const NETWORK_RETRIES = 3;

interface Gas {
    ref: { objectId: string; version: string; digest: string };
    balance: bigint;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FastLane {
    private readonly grpc: SuiGrpcClient;
    private gas: Promise<Gas> | null = null;
    private price: Promise<bigint> | null = null;

    constructor(
        client: ReturnType<typeof useCurrentClient>,
        private readonly owner: string,
    ) {
        this.grpc = client as unknown as SuiGrpcClient;
    }

    /** Have the gas coin and its price at hand before the first order. */
    prepare() {
        void Promise.all([this.gasCoin(), this.gasPrice()]).catch(() => {});
    }

    /** Another transaction spent the gas coin: read it again before the next order. */
    forgetGas() {
        this.gas = null;
    }

    private gasCoin(): Promise<Gas> {
        this.gas ??= this.grpc.core.listCoins({ owner: this.owner }).then(({ objects }) => {
            const coin = objects.reduce<(typeof objects)[number] | null>(
                (best, c) => (!best || BigInt(c.balance) > BigInt(best.balance) ? c : best),
                null,
            );
            if (!coin) throw new Error("Insufficient SUI balance");
            const { objectId, version, digest } = coin;
            return { ref: { objectId, version, digest }, balance: BigInt(coin.balance) };
        });
        this.gas.catch(() => (this.gas = null));
        return this.gas;
    }

    private gasPrice(): Promise<bigint> {
        this.price ??= this.grpc.core
            .getReferenceGasPrice()
            .then(({ referenceGasPrice }) => BigInt(referenceGasPrice));
        this.price.catch(() => (this.price = null));
        return this.price;
    }

    private async sign(order: Order, signer: Signer) {
        const [gas, price] = await Promise.all([this.gasCoin(), this.gasPrice()]);
        const tx = new Transaction();
        tx.setSender(this.owner);
        tx.setGasPrice(price);
        tx.setGasBudget(gas.balance < BUDGET ? gas.balance : BUDGET);
        tx.setGasPayment([gas.ref]);
        order(tx);
        const bytes = await tx.build();
        const { signature } = await signer.signTransaction(bytes);
        return { bytes, signature, gas };
    }

    /** Send one order. Rejects when the chain refuses it, with the gas coin kept up to date. */
    async execute(order: Order, signer: Signer): Promise<ExecutedOrder> {
        let signed = await this.sign(order, signer);
        let rebuilt = false;
        for (let attempt = 0; ; attempt++) {
            try {
                const { response } = await this.grpc.transactionExecutionService.executeTransaction(
                    {
                        transaction: { bcs: { value: signed.bytes } },
                        signatures: [
                            {
                                bcs: { value: fromBase64(signed.signature) },
                                signature: { oneofKind: undefined },
                            },
                        ],
                        readMask: { paths: READ_MASK },
                    },
                );
                return this.settle(response.transaction, signed.gas);
            } catch (error) {
                if (error instanceof OrderRefused) throw error;
                const message = error instanceof Error ? error.message : String(error);
                if (NETWORK_ERROR.test(message)) {
                    if (attempt >= NETWORK_RETRIES) throw error;
                    await sleep(400 * (attempt + 1));
                    continue;
                }
                // Turned away before it ran: most likely the gas coin or its price moved on.
                if (rebuilt) throw error;
                rebuilt = true;
                this.gas = null;
                this.price = null;
                await sleep(500);
                signed = await this.sign(order, signer);
            }
        }
    }

    private settle(
        executed: Awaited<
            ReturnType<SuiGrpcClient["transactionExecutionService"]["executeTransaction"]>
        >["response"]["transaction"],
        gas: Gas,
    ): ExecutedOrder {
        const effects = executed?.effects;
        const coin = effects?.gasObject;
        if (coin?.objectId && coin.outputVersion !== undefined && coin.outputDigest) {
            const used = effects?.gasUsed;
            const spent =
                BigInt(used?.computationCost ?? 0) +
                BigInt(used?.storageCost ?? 0) -
                BigInt(used?.storageRebate ?? 0);
            this.gas = Promise.resolve({
                ref: {
                    objectId: coin.objectId,
                    version: String(coin.outputVersion),
                    digest: coin.outputDigest,
                },
                balance: gas.balance - spent,
            });
        } else this.gas = null;

        if (!effects?.status?.success) {
            throw new OrderRefused(effects?.status?.error?.description ?? "execution failed");
        }

        const objects = executed?.objects?.objects ?? [];
        return {
            digest: executed?.digest ?? "",
            contents: (objectId) => {
                let latest: (typeof objects)[number] | undefined;
                for (const object of objects) {
                    if (object.objectId !== objectId) continue;
                    if (!latest || BigInt(object.version ?? 0) > BigInt(latest.version ?? 0))
                        latest = object;
                }
                return latest?.contents?.value;
            },
        };
    }
}

/** The chain ran the order and said no. */
export class OrderRefused extends Error {}
