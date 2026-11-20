// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly lobbies: the decoders against bytes Move wrote, the keys and codes, the seven calls'
 * argument order, and the agent through the sandbox.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID, normalizeSuiAddress } from "@mysten/sui/utils";

import { GhostsAgent, playGames } from "../src/agent.ts";
import { AccountBcs, decodeAccount, decodeGame, GameBcs, LobbyBcs, LobbyField, ModeBcs } from "../src/bcs.ts";
import { blake2b256 } from "../src/blake2b.ts";
import { referencePolicy } from "../src/bot.ts";
import {
    closeLobbyTx,
    closeLobbyWithGuestTx,
    joinLobbyTx,
    joinOpenTx,
    kickGuestTx,
    leaveLobbyTx,
    openLobbyTx,
    startFriendlyTx,
    type Deployment,
} from "../src/contract.ts";
import {
    classifySearch,
    codeHash,
    CODE_ALPHABET,
    CODE_LENGTH,
    encodeCode,
    formatCode,
    findInviteHost,
    formatInvite,
    type InviteReads,
    LOBBY_LIFETIME_MS,
    lobbyExpired,
    lobbyExpiresAtMs,
    newInviteCode,
    openLobbyId,
    parseCode,
    parseInvite,
    protectedKey,
    protectedKeyOf,
    protectedLobbyId,
} from "../src/lobby.ts";
import { parseCommand, runCommand } from "../src/play.ts";
import { createMcpServer } from "../src/mcp.ts";
import { createSandbox, SANDBOX_INVITE, SANDBOX_PEER_HOST, type SandboxOptions } from "../src/sandbox.ts";
import { ActionError } from "../src/types.ts";
import { pollingWake } from "../src/wake.ts";
import { FIXTURES, LOBBY } from "./fixtures.ts";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
const fast = { wake: pollingWake(1) };

const D: Deployment = {
    package: "0x1",
    registry: "0x2",
    matchmaker: "0x3",
    preset: "0x4",
    lobbies: "0x5",
    names: { package: "0x6", suins: "0x7", instance: "0x8", domain: "demo.ghosts.sui" },
};
const HOST = `0x${"a".repeat(64)}`;
const GUEST = `0x${"b".repeat(64)}`;

// === Decoders against Move's bytes ===

test("a game carries its mode last: rated, or friendly with its size", () => {
    for (const name of ["gameDeploying", "gamePlayingT0", "gameOverWonFallen"] as const) {
        assert.deepEqual(decodeGame(bytes(FIXTURES[name]), "1").mode, { kind: "rated" });
    }
    const invite = decodeGame(bytes(FIXTURES.gameFriendlyDeploying), "1");
    assert.deepEqual(invite.mode, { kind: "friendly", size: 3 });
    assert.deepEqual(invite.players, [LOBBY.friendly.alice, LOBBY.friendly.bob]);
    assert.equal(invite.status.kind, "deploying");
    assert.deepEqual(
        decodeGame(bytes(FIXTURES.gameFriendlyListedDeploying), "1").mode,
        { kind: "friendly", size: 4 },
    );
    assert.equal(decodeGame(bytes(FIXTURES.gameFriendlyPlaying), "1").status.kind, "active");
    assert.deepEqual(ModeBcs.serialize({ Friendly: { size: 4 } }).toBytes(), Uint8Array.from([1, 4]));
    assert.deepEqual(ModeBcs.serialize({ Rated: null }).toBytes(), Uint8Array.from([0]));
});

test("in a friendly game the fallen stay in the map's fallen until completion", () => {
    const game = decodeGame(bytes(FIXTURES.gameFriendlyOverFallen), "1");
    assert.equal(game.status.kind, "finished");
    assert.equal(game.fallen.length, 1);
    assert.equal(game.mode.kind, "friendly");
});

