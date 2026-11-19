// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    CODE_ALPHABET,
    ageLabel,
    asksBeforeClosing,
    ANY_RULE,
    bringSquad,
    budgetOptions,
    buildsSquad,
    codeFromId,
    defaultRule,
    matchRule,
    parseRule,
    readiness,
    ruleBudget,
    ruleLabel,
    ruleRating,
    ruleShort,
    formatCode,
    linkCode,
    parseCode,
    shareLink,
    typingProblem,
    withCheck,
} from "../src/features/play/friendly/model.ts";
import { defaultSquad, TIERS, tierOf } from "../src/features/play/economy/index.ts";
import {
    FIXTURES,
    arriveNow,
    hostLobby,
    hostedLobbies,
    joinLobby,
    leaveSession,
    lookupCode,
    NEVER,
    openGames,
    opponentState,
    phaseOf,
    readSession,
    recentCodes,
    startBlock,
    updateSquad,
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
    const none = bringSquad("saved", null, "4x4");
    assert.equal(none.kind, "default");
    assert.equal(none.squad.length, 4);
    const saved = bringSquad("saved", [{ role: "Assault", callsign: "VEX" }], "3x3");
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
        {
            mode: "3x3",
            visibility: "invite",
            rule: ANY_RULE,
            squad: [],
            names: [],
            builds: false,
            ready: true,
            you: YOU,
        },
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

test("a host's lobby asks before closing once an opponent is in or the code went out", () => {
    assert.equal(asksBeforeClosing("host", "waiting", false), false);
    assert.equal(asksBeforeClosing("host", "waiting", true), true);
    assert.equal(asksBeforeClosing("host", "ready", false), true);
    assert.equal(asksBeforeClosing("host", "ready", true), true);
    assert.equal(asksBeforeClosing("guest", "waiting", true), false);
    assert.equal(asksBeforeClosing("guest", "starting", false), false);
});

// === The squad rule ===

test("standard budgets come from the tiers, per size, lowest first", () => {
    for (const mode of ["3x3", "4x4"] as const) {
        const options = budgetOptions(mode);
        assert.equal(options.length, TIERS.length);
        options.forEach(([id, label], i) => {
            assert.equal(id, TIERS[i].id);
            assert.equal(label, `${TIERS[i].budget[mode]} cr · ${TIERS[i].name}`);
        });
    }
});

test("a rule maps to a budget, a rating and a label; changing size keeps the tier", () => {
    const rule = { kind: "budget", tier: "contractor" } as const;
    assert.equal(ruleBudget(rule, "3x3"), TIERS[1].budget["3x3"]);
    assert.equal(ruleBudget(rule, "4x4"), TIERS[1].budget["4x4"]);
    assert.equal(ruleRating(rule), TIERS[1].min);
    assert.equal(ruleLabel(rule, "3x3"), `Budget ${TIERS[1].budget["3x3"]} cr · Contractor`);
    assert.equal(ruleBudget(ANY_RULE, "3x3"), null);
    assert.equal(ruleLabel(ANY_RULE, "4x4"), "Any squad");
    // Any unlocks everything: the top tier's rating.
    assert.equal(tierOf(ruleRating(ANY_RULE)).id, TIERS[TIERS.length - 1].id);
    assert.equal(defaultRule(1500).tier, tierOf(1500).id);
    assert.deepEqual(parseRule({ kind: "budget", tier: "nope" }), ANY_RULE);
    assert.deepEqual(matchRule(rule, "3x3"), {
        budget: TIERS[1].budget["3x3"],
        rating: TIERS[1].min,
        label: ruleLabel(rule, "3x3"),
    });
});

test("readiness: a squad is ready when it fits the rule", () => {
    const rookie = { kind: "budget", tier: "rookie" } as const;
    const fit = bringSquad("build", null, "3x3", rookie);
    assert.equal(fit.kind, "build");
    assert.deepEqual(readiness(fit.squad, rookie, "3x3"), []);
    // The same squad on a bigger table is fine; a rookie squad is over a too-small budget.
    const rich = defaultSquad(TIERS[3].min, "3x3");
    assert.ok(readiness(rich, rookie, "3x3").length > 0);
    assert.deepEqual(readiness(rich, ANY_RULE, "3x3"), []);
    assert.equal(buildsSquad(rookie, "saved"), true);
    assert.equal(buildsSquad(ANY_RULE, "saved"), false);
    assert.equal(buildsSquad(ANY_RULE, "build"), true);
});

test("fixtures and the feed carry rules, deterministic from the seed", () => {
    assert.equal(FIXTURES.find((f) => f.code.startsWith("HARBER2"))!.rule.kind, "any");
    assert.ok(FIXTURES.some((f) => f.rule.kind === "budget"));
    const feed = openGames(T0 + 600_000);
    assert.deepEqual(
        feed.map((l) => l.rule),
        openGames(T0 + 600_000).map((l) => l.rule),
    );
    const kinds = new Set(
        Array.from({ length: 40 }, (_, i) =>
            openGames(T0 + i * 20_000).flatMap((l) => l.rule.kind),
        ).flat(),
    );
    assert.deepEqual([...kinds].sort(), ["any", "budget"]);
    for (const l of openGames(T0, "any", 7, "budget")) assert.equal(l.rule.kind, "budget");
    for (const l of openGames(T0, "any", 7, "any")) assert.equal(l.rule.kind, "any");
});

test("lobby lifecycle under a budget: ready follows the squad, Start waits for both", () => {
    const kv = memory();
    const rule = defaultRule(1500);
    const bring = bringSquad("build", null, "3x3", rule);
    const s = hostLobby(
        kv,
        {
            mode: "3x3",
            visibility: "open",
            rule,
            squad: bring.squad,
            names: bring.names,
            builds: true,
            ready: true,
            you: YOU,
        },
        T0,
        seq(0.1, 0.5, 0.5),
    );
    assert.equal(s.lobby.rule, rule);
    assert.equal(startBlock(s, T0), "Waiting for an opponent");
    assert.equal(opponentState(s, s.resolvesAt), "building");
    assert.match(startBlock(s, s.resolvesAt)!, /building a squad/);
    assert.equal(opponentState(s, s.opponentReadyAt), "ready");
    assert.equal(startBlock(s, s.opponentReadyAt), null);
    // The builder reports a squad over budget: not ready, with the reason.
    const over = defaultSquad(TIERS[3].min, "3x3");
    const issues = readiness(over, rule, "3x3");
    const bad = updateSquad(kv, over, issues, T0)!;
    assert.equal(bad.ready, false);
    assert.equal(startBlock(bad, bad.opponentReadyAt), issues[0].message);
    const good = updateSquad(kv, bring.squad, [], T0)!;
    assert.equal(startBlock(good, good.opponentReadyAt), null);
    // Skipping the wait moves readiness with the arrival.
    const early = arriveNow(kv, T0 + 100)!;
    assert.equal(opponentState(early, T0 + 100), "building");
    assert.equal(early.opponentReadyAt - early.resolvesAt, s.opponentReadyAt - s.resolvesAt);
});

test("a guest who is not ready keeps the host from starting until the squad fits", () => {
    const kv = memory();
    const lobby = FIXTURES.find((f) => f.rule.kind === "budget" && !f.full && !f.cancels)!;
    const g = joinLobby(kv, lobby, { squad: [], names: [], builds: true, ready: false }, T0);
    assert.equal(g.resolvesAt, NEVER);
    assert.equal(phaseOf(g, T0 + 1e9), "waiting");
    const ready = updateSquad(kv, [], [], T0 + 5000)!;
    assert.equal(phaseOf(ready, ready.resolvesAt), "starting");
    const again = updateSquad(kv, [], [{ message: "over" }], T0 + 6000)!;
    assert.equal(again.resolvesAt, NEVER);
    // An any-squad guest bringing a saved squad is ready at once.
    const any = FIXTURES.find((f) => f.rule.kind === "any")!;
    const quick = joinLobby(memory(), any, { squad: [], names: [] }, T0);
    assert.ok(quick.ready && quick.resolvesAt < NEVER);
});

test("a narrow row reads the rule short, with its units", () => {
    assert.equal(ruleShort(ANY_RULE, "3x3"), "Any squad");
    const rule = defaultRule(1500);
    assert.equal(ruleShort(rule, "3x3"), `${ruleBudget(rule, "3x3")} cr · ${tierOf(1500).name}`);
    assert.ok(ruleShort(rule, "4x4").length < ruleLabel(rule, "4x4").length);
});

test("the builder's unit names travel with the session", () => {
    const kv = memory();
    const rule = defaultRule(1500);
    const bring = bringSquad("build", null, "3x3", rule);
    hostLobby(
        kv,
        {
            mode: "3x3",
            visibility: "invite",
            rule,
            squad: bring.squad,
            names: bring.names,
            builds: true,
            ready: true,
            you: YOU,
        },
        T0,
        seq(0.1, 0.5, 0.5),
    );
    const named = updateSquad(kv, bring.squad, [], T0, ["Marksman", "Runner", "Heavy"])!;
    assert.deepEqual(named.labels, ["Marksman", "Runner", "Heavy"]);
    assert.deepEqual(readSession(kv)!.labels, ["Marksman", "Runner", "Heavy"]);
});
