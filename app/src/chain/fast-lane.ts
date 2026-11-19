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
 * session. The gas coin is tracked from each transaction's effects, and so is
 * every object owned by an address: what an `Account` holds is sent to it and
 * received by reference, and each write to one moves the reference on, so the
 * next transaction takes the newest this client has seen, from a read or from
 * its own effects. Signed bytes can be sent again safely when the network
 * drops: the chain runs them once.
 */

import type { useCurrentClient } from "@mysten/dapp-kit-react";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { Inputs, Transaction, type TransactionPlugin } from "@mysten/sui/transactions";
import {
    fromBase64,
    normalizeStructTag,
    normalizeSuiAddress,
    normalizeSuiObjectId,
} from "@mysten/sui/utils";

/** What an order calls; every object in it is a resolved reference. */
export type Order = (tx: Transaction) => void;

/** An object as a transaction left it. */
export interface WrittenObject {
    objectId: string;
    version: bigint;
    /** The object that owns it: a dynamic field holds a table's entry. */
    parent?: string;
    /** The address that owns it: an object's own, for one sent to an object. */
    owner?: string;
    /** Its Move type, normalized. */
    type?: string;
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
    "objects.objects.object_type",
    "objects.objects.contents",
];
const NETWORK_ERROR = /Failed to fetch|NetworkError|UNAVAILABLE|DEADLINE|timed? ?out|aborted/i;
const NETWORK_RETRIES = 3;
/** `ChangedObject.outputState` and `Owner.kind` in the effects. */
const [GONE, WRITTEN] = [1, 2];
const [OWNED_BY_ADDRESS, OWNED_BY_OBJECT, SHARED] = [1, 2, 3];
/** `OpenSignature.reference` of a parameter taken by `&`. */
const IMMUTABLE = 1;

type ObjectRef = { objectId: string; version: string; digest: string };
/**
 * How an object goes into a transaction: shared, by reference, or received by the
 * object it was sent to.
 */
type Passed = { shared: string } | { ref: ObjectRef } | { receiving: ObjectRef };
/** Shared objects by their initial version, frozen ones by their reference. */
const permanent = new Map<string, Passed>();

/**
 * The newest reference of each object owned by an address this client has seen,
 * from a read or from its own effects, and who owns it; no owner once it went
 * anywhere else (into another object, a table, or gone), so that a read a moment
 * behind cannot bring it back.
 */
const owned = new Map<string, { ref: ObjectRef; owner?: string }>();

/** Note an owned object as a read found it; kept only when newer than what is known. */
export function noteOwned(ref: ObjectRef, owner: string) {
    const objectId = normalizeSuiObjectId(ref.objectId);
    const known = owned.get(objectId);
    if (known && BigInt(known.ref.version) >= BigInt(ref.version)) return;
    owned.set(objectId, { ref: { ...ref, objectId }, owner: normalizeSuiAddress(owner) });
}

/** Whether a read of an object at `version` is older than where it has since gone. */
export function movedOn(objectId: string, version: string): boolean {
    const known = owned.get(normalizeSuiObjectId(objectId));
    return !!known && BigInt(known.ref.version) > BigInt(version);
}

/** Transactions sent here, with what their objects were passed by: see `forgetOwned`. */
const inputsOf = new WeakMap<Transaction, Parameters<TransactionPlugin>[0]>();
/** Per Move function, whether each parameter can change what it is passed. */
const signatures = new Map<string, Promise<boolean[]>>();
const signatureKey = (packageId: string, moduleName: string, name: string) =>
    `${normalizeSuiAddress(packageId)}::${moduleName}::${name}`;

/**
 * What pays for an order: a coin, or, for an address holding SUI only as an
 * address balance (what the faucet pays into), the balance itself, which has no
 * reference to pass.
 */