test("every Move-written lobby value reserializes to the same bytes", () => {
    for (const [schema, value] of [
        [GameBcs, FIXTURES.gameFriendlyDeploying],
        [GameBcs, FIXTURES.gameFriendlyPlaying],
        [GameBcs, FIXTURES.gameFriendlyOverFallen],
        [GameBcs, FIXTURES.gameFriendlyListedDeploying],
        [LobbyBcs, FIXTURES.lobbyFresh],
        [LobbyBcs, FIXTURES.lobbyGuest],
        [LobbyBcs, FIXTURES.lobbyKicked],
        [LobbyBcs, FIXTURES.lobbyGuestAndKicked],
        [AccountBcs, FIXTURES.accountHostingInvite],
        [AccountBcs, FIXTURES.accountGuestWaiting],
        [AccountBcs, FIXTURES.accountFriendlyPlaying],
        [AccountBcs, FIXTURES.accountLobbyProtectedHost],
        [AccountBcs, FIXTURES.accountLobbyOpenHost],
        [AccountBcs, FIXTURES.accountLobbyGuest],
    ] as const) {
        const parsed = (schema as typeof GameBcs).parse(bytes(value));
        assert.equal(Buffer.from(schema.serialize(parsed as never).toBytes()).toString("hex"), value);
    }
});

test("the lobby values decode: fresh, with a guest, with kicked", () => {
    assert.deepEqual(LobbyBcs.parse(bytes(FIXTURES.lobbyFresh)), { size: 4, guest: null, kicked: [] });
    assert.deepEqual(LobbyBcs.parse(bytes(FIXTURES.lobbyGuest)), { size: 3, guest: LOBBY.bob, kicked: [] });
    assert.deepEqual(LobbyBcs.parse(bytes(FIXTURES.lobbyKicked)), { size: 3, guest: null, kicked: [LOBBY.bob] });
    assert.deepEqual(LobbyBcs.parse(bytes(FIXTURES.lobbyGuestAndKicked)), {
        size: 3,
        guest: LOBBY.dave,
        kicked: [LOBBY.bob],
    });
    assert.equal(bytes(FIXTURES.lobbyFresh).length, 3);
    assert.equal(bytes(FIXTURES.lobbyGuest).length, 35);
});

test("a dynamic field of a lobby is its key, then the lobby", () => {
    const field = bcsField(LOBBY.alice, FIXTURES.lobbyGuest);
    const parsed = LobbyField.parse(field);
    assert.equal(parsed.id, `0x${"11".repeat(32)}`);
    assert.equal(parsed.name, LOBBY.alice);
    assert.equal(parsed.value.guest, LOBBY.bob);
});

function bcsField(key: string, value: string): Uint8Array {
    return Uint8Array.from([...bytes(`11`.repeat(32)), ...bytes(key), ...bytes(value)]);
}

test("an Account's search is read as a lobby's key or a queue ticket by lookup", () => {
    const host = decodeAccount(bytes(FIXTURES.accountLobbyOpenHost));
    assert.deepEqual(host.search, { kind: "searching", order: LOBBY.alice, sinceMs: 7000 });
    const invite = decodeAccount(bytes(FIXTURES.accountLobbyProtectedHost));
    assert.equal(invite.search.kind === "searching" && invite.search.order, LOBBY.protectedKey);
    const guest = decodeAccount(bytes(FIXTURES.accountLobbyGuest));
    assert.deepEqual(guest.search, { kind: "searching", order: LOBBY.alice, sinceMs: 8000 });
});

// === Keys and codes ===

test("the code hashes the way Move hashes it: blake2b256, twice for the key", () => {
    const code = bytes(LOBBY.code);
    assert.equal(codeHash(code), LOBBY.codeHash);
    assert.equal(protectedKey(code), LOBBY.protectedKey);
    assert.equal(protectedKeyOf(LOBBY.codeHash), LOBBY.protectedKey);
    // the hash used as the code is another lobby: the contract refuses it
    assert.notEqual(protectedKey(bytes(LOBBY.codeHash)), LOBBY.protectedKey);
    // the Account of the Move test searches on exactly this key
    const carol = AccountBcs.parse(bytes(FIXTURES.accountLobbyProtectedHost));
    assert.equal(carol.state.$kind === "Searching" && carol.state.Searching.order, LOBBY.protectedKey);
});

test("blake2b256 matches the reference vectors across block boundaries", () => {
    const vectors: [number, string][] = [
        [0, "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8"],
        [200, "a64872c9122a9e37335f16b285daa3fcfdf5eb1ee4e5c83c72610e5a0e370767"],
    ];
    for (const [length, expected] of vectors) {
        assert.equal(Buffer.from(blake2b256(new Uint8Array(length).fill(7))).toString("hex"), expected);
    }
});

