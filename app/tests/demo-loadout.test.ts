// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { Encounter, initialUnits, type Unit } from "../../packages/engine/src/game.ts";
import { baseIntel } from "../../packages/engine/src/intel.ts";
import { paperTrail } from "../../packages/engine/src/office/scenario.ts";
import { blackRain } from "../../packages/engine/src/scenario.ts";
import {
    applyLoadouts,
    deployedIntel,
    deploymentLoadouts,
} from "../../packages/engine/src/squad-bridge.ts";
import { initialSquad, restoreSquad } from "../../packages/squad/src/model.ts";
import { recruitStats, unpack, add, type Stats } from "../../packages/squad/src/stats.ts";
import type { Recruit } from "../../packages/squad/src/types.ts";

// What `Unit::from_recruit` makes of a recruit, written from the Move source
// (`items.move`, `recruit.move`, `rank.move`, `unit.move`) with its own copies of the numbers, so
// the demo's mirror is held to the contract and not to itself.

/** `bf::pack_u8!`: one byte per field, lowest first; 128 + n is -n. */
const pack = (bytes: number[]) => bytes.reduce((n, b, i) => n | (BigInt(b) << BigInt(8 * i)), 0n);

const DEFAULT_RECRUIT = pack([7, 65, 10, 0, 0]);
const DEFAULT_WEAPON = 0x03_04_00_00_01_00_00_02_04n << 48n;
const RIFLE: Record<string, bigint> = {
    mx4: 0x03_04_00_00_01_0a_0a_02_04n << 48n,
    srs9: 0x03_05_00_00_01_14_14_01_05n << 48n,
    plasma: 0x03_05_00_00_01_1e_1e_01_06n << 48n,
};
const ARMOR: Record<string, bigint> = {
    spectre: pack([0, 0, 0, 1, 10]),
    "nyx-mid": pack([0, 0, 0, 2, 0]),
    "nyx-heavy": pack([128 + 1, 0, 1, 3, 128 + 10]),
};
/** `items::weapon_upgrade`: the byte each kind writes to, and the tier's value. */
const UPGRADE_BYTE = { scope: 1, laser: 9, stock: 13, clip: 14 } as const;
const UPGRADE_VALUE = { scope: [5, 10, 15], laser: [5, 10, 15], stock: [1, 2, 3], clip: [1, 2, 3] };
/** `rank::next_rank_xp`: the total experience each rank takes to leave. */
const RANK_XP = [3, 8, 15, 25, 40, 60, 90];
const RANKS = [
    "Rookie",
    "Squaddie",
    "Corporal",
    "Sergeant",
    "Lieutenant",
    "Captain",
    "Major",
    "Colonel",
];

/** `recruit::add_xp` from a fresh rookie: +2 aim a promotion, +1 health every second one. */
function recruitAtRank(rank: string): Stats {
    const xp = rank === "Rookie" ? 0 : RANK_XP[RANKS.indexOf(rank) - 1];
    let stats = unpack(DEFAULT_RECRUIT);
    let ordinal = 0;
    while (ordinal < RANK_XP.length && xp >= RANK_XP[ordinal]) {
        ordinal++;
        stats = add(stats, unpack(pack([0, 2, ordinal % 2 === 0 ? 1 : 0, 0, 0])));
    }
    return stats;
}

/** `Unit::from_recruit`'s stats: the recruit's own, then the weapon (its upgrades already in it), then the armor. */
function contractStats(r: Recruit): Stats {
    let weapon = unpack(r.equipment.primary ? RIFLE[r.equipment.primary] : DEFAULT_WEAPON);
    if (r.equipment.primary)
        for (const id of Object.values(r.attachments ?? {})) {
            if (!id) continue;
            const [kind, tier] = id.split("-") as [keyof typeof UPGRADE_BYTE, string];
            weapon = add(
                weapon,
                unpack(
                    BigInt(UPGRADE_VALUE[kind][Number(tier) - 1]) << BigInt(8 * UPGRADE_BYTE[kind]),
                ),
            );
        }
    const armor = unpack(r.equipment.armor ? ARMOR[r.equipment.armor] : pack([0, 0, 0, 0, 0]));
    return add(add(recruitAtRank(r.rank ?? "Rookie"), weapon), armor);
}

