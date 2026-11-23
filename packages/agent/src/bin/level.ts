#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Freeze a level on testnet and make it the ranked level of both sizes, as the holder of the
 * `RulesCap` (the Sui CLI's active address; it signs through `sui keytool sign`, so no key is read
 * here):
 *
 *   pnpm --filter @ghosts/agent level                       dry run: simulate and check, send nothing
 *   pnpm --filter @ghosts/agent level --send                then send `new_level` and `set_level` 3 and 4
 *   pnpm --filter @ghosts/agent level --module <file.ts>    the pinned level (default: the engine's
 *                                                           `night-shift/chain.ts`; `chain-next.ts` next)
 *
 * The module exports `NIGHT_SHIFT_NAME`, `NIGHT_SHIFT_MAP` (hex) and `NIGHT_SHIFT_POSITIONS`
 * (`[row, col]`, side A's then side B's). Before anything is sent, `new_level` is simulated and the
 * `Preset` it creates is read from the simulation and compared byte for byte with the module:
 * `id ‖ id ‖ map[32..] ‖ units [] ‖ name ‖ positions`. The grid is also compared tile by tile with
 * the engine's `toMoveMap` of the shipped level, which only warns: the engine may already be ahead
 * of, or behind, the module. After sending, the live object is read back and checked again, and the
 * `Rules` are read to confirm both sizes name the new preset. Reads go over gRPC.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { bcs } from "@mysten/sui/bcs";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toBase64 } from "@mysten/sui/utils";

import { decodeTiles, MapBcs, RulesBcs } from "../bcs.ts";
import { TESTNET_DEPLOYMENT } from "../contract.ts";

const ENGINE = resolve(import.meta.dirname, "../../../engine/src");
const { values } = parseArgs({
    options: {
        module: { type: "string", default: `${ENGINE}/night-shift/chain.ts` },
        send: { type: "boolean", default: false },
        sizes: { type: "string", default: "3,4" },
    },
});

const level = await import(resolve(values.module!));
const NAME: string = level.NIGHT_SHIFT_NAME;
const MAP: string = level.NIGHT_SHIFT_MAP;
const POSITIONS: [number, number][] = level.NIGHT_SHIFT_POSITIONS;
if (!NAME || !MAP || !POSITIONS) throw new Error(`${values.module} lacks NIGHT_SHIFT_NAME, _MAP or _POSITIONS.`);
const sizes = values.sizes!.split(",").map(Number);

const d = TESTNET_DEPLOYMENT;
const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
const sui = (...args: string[]) => execFileSync("sui", args, { encoding: "utf8" }).trim();
if (sui("client", "active-env").split("\n").pop() !== "testnet") throw new Error("The Sui CLI is not on testnet.");
const sender = sui("client", "active-address");
const caps = await client.core.listOwnedObjects({ owner: sender, type: `${d.package}::rules::RulesCap` });
const cap = caps.objects[0]?.objectId;
if (!cap) throw new Error("The CLI's active address holds no RulesCap of this package.");

const Preset = bcs.struct("Preset", {
    id: bcs.Address,
    map: MapBcs,
    name: bcs.string(),
    positions: bcs.vector(bcs.vector(bcs.u8())),
});
const mapBytes = fromHex(MAP);

/** The byte-for-byte check of a `Preset`'s content against the module; true when it passes. */
async function check(id: string, content: Uint8Array): Promise<boolean> {
    const idBytes = fromHex(id);
    const expected = new Uint8Array([
        ...idBytes,
        ...idBytes,
        ...mapBytes.slice(32),
        0,
        ...bcs.string().serialize(NAME).toBytes(),
        ...bcs.vector(bcs.vector(bcs.u8())).serialize(POSITIONS).toBytes(),
    ]);
    const equal = expected.length === content.length && expected.every((b, i) => b === content[i]);
    const preset = Preset.parse(content);
    const tiles = decodeTiles(preset.map);
    console.log(
        `  bytes: ${equal ? "equal" : "DIFFERENT"} (${content.length} of ${expected.length}); ` +
            `grid ${tiles.length} x ${tiles[0]?.length}; map id is the preset's: ${preset.map.id === preset.id}; ` +
            `positions ${JSON.stringify(preset.positions) === JSON.stringify(POSITIONS) ? "equal" : "DIFFERENT"}`,
    );
    try {
        const { toMoveMap } = await import(`${ENGINE}/editor/level.ts`);
        const { nightShiftLevel } = await import(`${ENGINE}/night-shift/level.ts`);
        const engine = toMoveMap(nightShiftLevel()).tiles;
        let off = 0;
        tiles.forEach((row, r) =>
            row.forEach((tile, c) => {
                const e = engine[r]?.[c];
                const sides = tile.kind === "cover" ? [tile.left, tile.top, tile.right, tile.bottom].join() : "";
                if (!e || e.t !== tile.kind || (tile.kind === "cover" && e.sides.join() !== sides)) off++;
            }),
        );
        console.log(`  engine's toMoveMap: ${off} tile(s) differ${off ? " (warning only)" : ""}`);
    } catch (error) {
        console.log(`  engine's toMoveMap not compared: ${(error as Error).message}`);
    }
    return equal && preset.map.id === preset.id;
}