test("a new invite code is 8 random bytes", () => {
    const a = newInviteCode();
    assert.equal(a.length, 8);
    assert.notDeepEqual(a, newInviteCode());
});

test("the field IDs of the lobbies follow the standard dynamic field derivation", () => {
    const home = { package: D.package, lobbies: D.lobbies };
    const open = openLobbyId(home, HOST);
    assert.match(open, /^0x[0-9a-f]{64}$/);
    assert.equal(
        open,
        deriveDynamicFieldID(D.lobbies, `${D.package.replace("0x", "0x" + "0".repeat(63))}::lobby::Open`, bytes(HOST)),
    );
    assert.notEqual(open, protectedLobbyId(home, HOST), "the two key types never share a field");
    assert.notEqual(open, openLobbyId({ ...home, lobbies: "0x6" }, HOST));
});

test("the field IDs match what a local node held: found among the Lobbies' dynamic fields", () => {
    // read off a local network: a listed lobby and an invite-only one, each ID listed and fetched there
    const home = { package: "0x1c45c8f00feb892f73fc273cc77595a6fb69aa80bfb9a68f4307fee715bcd8b8", lobbies: "0x15debf10a184f05a3894bdef581d96d4aa40bdd2e6b9647472d6b3a6b693a94e" };
    assert.equal(openLobbyId(home, "0xf2542a10b0eb2ee028cad758d73167c5ae010e2bd4ff6d6646cee8dca4a2ef8f"), "0xece72e6c026762c256703d49884daaf7027547df41cede7efa4bbd6d019a9a82");
    const code = bytes("f2dcfd479821ff79");
    assert.equal(protectedKey(code), "0x51205213d8f95f5a0d0d128e265e8cdef524cd961f3079ef7f9bdfed198e0eb2");
    assert.equal(protectedLobbyId(home, protectedKey(code)), "0x8c39df4a924d5a46a2d0a9ac930a40d214b22e16a81c74f0b786fc0356f03a27");
});

test("a code's text is 13 characters of the app's alphabet, grouped 4-4-5", () => {
    assert.equal(CODE_ALPHABET.length, 31);
    const zero = encodeCode(new Uint8Array(8));
    assert.equal(zero, "2".repeat(CODE_LENGTH));
    assert.equal(formatCode(zero), "2222-2222-22222");
    const max = encodeCode(new Uint8Array(8).fill(255));
    assert.equal(max.length, 13);
    assert.ok(max[0] <= "S", "the first character stays low: 31^13 only just clears 2^64");
    for (let i = 0; i < 200; i++) {
        const code = newInviteCode();
        const text = encodeCode(code);
        assert.equal(text.length, 13);
        const parsed = parseCode(formatCode(text).toLowerCase().replace(/-/g, " "));
        assert.ok(parsed.ok);
        if (parsed.ok) assert.deepEqual(parsed.code, code);
    }
    assert.equal(formatCode("abcd"), "ABCD");
    assert.equal(formatCode("abcdefghj"), "ABCD-EFGH-J");
});

test("a text that is no code says why", () => {
    const problem = (text: string) => {
        const parsed = parseCode(text);
        return parsed.ok ? "ok" : parsed.problem;
    };
    assert.equal(problem(""), "empty");
    assert.equal(problem("2222-2222-0222"), "chars");
    assert.equal(problem("2222-2222-2222"), "short");
    assert.equal(problem("2222-2222-22222-2"), "long");
    assert.equal(problem("ZZZZ-ZZZZ-ZZZZZ"), "range");
});

test("an invite is the host's Account and the code, and reads back", () => {
    const code = bytes(LOBBY.code);
    const text = formatInvite(HOST, code);
    assert.equal(text, `${HOST}:${formatCode(encodeCode(code))}`);
    assert.deepEqual(parseInvite(text), { host: HOST, code });
    assert.deepEqual(parseInvite(text.replace(":", " ").toLowerCase()), { host: HOST, code });
    assert.equal(parseInvite("ABCD"), null);
    assert.equal(parseInvite(`${HOST}:nope`), null);
});

