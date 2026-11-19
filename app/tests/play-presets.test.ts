// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultSquad, PRESETS, type Loadout } from "../src/features/play/economy/index.ts";
import {
    cleanName,
    deleteSquad,
    deleteType,
    emptyLibrary,
    isSquad,
    nameRefusal,
    nextName,
    overwriteSquad,
    parseLibrary,
    renameSquad,
    saveSquad,
    saveSquadRefusal,
    saveType,
    saveTypeRefusal,
    serializeLibrary,
    SQUAD_SLOTS,
    squadsFor,
    TYPE_SLOTS,
    typeOf,
} from "../src/features/play/ranked/presets.ts";

const RATING = 1500;
const three = () => defaultSquad(RATING, "3x3");
const four = () => defaultSquad(RATING, "4x4");
const assault = PRESETS.find((p) => p.id === "assault")!.loadout;
const lighter: Loadout = { ...assault, armor: "armor-1" };

test("save, overwrite, rename and delete a squad", () => {
    let lib = saveSquad(emptyLibrary(), "3x3", "  Line   up ", three(), "a");
    assert.equal(lib.squads.length, 1);
    assert.equal(lib.squads[0].name, "Line up");
    assert.ok(isSquad(lib.squads[0], three()));
    const changed = three().map((u, i) => (i === 0 ? lighter : u));
    lib = overwriteSquad(lib, "a", changed);
    assert.deepEqual(lib.squads[0].units, changed);
    lib = renameSquad(lib, "a", "Night shift");
    assert.equal(lib.squads[0].name, "Night shift");
    assert.equal(renameSquad(lib, "a", "   ").squads[0].name, "Night shift");
    lib = saveSquad(lib, "4x4", "Big", four(), "b");
    assert.equal(squadsFor(lib, "3x3").length, 1);
    assert.equal(squadsFor(lib, "4x4").length, 1);
    lib = deleteSquad(lib, "a");
    assert.deepEqual(
        lib.squads.map((s) => s.id),
        ["b"],
    );
    // the stored units are copies
    const units = three();
    const saved = saveSquad(emptyLibrary(), "3x3", "x", units, "c");
    units[0].weapon = "changed";
    assert.notEqual(saved.squads[0].units[0].weapon, "changed");
});

test("a squad with an empty place, the wrong size or no free slot is not saved", () => {
    const withGap = [null, ...three().slice(1)];
    assert.match(saveSquadRefusal(emptyLibrary(), "3x3", withGap)!, /type first/);
    assert.equal(saveSquad(emptyLibrary(), "3x3", "x", withGap).squads.length, 0);
    assert.ok(saveSquadRefusal(emptyLibrary(), "4x4", three()));
    let full = emptyLibrary();
    for (let i = 0; i < SQUAD_SLOTS; i++) full = saveSquad(full, "3x3", `S${i}`, three(), `id${i}`);
    assert.match(saveSquadRefusal(full, "3x3", three())!, /slots are used/);
    assert.equal(saveSquadRefusal(full, "4x4", four()), null, "slots are per size");
    assert.equal(overwriteSquad(full, "id0", withGap), full);
});

test("unit types: only a changed kit, once, and within the slots", () => {
    assert.match(saveTypeRefusal(emptyLibrary(), { ...assault })!, /change a slot first/);
    assert.ok(saveTypeRefusal(emptyLibrary(), null));
    let lib = saveType(emptyLibrary(), "Breacher", lighter, "t");
    assert.equal(lib.types.length, 1);
    assert.equal(typeOf({ ...lighter }, lib.types)?.name, "Breacher");
    assert.match(saveTypeRefusal(lib, lighter)!, /Saved already as Breacher/);
    lib = deleteType(lib, "t");
    assert.equal(lib.types.length, 0);
    let full = emptyLibrary();
    const items = ["rifle-1", "rifle-2", "rifle-3"];
    const armors = ["armor-1", "armor-2", "armor-3"];
    for (let i = 0; i < TYPE_SLOTS; i++)
        full = saveType(
            full,
            `T${i}`,
            {
                preset: "recruit",
                weapon: items[i % 3],
                armor: armors[Math.floor(i / 3) % 3],
                utility: i >= 6 ? "frag-grenade" : null,
            },
            `t${i}`,
        );
    assert.ok(full.types.length >= TYPE_SLOTS - 1);
});

test("names: cleaned, required, unique, and a free default", () => {
    assert.equal(cleanName("  a   b  "), "a b");
    assert.equal(cleanName("x".repeat(40)).length, 24);
    assert.ok(nameRefusal("  ", []));
    assert.ok(nameRefusal("Squad 1", ["squad 1"]));
    assert.equal(nameRefusal("Squad 2", ["Squad 1"]), null);
    assert.equal(nextName("Squad", ["Squad 1", "Squad 2"]), "Squad 3");
});

test("the library round-trips and drops what it cannot trust, entry by entry", () => {
    let lib = saveSquad(emptyLibrary(), "3x3", "A", three(), "a");
    lib = saveType(lib, "Breacher", lighter, "t");
    assert.deepEqual(parseLibrary(serializeLibrary(lib)), lib);
    for (const junk of [null, "", "{", "[]", "1", '{"v":2}', '{"v":1,"squads":7}'])
        assert.deepEqual(parseLibrary(junk), emptyLibrary());
    const raw = {
        v: 1,
        squads: [
            lib.squads[0],
            { ...lib.squads[0], id: "a" }, // duplicate id
            { ...lib.squads[0], id: "b", units: three().slice(1) }, // wrong size
            { ...lib.squads[0], id: "c", units: three().map((u) => ({ ...u, weapon: "gone" })) },
            { ...lib.squads[0], id: "d", units: three().map((u) => ({ ...u, weapon: u.armor })) },
            { ...lib.squads[0], id: "e", name: "   " },
            { ...lib.squads[0], id: "f", mode: "9x9" },
            null,
            "x",
        ],
        types: [
            lib.types[0],
            { id: "u", name: "No preset", loadout: { ...lighter, preset: "nobody" } },
            { id: "v", name: 5, loadout: lighter },
            { id: "w", name: "ok", loadout: { ...lighter, utility: "armor-1" } },
        ],
    };
    const read = parseLibrary(JSON.stringify(raw));
    assert.deepEqual(
        read.squads.map((s) => s.id),
        ["a"],
    );
    assert.deepEqual(
        read.types.map((t) => t.id),
        ["t"],
    );
});