interface Gas {
    ref: { objectId: string; version: string; digest: string } | null;
    balance: bigint;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FastLane {
    private readonly grpc: SuiGrpcClient;
    private gas: Promise<Gas> | null = null;
    private price: Promise<bigint> | null = null;
    /** The epoch and chain an address-balance order is valid in, read once. */
    private validity: Promise<{ epoch: bigint; chain: string }> | null = null;

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
        this.gas ??= this.grpc.core.listCoins({ owner: this.owner }).then(async ({ objects }) => {
            const coin = objects.reduce<(typeof objects)[number] | null>(
                (best, c) => (!best || BigInt(c.balance) > BigInt(best.balance) ? c : best),
                null,
            );
            if (coin) {
                const { objectId, version, digest } = coin;
                return { ref: { objectId, version, digest }, balance: BigInt(coin.balance) };
            }
            // No coin: SUI paid straight into the address balance pays the fee too.
            const { balance } = await this.grpc.core.getBalance({ owner: this.owner });
            const held = BigInt(balance.addressBalance);
            if (held <= 0n) throw new Error("Insufficient SUI balance");
            return { ref: null, balance: held };
        });
        this.gas.catch(() => (this.gas = null));
        return this.gas;
    }

    /** The validity window of an order paid from the address balance: this epoch and the next. */
    private async expiration() {
        this.validity ??= Promise.all([
            this.grpc.core.getCurrentSystemState(),
            this.grpc.core.getChainIdentifier(),
        ]).then(([{ systemState }, { chainIdentifier }]) => ({
            epoch: BigInt(systemState.epoch),
            chain: chainIdentifier,
        }));
        this.validity.catch(() => (this.validity = null));
        const { epoch, chain } = await this.validity;
        return {
            ValidDuring: {
                minEpoch: String(epoch),
                maxEpoch: String(epoch + 1n),
                minTimestamp: null,
                maxTimestamp: null,
                chain,
                nonce: Math.floor(Math.random() * 2 ** 32),
            },
        };
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
            tx.addBuildPlugin((data, options, next) => {
                inputsOf.set(tx, data);
                return this.resolve(data, options, next);
            });
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
        if (gas.ref) tx.setGasPayment([gas.ref]);
        else {
            tx.setGasPayment([]);
            tx.setExpiration(await this.expiration());
        }
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
                        : "receiving" in how
                          ? Inputs.ReceivingRef(how.receiving)
                          : Inputs.ObjectRef(how.ref);
            });
        }
        await next();
    };

    /**
     * How each object goes into a transaction: from memory where that never changes
     * or this client knows the newest reference, else read now. One owned by
     * another address than the sender's is an object's, to be received.
     */
    private async lookUp(named: string[]): Promise<Map<string, Passed>> {
        const ids = named.map((id) => normalizeSuiObjectId(id));
        const now = new Map<string, Passed>();
        const sender = normalizeSuiAddress(this.owner);
        const byOwner = (ref: ObjectRef, owner: string): Passed =>
            owner === sender ? { ref } : { receiving: ref };
        for (const id of ids) {
            const known = owned.get(id);
            if (!permanent.has(id) && known?.owner) now.set(id, byOwner(known.ref, known.owner));
        }
        let missing = [...new Set(ids.filter((id) => !permanent.has(id) && !now.has(id)))];
        for (let attempt = 0; missing.length; attempt++) {
            const { objects } = await this.grpc.core.getObjects({ objectIds: missing });
            const behind: string[] = [];
            objects.forEach((object, i) => {
                if (object instanceof Error) throw object;
                const { objectId, version, digest, owner } = object;
                const ref = { objectId, version, digest };
                if (owner.$kind === "Shared")
                    permanent.set(missing[i], { shared: owner.Shared.initialSharedVersion });
                else if (owner.$kind === "Immutable") permanent.set(missing[i], { ref });
                else if (owner.$kind === "ConsensusAddressOwner")
                    now.set(missing[i], { shared: owner.ConsensusAddressOwner.startVersion });
                else if (owner.$kind === "AddressOwner") {
                    // a node a moment behind: what it has is older than where the object went
                    if (movedOn(objectId, version) && attempt < 4) behind.push(missing[i]);
                    else {
                        noteOwned(ref, owner.AddressOwner);
                        now.set(missing[i], byOwner(ref, normalizeSuiAddress(owner.AddressOwner)));
                    }
                } else now.set(missing[i], { ref });
            });
            missing = behind;
            if (missing.length) await sleep(400);
        }
        return new Map(ids.map((id) => [id, permanent.get(id) ?? now.get(id)!]));
    }

    /**
     * A transaction the chain turned away or refused may have named an owned object
     * by a reference gone stale: someone else moved it on. Forget what it was passed
     * by, so it is read again, by this transaction when it is signed once more.
     */
    private forgetOwned(order: Order | Transaction) {
        const data = order instanceof Transaction ? inputsOf.get(order) : undefined;
        data?.inputs.forEach((input, index) => {
            const ref = input.Object?.Receiving ?? input.Object?.ImmOrOwnedObject;
            if (!ref) return;
            owned.delete(normalizeSuiObjectId(ref.objectId));
            data.inputs[index] = {
                $kind: "UnresolvedObject",
                UnresolvedObject: { objectId: ref.objectId },
            };
        });
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
                if (error instanceof OrderRefused) {
                    this.forgetOwned(order);
                    throw error;
                }
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
                this.validity = null;
                this.forgetOwned(order);
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
        const coin = gas.ref ? effects?.gasObject : undefined;
        if (!gas.ref) {
            // Paid from the address balance: no coin moved on. Track what is left, and
            // read it again when it runs low or the balance may have been topped up.
            const used = effects?.gasUsed;
            const left =
                gas.balance -
                (BigInt(used?.computationCost ?? 0) +
                    BigInt(used?.storageCost ?? 0) -
                    BigInt(used?.storageRebate ?? 0));
            this.gas = left >= 2n * BUDGET ? Promise.resolve({ ref: null, balance: left }) : null;
        } else if (coin?.objectId && coin.outputVersion !== undefined && coin.outputDigest) {
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

        // An object the order shared is passed by that version from now on, and one it
        // left with an address by its new reference; one it moved anywhere else isn't.
        const lamport = String(effects?.lamportVersion ?? 0);
        for (const change of effects?.changedObjects ?? []) {
            const { objectId, outputState, outputOwner, outputVersion, outputDigest } = change;
            if (!objectId) continue;
            const id = normalizeSuiObjectId(objectId);
            if (outputOwner?.kind === SHARED && outputOwner.version !== undefined)
                permanent.set(id, { shared: String(outputOwner.version) });
            if (id === normalizeSuiObjectId(coin?.objectId ?? "0x0")) continue;
            const version = outputVersion !== undefined ? String(outputVersion) : lamport;
            const ref = { objectId: id, version, digest: outputDigest ?? "" };
            const left =
                outputState === WRITTEN && outputOwner?.kind === OWNED_BY_ADDRESS && outputDigest;
            if (left) owned.set(id, { ref, owner: normalizeSuiAddress(outputOwner.address!) });
            else if (owned.has(id) || outputState === GONE) owned.set(id, { ref });
        }

        if (!effects?.status?.success) {
            throw new OrderRefused(effects?.status?.error?.description ?? "execution failed");
        }

        const objects = executed?.objects?.objects ?? [];
        const latest = (objectId: string) => {
            let found: (typeof objects)[number] | undefined;
            for (const object of objects) {
                if (object.objectId !== objectId) continue;
                if (!found || BigInt(object.version ?? 0) > BigInt(found.version ?? 0))
                    found = object;
            }
            return found;
        };
        const contents = (objectId: string) => latest(objectId)?.contents?.value;
        const written: WrittenObject[] = [];
        const removed: string[] = [];
        for (const change of effects?.changedObjects ?? []) {
            const { objectId, outputState, outputVersion, outputOwner } = change;
            if (!objectId) continue;
            const type = change.objectType ?? latest(objectId)?.objectType;
            if (outputState === GONE) removed.push(objectId);
            else if (outputState === WRITTEN)
                written.push({
                    objectId,
                    version: BigInt(outputVersion ?? 0),
                    parent: outputOwner?.kind === OWNED_BY_OBJECT ? outputOwner.address : undefined,
                    owner:
                        outputOwner?.kind === OWNED_BY_ADDRESS && outputOwner.address
                            ? normalizeSuiAddress(outputOwner.address)
                            : undefined,
                    type: type ? normalizeStructTag(type) : undefined,
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