test("a lobby expires strictly past 600 seconds from the host's search", () => {
    assert.equal(LOBBY_LIFETIME_MS, 600_000);
    assert.equal(lobbyExpired(1000, 601_000), false);
    assert.equal(lobbyExpired(1000, 601_001), true);
    assert.equal(lobbyExpiresAtMs(1000), 601_001);
});

// === Telling a search apart ===

test("a search is classified by lookup, in the order the contract's keys allow", async () => {
    const none = {
        open: async () => null,
        protectedExists: async () => false,
        seatWaiting: async () => false,
    };
    assert.deepEqual(await classifySearch(HOST, HOST, { ...none, open: async () => ({ guest: null }) }), {
        kind: "hosting_open",
    });
    assert.deepEqual(
        await classifySearch(GUEST, HOST, { ...none, open: async () => ({ guest: GUEST }) }),
        { kind: "guest", host: HOST },
    );
    assert.deepEqual(await classifySearch(HOST, "0x77", { ...none, protectedExists: async () => true }), {
        kind: "hosting_invite",
    });
    assert.deepEqual(await classifySearch(HOST, "0x77", none), { kind: "queued" });
    assert.deepEqual(await classifySearch(HOST, "0x77", { ...none, seatWaiting: async () => true }), {
        kind: "seat_waiting",
    });
    // an open lobby of someone else with another guest says nothing of this Account
    assert.deepEqual(
        await classifySearch(GUEST, HOST, { ...none, open: async () => ({ guest: `0x${"c".repeat(64)}` }) }),
        { kind: "queued" },
    );
});

// === The seven calls ===

function calls(tx: Transaction) {
    const data = tx.getData();
    return data.commands.map((command) => {
        assert.equal(command.$kind, "MoveCall");
        const call = command.MoveCall!;
        return {
            target: `${call.module}::${call.function}`,
            args: call.arguments.map((arg) => {
                if (arg.$kind !== "Input") return "result";
                const input = data.inputs[arg.Input];
                return input.$kind === "UnresolvedObject"
                    ? `obj:${input.UnresolvedObject.objectId}`
                    : "pure";
            }),
        };
    });
}

const obj = (id: string) => `obj:${normalizeSuiAddress(id)}`;
const CLOCK = obj("0x6");

test("open_lobby: lobbies, account, clock, then the size and the optional code hash", () => {
    const [call] = calls(openLobbyTx(D, HOST, 3));
    assert.equal(call.target, "ghosts::open_lobby");
    assert.deepEqual(call.args, [obj("0x5"), obj(HOST), CLOCK, "pure", "pure"]);
    const tx = openLobbyTx(D, HOST, 4, bytes(LOBBY.code));
    const pure = tx.getData().inputs.filter((input) => input.$kind === "Pure");
    assert.equal(pure.length, 2);
    // Option<address> as `0x01 ++ the hash of the code`, and the size
    const optionBytes = Buffer.from(pure[1].Pure!.bytes, "base64");
    assert.equal(optionBytes.toString("hex"), `01${LOBBY.codeHash.slice(2)}`);
    assert.equal(Buffer.from(pure[0].Pure!.bytes, "base64").toString("hex"), "04");
    const listed = openLobbyTx(D, HOST, 3).getData().inputs.filter((i) => i.$kind === "Pure");
    assert.equal(Buffer.from(listed[1].Pure!.bytes, "base64").toString("hex"), "00");
});

test("join_lobby: lobbies, preset, host, account, clock, then the raw code", () => {
    const tx = joinLobbyTx(D, GUEST, HOST, bytes(LOBBY.code));
    const [call] = calls(tx);
    assert.equal(call.target, "ghosts::join_lobby");
    assert.deepEqual(call.args, [obj("0x5"), obj("0x4"), obj(HOST), obj(GUEST), CLOCK, "pure"]);
    const [code] = tx.getData().inputs.filter((input) => input.$kind === "Pure");
    assert.equal(Buffer.from(code.Pure!.bytes, "base64").toString("hex"), `08${LOBBY.code.slice(2)}`);
});

