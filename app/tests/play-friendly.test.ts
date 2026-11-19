// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    CODE_ALPHABET,
    ageLabel,
    bringSquad,
    codeFromId,
    formatCode,
    linkCode,
    parseCode,
    shareLink,
    typingProblem,
    withCheck,
} from "../src/features/play/friendly/model.ts";
import {
    FIXTURES,
    arriveNow,
    hostLobby,
    hostedLobbies,
    joinLobby,
    leaveSession,
    lookupCode,
    openGames,
    phaseOf,
    readSession,
    recentCodes,
    type KV,
} from "../src/features/play/friendly/lobbies.ts";

function memory(): KV {
    const map = new Map<string, string>();
    return {
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
    };
}

const YOU = { name: "you", rating: 1500 };
const T0 = 1_700_000_000_000;
const seq = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length];
};

test("codes are 8 characters from the unambiguous alphabet and deterministic", () => {
    assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
    for (let i = 0; i < 200; i++) {
        const code = codeFromId(`id-${i}`);
        assert.equal(code.length, 8);
        for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch));
        assert.equal(code, codeFromId(`id-${i}`));
        assert.ok(parseCode(code).ok);
    }
    assert.notEqual(codeFromId("a"), codeFromId("b"));
});

test("formatting groups four and four, also while typing", () => {
    assert.equal(formatCode("abcdefgh"), "ABCD-EFGH");
    assert.equal(formatCode("abc"), "ABC");
    assert.equal(formatCode("abcde"), "ABCD-E");
});

test("parsing is tolerant of case, spaces, dashes and a pasted link", () => {
    const code = codeFromId("x");
    const dashed = formatCode(code);
    for (const text of [
        code,
        code.toLowerCase(),
        dashed,
        ` ${dashed.toLowerCase().replace("-", " ")} `,
    ]) {
        const parsed = parseCode(text);
        assert.ok(parsed.ok && parsed.code === code, text);
    }
    const link = parseCode(shareLink(code, "https://x.test"));
    assert.ok(link.ok && link.code === code);
});

test("parsing refuses what is malformed, with a reason", () => {
    const reason = (t: string) => {
        const p = parseCode(t);
        return p.ok ? "ok" : p.problem;
    };
    assert.equal(reason(""), "empty");
    assert.equal(reason("  - "), "empty");
    assert.equal(reason("ABC"), "short");
    assert.equal(reason("ABCDEFGHJ"), "long");
    assert.equal(reason("ABCD-EF0H"), "chars");
    assert.equal(reason("ABCD-EFIH"), "chars");
});

test("the check character catches a typo and a swap", () => {
    const code = withCheck("HARBER2");
    const p = (t: string) => parseCode(t);
    assert.ok(p(code).ok);
    const wrong = code.slice(0, 7) + (code[7] === "2" ? "3" : "2");
    assert.ok(!p(wrong).ok);
    const swapped = "AHRBER2" + code[7];
    assert.ok(!p(swapped).ok);
    assert.equal(typingProblem("ABC"), null);
    assert.equal(typingProblem(""), null);
    assert.ok(typingProblem("ABCD-EF0H"));
});

test("a share link round-trips through the query string", () => {
    const code = codeFromId("y");
    const link = shareLink(code, "https://x.test");
    assert.equal(link, `https://x.test/play/friendly?code=${formatCode(code)}`);
    assert.equal(linkCode(new URL(link).search), formatCode(code));
    assert.equal(linkCode(""), null);
    assert.equal(linkCode("?code="), null);
});

test("ages read in plain units", () => {
    assert.equal(ageLabel(2000), "just now");
    assert.equal(ageLabel(40_000), "40s");
    assert.equal(ageLabel(190_000), "3m");
    assert.equal(ageLabel(7_300_000), "2h");
});

