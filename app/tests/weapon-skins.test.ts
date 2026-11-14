// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync } from "node:fs";

import { FACTORY_SKIN, skinsFor, validSkin } from "@ghosts/squad/weapon-skins";
import { SKIN_RECIPES } from "../../packages/squad/src/skin-recipes.ts";

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
    assert.deepEqual(saveWeaponSkin("0xb", "urban", store), { "0xa": "camo", "0xb": "urban" });
    assert.deepEqual(readWeaponSkins(store), { "0xa": "camo", "0xb": "urban" });
    assert.deepEqual(saveWeaponSkin("0xa", FACTORY_SKIN, store), { "0xb": "urban" });
    assert.deepEqual(JSON.parse(store.data.get(WEAPON_SKINS_KEY)!), { "0xb": "urban" });
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

test("every long gun wears the same skins; unknown, removed or sidearm skins fall back to Factory", () => {
    const ids = [FACTORY_SKIN, "standard", "camo", "desert", "urban", "arctic", "worn", "hardtest"];
    for (const model of ["rifle", "sniper", "plasma"] as const) {
        assert.deepEqual(
            skinsFor(model).map((s) => s.id),
            ids,
        );
        for (const id of ids.slice(1)) assert.equal(validSkin(model, id), id);
    }
    assert.deepEqual(
        skinsFor("pistol").map((s) => s.id),
        [FACTORY_SKIN],
    );
    assert.equal(validSkin("pistol", "camo"), FACTORY_SKIN);
    assert.equal(validSkin("rifle", "gold"), FACTORY_SKIN);
    assert.equal(validSkin("rifle", undefined), FACTORY_SKIN);
    // "heavy" was retired: a stored choice of it reads as Factory.
    assert.equal(validSkin("rifle", "heavy"), FACTORY_SKIN);
    const store = memory({ [WEAPON_SKINS_KEY]: '{"0xa":"heavy","0xb":"desert"}' });
    const saved = readWeaponSkins(store);
    assert.equal(validSkin("rifle", saved["0xa"]), FACTORY_SKIN);
    assert.equal(validSkin("plasma", saved["0xb"]), "desert");
});

test("every listed skin has a recipe and shipped maps for each gun", () => {
    for (const model of ["rifle", "sniper", "plasma"] as const) {
        assert.ok(existsSync(`public/squad/weapons/skins/${model}.glb`), model);
        for (const { id, swatch } of skinsFor(model).slice(1)) {
            assert.ok(SKIN_RECIPES[id], id);
            assert.ok(swatch.length >= 2 && swatch.every((c) => /^#[0-9a-f]{6}$/.test(c)), id);
            for (const kind of ["base", "rm"])
                assert.ok(
                    existsSync(`public/squad/weapons/skins/${model}-${id}-${kind}.webp`),
                    `${model} ${id} ${kind}`,
                );
        }
    }
    // Nothing shipped for a skin that is no longer listed.
    const listed = new Set(skinsFor("rifle").map((s) => s.id));
    for (const file of readdirSync("public/squad/weapons/skins"))
        if (file.endsWith(".webp")) assert.ok(listed.has(file.split("-")[1]), file);
});