test("join_open, leave_lobby, kick_guest, start_friendly and close_lobby take their objects in order", () => {
    assert.deepEqual(calls(joinOpenTx(D, GUEST, HOST)), [
        { target: "ghosts::join_open", args: [obj("0x5"), obj(HOST), obj(GUEST), CLOCK] },
    ]);
    assert.deepEqual(calls(leaveLobbyTx(D, GUEST)), [
        { target: "ghosts::leave_lobby", args: [obj("0x5"), obj(GUEST)] },
    ]);
    assert.deepEqual(calls(kickGuestTx(D, HOST, GUEST)), [
        { target: "ghosts::kick_guest", args: [obj("0x5"), obj(HOST), obj(GUEST), CLOCK] },
    ]);
    assert.deepEqual(calls(startFriendlyTx(D, HOST, GUEST)), [
        { target: "ghosts::start_friendly", args: [obj("0x5"), obj("0x4"), obj(HOST), obj(GUEST), CLOCK] },
    ]);
    assert.deepEqual(calls(closeLobbyTx(D, HOST)), [
        { target: "ghosts::close_lobby", args: [obj("0x5"), obj(HOST), CLOCK] },
    ]);
});

test("cleaning up an expired lobby with a guest is one transaction: kick, then close", () => {
    assert.deepEqual(calls(closeLobbyWithGuestTx(D, HOST, GUEST)), [
        { target: "ghosts::kick_guest", args: [obj("0x5"), obj(HOST), obj(GUEST), CLOCK] },
        { target: "ghosts::close_lobby", args: [obj("0x5"), obj(HOST), CLOCK] },
    ]);
});

// === The agent, on the sandbox ===

/** An agent on a sandbox whose clock the test moves. */
async function named(options: SandboxOptions = {}) {
    const agent = new GhostsAgent(createSandbox({ seed: 3, ...options }), {
        ...fast,
        now: options.now,
    });
    await agent.setName("lobby-tester");
    await agent.setup();
    return agent;
}

test("a listed lobby: a guest takes the slot, the host starts, the game is friendly", async () => {
    const agent = await named({ guest: true });
    const { situation, invite } = await agent.hostLobby({ size: 3 });
    assert.equal(invite, undefined);
    assert.equal(situation.phase, "lobby_hosting");
    assert.equal(situation.actionable, true, "a guest is waiting");
    assert.equal(situation.lobby?.role, "hosting_open");
    assert.ok(situation.lobby?.guest);
    assert.equal((await agent.backend.searchRole())?.kind, "hosting_open");

    const started = await agent.startFriendly();
    assert.equal(started.phase, "deploy");
    const { state, side } = await agent.current();
    assert.equal(side, 0, "the host goes first");
    assert.deepEqual(state.mode, { kind: "friendly", size: 3 });
    assert.equal((await agent.observe()).mode.kind, "friendly");
});

test("an invite lobby starts the game when the guest joins, and the invite comes back once", async () => {
    const agent = await named({ guest: true });
    const { situation, invite } = await agent.hostLobby({ size: 4, invite: true });
    assert.equal(situation.phase, "deploy", "the sandbox's guest joined at once");
    assert.match(invite!.code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{5}$/);
    assert.equal(invite!.text, `${invite!.host}:${invite!.code}`);
    assert.deepEqual((await agent.current()).state.mode, { kind: "friendly", size: 4 });
});

test("an invite lobby waits for its guest, and the host closes it", async () => {
    const agent = await named();
    const { situation } = await agent.hostLobby({ invite: true });
    assert.equal(situation.phase, "lobby_hosting");
    assert.equal(situation.actionable, false);
    assert.equal(situation.lobby?.role, "hosting_invite");
    assert.ok((situation.lobby?.expiresInMs ?? 0) > 0);
    await assert.rejects(agent.findGame(), (e: ActionError) => e.code === "rejected");
    await assert.rejects(agent.cancelSearch(), (e: ActionError) => e.code === "rejected");
    assert.equal((await agent.closeLobby()).phase, "idle");
    await assert.rejects(agent.closeLobby(), (e: ActionError) => e.code === "no_lobby");
});

