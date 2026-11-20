// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Virtual units as the builder, the ranked field and the debrief dress them
 * (`features/play/ranked/kit.ts`): a loadout's kit by squad catalog id, its role,
 * the figures, the opponent's faces, and a ranked unit's loadout read back off its
 * stats and actions, as `unit::from_loadout` builds it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { demoLevels } from "../../packages/engine/src/editor/from-plan.ts";
import { scenarioFromLevel } from "../../packages/engine/src/editor/playtest.ts";
import { initialUnits } from "../../packages/engine/src/game.ts";
import { deploymentLoadouts } from "../../packages/engine/src/squad-bridge.ts";
import { pack } from "@ghosts/squad/stats";
import {
    fieldUnit,
    PRESETS,
    presetOf,
    unitStats,
    type Loadout,
} from "../src/features/play/economy/index.ts";
import {
    BASIC_KIT,
    fieldKit,
    fieldRole,
    hash,
    opponentFaces,
    playerFaces,
    rankedSide,
    sideLooks,
    unitLoadout,
    virtualRecruits,
    type ChainUnitLike,
    type Side,
} from "../src/features/play/ranked/kit.ts";

const preset = (id: string): Loadout => ({ ...presetOf(id)!.loadout });

/** A unit on the map as the contract builds it from a loadout: its stats packed, its actions. */
function chainUnit(recruit: string, loadout: Omit<Loadout, "preset">): ChainUnitLike {
    const { stats, actions } = fieldUnit({ preset: "", ...loadout });
    return {
        recruit,
        stats: { value: pack(stats).toString() },
        actions: actions.map((a) => ({ kind: { $kind: a.kind } })),
    };
}

test("a loadout maps to squad catalog ids slot by slot", () => {
    assert.deepEqual(fieldKit(preset("assault")), {
        primary: "mx4",
        armor: "nyx-mid",
        utility: "frag",
    });
    assert.deepEqual(fieldKit(preset("sniper")), {
        primary: "srs9",
        armor: "spectre",
        utility: null,
    });
    assert.deepEqual(fieldKit(preset("heavy")), {
        primary: "plasma",
        armor: "nyx-heavy",
        utility: null,
    });
    assert.equal(fieldRole(fieldKit(preset("sniper"))), "RECON");
    assert.equal(fieldRole(fieldKit(preset("heavy"))), "HEAVY");
    assert.equal(fieldRole(fieldKit(preset("assault"))), "ASSAULT");
});

test("unknown ids fall back to the basic kit with a warning", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const kit = fieldKit({
        preset: "ghost",
        weapon: "railgun-9",
        armor: "exo-suit",
        utility: "drone",
    });
    assert.deepEqual(kit, BASIC_KIT);
    assert.equal(warn.mock.callCount(), 3);
    const wrong = fieldKit({ preset: "x", weapon: "armor-2", armor: "armor-1", utility: null });
    assert.equal(wrong.primary, "mx4");
    assert.equal(wrong.armor, "spectre");
});

test("a ranked unit's loadout is read back off its stats and actions, every loadout", () => {
    const weapons = ["rifle-1", "rifle-2", "rifle-3"];
    const armors = ["armor-1", "armor-2", "armor-3"];
    const utilities = [null, "frag-grenade", "flashbang", "smoke-grenade"];
    for (const weapon of weapons)
        for (const armor of armors)
            for (const utility of utilities) {
                const read = unitLoadout(chainUnit("0x1", { weapon, armor, utility }));
                assert.deepEqual(
                    [read.weapon, read.armor, read.utility],
                    [weapon, armor, utility],
                    `${weapon} ${armor} ${utility}`,
                );
            }
    // An exact preset is named as one.
    assert.equal(unitLoadout(chainUnit("0x1", preset("assault"))).preset, "assault");
    assert.equal(unitLoadout(chainUnit("0x1", preset("heavy"))).preset, "heavy");
});

test("a ranked side: the builder's names for the player's squad, role names for the other", () => {
    const units = [
        chainUnit("0x3", preset("runner")),
        chainUnit("0x1", preset("assault")),
        chainUnit("0x2", preset("assault")),
    ];
    const theirs = rankedSide(units, null);
    assert.deepEqual(theirs.names, ["Runner", "Assault", "Assault-2"]);
    assert.deepEqual(theirs.callsigns, ["RUNNER", "ASSAULT", "ASSAULT-2"]);
    assert.deepEqual(theirs.ids, ["0x3", "0x1", "0x2"]);
    const mine = rankedSide(units, {
        units: [preset("assault"), preset("runner"), preset("assault")],
        labels: ["Breacher", "Scout · modified", "Assault"],
    });
    assert.deepEqual(mine.names, ["Scout", "Breacher", "Assault"]);
});

test("virtual recruits fight with the economy's numbers in the engine", () => {
    const loadouts = [preset("assault"), preset("sniper"), preset("heavy")];
    const kits = loadouts.map(fieldKit);
    const side: Side = {
        ids: ["a1", "a2", "a3"],
        loadouts,
        kits,
        roles: kits.map(fieldRole),
        callsigns: ["A", "B", "C"],
        names: ["Assault", "Sniper", "Heavy"],
        types: ["Assault", "Sniper", "Heavy"],
    };
    const recruits = virtualRecruits(side, hash("0xgame"));
    assert.deepEqual(recruits[2].equipment, {
        primary: "plasma",
        sidearm: "k12",
        armor: "nyx-heavy",
        utility: null,
    });
    const { level } = demoLevels[0].build();
    const scenario = scenarioFromLevel(level);
    const units = initialUnits(scenario);
    units
        .filter((u) => !u.enemy)
        .slice(0, 3)
        .forEach((u, i) => (u.id = recruits[i].id));
    const fit = deploymentLoadouts(recruits, units, scenario);
    loadouts.forEach((loadout, i) => {
        const got = fit.get(`a${i + 1}`)!.fit;
        const stats = unitStats(loadout);
        assert.equal(got.hp, stats.hp);
        assert.equal(got.armor, stats.armor);
        assert.equal(got.aim, stats.aim);
        assert.equal(got.mobility, stats.mobility);
    });
});

test("the opponent's units wear their kit's armor and faces the player's do not", () => {
    for (const size of [3, 4])
        for (const seed of [1, 2, 3, hash("0xgame")]) {
            const mine = playerFaces(seed, size).map((f) => f.name);
            const theirs = opponentFaces(seed, size).map((f) => f.name);
            assert.equal(new Set(theirs).size, size);
            assert.ok(theirs.filter((n) => mine.includes(n)).length <= Math.max(0, 2 * size - 6));
            const side = rankedSide(
                PRESETS.slice(0, size).map((p, i) => chainUnit(`0x${i}`, p.loadout)),
                null,
            );
            assert.deepEqual(
                sideLooks(side, seed).map((l) => l.armor),
                side.kits.map((k) => k.armor),
            );
        }
});