const MODS = [
    {},
    { scope: "scope-3" },
    { laser: "laser-2" },
    { stock: "stock-1" },
    { clip: "clip-3" },
    { scope: "scope-1", laser: "laser-1", clip: "clip-1" },
    { stock: "stock-3", laser: "laser-3", scope: "scope-2" },
];

function recruitWith(
    primary: string | null,
    attachments: Recruit["attachments"],
    armor: string | null,
    utility: string | null,
    rank?: string,
): Recruit {
    const base = initialSquad().recruits[0];
    return {
        ...base,
        equipment: { primary, sidearm: "k12", armor, utility },
        attachments,
        ...(rank ? { rank } : {}),
    };
}

/** The first ally of Black Rain deployed as `recruit`. */
function deploy(recruit: Recruit): Unit {
    const units = initialUnits();
    applyLoadouts(units, deploymentLoadouts([recruit], units, blackRain));
    return units[0];
}

test("a recruit's demo unit has the stats the contract gives its unit, for every loadout", () => {
    let checked = 0;
    for (const primary of ["mx4", "srs9", "plasma", null])
        for (const mods of MODS)
            for (const armor of [null, "spectre", "nyx-mid", "nyx-heavy"])
                for (const utility of [null, "frag"])
                    for (const rank of [undefined, "Sergeant", "Colonel"]) {
                        const recruit = recruitWith(primary, mods, armor, utility, rank);
                        const u = deploy(recruit);
                        const s = contractStats(recruit);
                        const label = JSON.stringify([primary, mods, armor, utility, rank]);
                        assert.deepEqual(
                            [
                                u.hp,
                                u.maxHp,
                                u.ammo,
                                u.clip,
                                u.armor,
                                u.aim,
                                u.mobility,
                                u.range,
                                u.damage,
                            ],
                            [
                                s.health,
                                s.health,
                                s.ammo,
                                s.ammo,
                                s.armor,
                                s.aim,
                                s.mobility,
                                s.range,
                                s.damage,
                            ],
                            label,
                        );
                        assert.deepEqual(
                            [u.spread, u.plusOne, u.critChance, u.dodge, u.defense],
                            [s.spread, s.plusOne, s.critChance, s.dodge, s.defense],
                            label,
                        );
                        const kinds = u.actions.map((a) => a.kind);
                        assert.equal(
                            kinds.includes("Attack") && kinds.includes("Reload"),
                            primary !== null,
                            label,
                        );
                        assert.equal(kinds.includes("Grenade"), utility === "frag", label);
                        if (utility)
                            assert.deepEqual(
                                u.actions.find((a) => a.kind === "Grenade"),
                                { kind: "Grenade", uses: 1 },
                            );
                        checked++;
                    }
    assert.equal(checked, 4 * MODS.length * 4 * 2 * 3);
});

