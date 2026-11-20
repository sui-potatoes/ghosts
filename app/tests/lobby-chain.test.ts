// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly lobbies as the app reads and keys them (`src/chain/lobby-core.ts`,
 * the lobby schemas and `Game.mode` in `src/chain/bcs.ts`, the friendly rules in
 * `match-rules.ts`). Expected bytes are written out by hand from the Move
 * layout (`ghosts::lobby`, `ghosts::ghosts::Mode`, `Game`, `Preset`), one field
 * at a time, not produced by the encoder under test; the hash is checked
 * against published vectors and an independent implementation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID } from "@mysten/sui/utils";
import { blake2b } from "hash-wasm";

import { Game, GameMode, Lobby, LobbyField, Preset } from "../src/chain/bcs.ts";
import {
    abortOf,
    blake2b256,
    codeHash,
    codeText,
    droppedWhy,
    expiresAt,
    isExpired,
    keyType,
    lobbyFieldId,
    lobbyRefusal,
    parseCode,
    placeOf,
    protectedKey,
    randomCode,
} from "../src/chain/lobby-core.ts";
import {
    deployCap,
    experienceFor,
    friendlySize,
    isFriendly,
    podiumsFor,
} from "../src/chain/match-rules.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s.replace(/^0x/, ""), "hex"));
const id = (byte: string) => byte.repeat(32);
const PKG = `0x${id("ab")}`;
const LOBBIES = `0x${id("cd")}`;

// === Hash and code ==========================================================

test("blake2b256 is Sui's hash::blake2b256: published vectors and hash-wasm", async () => {
    assert.equal(
        hex(blake2b256(new Uint8Array())),
        "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
    );
    assert.equal(
        hex(blake2b256(new TextEncoder().encode("abc"))),
        "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
    );
    for (const n of [1, 8, 32, 64, 127, 128, 129, 256, 300]) {
        const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
        assert.equal(hex(blake2b256(data)), await blake2b(data, 256), `length ${n}`);
    }
});

test("the code's text: 8 bytes as a big-endian number in base 31, 13 digits", () => {
    assert.equal(codeText(new Uint8Array(8)), "2222222222222");
    assert.equal(codeText(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])), "2222222222223");
    // 31 is "32" in base 31: digit 1 then digit 0.
    assert.equal(codeText(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 31])), "2222222222232");
    // 2^64 - 1, the largest code.
    assert.equal(codeText(new Uint8Array(8).fill(255)), "SF297MD67PA8H");
    const one = parseCode("SF297MD67PA8H");
    assert.ok(one.ok && hex(one.bytes) === "ffffffffffffffff");
    // One past it is 2^64: no code.
    const past = parseCode("SF297MD67PA8J");
    assert.ok(!past.ok && past.message === "No game with this code");
    for (let i = 0; i < 200; i++) {
        const code = randomCode();
        const text = codeText(code);
        assert.equal(text.length, 13);
        const back = parseCode(text);
        assert.ok(back.ok && hex(back.bytes) === hex(code));
    }
});

test("keys: the host sends the hash of the code; the lobby is filed at its hash", async () => {
    const code = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const once = await blake2b(code, 256);
    assert.equal(codeHash(code), `0x${once}`);
    assert.equal(protectedKey(code), `0x${await blake2b(unhex(once), 256)}`);
    // `Option<address>` as `open_lobby` takes it: 0x01, then the 32 bytes as they are.
    const tx = new Transaction();
    tx.pure.option("address", codeHash(code));
    const pure = tx.getData().inputs[0].Pure!.bytes;
    assert.equal(hex(Buffer.from(pure, "base64")), `01${once}`);
    assert.equal(hex(Buffer.from(tx.getData().inputs[0].Pure!.bytes, "base64")).length, 66);
});

