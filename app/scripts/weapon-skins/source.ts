// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// Stage 0 of the weapon-skin bake: the gun as the Armory builds it, for Blender.
//
//   node --experimental-strip-types source.ts <gun> <work-dir>
//
// Writes <work-dir>/source-high.json and source-low.json: the body and the
// standard clip and stock at each detail, in the Armory weapon frame (+X
// muzzle, +Y up, +Z right, WEAPON_SCALE applied, clip and stock seated at
// their mounts: exactly `buildArmoryWeapon`'s frame), one node per (piece,
// material) with a builder part per triangle. Also writes recipes.json (the
// skin recipes) and the gun's factory finish per material slot.
//
// Part ids come from the builder function that drew each triangle (read off
// the call stack while it is drawn). The builders are hashed by the baked
// equipment poses, so nothing here edits them: GearGeometry is patched at
// run time instead.

import * as T from "three";
import { mkdirSync, writeFileSync } from "node:fs";

const STUDIO = "../../../packages/squad/src/studio/";
const { GearGeometry, WEAPON_BASIS } = await import(STUDIO + "gear-geometry.ts");
const { WeaponGeometry, WEAPON_SCALE, sizeWeapon, weaponFinish } = await import(
    STUDIO + "weapon-finish.ts"
);
const { familyFinish, withDetail } = await import(STUDIO + "rifle-shapes.ts");
const SR = await import(STUDIO + "service-rifle.ts");
const MR = await import(STUDIO + "marksman-rifle.ts");
const PR = await import(STUDIO + "plasma-rifle.ts");
const { SKIN_RECIPES } = await import("../../../packages/squad/src/skin-recipes.ts");

type Detail = "high" | "low";
type Finish = ReturnType<typeof familyFinish>;
interface Gun {
    finish: () => Finish;
    body: (g: InstanceType<typeof WeaponGeometry>, m: Finish) => void;
    standard: (slot: "clip" | "stock", m: Finish) => T.Group;
    mounts: Record<"clip" | "stock", readonly number[]>;
    /** Bore height (authoring units, before WEAPON_SCALE). */
    bore: number;
    /** Builder function name -> part name. The innermost match on the stack wins. */
    parts: Record<string, string>;
}

const GUNS: Record<string, Gun> = {
    rifle: {
        finish: familyFinish,
        body: (g, m) => SR.serviceRifle(g, m, current),
        standard: (slot, m) => SR.createServiceFurniture(slot, m, current),
        mounts: SR.RIFLE_MOUNTS,
        bore: SR.RIFLE_BORE,
        parts: {
            upperReceiver: "upper",
            lowerReceiver: "lower",
            pistolGrip: "grip",
            handguard: "handguard",
            barrel: "barrel",
            foldedSight: "sight",
            magazine: "magazine",
            stock: "stock",
        },
    },
    sniper: {
        finish: familyFinish,
        body: (g, m) => MR.marksmanRifle(g, m),
        standard: (slot, m) => MR.createMarksmanFurniture(slot, m),
        mounts: MR.MARKSMAN_MOUNTS,
        bore: MR.MARKSMAN_BORE,
        parts: {
            upperReceiver: "upper",
            lowerReceiver: "lower",
            pistolGrip: "grip",
            handguard: "handguard",
            barrel: "barrel",
            bipod: "bipod",
            foldedSight: "sight",
            magazine: "magazine",
            stock: "stock",
        },
    },
    plasma: {
        finish: () => weaponFinish("plasma"),
        body: (g, m) => PR.plasmaRifle(g, m),
        standard: (slot, m) => PR.createPlasmaFurniture(slot, m),
        mounts: PR.PLASMA_MOUNTS,
        bore: PR.PLASMA_BORE,
        parts: {
            upperHousing: "upper",
            lowerReceiver: "lower",
            pistolGrip: "grip",
            capacitorBank: "capacitor",
            controlBox: "control",
            accelerator: "accelerator",
            emitter: "emitter",
            supportZone: "handguard",
            radiator: "radiator",
            power: "power",
            coolant: "coolant",
            cable: "cable",
            powerCell: "magazine",
            benchStock: "stock",
        },
    },
};

const [name, dir] = process.argv.slice(2);
const gun = GUNS[name];
if (!gun || !dir) {
    console.error(`usage: source.ts <${Object.keys(GUNS).join("|")}> <work-dir>`);
    process.exit(2);
}
mkdirSync(dir, { recursive: true });
let current: Detail = "high";

const PARTS = [...new Set(Object.values(gun.parts))];
/** Material slots, in the order the bake encodes them. */
const SLOTS = [
    "01_Cerakote",
    "02_Graphite",
    "03_Titanium",
    "04_Elastomer",
    "05_Copper",
    "06_OpticalGlass",
    "07_Indicator",
    "08_Markings",
];