test("the weapons are the contract's: damage range, range, crit, clip", () => {
    const stats = (primary: string, mods = {}) => {
        const u = deploy(recruitWith(primary, mods, null, null));
        return {
            damage: [u.damage - u.spread, u.damage + u.spread],
            range: u.range,
            crit: u.critChance,
            clip: u.clip,
        };
    };
    // Standard 2-6 (4 +/- 2), range 4, 10% crit, 3 rounds; Sharpshooter 4-6, range 5, 20%; Plasma 5-7, range 5, 30%
    assert.deepEqual(stats("mx4"), { damage: [2, 6], range: 4, crit: 10, clip: 3 });
    assert.deepEqual(stats("srs9"), { damage: [4, 6], range: 5, crit: 20, clip: 3 });
    assert.deepEqual(stats("plasma"), { damage: [5, 7], range: 5, crit: 30, clip: 3 });
    // each mod does what its tier says
    assert.equal(stats("mx4", { clip: "clip-3" }).clip, 6);
    assert.equal(stats("mx4", { stock: "stock-2" }).range, 6);
    assert.equal(stats("mx4", { laser: "laser-3" }).crit, 25);
    assert.equal(deploy(recruitWith("mx4", { scope: "scope-2" }, null, null)).aim, 75);
    // heavy armor: +1 health, -1 mobility, +3 armor, dodge floors at 0; light armor dodges one in ten
    const heavy = deploy(recruitWith("mx4", {}, "nyx-heavy", null));
    assert.deepEqual([heavy.maxHp, heavy.mobility, heavy.armor, heavy.dodge], [11, 6, 3, 0]);
    assert.equal(deploy(recruitWith("mx4", {}, "spectre", null)).dodge, 10);
    // Sergeant: three promotions, +6 aim, +1 health (the second)
    const sergeant = deploy(recruitWith("mx4", {}, null, null, "Sergeant"));
    assert.deepEqual([sergeant.aim, sergeant.maxHp], [71, 11]);
});

test("the marksman rifle is the one in a sharpshooter's hands; the rest carry the rifle", () => {
    assert.equal(deploy(recruitWith("srs9", {}, null, null)).weapon, "sniper");
    assert.equal(deploy(recruitWith("mx4", {}, null, null)).weapon, "rifle");
    // the field has no plasma rifle model yet
    assert.equal(deploy(recruitWith("plasma", {}, null, null)).weapon, "rifle");
    // the scenario's Recon is no sharpshooter unless the recruit is
    const units = initialUnits();
    assert.equal(units[1].weapon, "sniper");
    applyLoadouts(
        units,
        deploymentLoadouts([recruitWith("mx4", {}, null, null)], units, blackRain),
    );
    assert.equal(units[0].weapon, "rifle");
});

test("allies without a recruit keep the scenario's numbers", () => {
    const fresh = initialUnits();
    const units = initialUnits();
    applyLoadouts(
        units,
        deploymentLoadouts([recruitWith("plasma", {}, "nyx-heavy", "frag")], units, blackRain),
    );
    for (const [i, u] of units.entries()) if (!u.enemy && i > 0) assert.deepEqual(u, fresh[i]);
});

const KITS = {
    ASSAULT: recruitWith("mx4", {}, "spectre", null),
    RECON: recruitWith("srs9", {}, "spectre", null),
    HEAVY: recruitWith("mx4", {}, "nyx-mid", null),
};

test("hostiles are built from their role's kit by the same rules, in both demos", () => {
    for (const scenario of [blackRain, paperTrail]) {
        const units = initialUnits(scenario);
        applyLoadouts(units, deploymentLoadouts(null, units, scenario));
        const foes = units.filter((u) => u.enemy);
        assert.equal(foes.length, 3);
        for (const u of foes) {
            const kit = KITS[u.role as keyof typeof KITS];
            const s = contractStats(kit);
            assert.deepEqual(
                [
                    u.hp,
                    u.maxHp,
                    u.ammo,
                    u.clip,
                    u.armor,
                    u.aim,
                    u.mobility,
                    u.range,
                    u.damage,
                    u.spread,
                    u.critChance,
                    u.dodge,
                ],
                [
                    s.health,
                    s.health,
                    s.ammo,
                    s.ammo,
                    s.armor,
                    s.aim,
                    s.mobility,
                    s.range,
                    s.damage,
                    s.spread,
                    s.critChance,
                    s.dodge,
                ],
                u.id,
            );
            assert.equal(u.weapon, u.role === "RECON" ? "sniper" : "rifle");
            assert.ok(u.actions.some((a) => a.kind === "Attack"));
        }
        // the scenario's intent: the marksman shoots furthest, the heavy is the toughest
        const [assault, heavy, recon] = foes;
        assert.ok(recon.range > assault.range && heavy.armor > assault.armor);
    }
});

