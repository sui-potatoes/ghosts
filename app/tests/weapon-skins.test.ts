// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { FACTORY_SKIN, skinsFor, validSkin } from "@ghosts/squad/weapon-skins";

import {
    readWeaponSkins,
    saveWeaponSkin,
    WEAPON_SKINS_KEY,
} from "../src/features/headquarters/skins.ts";

function memory(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
    };
}

const broken = {
    getItem(): string | null {
        throw new Error("blocked");
    },
    setItem() {
        throw new Error("blocked");
    },
};

test("choices round-trip per weapon id; Factory removes the entry", () => {
    const store = memory();
    assert.deepEqual(saveWeaponSkin("0xa", "camo", store), { "0xa": "camo" });
    assert.deepEqual(saveWeaponSkin("0xb", "heavy", store), { "0xa": "camo", "0xb": "heavy" });
    assert.deepEqual(readWeaponSkins(store), { "0xa": "camo", "0xb": "heavy" });
    assert.deepEqual(saveWeaponSkin("0xa", FACTORY_SKIN, store), { "0xb": "heavy" });
    assert.deepEqual(JSON.parse(store.data.get(WEAPON_SKINS_KEY)!), { "0xb": "heavy" });
});

test("missing, malformed or throwing storage reads as no choices", () => {
    assert.deepEqual(readWeaponSkins(null), {});
    assert.deepEqual(readWeaponSkins(memory({ [WEAPON_SKINS_KEY]: "{oops" })), {});
    assert.deepEqual(readWeaponSkins(memory({ [WEAPON_SKINS_KEY]: "[1,2]" })), {});
    assert.deepEqual(readWeaponSkins(memory({ [WEAPON_SKINS_KEY]: '{"0xa":"camo","0xb":7}' })), {
        "0xa": "camo",
    });
    assert.deepEqual(readWeaponSkins(broken), {});
    // a write that cannot persist still returns the choice for this visit
    assert.deepEqual(saveWeaponSkin("0xa", "camo", broken), { "0xa": "camo" });
    assert.deepEqual(saveWeaponSkin("0xa", "camo", null), { "0xa": "camo" });
});

test("skins are per model; unknown ids fall back to Factory", () => {
    assert.deepEqual(
        skinsFor("rifle").map((s) => s.id),
        [FACTORY_SKIN, "standard", "camo", "hardtest", "heavy"],
    );
    assert.deepEqual(
        skinsFor("sniper").map((s) => s.id),
        [FACTORY_SKIN],
    );
    assert.equal(validSkin("rifle", "camo"), "camo");
    assert.equal(validSkin("sniper", "camo"), FACTORY_SKIN);
    assert.equal(validSkin("rifle", "gold"), FACTORY_SKIN);
    assert.equal(validSkin("rifle", undefined), FACTORY_SKIN);
});
