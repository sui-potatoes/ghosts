// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The quick way to send a transaction: one network call. Every input is resolved
 * up front, so there is nothing to look up, estimate or search for, and what the
 * transaction changed comes back in the response, so there is nothing to wait for
 * or read afterwards. Measured on testnet, 1.6s a game order becomes 0.7s, and a
 * Headquarters write 3.6–4.5s, nearly all of it consensus and the network.
 *
 * Shared and frozen objects keep the version they are passed by for good, and a
 * published package's signatures never change, so both are looked up once per
 * session. The gas coin is tracked from each transaction's effects. Signed bytes
 * can be sent again safely when the network drops: the chain runs them once.
 */

import type { useCurrentClient } from "@mysten/dapp-kit-react";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { Inputs, Transaction, type TransactionPlugin } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";

/** What an order calls; every object in it is a resolved reference. */
export type Order = (tx: Transaction) => void;

/** An object as a transaction left it. */
export interface WrittenObject {
    objectId: string;
    version: bigint;
    /** The object that owns it: a dynamic field holds a table's entry. */
    parent?: string;
    contents?: Uint8Array;
}

/** What came of an order. */
export interface ExecutedOrder {
    digest: string;
    /** The contents of an object as the order left it. */
    contents(objectId: string): Uint8Array | undefined;
    /** Every object the order wrote, at its new version. */
    written: WrittenObject[];
    /** Objects the order deleted or wrapped into another. */
    removed: string[];
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
/** `ChangedObject.outputState` and `Owner.kind` in the effects. */
const [GONE, WRITTEN, OWNED_BY_OBJECT, SHARED] = [1, 2, 2, 3];
/** `OpenSignature.reference` of a parameter taken by `&`. */
const IMMUTABLE = 1;

/** How an object goes into a transaction, where that never changes. */
type Passed = { shared: string } | { ref: { objectId: string; version: string; digest: string } };
/** Shared objects by their initial version, frozen ones by their reference. */
const permanent = new Map<string, Passed>();
/** Per Move function, whether each parameter can change what it is passed. */
const signatures = new Map<string, Promise<boolean[]>>();
const signatureKey = (packageId: string, moduleName: string, name: string) =>
    `${normalizeSuiAddress(packageId)}::${moduleName}::${name}`;

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

    /**
     * Have the gas coin, its price, the objects named here and the signatures of
     * the packages named here at hand before the first order.
     */
    prepare(objects: string[] = [], packages: string[] = []) {
        void Promise.all([
            this.gasCoin(),
            this.gasPrice(),
            this.lookUp(objects),
            ...packages.map((packageId) => this.learn(packageId)),
        ]).catch(() => {});
    }