test("a scenario unit's own kit replaces its role's", () => {
    const scenario = {
        ...blackRain,
        units: blackRain.units.map((u) =>
            u.id === "h1"
                ? { ...u, kit: { primary: "plasma", armor: "nyx-heavy", rank: "Captain" } }
                : u,
        ),
    };
    const units = initialUnits(scenario);
    applyLoadouts(units, deploymentLoadouts(null, units, scenario));
    const s = contractStats(recruitWith("plasma", {}, "nyx-heavy", null, "Captain"));
    const h1 = units.find((u) => u.id === "h1")!;
    assert.deepEqual([h1.maxHp, h1.aim, h1.damage, h1.armor], [s.health, s.aim, s.damage, s.armor]);
});

test("no unit in either demo is outside what the contract can produce, saved roster or not", () => {
    // the contract: 4 to 8 range (rifle 4 or 5, a stock up to +3), 4 to 6 damage stat, 10 to 14 health
    // (a Colonel's six promotions and heavy armor), armor 0 to 3, aim 65 to 107, 3 to 6 rounds
    const one = recruitWith(
        "plasma",
        { stock: "stock-3", clip: "clip-3", scope: "scope-3" },
        "nyx-heavy",
        "frag",
        "Colonel",
    );
    const saved = [one, one, one, one];
    for (const scenario of [blackRain, paperTrail])
        for (const roster of [null, saved]) {
            const units = initialUnits(scenario);
            applyLoadouts(units, deploymentLoadouts(roster, units, scenario));
            for (const u of units) {
                assert.ok(u.range >= 4 && u.range <= 8, `${u.id} range ${u.range}`);
                assert.ok(u.damage >= 4 && u.damage <= 6, `${u.id} damage ${u.damage}`);
                assert.ok(u.maxHp >= 10 && u.maxHp <= 14, `${u.id} hp ${u.maxHp}`);
                assert.ok(
                    u.armor <= 3 && u.aim >= 65 && u.aim <= 107 && u.clip >= 3 && u.clip <= 6,
                    u.id,
                );
            }
        }
});

test("a fresh visitor's squad is deployed from the default roster, stat for stat", () => {
    const units = initialUnits();
    applyLoadouts(units, deploymentLoadouts(null, units, blackRain));
    const squad = initialSquad().recruits;
    units
        .filter((u) => !u.enemy)
        .forEach((u, i) => {
            const s = contractStats(squad[i]);
            assert.deepEqual(
                [u.maxHp, u.clip, u.armor, u.aim, u.mobility, u.range, u.damage],
                [s.health, s.ammo, s.armor, s.aim, s.mobility, s.range, s.damage],
            );
        });
});

test("a saved roster keeps its rank and drops one the chain has no name for", () => {
    const squad = initialSquad();
    squad.recruits[0] = { ...squad.recruits[0], rank: "Captain" };
    squad.recruits[1] = { ...squad.recruits[1], rank: "Admiral" };
    const restored = restoreSquad(JSON.parse(JSON.stringify(squad))).recruits;
    assert.equal(restored[0].rank, "Captain");
    assert.ok(!("rank" in restored[1]));
});