// Per (geometry, material): one part id per triangle, in insertion order.
// Builders draw in the authoring frame into a scratch geometry that
// `inAuthoringFrame` re-adds merged; that re-add carries the scratch's
// per-face parts (looked up by geometry).
const log = new Map<object, Map<T.Material, number[]>>();
const byGeometry = new WeakMap<T.BufferGeometry, number[]>();
const add = GearGeometry.prototype.add;
GearGeometry.prototype.add = function (
    this: object,
    geometry: T.BufferGeometry,
    material: T.Material,
    ...rest: unknown[]
) {
    const tris = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    const names = new Error().stack!.split("\n").map((l) => l.trim().split(" ")[1]);
    const fn = names.find((n) => n && gun.parts[n]);
    const known = byGeometry.get(geometry);
    let faces: number[];
    if (fn) faces = new Array(tris).fill(PARTS.indexOf(gun.parts[fn]));
    else if (known && known.length === tris) faces = known;
    else throw new Error(`no part for a builder call: ${names.slice(2, 8).join(" < ")}`);
    const byMaterial = log.get(this) ?? new Map<T.Material, number[]>();
    log.set(this, byMaterial);
    const list = byMaterial.get(material) ?? [];
    byMaterial.set(material, list);
    for (const face of faces) list.push(face);
    return add.call(this, geometry, material, ...(rest as []));
};
const partsOf = new Map<T.Mesh, number[]>();
const finish = GearGeometry.prototype.finish;
GearGeometry.prototype.finish = function (this: object, label: string, basis?: T.Matrix4) {
    const byMaterial = log.get(this);
    log.delete(this);
    const root = finish.call(this, label, basis) as T.Group;
    for (const mesh of root.children as T.Mesh[]) {
        const faces = byMaterial!.get(mesh.material as T.Material)!;
        partsOf.set(mesh, faces);
        byGeometry.set(mesh.geometry, faces);
    }
    return root;
};

const INVERSE_BASIS = WEAPON_BASIS.clone().invert();

/** The gun at one detail, as `buildArmoryWeapon` lays it out. */
function build(detail: Detail) {
    current = detail;
    return withDetail(detail, () => {
        const m = gun.finish();
        const pieces: [string, T.Mesh[]][] = [];
        const g = new WeaponGeometry();
        gun.body(g, m);
        pieces.push(["body", sizeWeapon(g.finish("body")).children as T.Mesh[]]);
        for (const slot of ["clip", "stock"] as const) {
            const root = gun.standard(slot, m);
            const at = new T.Matrix4().makeTranslation(
                ...(gun.mounts[slot].map((v) => v * WEAPON_SCALE) as [number, number, number]),
            );
            for (const mesh of root.children as T.Mesh[])
                mesh.geometry.applyMatrix4(INVERSE_BASIS).applyMatrix4(at);
            pieces.push([slot, root.children as T.Mesh[]]);
        }
        const nodes = [];
        let tris = 0;
        for (const [piece, meshes] of pieces)
            for (const mesh of meshes) {
                const material = mesh.material as T.MeshStandardMaterial;
                const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
                const position = geometry.attributes.position.array as Float32Array;
                const parts = partsOf.get(mesh)!;
                if (parts.length * 9 !== position.length)
                    throw new Error(`part count mismatch: ${piece} ${material.name}`);
                const slot = SLOTS.indexOf(material.name);
                if (slot < 0) throw new Error(`unknown material slot ${material.name}`);
                tris += parts.length;
                nodes.push({
                    piece,
                    slot,
                    vertices: Array.from(position, (v) => Math.round(v * 1e7) / 1e7),
                    parts,
                });
            }
        return { nodes, tris, finish: m };
    });
}

for (const detail of ["high", "low"] as const) {
    const { nodes, tris } = build(detail);
    writeFileSync(
        `${dir}/source-${detail}.json`,
        JSON.stringify({ gun: name, parts: PARTS, slots: SLOTS, nodes }),
    );
    console.log(`SOURCE ${name} ${detail}: ${tris} triangles`);
}

// Factory finish per slot (sRGB), for what a skin leaves as built.
const m = gun.finish() as unknown as Record<string, T.MeshStandardMaterial>;
const factory: Record<string, { color: number; rough: number; metal: number }> = {};
for (const material of Object.values(m))
    factory[material.name] = {
        color: material.color.getHex(),
        rough: material.roughness,
        metal: material.metalness,
    };
writeFileSync(
    `${dir}/gun.json`,
    JSON.stringify(
        { gun: name, slots: SLOTS, parts: PARTS, bore: gun.bore * WEAPON_SCALE, factory },
        null,
        1,
    ),
);
writeFileSync(`${dir}/recipes.json`, JSON.stringify(SKIN_RECIPES, null, 1));