test("a lobby has 3 or 4 recruits a side", async () => {
    const agent = await named();
    for (const size of [2, 5, 3.5]) {
        await assert.rejects(agent.hostLobby({ size }), (e: ActionError) => e.code === "bad_action");
    }
});

test("kick, leave and close in a listed lobby", async () => {
    const agent = await named({ guest: true });
    await agent.hostLobby({ size: 3 });
    const kicked = await agent.kickGuest();
    assert.equal(kicked.actionable, false, "the slot is free again");
    assert.equal((await agent.lobby((await agent.backend.account())!.id))?.kicked.length, 1);
    await assert.rejects(agent.kickGuest(), (e: ActionError) => e.code === "no_lobby");
    await assert.rejects(agent.startFriendly(), (e: ActionError) => e.code === "no_lobby");
    assert.equal((await agent.closeLobby()).phase, "idle");
});

test("the listed lobbies, and joining one: the host starts, or kicks", async () => {
    let now = 1_000_000;
    const agent = await named({ now: () => now });
    const lobbies = await agent.lobbies();
    assert.deepEqual(lobbies.map((l) => [l.host, l.size, l.full]), [[SANDBOX_PEER_HOST, 3, false]]);
    assert.equal(lobbies[0].hostName, "sparring-partner");

    const joined = await agent.joinOpen(SANDBOX_PEER_HOST);
    assert.equal(joined.phase, "lobby_guest");
    assert.equal(joined.lobby?.host, SANDBOX_PEER_HOST);
    assert.equal(joined.actionable, false);
    assert.equal((await agent.backend.searchRole())?.kind, "guest");
    // the host answers: it starts the game
    now += 5_000;
    const started = await agent.wait({ timeoutMs: 1000 });
    assert.equal(started.phase, "deploy", "the host started the game and deployed; our squad is next");
    assert.equal((await agent.current()).side, 1);
});

test("a kicked guest is refused and can leave", async () => {
    let now = 1_000_000;
    const agent = await named({ peerKicks: true, now: () => now });
    await agent.joinOpen(SANDBOX_PEER_HOST);
    now += 5_000;
    assert.equal((await agent.situation()).phase, "idle", "kicked: the account is idle again");
    await assert.rejects(agent.joinOpen(SANDBOX_PEER_HOST), (e: ActionError) => e.code === "rejected");
    assert.equal((await agent.lobbies()).length, 0);
    const leaver = await named();
    await leaver.joinOpen(SANDBOX_PEER_HOST);
    assert.equal((await leaver.leaveLobby()).phase, "idle");
    await assert.rejects(leaver.leaveLobby(), (e: ActionError) => e.code === "rejected");
});

test("joining an invite by host and code, in either form", async () => {
    const inviteText = formatInvite(SANDBOX_INVITE.host, SANDBOX_INVITE.code);
    const agent = await named();
    assert.equal((await agent.joinInvite(inviteText)).phase, "deploy", "the game starts at once");
    assert.deepEqual((await agent.current()).state.mode, { kind: "friendly", size: 3 });

    const again = await named();
    const code = formatCode(encodeCode(SANDBOX_INVITE.code)).toLowerCase();
    assert.equal((await again.joinInvite(SANDBOX_INVITE.host, code)).phase, "deploy");

    const wrong = await named();
    await assert.rejects(wrong.joinInvite(SANDBOX_INVITE.host, "2222-2222-22222"), (e: ActionError) => e.code === "rejected");
    await assert.rejects(wrong.joinInvite(HOST, formatCode(encodeCode(SANDBOX_INVITE.code))), (e: ActionError) => e.code === "rejected");
    await assert.rejects(wrong.joinInvite("nonsense"), (e: ActionError) => e.code === "bad_action");
    await assert.rejects(wrong.joinInvite(HOST, "nonsense"), (e: ActionError) => e.code === "bad_action");
});

test("a lobby account cannot find a game or cancel a search, and a queued one cannot host", async () => {
    const queued = await named({ empty: true });
    await queued.findGame();
    await assert.rejects(queued.hostLobby(), (e: ActionError) => e.code === "rejected");
    await assert.rejects(queued.joinOpen(SANDBOX_PEER_HOST), (e: ActionError) => e.code === "rejected");
    assert.equal((await queued.backend.searchRole())?.kind, "queued");
    await assert.rejects(queued.closeLobby(), (e: ActionError) => e.code === "no_lobby");

    const host = await named();
    await host.hostLobby();
    await assert.rejects(host.findGame(), (e: ActionError) => e.code === "rejected");
    await assert.rejects(host.hostLobby(), (e: ActionError) => e.code === "rejected");
});

