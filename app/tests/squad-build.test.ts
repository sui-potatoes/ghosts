// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    add,
    BUILT_INS,
    complete,
    copyName,
    fromSquad,
    gaps,
    load,
    MAX_PRESETS,
    modified,
    PRESETS_KEY,
    presetCost,
    rename,
    resolve,
    store,
    type Preset,
} from "../src/features/ui-sample/presets.ts";
import {
    buildMarker,
    costLines,
    deployRefusal,
    loadoutCost,
    squadCost,
    type Loadout,
} from "../src/features/ui-sample/squad-build.ts";

const standard: Loadout = { primary: "mx4", mods: {}, armor: "spectre", utility: "frag" };

test("a loadout costs its operative plus each item (sample table)", () => {
    assert.equal(loadoutCost(standard), 300);
    const tuned = { ...standard, mods: { scope: "scope-2", clip: "clip-1" } };
    assert.equal(loadoutCost(tuned), 390);
    assert.deepEqual(
        costLines(tuned).map((l) => l.label),
        ["Operative", "Rifle", "Mods", "Armor", "Utility"],
    );
});

test("vacant podiums cost nothing; the squad sums the rest", () => {
    assert.equal(squadCost([standard, null, standard]), 600);
});

test("BASE is exactly the role's standard issue; anything else is CUSTOM", () => {
    assert.equal(buildMarker("Assault", standard), "base");
    assert.equal(buildMarker("Assault", { ...standard, utility: null }), "custom");
    assert.equal(buildMarker("Marksman", { ...standard, primary: "srs9" }), "custom");
    assert.equal(
        buildMarker("Marksman", {
            ...standard,
            primary: "srs9",
            mods: { scope: "scope-1", laser: null },
        }),
        "base",
    );
});

test("deploy is refused for a vacant podium, then for the budget", () => {
    assert.equal(deployRefusal([standard, null, standard], 1000), "Podium 2 is vacant");
    assert.equal(deployRefusal([standard, standard, standard], 850), "Over budget by 50");
    assert.equal(deployRefusal([standard, standard, standard], 900), null);
});

const inventory = {
    owned: new Set(["mx4", "srs9", "spectre", "nyx-mid", "frag", "scope-1", "clip-1"]),
    roster: new Set(["vex", "ghost", "bishop", "echo"]),
};

test("built-in presets cost what their loadouts cost", () => {
    assert.equal(presetCost(BUILT_INS[0]), 300 + 390 + 300);
});

test("gaps name the items the armory lacks and recruits who left; nothing is substituted", () => {
    const breach = BUILT_INS.find((p) => p.id === "breach")!;
    assert.deepEqual(gaps(breach, inventory)[0], { items: ["nyx-heavy", "clip-2"], recruit: null });
    assert.equal(complete(breach, inventory), false);
    assert.equal(complete(BUILT_INS[0], inventory), true);
    const left: Preset = {
        ...BUILT_INS[0],
        podiums: [{ ...BUILT_INS[0].podiums[0]!, preferred: "nyx" }, null, null],
    };
    assert.equal(gaps(left, inventory)[0].recruit, "nyx");
});

test("applying places preferred recruits, keeps the rest where they stand, moves the displaced", () => {
    const preset = fromSquad("p", "Mine", [
        { id: "echo", role: "Recon", loadout: standard },
        null,
        { id: "vex", role: "Assault", loadout: standard },
    ]);
    // Podium 2 is empty in the preset, so it stays empty; VEX moves to podium 3.
    assert.deepEqual(resolve(preset, ["vex", "ghost", "bishop"], inventory), ["echo", null, "vex"]);
    const open: Preset = {
        ...preset,
        podiums: preset.podiums.map((s) => s && { ...s, preferred: null }),
    };
    assert.deepEqual(resolve(open, ["vex", "ghost", "bishop"], inventory), ["vex", null, "bishop"]);
});

test("a preferred recruit no longer on the roster leaves the current occupant", () => {
    const preset = fromSquad("p", "Mine", [
        { id: "nyx", role: "Assault", loadout: standard },
        null,
        null,
    ]);
    assert.deepEqual(resolve(preset, ["vex", "ghost", "bishop"], inventory), ["vex", null, null]);
});

test("modified compares the kit on each podium with the preset", () => {
    const preset = BUILT_INS[0];
    const same = preset.podiums.map((s) => s!.loadout);
    assert.equal(modified(preset, same), false);
    assert.equal(modified(preset, [same[0], same[1], { ...standard, armor: "nyx-mid" }]), true);
    assert.equal(modified(preset, [same[0], same[1], null]), true);
});

test("the player's presets are capped, named, and copies number themselves", () => {
    let list: Preset[] = [];
    for (let i = 0; i < MAX_PRESETS; i++) {
        const edit = add(list, {
            ...BUILT_INS[0],
            id: `p${i}`,
            name: `Squad ${i}`,
            builtIn: false,
        });
        assert.ok(edit.ok);
        list = edit.presets;
    }
    const full = add(list, { ...BUILT_INS[0], id: "x", name: "One more", builtIn: false });
    assert.equal(full.ok, false);
    assert.match(!full.ok ? full.reason : "", /8 presets at most/);
    assert.equal(rename(list, "p0", "   ").ok, false);
    assert.equal(copyName(list, "Squad 1"), "Squad 8");
});

test("storage: versioned, guarded, and nothing unreadable gets through", () => {
    const mem = new Map<string, string>();
    const storage = {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const mine = fromSquad("m", "Mine", [
        { id: "vex", role: "Assault", loadout: standard },
        null,
        null,
    ]);
    assert.equal(store(storage, [mine]), true);
    assert.deepEqual(load(storage), [mine]);
    mem.set(PRESETS_KEY, "{not json");
    assert.deepEqual(load(storage), []);
    mem.set(PRESETS_KEY, JSON.stringify({ version: 99, presets: [mine] }));
    assert.deepEqual(load(storage), []);
    const broken = {
        getItem: () => {
            throw new Error("blocked");
        },
        setItem: () => {
            throw new Error("quota");
        },
    };
    assert.deepEqual(load(broken), []);
    assert.equal(store(broken, [mine]), false);
});