test("the readout shows the recruit's gear and the numbers the rules roll with", () => {
    const recruit = recruitWith(
        "plasma",
        { scope: "scope-2", clip: "clip-1" },
        "nyx-mid",
        "frag",
        "Corporal",
    );
    const game = new Encounter();
    applyLoadouts(game.units, deploymentLoadouts([recruit], game.units, blackRain));
    const u = game.units[0];
    const intel = deployedIntel(u, baseIntel(game, u, "Light Armor"));
    assert.deepEqual(intel.weapon, {
        name: "Plasma Rifle",
        mods: [
            { kind: "clip", name: "Basic Expanded Clip", tier: 1 },
            { kind: "scope", name: "Advanced Scope", tier: 2 },
        ],
    });
    assert.deepEqual(intel.armor, { name: "NYX / Shade" });
    assert.deepEqual(intel.rank, { name: "Corporal", index: 2 });
    const s = contractStats(recruit);
    // plasma 6 +/- 1, one more on a plus-one roll
    assert.deepEqual(intel.stats, {
        aim: s.aim,
        damage: [5, 8],
        range: s.range,
        mobility: s.mobility,
        dodge: 0,
        defense: 0,
        critChance: 30,
    });
    assert.deepEqual(
        [intel.condition.maxHp, intel.condition.armor, intel.condition.clip],
        [s.health, 2, 4],
    );
    // a unit with no gear (the engine's own) is read as the engine has it
    const plain = new Encounter();
    const enemy = plain.enemies[0];
    assert.deepEqual(deployedIntel(enemy, baseIntel(plain, enemy)), baseIntel(plain, enemy));
    // the unit panel names the recruit's weapon, a plus for fitted mods
    assert.equal(recruitStats(recruit).critChance, 30);
});

/** Shots from `shooter` at `target`, the target healed and the shooter reloaded between them. */
function volley(shooter: Unit, target: Unit, game: Encounter, n: number) {
    const shots = [];
    for (let i = 0; i < n; i++) {
        shooter.ap = 2;
        shooter.ammo = shooter.clip;
        target.hp = target.maxHp = 99;
        const shot = game.attack(shooter, target);
        assert.ok(shot);
        shots.push(shot);
    }
    return shots;
}

test("shots roll the recruit's damage spread, crits and the target's dodge and armor", () => {
    const game = new Encounter();
    const [a, b] = [game.units[0], game.enemies[0]];
    applyLoadouts(
        game.units,
        deploymentLoadouts(
            [recruitWith("plasma", { laser: "laser-3" }, null, null)],
            game.units,
            blackRain,
        ),
    );
    a.pos = [1, -2];
    b.pos = [2, -2];
    a.aim = 100;
    b.armor = 1;
    const shots = volley(a, b, game, 600).filter((s) => s.hit);
    assert.ok(shots.length > 500);
    // plasma 6 +/- 1 (+1 on a plus-one roll), a crit adds 3, less 1 armor
    const plain = shots.filter((s) => !s.crit).map((s) => s.damage);
    const crits = shots.filter((s) => s.crit).map((s) => s.damage);
    assert.deepEqual([Math.min(...plain), Math.max(...plain)], [4, 7]);
    assert.deepEqual([Math.min(...crits), Math.max(...crits)], [7, 10]);
    assert.ok(new Set(plain).size === 4, "every value of the range comes up");
    // 30% plasma + 15% laser
    assert.ok(
        Math.abs(crits.length / shots.length - 0.45) < 0.07,
        String(crits.length / shots.length),
    );

    // dodge: light armor sidesteps a tenth of the shots, heavy armor none
    const game2 = new Encounter();
    const [foe, ally] = [game2.enemies[0], game2.units[0]];
    game2.phase = "enemy";
    foe.pos = [2, -2];
    for (const [armor, dodge] of [
        ["spectre", 0.1],
        ["nyx-heavy", 0],
    ] as const) {
        applyLoadouts(
            game2.units,
            deploymentLoadouts([recruitWith("mx4", {}, armor, null)], game2.units, blackRain),
        );
        foe.aim = 100;
        ally.pos = [1, -2];
        ally.armor = 0;
        const missed = volley(foe, ally, game2, 800).filter((s) => !s.hit).length / 800;
        assert.ok(Math.abs(missed - dodge) < 0.04, `${armor}: ${missed}`);
    }
});