    /** Every function signature of a package, in one read. */
    private async learn(packageId: string) {
        const { response } = await this.grpc.movePackageService.getPackage({ packageId });
        for (const { name: moduleName, functions } of response.package?.modules ?? [])
            for (const fn of functions) {
                const key = signatureKey(packageId, moduleName ?? "", fn.name ?? "");
                if (!signatures.has(key))
                    signatures.set(
                        key,
                        Promise.resolve(fn.parameters.map((p) => p.reference !== IMMUTABLE)),
                    );
            }
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

    private async sign(order: Order | Transaction, signer: Signer) {
        const built = order instanceof Transaction;
        const tx = built ? order : new Transaction();
        if (!built) order(tx);
        else if (!resolving.has(tx)) {
            resolving.add(tx);
            tx.addBuildPlugin(this.resolve);
        }
        // The objects are looked up while the gas is: settling the commands needs no gas.
        // With the client, whatever the lookup could not settle is settled by the node.
        const [gas, price] = await Promise.all([
            this.gasCoin(),
            this.gasPrice(),
            built ? tx.build({ client: this.grpc, onlyTransactionKind: true }) : null,
        ]);
        tx.setSenderIfNotSet(this.owner);
        tx.setGasPrice(price);
        tx.setGasBudget(gas.balance < BUDGET ? gas.balance : BUDGET);
        tx.setGasPayment([gas.ref]);
        const bytes = await tx.build({ client: this.grpc });
        const { signature } = await signer.signTransaction(bytes);
        return { bytes, signature, gas };
    }

    /** Pass every object a transaction names by its reference, looked up once where it never changes. */
    private resolve: TransactionPlugin = async (data, _options, next) => {
        const pending = data.inputs.flatMap((input, index) =>
            input.UnresolvedObject ? [index] : [],
        );
        if (pending.length) {
            const ids = pending.map((i) =>
                normalizeSuiObjectId(data.inputs[i].UnresolvedObject!.objectId),
            );
            const [passed, mutable] = await Promise.all([
                this.lookUp([...new Set(ids)]),
                Promise.all(pending.map((index) => usedAsMutable(this.grpc, data, index))),
            ]);
            pending.forEach((index, n) => {
                const input = data.inputs[index].UnresolvedObject!;
                const how = passed.get(ids[n])!;
                data.inputs[index] =
                    "shared" in how
                        ? Inputs.SharedObjectRef({
                              objectId: ids[n],
                              initialSharedVersion: input.initialSharedVersion ?? how.shared,
                              mutable: input.mutable ?? mutable[n],
                          })
                        : Inputs.ObjectRef(how.ref);
            });
        }
        await next();
    };

    /** How each object goes into a transaction: from memory where that never changes, else read now. */
    private async lookUp(named: string[]): Promise<Map<string, Passed>> {
        const ids = named.map((id) => normalizeSuiObjectId(id));
        const missing = [...new Set(ids.filter((id) => !permanent.has(id)))];
        const now = new Map<string, Passed>();
        if (missing.length) {
            const { objects } = await this.grpc.core.getObjects({ objectIds: missing });
            objects.forEach((object, i) => {
                if (object instanceof Error) throw object;
                const { objectId, version, digest, owner } = object;
                const ref = { objectId, version, digest };
                if (owner.$kind === "Shared")
                    permanent.set(missing[i], { shared: owner.Shared.initialSharedVersion });
                else if (owner.$kind === "Immutable") permanent.set(missing[i], { ref });
                else if (owner.$kind === "ConsensusAddressOwner")
                    now.set(missing[i], { shared: owner.ConsensusAddressOwner.startVersion });
                else now.set(missing[i], { ref });
            });
        }
        return new Map(ids.map((id) => [id, permanent.get(id) ?? now.get(id)!]));
    }

    /**
     * Send one order, or a transaction built elsewhere, whose objects are looked up
     * here. Rejects when the chain refuses it, with the gas coin kept up to date.
     */
    async execute(order: Order | Transaction, signer: Signer): Promise<ExecutedOrder> {
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

        // An object the order shared is passed by that version from now on.
        for (const { objectId, outputOwner } of effects?.changedObjects ?? [])
            if (objectId && outputOwner?.kind === SHARED && outputOwner.version !== undefined)
                permanent.set(normalizeSuiObjectId(objectId), {
                    shared: String(outputOwner.version),
                });

        if (!effects?.status?.success) {
            throw new OrderRefused(effects?.status?.error?.description ?? "execution failed");
        }

        const objects = executed?.objects?.objects ?? [];
        const contents = (objectId: string) => {
            let latest: (typeof objects)[number] | undefined;
            for (const object of objects) {
                if (object.objectId !== objectId) continue;
                if (!latest || BigInt(object.version ?? 0) > BigInt(latest.version ?? 0))
                    latest = object;
            }
            return latest?.contents?.value;
        };
        const written: WrittenObject[] = [];
        const removed: string[] = [];
        for (const change of effects?.changedObjects ?? []) {
            const { objectId, outputState, outputVersion, outputOwner } = change;
            if (!objectId) continue;
            if (outputState === GONE) removed.push(objectId);
            else if (outputState === WRITTEN)
                written.push({
                    objectId,
                    version: BigInt(outputVersion ?? 0),
                    parent: outputOwner?.kind === OWNED_BY_OBJECT ? outputOwner.address : undefined,
                    contents: contents(objectId),
                });
        }
        return { digest: executed?.digest ?? "", contents, written, removed };
    }
}

/** Transactions that already carry the lookup. */
const resolving = new WeakSet<Transaction>();

/**
 * Whether a transaction may change the object at `index`, by how its commands
 * take it, the way the SDK decides it: anything but an immutable reference.
 */
async function usedAsMutable(
    client: SuiGrpcClient,
    data: Parameters<TransactionPlugin>[0],
    index: number,
): Promise<boolean> {
    const uses = await Promise.all(
        data.commands.map(async (command) => {
            if (!command.MoveCall) {
                return JSON.stringify(command).includes(`"Input":${index}`);
            }
            const { package: packageId, module: moduleName, function: name } = command.MoveCall;
            const at = command.MoveCall.arguments.flatMap((arg, i) =>
                arg.$kind === "Input" && arg.Input === index ? [i] : [],
            );
            if (!at.length) return false;
            const key = signatureKey(packageId, moduleName, name);
            let changes = signatures.get(key);
            if (!changes) {
                changes = client.core
                    .getMoveFunction({ packageId, moduleName, name })
                    .then(({ function: fn }) =>
                        fn.parameters.map((p) => p.reference !== "immutable"),
                    );
                changes.catch(() => signatures.delete(key));
                signatures.set(key, changes);
            }
            const mutable = await changes;
            return at.some((i) => mutable[i] ?? true);
        }),
    );
    return uses.some(Boolean);
}

/** The chain ran the order and said no. */
export class OrderRefused extends Error {}