test("a lobby's field id: Sui's child id derivation over the key's type tag and bytes", () => {
    const key = protectedKey(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
    for (const kind of ["Open", "Protected"] as const) {
        // TypeTag::Struct (7), the address, the module and the name as strings, no type params.
        const name = new TextEncoder().encode(kind);
        const tag = new Uint8Array([
            7,
            ...unhex(PKG),
            5,
            ...new TextEncoder().encode("lobby"),
            name.length,
            ...name,
            0,
        ]);
        // 0xf0 (child object id scope), parent, the key's length as u64 LE, the key, the tag.
        const preimage = new Uint8Array([
            0xf0,
            ...unhex(LOBBIES),
            32,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            ...unhex(key),
            ...tag,
        ]);
        assert.equal(lobbyFieldId(LOBBIES, PKG, kind, key), `0x${hex(blake2b256(preimage))}`);
        assert.equal(
            lobbyFieldId(LOBBIES, PKG, kind, key),
            deriveDynamicFieldID(LOBBIES, keyType(PKG, kind), unhex(key)),
        );
    }
});

// === Layouts ================================================================

test("Lobby: a fresh protected lobby is 3 bytes, a guest 35, kicked ids follow", () => {
    assert.deepEqual(Lobby.parse(unhex("040000")), { size: 4, guest: null, kicked: [] });
    const withGuest = Lobby.parse(unhex(`0301${id("11")}00`));
    assert.deepEqual(withGuest, { size: 3, guest: `0x${id("11")}`, kicked: [] });
    assert.equal(unhex(`0301${id("11")}00`).length, 35);
    assert.deepEqual(Lobby.parse(unhex(`030001${id("22")}`)), {
        size: 3,
        guest: null,
        kicked: [`0x${id("22")}`],
    });
    const cap = Lobby.parse(unhex(`030010${id("33").repeat(16)}`));
    assert.equal(cap.kicked.length, 16);
    assert.equal(unhex(`030010${id("33").repeat(16)}`).length, 3 + 32 * 16);
});

test("Field<Open, Lobby>: the field's id, the host's Account id, the lobby", () => {
    const field = LobbyField.parse(unhex(`${id("aa")}${id("bb")}0301${id("cc")}00`));
    assert.equal(field.id, `0x${id("aa")}`);
    assert.equal(field.name, `0x${id("bb")}`);
    assert.deepEqual(field.value, { size: 3, guest: `0x${id("cc")}`, kicked: [] });
});

test("Mode: Stakes is tag 0, Friendly { size } tag 1, Ranked { size, tier } tag 2", () => {
    assert.equal(GameMode.parse(unhex("00")).$kind, "Stakes");
    const friendly = GameMode.parse(unhex("0104"));
    assert.ok(friendly.$kind === "Friendly" && friendly.Friendly.size === 4);
    const ranked = GameMode.parse(unhex("020302"));
    assert.ok(ranked.$kind === "Ranked" && ranked.Ranked.size === 3 && ranked.Ranked.tier === 2);
});

/** A `Game` of an empty map, by hand, in field order, ending with `mode`. */
function gameBytes(mode: string, positions = "00") {
    return unhex(
        [
            id("01"), // id
            id("02"), // map.id
            "00", // map.grid.grid: no rows
            "0000", // rows
            "0000", // cols
            "00", // fallen
            "00", // units
            "02", // players: 2
            id("a1"),
            id("a2"),
            "00", // state: Deploying
            "e803000000000000", // until_ms: 1000
            "0000", // turn
            positions, // positions
            "00", // history
            id("03"), // recruits.id
            "0000000000000000", // recruits.size
            mode,
        ].join(""),
    );
}

test("Game: mode is the last field", () => {
    const rated = Game.parse(gameBytes("00"));
    assert.equal(rated.mode.$kind, "Stakes");
    assert.equal(isFriendly(rated), false);
    assert.equal(friendlySize(rated), null);
    const friendly = Game.parse(gameBytes("0104"));
    assert.equal(isFriendly(friendly), true);
    assert.equal(friendlySize(friendly), 4);
    assert.deepEqual(friendly.players, [`0x${id("a1")}`, `0x${id("a2")}`]);
});

test("a friendly game deploys up to its size, and never past the level's positions", () => {
    // positions: two sides of three spawns, each spawn [row, col].
    const side3 = "03" + "020000".repeat(3);
    const game = Game.parse(gameBytes("0104", `02${side3}${side3}`));
    assert.equal(deployCap(game, 0), 3);
    assert.equal(podiumsFor(game, 0, 0), 3);
    const small = Game.parse(gameBytes("0103", `02${"04" + "020000".repeat(4)}${side3}`));
    assert.equal(deployCap(small, 0), 3);
    // Deployed 2 of a size-3 game with 2 positions left: still 3 podiums.
    const after = Game.parse(gameBytes("0103", `02${"02" + "020000".repeat(2)}${side3}`));
    assert.equal(podiumsFor(after, 0, 2), 3);
    const rated = Game.parse(gameBytes("00", `02${side3}${side3}`));
    assert.equal(deployCap(rated, 0), 3);
    assert.equal(podiumsFor(rated, 0, 0), 3);
});

test("a friendly game earns no experience", () => {
    const over = (mode: string) => ({
        ...Game.parse(gameBytes(mode)),
        turn: 5,
        state: { $kind: "Over", Over: { $kind: "Won", Won: `0x${id("a1")}` } },
    });
    assert.equal(experienceFor(over("00") as never, 0), 2);
    assert.equal(experienceFor(over("0103") as never, 0), 0);
});

test("Preset: the level's spawn positions, half a side", () => {
    const bytes = unhex(
        [
            id("05"), // id
            id("06"), // map.id
            "00", // grid
            "0000",
            "0000",
            "00", // fallen
            "00", // units
            "0a", // name: 10 bytes
            Buffer.from("Black Rain").toString("hex"),
            "06" + "020102".repeat(6), // positions: 6 spawns of [row, col]
        ].join(""),
    );
    const preset = Preset.parse(bytes);
    assert.equal(preset.name, "Black Rain");
    assert.equal(preset.positions.length / 2, 3);
});

// === Where a searching Account stands =======================================

const ME = `0x${id("a1")}`;
const HOST = `0x${id("b2")}`;
const lobby = (guest: string | null = null, kicked: string[] = []) => ({ size: 3, guest, kicked });

test("a Searching order names a lobby hosted, a lobby joined, an invite, or the queue", () => {
    assert.deepEqual(placeOf(ME, ME, lobby(), null), { kind: "host-open", size: 3, guest: null });
    assert.deepEqual(placeOf(ME, ME, lobby(HOST), null), {
        kind: "host-open",
        size: 3,
        guest: HOST,
    });
    assert.deepEqual(placeOf(ME, HOST, lobby(ME), null), { kind: "guest", host: HOST, size: 3 });
    const key = protectedKey(new Uint8Array(8));
    assert.deepEqual(placeOf(ME, key, null, lobby()), { kind: "host-invite", size: 3, key });
    assert.deepEqual(placeOf(ME, `0x${id("ee")}`, null, null), { kind: "queue" });
    // An open lobby at the order whose guest is someone else is not this Account's.
    assert.deepEqual(placeOf(ME, HOST, lobby(`0x${id("c3")}`), null), { kind: "queue" });
    // Short and long forms of an id are the same Account.
    assert.equal(placeOf("0x00a1", "0xa1", lobby(), null).kind, "host-open");
});

test("the lifetime: joinable up to since + 600000 inclusive, expired from the next ms", () => {
    assert.equal(expiresAt(1000), 601_000);
    assert.equal(isExpired(1000, 601_000), false);
    assert.equal(isExpired(1000, 601_001), true);
});

test("a guest out of a lobby without leaving: kicked, expired or closed", () => {
    assert.equal(droppedWhy(ME, lobby(null, [ME]), 0, 1000), "kicked");
    assert.equal(droppedWhy(ME, null, 0, 700_000), "expired");
    assert.equal(droppedWhy(ME, lobby(), 0, 1000), "closed");
    assert.equal(droppedWhy(ME, null, null, 1000), "closed");
});

// === Refusals ===============================================================

const longAbort = (module: string, fn: string, code: number) =>
    `MoveAbort(MoveLocation { module: ModuleId { address: ${PKG.slice(2)}, name: Identifier("${module}") }, function: 3, instruction: 12, function_name: Some("${fn}") }, ${code}) in command 0`;

test("aborts read in both forms the network words them", () => {
    assert.deepEqual(abortOf(longAbort("lobby", "join_open", 5)), {
        module: "lobby",
        fn: "join_open",
        code: 5,
    });
    assert.deepEqual(
        abortOf(
            `MoveAbort in 1st command, abort code: 4, in '${PKG}::lobby::join_protected' (instruction 9)`,
        ),
        {
            module: "lobby",
            fn: "join_protected",
            code: 4,
        },
    );
    assert.equal(abortOf("Insufficient gas"), null);
});

test("the contract's refusals as plain lines", () => {
    assert.equal(lobbyRefusal(longAbort("lobby", "join_protected", 2)), "No game with this code");
    assert.equal(lobbyRefusal(longAbort("lobby", "join_protected", 3)), "No game with this code");
    assert.equal(lobbyRefusal(longAbort("lobby", "join_protected", 4)), "This game has expired");
    assert.equal(lobbyRefusal(longAbort("lobby", "join_open", 5)), "This game is full");
    assert.equal(
        lobbyRefusal(longAbort("lobby", "join_open", 6)),
        "The host removed you from this game",
    );
    assert.equal(lobbyRefusal(longAbort("lobby", "join_open", 2)), "This game is closed");
    assert.equal(lobbyRefusal(longAbort("lobby", "start", 4)), "This game has expired");
    assert.equal(lobbyRefusal(longAbort("ghosts", "check_free", 22)), "Hire a squad first");
    assert.equal(
        lobbyRefusal(longAbort("ghosts", "deploy_squad", 28)),
        "Too many recruits for this game",
    );
    assert.equal(lobbyRefusal(longAbort("ghosts", "next_turn", 6)), null);
    assert.equal(lobbyRefusal("Connection reset"), null);
});
