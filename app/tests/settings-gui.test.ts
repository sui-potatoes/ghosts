// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    FLAG_ROWS,
    LEVEL_ROWS,
    levelToSlider,
    panelChanges,
    panelReset,
    rpcForm,
    sliderToLevel,
    stepTab,
    tabOf,
    tabParams,
    TABS,
    type RpcFormInput,
} from "../src/features/settings/model.ts";
import type { Settings } from "../src/settings/store.ts";

// A stand-in for the store's defaults: the model only compares and copies.
const DEFAULTS: Settings = {
    audio: { master: 50, music: 50, sfx: 80, voice: 80, ui: 80, muted: false },
    display: {
        scanlines: true,
        vignette: true,
        reduceMotion: false,
        batterySaver: true,
        wireframe: false,
    },
    controls: {
        bindings: {} as Settings["controls"]["bindings"],
        combat: { fire: ["f"], reload: ["r"] } as unknown as Settings["controls"]["combat"],
        padCombat: { fire: "rt", grenade: "lt" } as unknown as Settings["controls"]["padCombat"],
        layout: "auto",
        layoutAnswered: false,
    },
    network: { rpcUrl: "" },
};

test("?tab= picks a category; anything else is the first", () => {
    assert.equal(tabOf("audio"), "audio");
    assert.equal(tabOf("network"), "network");
    assert.equal(tabOf(null), "player");
    assert.equal(tabOf("nonsense"), "player");
});

test("the first category keeps the URL bare; the others are kept in ?tab=", () => {
    assert.deepEqual(tabParams("player"), {});
    assert.deepEqual(tabParams("controller"), { tab: "controller" });
    for (const t of TABS) assert.equal(tabOf(tabParams(t.id).tab ?? null), t.id);
});

test("the bumpers step through the categories and wrap", () => {
    assert.equal(stepTab("player", 1), "account");
    assert.equal(stepTab("player", -1), "network");
    assert.equal(stepTab("network", 1), "player");
});

test("the seven classic categories, in the classic order", () => {
    assert.deepEqual(
        TABS.map((t) => t.id),
        ["player", "account", "audio", "display", "controls", "controller", "network"],
    );
});

test("level rows cover every audio level; flag rows every display flag", () => {
    const levels = LEVEL_ROWS.map((r) => r.key).sort();
    const audio = Object.keys(DEFAULTS.audio)
        .filter((k) => k !== "muted")
        .sort();
    assert.deepEqual(levels, audio);
    assert.deepEqual(FLAG_ROWS.map((r) => r.key).sort(), Object.keys(DEFAULTS.display).sort());
    // The two channels with a preview sound keep it.
    assert.equal(LEVEL_ROWS.find((r) => r.key === "sfx")?.preview, "effect");
    assert.equal(LEVEL_ROWS.find((r) => r.key === "voice")?.preview, "dialogue");
});

test("a stored level round-trips through the slider", () => {
    for (let level = 0; level <= 100; level += 10)
        assert.equal(sliderToLevel(levelToSlider(level)), level);
    assert.equal(sliderToLevel(0.304), 30);
    assert.equal(sliderToLevel(1.4), 100);
    assert.equal(sliderToLevel(-0.2), 0);
});

test("a panel counts its own changes and resets only its own keys", () => {
    const s: Settings = {
        ...DEFAULTS,
        audio: { ...DEFAULTS.audio, master: 20, muted: true },
        display: { ...DEFAULTS.display, scanlines: false },
        network: { rpcUrl: "https://rpc.example.test" },
    };
    assert.equal(panelChanges("audio", s, DEFAULTS), 2);
    assert.equal(panelChanges("display", s, DEFAULTS), 1);
    const reset = panelReset("audio", s, DEFAULTS);
    assert.deepEqual(reset.audio, DEFAULTS.audio);
    assert.equal(reset.display.scanlines, false);
    assert.equal(reset.network.rpcUrl, "https://rpc.example.test");
});

test("binding panels count changed actions and keep the layout choice", () => {
    const s: Settings = {
        ...DEFAULTS,
        controls: {
            ...DEFAULTS.controls,
            combat: { fire: ["g"], reload: ["r"] } as unknown as Settings["controls"]["combat"],
            padCombat: {
                fire: "lt",
                grenade: "rt",
            } as unknown as Settings["controls"]["padCombat"],
            layout: "controller",
        },
    };
    assert.equal(panelChanges("controls", s, DEFAULTS), 1);
    assert.equal(panelChanges("controller", s, DEFAULTS), 2);
    const reset = panelReset("controller", s, DEFAULTS);
    assert.deepEqual(reset.controls.padCombat, DEFAULTS.controls.padCombat);
    assert.deepEqual(reset.controls.combat, s.controls.combat);
    assert.equal(reset.controls.layout, "controller");
});

const FALLBACK = "https://fullnode.testnet.example";
const form = (patch: Partial<RpcFormInput>) =>
    rpcForm({
        draft: "",
        saved: "",
        status: { kind: "idle" },
        active: FALLBACK,
        fallback: FALLBACK,
        ...patch,
    });