/** Sign with the CLI's active address and execute; the effects' status must be a success. */
async function sendTx(bytes: Uint8Array) {
    const signed = JSON.parse(sui("keytool", "sign", "--address", sender, "--data", toBase64(bytes), "--json"));
    const result = await client.core.executeTransaction({
        transaction: bytes,
        signatures: [signed.suiSignature],
        include: { effects: true, objectTypes: true },
    });
    const tx = result.Transaction ?? result.FailedTransaction;
    if (!tx?.effects?.status.success) throw new Error(`Failed: ${JSON.stringify(tx?.effects?.status)}`);
    await client.core.waitForTransaction({ digest: tx.digest });
    return tx;
}

// 1. new_level, simulated and checked
const create = new Transaction();
create.setSender(sender);
create.moveCall({
    target: `${d.package}::ghosts::new_level`,
    arguments: [
        create.object(cap),
        create.pure.string(NAME),
        create.pure.vector("u8", Array.from(mapBytes)),
        create.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(POSITIONS)),
    ],
});
const createBytes = await create.build({ client });
const { response } = await client.transactionExecutionService.simulateTransaction({
    transaction: { bcs: { value: createBytes } },
    readMask: {
        paths: [
            "transaction.effects.status",
            "transaction.objects.objects.object_id",
            "transaction.objects.objects.object_type",
            "transaction.objects.objects.contents",
        ],
    },
});
if (!response.transaction?.effects?.status?.success) {
    throw new Error(`new_level simulation failed: ${JSON.stringify(response.transaction?.effects?.status)}`);
}
const simulated = response.transaction.objects?.objects?.find((o) => o.objectType?.endsWith("::ghosts::Preset"));
if (!simulated?.objectId || !simulated.contents?.value) throw new Error("The simulation created no Preset.");
console.log(`${NAME}: dry run of new_level`);
if (!(await check(simulated.objectId, simulated.contents.value))) throw new Error("The check failed: nothing sent.");
if (!values.send) {
    console.log("Check passed. Nothing sent: run again with --send.");
    process.exit(0);
}

// 2. new_level, sent, and the live object checked again
const created = await sendTx(createBytes);
const preset = Object.entries(created.objectTypes ?? {}).find(([, type]) => type.endsWith("::ghosts::Preset"))?.[0];
if (!preset) throw new Error(`new_level ${created.digest} created no Preset.`);
console.log(`new_level: ${created.digest}, preset ${preset}`);
const live = await client.core.getObject({ objectId: preset, include: { content: true } });
if (!(await check(preset, live.object.content!))) throw new Error("The live preset fails the check: set_level not sent.");

// 3. set_level for every size, in one transaction
const point = new Transaction();
point.setSender(sender);
for (const size of sizes) {
    point.moveCall({
        target: `${d.package}::ghosts::set_level`,
        arguments: [point.object(d.rules!), point.object(cap), point.object(preset), point.pure.u8(size)],
    });
}
const pointed = await sendTx(await point.build({ client }));
const rules = RulesBcs.parse((await client.core.getObject({ objectId: d.rules!, include: { content: true } })).object.content!);
console.log(`set_level ${sizes.join(", ")}: ${pointed.digest}`);
for (const size of rules.sizes) console.log(`  rules: size ${size.units} plays ${size.level ?? "no level"}`);
console.log(`
Now update, with the new preset ${preset}:
- app/src/constants.ts: LEVELS.nightShift = "${preset}"; move the old ID into LEVELS.retired
  (its replays then show "This map is no longer available" instead of the new scene).
- packages/agent/src/maps.ts: TESTNET_LEVELS: the new ID to NIGHT_SHIFT_LEVEL (with NIGHT_SHIFT and
  NIGHT_SHIFT_POSITIONS from ${values.module}); keep the old ID on the old bytes, as its own LevelMap.
- packages/agent/src/contract.ts: TESTNET_DEPLOYMENT.friendlyLevel = "${preset}".
- levels/night-shift-onchain.md: the ids and digests above.`);