test("an expired lobby is closed by a stranger's clean up, and waiting never auto-cancels it", async () => {
    let now = 1_000_000;
    const agent = new GhostsAgent(createSandbox({ seed: 3, now: () => now, guest: true }), {
        ...fast,
        now: () => now,
    });
    await agent.setName("lobby-tester");
    await agent.setup();
    const id = (await agent.backend.account())!.id;
    await agent.hostLobby();
    await assert.rejects(agent.cleanUpLobby(id), (e: ActionError) => e.code === "rejected");

    now += LOBBY_LIFETIME_MS + 1;
    // past the search timeout of the queue, a lobby is not cancelled: it expires on its own terms
    const situation = await agent.wait({ timeoutMs: 50 });
    assert.equal(situation.phase, "lobby_hosting");
    assert.equal(situation.lobby?.expiresInMs, 0);
    assert.ok(situation.next.includes("expired"));
    await assert.rejects(agent.startFriendly(), (e: ActionError) => e.code === "rejected");
    assert.equal((await agent.cleanUpLobby(id)).phase, "idle");
});

test("a friendly game is played to the end for nothing: no score, no rating, every recruit home", async () => {
    for (const seed of [1, 2, 3]) {
        const agent = new GhostsAgent(createSandbox({ seed, guest: true }), fast);
        await agent.setName("friendly-bot");
        await agent.setup();
        const before = await agent.backend.account();
        await agent.hostLobby({ size: 3, invite: true });
        const { state } = await agent.current();
        assert.equal(state.mode.kind, "friendly");

        const { played } = await playGames(agent, referencePolicy, {
            games: 1,
            signal: AbortSignal.timeout(20_000),
        });
        assert.equal(played, 1);
        const after = (await agent.backend.account())!;
        assert.deepEqual(after.score, before!.score, "no score");
        assert.equal(after.rating, before!.rating);
        assert.equal(after.suspendedUntilMs, 0);
        assert.equal(after.recruits, before!.recruits, "the fallen are home too");
        assert.equal(after.search.kind, "idle");
    }
});

test("a rated game still works after a friendly one", async () => {
    const agent = new GhostsAgent(createSandbox({ seed: 4, guest: true }), fast);
    await agent.setName("both-modes");
    await agent.setup();
    await agent.hostLobby({ invite: true });
    await playGames(agent, referencePolicy, { games: 1, signal: AbortSignal.timeout(20_000) });
    assert.equal((await agent.findGame()).phase, "deploy");
    assert.deepEqual((await agent.current()).state.mode, { kind: "rated" });
});

test("a friendly game deploys 1 to its size, and a rated one all its positions", async () => {
    const agent = await named({ guest: true });
    await agent.hostLobby({ size: 3, invite: true });
    const { state } = await agent.current();
    assert.equal(state.positions[0].length, 3, "Black Rain has three spawns a side");
    const { receipt } = await agent.act(["deploy"]);
    assert.equal(receipt.records.length, 3);
});

// === Tools and the shell ===

async function connect() {
    const agent = await named();
    const server = createMcpServer(agent);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        const [{ text }] = result.content as { text: string }[];
        // a call the schema refuses is answered with plain text
        return { isError: !!result.isError, body: text.startsWith("{") ? JSON.parse(text) : text };
    };
}

test("the tools host, list, join, leave and close", async () => {
    const call = await connect();
    const hosted = await call("ghosts_host_lobby", { invite: true, size: 4 });
    assert.equal(hosted.body.situation.phase, "lobby_hosting");
    assert.match(hosted.body.invite.text, /^0x[0-9a-f]{64}:/);
    assert.equal((await call("ghosts_close_lobby")).body.phase, "idle");

    assert.equal((await call("ghosts_list_lobbies")).body.lobbies[0].host, SANDBOX_PEER_HOST);
    assert.equal((await call("ghosts_join_open", { host: SANDBOX_PEER_HOST })).body.phase, "lobby_guest");
    assert.equal((await call("ghosts_leave_lobby")).body.phase, "idle");

    const invite = formatInvite(SANDBOX_INVITE.host, SANDBOX_INVITE.code);
    assert.equal((await call("ghosts_join_invite", { invite })).body.phase, "deploy");
    assert.equal((await call("ghosts_host_lobby", { size: 9 })).isError, true, "out of the schema");
});