test("the squad brought is the default without a saved one, and sized to the mode", () => {
    const none = bringSquad("saved", null, "4x4", 1500);
    assert.equal(none.kind, "default");
    assert.equal(none.squad.length, 4);
    const saved = bringSquad("saved", [{ role: "Assault", callsign: "VEX" }], "3x3", 1500);
    assert.equal(saved.kind, "saved");
    assert.equal(saved.squad.length, 3);
    assert.deepEqual(saved.names, ["VEX", "Unit 2", "Unit 3"]);
});

test("the open list is deterministic, ages out and is never in the future", () => {
    const a = openGames(T0);
    assert.deepEqual(a, openGames(T0));
    for (const l of a) assert.ok(l.openedAt <= T0);
    let seen = 0;
    let empty = 0;
    for (let t = T0; t < T0 + 3_600_000; t += 10_000) {
        const list = openGames(t);
        seen += list.length;
        if (list.length === 0) empty++;
        for (const l of openGames(t, "3x3")) assert.equal(l.mode, "3x3");
    }
    assert.ok(seen > 0);
    assert.ok(empty < 360);
    // Something open now is gone later.
    const first = openGames(T0)[0];
    if (first) assert.ok(!openGames(T0 + 400_000).some((l) => l.id === first.id));
    assert.notDeepEqual(openGames(T0, "any", 1), openGames(T0, "any", 2));
});

test("hosting: code, arrival, ready, cancel", () => {
    const kv = memory();
    const s = hostLobby(
        kv,
        { mode: "3x3", visibility: "invite", squad: [], names: [], you: YOU },
        T0,
        seq(0.1, 0.5),
    );
    assert.ok(parseCode(s.lobby.code).ok);
    assert.equal(phaseOf(s, T0), "waiting");
    assert.equal(phaseOf(s, s.resolvesAt), "ready");
    assert.equal(readSession(kv)?.lobby.id, s.lobby.id);
    // Skipping the wait.
    const early = arriveNow(kv, T0 + 100);
    assert.equal(phaseOf(early!, T0 + 100), "ready");
    // The code is known in this session, as the host's own.
    const hit = lookupCode(kv, s.lobby.code, T0);
    assert.ok(hit.ok && hit.own);
    leaveSession(kv);
    assert.equal(readSession(kv), null);
    assert.equal(hostedLobbies(kv).length, 1);
    const gone = lookupCode(kv, s.lobby.code, T0);
    assert.ok(!gone.ok && gone.reason === "closed");
});

test("lookup: malformed, unknown, full, fixtures and the open feed", () => {
    const kv = memory();
    const bad = lookupCode(kv, "nope", T0);
    assert.ok(!bad.ok && bad.reason === "malformed");
    const unknown = lookupCode(kv, withCheck("AAAAAAA"), T0);
    assert.ok(!unknown.ok && unknown.reason === "unknown");
    for (const f of FIXTURES) {
        const r = lookupCode(kv, f.code, T0);
        if (f.full) assert.ok(!r.ok && r.reason === "full");
        else assert.ok(r.ok && !r.own && r.lobby.id === f.id);
    }
    const open = openGames(T0)[0];
    if (open) {
        const r = lookupCode(kv, open.code, T0);
        assert.ok(r.ok && r.lobby.id === open.id);
        const later = lookupCode(kv, open.code, T0 + 500_000);
        assert.ok(!later.ok);
    }
});

test("joining: the host starts after a moment, or closes the lobby", () => {
    const kv = memory();
    const ok = FIXTURES.find((f) => !f.full && !f.cancels)!;
    const g = joinLobby(kv, ok, { squad: [], names: [] }, T0);
    assert.equal(g.role, "guest");
    assert.equal(phaseOf(g, T0), "waiting");
    assert.equal(phaseOf(g, g.resolvesAt), "starting");
    assert.deepEqual(recentCodes(kv), [ok.code]);
    const cancels = FIXTURES.find((f) => f.cancels)!;
    const c = joinLobby(kv, cancels, { squad: [], names: [] }, T0);
    assert.equal(phaseOf(c, c.resolvesAt), "cancelled");
    assert.deepEqual(recentCodes(kv), [cancels.code, ok.code]);
});