test("the default endpoint: testable, nothing to save or reset", () => {
    const v = form({});
    assert.equal(v.unsaved, false);
    assert.equal(v.reload, false);
    assert.equal(v.testDeny, undefined);
    assert.equal(v.saveDeny, "Already saved");
    assert.equal(v.resetDeny, "Already the default");
    assert.equal(v.line, null);
});

test("a bad URL is refused everywhere and named on the amber line", () => {
    const v = form({ draft: "http://rpc.example.test" });
    assert.equal(v.unsaved, true);
    assert.match(v.testDeny ?? "", /https/);
    assert.equal(v.saveDeny, v.testDeny);
    assert.equal(v.line?.tone, "warn");
});

test("a typed endpoint is unsaved until saved; then it waits for a reload", () => {
    const typed = form({ draft: "https://rpc.example.test/" });
    assert.equal(typed.unsaved, true);
    assert.equal(typed.saveDeny, undefined);
    const saved = form({ draft: "https://rpc.example.test", saved: "https://rpc.example.test" });
    assert.equal(saved.unsaved, false);
    assert.equal(saved.reload, true);
    assert.equal(saved.resetDeny, undefined);
});

test("probe results: ok in the hint, a failure (CSP, wrong chain) on the amber line", () => {
    const ok = form({
        status: { kind: "done", result: { ok: true, latencyMs: 42, chainId: "x" } },
    });
    assert.equal(ok.line?.tone, "ok");
    assert.match(ok.line?.text ?? "", /42 ms/);
    const csp =
        "Blocked by this site's Content-Security-Policy, which does not allow connections to that endpoint.";
    const blocked = form({
        draft: "https://rpc.example.test",
        status: { kind: "done", result: { ok: false, error: csp } },
    });
    assert.deepEqual(blocked.line, { text: csp, tone: "warn" });
    const busy = form({
        draft: "https://rpc.example.test",
        status: { kind: "busy", what: "test" },
    });
    assert.equal(busy.testDeny, "Testing");
    assert.equal(busy.saveDeny, "Testing");
});

test("the Player panel shows the rating from the account and sends the reset to the contract", async () => {
    const { readFileSync } = await import("node:fs");
    const panels = readFileSync(
        new URL("../src/features/settings/panels.tsx", import.meta.url),
        "utf8",
    );
    const record = readFileSync(
        new URL("../src/features/settings/rating-qa.ts", import.meta.url),
        "utf8",
    );
    const block = panels.slice(
        panels.indexOf("export function PlayerPanel"),
        panels.indexOf("function NamePrompt"),
    );
    // The contract keeps no peak: no peak line, no mock store, one confirmation.
    assert.doesNotMatch(block, /Peak|useRating\(|localStorage/);
    for (const label of [
        "Tier",
        "Rating",
        "Ranked games",
        "Record",
        "Budget 3x3",
        "Budget 4x4",
        "Placement left",
        "Resets",
    ])
        assert.ok(block.includes(`label="${label}"`), label);
    assert.equal(block.split("<Prompt").length - 1, 1);
    assert.match(record, /resetRatingTx\(/);
    assert.match(record, /resetDeny\(/);
    assert.doesNotMatch(block, /testnet|on chain|preview|for now/i);
});

test("read-only lines share one label column on every tab, and a label never runs over its value", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(
        new URL("../src/features/settings/settings-gui.css", import.meta.url),
        "utf8",
    );
    const at = css.indexOf(":is(.gset-c2, .gset-c3) .gui-readout {");
    assert.ok(at >= 0);
    const rule = css.slice(at, css.indexOf("/* === Controller diagram"));
    // One definition for every tab, not a Player-only one.
    assert.doesNotMatch(rule, /gset-rank|subgrid/);
    assert.match(rule, /grid-template-columns:/);
    // A label that cannot fit is cut with an ellipsis inside its own column.
    assert.match(rule, /text-overflow: ellipsis/);
    assert.match(rule, /overflow: hidden/);
});

test("the panels and the view share their context through a module neither imports the other from", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (f: string) =>
        readFileSync(new URL(`../src/features/settings/${f}`, import.meta.url), "utf8");
    // A cycle between the view and the panels let a hot reload pair a panel with a stale context.
    assert.doesNotMatch(read("panels.tsx"), /from "\.\/SettingsView"/);
    assert.doesNotMatch(read("frame.tsx"), /from "\.\/(SettingsView|panels)"/);
    assert.match(read("SettingsView.tsx"), /<SettingsProvider value=\{ctx\}>/);
    // The reset prompt and its row are mounted by the Player panel alone, inside the frame.
    for (const f of [
        "../play/PlayScreen.tsx",
        "../play/ranked/RankedView.tsx",
        "../../PauseMenu.tsx",
    ])
        assert.doesNotMatch(read(f), /ResetPrompt|RatingResetRow|RankedBlock|useSettingsContext/);
});
