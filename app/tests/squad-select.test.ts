// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    benchOf,
    defaultSquad,
    deployRefusal,
    formatClock,
    kitOf,
    LAST_SQUAD_KEY,
    place,
    podiumCount,
    readLastSquad,
    squadOf,
    swapTarget,
    warningsOf,
    weaponLabel,
    writeLastSquad,
    type DeployState,
} from "../src/features/squad-view/rules.ts";

const ROSTER = ["0xa", "0xb", "0xc", "0xd"];

test("podiums: the positions left plus the ones already taken", () => {
    assert.equal(podiumCount(3, 0), 3);
    assert.equal(podiumCount(0, 3), 3);
    assert.equal(podiumCount(1, 2), 3);
});

test("default squad: the first by roster order fill every podium", () => {
    assert.deepEqual(defaultSquad(ROSTER, 3), ["0xa", "0xb", "0xc"]);
    assert.deepEqual(defaultSquad(["0xa", "0xb"], 3), ["0xa", "0xb", null]);
    assert.deepEqual(defaultSquad([], 3), [null, null, null]);
});

test("default squad: the last squad kept on the device, where still on the roster", () => {
    assert.deepEqual(defaultSquad(ROSTER, 3, ["0xd", "0xa", "0xc"]), ["0xd", "0xa", "0xc"]);
    // a fallen recruit leaves a gap that the roster fills; a vacant podium is filled too
    assert.deepEqual(defaultSquad(ROSTER, 3, ["0xd", "0xgone", null]), ["0xd", "0xa", "0xb"]);
    // duplicates and extra entries are ignored
    assert.deepEqual(defaultSquad(ROSTER, 3, ["0xb", "0xb", "0xc", "0xd"]), ["0xb", "0xa", "0xc"]);
});

test("place: onto a podium, trading places with a recruit standing elsewhere", () => {
    const podiums = ["0xa", "0xb", "0xc"];
    assert.deepEqual(place(podiums, 0, "0xd"), ["0xd", "0xb", "0xc"]);
    assert.deepEqual(place(podiums, 0, "0xc"), ["0xc", "0xb", "0xa"]);
    assert.deepEqual(place(podiums, 1, null), ["0xa", null, "0xc"]);
    assert.deepEqual(place(podiums, 1, "0xb"), podiums);
    // the input is left as it was
    assert.deepEqual(podiums, ["0xa", "0xb", "0xc"]);
});

test("bench: the roster on no podium, in roster order", () => {
    assert.deepEqual(benchOf(ROSTER, ["0xa", "0xb", "0xc"]), ["0xd"]);
    assert.deepEqual(benchOf(ROSTER, ["0xa", null, "0xc"]), ["0xb", "0xd"]);
    assert.deepEqual(squadOf(["0xa", null, "0xc"]), ["0xa", "0xc"]);
});

test("swap target: a vacant podium first, then the last one the cursor stood on", () => {
    assert.equal(swapTarget(["0xa", null, "0xc"], 2), 1);
    assert.equal(swapTarget(["0xa", "0xb", "0xc"], 0), 0);
    assert.equal(swapTarget(["0xa", "0xb", "0xc"], null), 2);
    assert.equal(swapTarget(["0xa", "0xb", "0xc"], 7), 2);
});

const ready: DeployState = {
    podiums: ["0xa", "0xb", "0xc"],
    roster: ROSTER,
    expired: false,
    joining: false,
    busy: false,
    deployed: false,
};

test("deploy: a full squad, or fewer than the positions, goes", () => {
    assert.equal(deployRefusal(ready), null);
    assert.equal(deployRefusal({ ...ready, podiums: [null, "0xb", null] }), null);
});

test("deploy: refused with the reason the contract would give", () => {
    assert.equal(
        deployRefusal({ ...ready, podiums: [null, null, null] }),
        "Put an operative on a podium",
    );
    assert.equal(deployRefusal({ ...ready, expired: true }), "Time is up");
    assert.equal(deployRefusal({ ...ready, joining: true }), "Joining the match");
    assert.equal(deployRefusal({ ...ready, busy: true }), "Deploying the squad");
    assert.equal(deployRefusal({ ...ready, deployed: true }), "The squad is deployed");
    assert.equal(
        deployRefusal({ ...ready, podiums: ["0xa", "0xa", null] }),
        "An operative stands on two podiums",
    );
    assert.equal(
        deployRefusal({ ...ready, podiums: ["0xa", "0xz", null] }),
        "An operative on the podiums left the roster",
    );
});

test("clock: m:ss, rounded up, never negative", () => {
    assert.equal(formatClock(120_000), "2:00");
    assert.equal(formatClock(119_001), "2:00");
    assert.equal(formatClock(61_000), "1:01");
    assert.equal(formatClock(9_500), "0:10");
    assert.equal(formatClock(1), "0:01");
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(-5_000), "0:00");
});

test("last squad: kept and read back; junk reads as nothing", () => {
    const bag = new Map<string, string>();
    const storage = {
        getItem: (k: string) => bag.get(k) ?? null,
        setItem: (k: string, v: string) => void bag.set(k, v),
    };
    writeLastSquad(storage, ["0xa", null, "0xc"]);
    assert.deepEqual(readLastSquad(storage), ["0xa", null, "0xc"]);
    bag.set(LAST_SQUAD_KEY, "{not json");
    assert.deepEqual(readLastSquad(storage), []);
    bag.set(LAST_SQUAD_KEY, JSON.stringify({ a: 1 }));
    assert.deepEqual(readLastSquad(storage), []);
    assert.deepEqual(readLastSquad(undefined), []);
});

test("kit: the weapon with its mods, the armor class, the utility's uses", () => {
    const kit = kitOf({
        weapon: { name: "Standard Rifle", upgrades: [{ tier: 2 }, { tier: 3 }] },
        armor: { name: "Heavy Armor" },
        utilities: [{ name: "Frag Grenade", actions: [{ uses: 1 }] }],
    });
    assert.deepEqual(kit, {
        weapon: { name: "Standard Rifle", modded: true, mods: [2, 3] },
        armor: { name: "Heavy Armor", tier: 3 },
        utility: { name: "Frag Grenade", uses: 1 },
    });
    assert.equal(weaponLabel(kit), "Standard Rifle +");
    assert.deepEqual(warningsOf(kit), []);
});

test("kit: a recruit whose rifle was taken off is unarmed, and the plate says so", () => {
    const kit = kitOf({ weapon: null, armor: null, utilities: [] });
    assert.equal(kit.weapon, null);
    assert.equal(kit.armor, null);
    assert.equal(kit.utility, null);
    assert.deepEqual(warningsOf(kit), ["Unarmed"]);
    assert.equal(weaponLabel(kit), "No weapon");
    const plain = kitOf({
        weapon: { name: "Standard Rifle", upgrades: [] },
        armor: { name: "Light Armor" },
        utilities: [{ name: "Field Kit", actions: [{ uses: null }] }],
    });
    assert.equal(weaponLabel(plain), "Standard Rifle");
    assert.equal(plain.armor?.tier, 1);
    assert.equal(plain.utility?.uses, null);
});