test("the shell hosts, lists, joins, kicks, starts, leaves, closes and cleans up", async () => {
    const parse = (line: string) => parseCommand(line.split(" "));
    assert.deepEqual(parse("host --size 4 --invite").flags, { size: 4, invite: true });
    assert.throws(() => parse("host --size 9"), (e: ActionError) => e.code === "bad_action");

    const agent = await named({ guest: true });
    const run = (line: string) => runCommand(agent, parse(line));
    assert.equal(((await run("host")) as any).situation.phase, "lobby_hosting");
    assert.equal(((await run("kick")) as any).phase, "lobby_hosting");
    assert.equal(((await run("close")) as any).phase, "idle");
    assert.equal(((await run("lobbies")) as any).lobbies.length, 1);
    assert.equal(((await run(`join-open ${SANDBOX_PEER_HOST}`)) as any).phase, "lobby_guest");
    assert.equal(((await run("leave")) as any).phase, "idle");
    const invite = formatInvite(SANDBOX_INVITE.host, SANDBOX_INVITE.code);
    assert.equal(((await run(`join ${invite}`)) as any).phase, "deploy");
    await assert.rejects(run("join"), (e: ActionError) => e.code === "bad_action");
    await assert.rejects(run("cleanup"), (e: ActionError) => e.code === "bad_action");
});

// === The host behind a code ===

test("the host behind a code: the Account the opening transaction wrote, searching on the key", async () => {
    const code = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
    const key = protectedKey(code);
    const asked: string[] = [];
    const reads: InviteReads = {
        async fieldTransaction(at) {
            asked.push(at);
            return at === normalizeSuiAddress(key) ? "digest-open" : null;
        },
        async writtenAccounts(digest) {
            assert.equal(digest, "digest-open");
            return [
                { id: GUEST, order: null },
                { id: HOST, order: key },
            ];
        },
    };
    assert.equal(await findInviteHost(code, reads), HOST);
    assert.deepEqual(asked, [normalizeSuiAddress(key)], "the lobby is read at the double hash");

    // no lobby under the code
    assert.equal(await findInviteHost(Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1]), reads), null);
    // the transaction wrote no Account searching on the key (a queue order is not a lobby key)
    const elsewhere: InviteReads = {
        fieldTransaction: async () => "digest-open",
        writtenAccounts: async () => [{ id: HOST, order: HOST }, { id: GUEST, order: null }],
    };
    assert.equal(await findInviteHost(code, elsewhere), null);
});

test("joining with the code alone looks the host up; host:code skips the lookup", async () => {
    const inviteCode = formatCode(encodeCode(SANDBOX_INVITE.code));
    const alone = await named();
    assert.equal((await alone.joinInvite(inviteCode)).phase, "deploy");

    const full = await named();
    assert.equal((await full.joinInvite(formatInvite(SANDBOX_INVITE.host, SANDBOX_INVITE.code))).phase, "deploy");

    // a code that opens nothing: no lobby, and no guess at a host
    const unknown = await named();
    await assert.rejects(unknown.joinInvite("2222-2222-22222"), (e: ActionError) => e.code === "no_lobby");
    await assert.rejects(unknown.joinInvite("nonsense"), (e: ActionError) => e.code === "bad_action");

    // a failing lookup falls back to the given host
    const backend = createSandbox();
    const fallback = new GhostsAgent({ ...backend, inviteHost: async () => { throw new Error("down"); } }, fast);
    await fallback.setName("fallback");
    await fallback.setup();
    assert.equal((await fallback.joinInvite(SANDBOX_INVITE.host, inviteCode)).phase, "deploy");
    await assert.rejects(fallback.joinInvite(inviteCode), (e: ActionError) => e.code === "no_lobby");
});
