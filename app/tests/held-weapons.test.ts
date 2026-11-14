// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import * as T from "three";
import {
    HELD_GRIP,
    HOLDER_BASIS,
    acquireHeldWeapon,
    createHeldWeapon,
    heldMount,
    heldMuzzle,
    heldPoint,
    heldSupport,
    heldTriangles,
    supportSeat,
    type HeldGun,
} from "@ghosts/squad/studio/held-weapons";
import {
    RIFLE_MOUNTS,
    RIFLE_MUZZLE,
    RIFLE_BORE,
} from "../../packages/squad/src/studio/service-rifle.ts";
import { ATTACHMENTS } from "../../packages/squad/src/catalog.ts";
import { WEAPON_BASIS } from "../../packages/squad/src/studio/gear-geometry.ts";
import { WEAPON_SCALE, WeaponGeometry } from "../../packages/squad/src/studio/weapon-finish.ts";
import { familyFinish } from "../../packages/squad/src/studio/rifle-shapes.ts";
import {
    createServiceFurniture,
    serviceRifle,
} from "../../packages/squad/src/studio/service-rifle.ts";
import {
    ARMORY_TO_SOCKET,
    acquireSkinnedHeldWeapon,
    createSkinnedHeldWeapon,
    skinnedHeldCache,
} from "../../packages/squad/src/studio/held-skins.ts";
import type { ArmorySkin, SkinPieces } from "../../packages/squad/src/studio/armory-skins.ts";

const GUNS: HeldGun[] = ["rifle", "sniper", "plasma"];
const holder = (p: T.Vector3) => p.clone().applyMatrix4(HOLDER_BASIS);
const toSocket = HOLDER_BASIS.clone().invert();
/** First hit on `group` along a holder-frame ray. */
function cast(group: T.Object3D, from: number[], direction: number[]) {
    group.updateMatrixWorld(true);
    const origin = new T.Vector3(...from).applyMatrix4(toSocket);
    const dir = new T.Vector3(...direction).transformDirection(toSocket);
    const hit = new T.Raycaster(origin, dir).intersectObject(group, true)[0];
    return hit && holder(hit.point);
}

for (const gun of GUNS) {
    test(`${gun}: low detail is a field-weight mesh, one draw per material`, () => {
        const high = createHeldWeapon(gun, {}, "high"),
            low = createHeldWeapon(gun, {}, "low");
        const meshes = (g: T.Group) => g.children.filter((c) => c instanceof T.Mesh) as T.Mesh[];
        for (const g of [high, low])
            for (const mesh of meshes(g)) {
                const position = mesh.geometry.attributes.position.array;
                assert.ok(Array.from(position).every(Number.isFinite), `${gun}: finite`);
                assert.ok(mesh.geometry.attributes.normal, `${gun}: normals`);
            }
        // One mesh per material, never one per part.
        const materials = new Set(meshes(low).map((m) => m.material));
        assert.equal(meshes(low).length, materials.size);
        assert.ok(meshes(low).length <= 8, `${gun}: ${meshes(low).length} draws`);
        assert.ok(heldTriangles(low) < heldTriangles(high), `${gun}: low is lighter`);
        // Field budget for the guns units carry in matches (rifle, marksman): no
        // heavier than the old field rifles (~21k triangles). The plasma rifle
        // is not issued on the field and has no reduced build yet.
        if (gun !== "plasma")
            assert.ok(heldTriangles(low) < 21300, `${gun}: ${heldTriangles(low)} triangles`);
    });

    test(`${gun}: the muzzle point is the crown on the bore`, () => {
        const g = createHeldWeapon(gun, {}, "low"),
            muzzle = holder(heldMuzzle(gun));
        assert.deepEqual(g.userData.muzzle, heldMuzzle(gun).toArray());
        // From ahead of the gun, back along the bore, around the open bore: the
        // foremost surface is the crown, at the muzzle point.
        let front = -Infinity;
        for (const r of [0.004, 0.006, 0.008, 0.01, 0.012, 0.014])
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                const hit = cast(
                    g,
                    [muzzle.x + 0.2, muzzle.y + r * Math.sin(a), r * Math.cos(a)],
                    [-1, 0, 0],
                );
                if (hit) front = Math.max(front, hit.x);
            }
        assert.ok(
            Math.abs(front - muzzle.x) < 0.004,
            `${gun}: crown at ${front}, muzzle ${muzzle.x}`,
        );
    });

    test(`${gun}: shared grip, left-side laser and fittings on their mounts`, () => {
        const base = createHeldWeapon(gun, {}, "low");
        // The trigger-hand contact sits on the family grip on every gun, and the
        // grip below it fills the palm (as the old long-gun test measured it).
        const grip = holder(new T.Vector3(...HELD_GRIP));
        const width = (x: number, y: number) => {
            const right = cast(base, [x, y, -0.1], [0, 0, 1]),
                left = cast(base, [x, y, 0.1], [0, 0, -1]);
            assert.ok(right && left && right.z < 0 && left.z > 0, `${gun}: grip at ${x}, ${y}`);
            return left.z - right.z;
        };
        assert.ok(width(grip.x, grip.y) > 0.015, `${gun}: grip at the contact`);
        const palm = width(grip.x - 0.9 * 0.026, grip.y - 0.9 * 0.015);
        assert.ok(palm > 0.023, `${gun}: palm-filling grip ${palm}`);
        // The laser rail is on the shooter's left: the support hand's side (+z).
        assert.ok(holder(heldMount(gun, "laser")).z > 0.01, `${gun}: laser on the left`);
        const scope = holder(heldMount(gun, "scope")),
            laser = holder(heldMount(gun, "laser"));
        const fitted = createHeldWeapon(gun, { scope: "scope-1", laser: "laser-1" }, "low");
        const top = (g: T.Group) => cast(g, [scope.x + 0.01, 0.3, 0], [0, -1, 0])!.y;
        assert.ok(top(fitted) > top(base) + 0.02, `${gun}: scope stands on its rail`);
        const side = (g: T.Group) => cast(g, [laser.x, laser.y, 0.3], [0, 0, -1])!.z;
        assert.ok(side(fitted) > side(base) + 0.008, `${gun}: laser stands off its rail`);
        for (const slot of ["scope", "laser"] as const)
            assert.equal(fitted.getObjectByName(`mount_${slot}`)!.userData.tier, 1);
        assert.equal(base.getObjectByName("mount_scope")!.userData.tier, undefined);
    });

    test(`${gun}: every fitting builds, at both details`, () => {
        for (const item of ATTACHMENTS)
            for (const detail of ["high", "low"] as const) {
                const g = createHeldWeapon(gun, { [item.slot]: item.id }, detail);
                const size = new T.Box3().setFromObject(g).getSize(new T.Vector3());
                assert.ok(size.y < 1.1 && size.x < 0.25 && size.z < 0.4, `${gun}/${item.id}`);
                g.traverse((o) => {
                    if (o instanceof T.Mesh) {
                        o.geometry.dispose();
                        o.material.dispose();
                    }
                });
            }
    });

    test(`${gun}: support seat is the handguard underside at its station`, () => {
        const g = createHeldWeapon(gun, {}, "high");
        const seat = supportSeat(g, gun),
            station = holder(heldSupport(gun));
        assert.equal(seat.contact.x, station.x);
        assert.ok(seat.contact.y < station.y - 0.01, `${gun}: underside below the bore`);
        assert.ok(seat.contact.y > station.y - 0.06, `${gun}: a forend, not the magazine`);
        assert.ok(seat.half > 0.012 && seat.half < 0.06, `${gun}: half width ${seat.half}`);
        // The station is on the gun's own handguard, ahead of the receiver.
        assert.ok(station.x > holder(new T.Vector3(...HELD_GRIP)).x + 0.15);
    });
}

test("held points follow the gun tables, scaled about the shared grip", () => {
    // The trigger-hand contact (authoring -0.114, -0.045) is the fixed point.
    const pivot = heldPoint([-0.114, -0.045, 0]);
    assert.ok(pivot.distanceTo(new T.Vector3(...HELD_GRIP)) < 1e-9);
    // Table points (weapon frame, +z right) land 0.9x as far from it, with the
    // shooter's left on the holder's +z.
    const scope = holder(heldMount("rifle", "scope")),
        laser = holder(heldMount("rifle", "laser")),
        muzzle = holder(heldPoint([RIFLE_MUZZLE, RIFLE_BORE, 0]));
    const [sx, sy] = RIFLE_MOUNTS.scope,
        [lx, ly, lz] = RIFLE_MOUNTS.laser;
    assert.ok(Math.abs(scope.x - muzzle.x - 0.9 * (sx - RIFLE_MUZZLE)) < 1e-9);
    assert.ok(Math.abs(scope.y - muzzle.y - 0.9 * (sy - RIFLE_BORE)) < 1e-9);
    assert.ok(Math.abs(laser.x - muzzle.x - 0.9 * (lx - RIFLE_MUZZLE)) < 1e-9);
    assert.ok(Math.abs(laser.y - muzzle.y - 0.9 * (ly - RIFLE_BORE)) < 1e-9);
    assert.ok(Math.abs(laser.z + 0.9 * lz) < 1e-9);
});

test("acquired guns share one build per (gun, fittings, detail)", () => {
    const a = acquireHeldWeapon("rifle", { scope: "scope-2" }, "low"),
        b = acquireHeldWeapon("rifle", { scope: "scope-2" }, "low"),
        c = acquireHeldWeapon("rifle", {}, "low");
    const geometry = (g: T.Group) =>
        (g.children.find((o) => o instanceof T.Mesh) as T.Mesh).geometry;
    assert.equal(geometry(a.model), geometry(b.model));
    assert.notEqual(geometry(a.model), geometry(c.model));
    assert.ok(a.model.children.some((o) => o.userData.sharedWeapon));
    a.release();
    a.release();
    b.release();
    c.release();
});

// ---- Skinned held guns (held-skins.ts) ----

/** The skin mesh's body, clip and stock, read straight from the GLB (node
 * has no image decoder, so the embedded maps are skipped). */
function skinPieces(): SkinPieces {
    const b = readFileSync("public/squad/weapons/skins/rifle.glb");
    const length = b.readUInt32LE(12),
        json = JSON.parse(b.subarray(20, 20 + length).toString()),
        bin = 20 + length + 8;
    const read = (i: number) => {
        const a = json.accessors[i],
            view = json.bufferViews[a.bufferView];
        const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
        const float = a.componentType === 5126,
            size = float ? 4 : a.componentType === 5125 ? 4 : 2,
            stride = view.byteStride ?? n * size;
        const out = float ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
        const data = new DataView(
            b.buffer,
            b.byteOffset + bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
        );
        for (let k = 0; k < a.count; k++)
            for (let c = 0; c < n; c++) {
                const at = k * stride + c * size;
                out[k * n + c] = float
                    ? data.getFloat32(at, true)
                    : size === 4
                      ? data.getUint32(at, true)
                      : data.getUint16(at, true);
            }
        return new T.BufferAttribute(out, n);
    };
    const pieces: Partial<SkinPieces> = {};
    for (const mesh of json.meshes) {
        const p = mesh.primitives[0],
            g = new T.BufferGeometry();
        g.setAttribute("position", read(p.attributes.POSITION));
        g.setAttribute("normal", read(p.attributes.NORMAL));
        g.setAttribute("uv", read(p.attributes.TEXCOORD_0));
        g.setAttribute("tangent", read(p.attributes.TANGENT));
        g.setIndex(read(p.indices));
        pieces[mesh.name as keyof SkinPieces] = g;
    }
    return pieces as SkinPieces;
}

/** A skin as `loadArmorySkin` hands it out, counting its references. */
function fakeSkin(name: string, pieces = skinPieces()) {
    const material = new T.MeshStandardMaterial();
    material.userData.armorySkin = `rifle:${name}`;
    let disposed = false;
    material.addEventListener("dispose", () => (disposed = true));
    const skin = {
        key: `rifle:${name}`,
        pieces,
        material,
        refs: 0,
        retain() {
            skin.refs++;
        },
        release() {
            skin.refs--;
        },
        get disposed() {
            return disposed;
        },
    };
    return skin satisfies ArmorySkin;
}

const boxOf = (geometries: T.BufferGeometry[]) => {
    const box = new T.Box3();
    for (const g of geometries) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
    }
    return box;
};
const gap = (a: T.Box3, b: T.Box3) =>
    Math.max(
        ...a.min.clone().sub(b.min).toArray().map(Math.abs),
        ...a.max.clone().sub(b.max).toArray().map(Math.abs),
    );
const meshesOf = (g: T.Object3D) => g.children.filter((c) => c instanceof T.Mesh) as T.Mesh[];

test("skinned rifle: body, clip and stock sit where the procedural ones do in the hand", () => {
    const pieces = skinPieces();
    // The skin's frame to the socket agrees with the held gun's own tables.
    for (const p of [
        [0, 0, 0],
        [RIFLE_MUZZLE, RIFLE_BORE, 0],
        [-0.114, -0.045, 0.03],
        ...Object.values(RIFLE_MOUNTS),
    ]) {
        const sized = new T.Vector3(...p)
            .multiplyScalar(WEAPON_SCALE)
            .applyMatrix4(ARMORY_TO_SOCKET);
        assert.ok(sized.distanceTo(heldPoint(p)) < 1e-9);
    }
    // Each piece against the procedural build of the same piece, both in the
    // hand socket. The skin is a bake of the authored gun at game density, so
    // its outline differs by well under a millimetre, not by a transform.
    const m = familyFinish(),
        sized = new T.Matrix4().makeScale(WEAPON_SCALE, WEAPON_SCALE, WEAPON_SCALE),
        unbasis = WEAPON_BASIS.clone().invert();
    const g = new WeaponGeometry();
    serviceRifle(g, m, "high");
    const procedural = {
        body: meshesOf(g.finish("body")).map((x) =>
            x.geometry.applyMatrix4(sized).applyMatrix4(ARMORY_TO_SOCKET),
        ),
        ...Object.fromEntries(
            (["clip", "stock"] as const).map((slot) => {
                const at = new T.Matrix4().makeTranslation(
                    ...(RIFLE_MOUNTS[slot].map((v) => v * WEAPON_SCALE) as [
                        number,
                        number,
                        number,
                    ]),
                );
                return [
                    slot,
                    meshesOf(createServiceFurniture(slot, m, "high")).map((x) =>
                        x.geometry
                            .applyMatrix4(unbasis)
                            .applyMatrix4(at)
                            .applyMatrix4(ARMORY_TO_SOCKET),
                    ),
                ];
            }),
        ),
    } as Record<keyof SkinPieces, T.BufferGeometry[]>;
    for (const piece of ["body", "clip", "stock"] as const) {
        const skinned = boxOf([pieces[piece].clone().applyMatrix4(ARMORY_TO_SOCKET)]);
        const d = gap(boxOf(procedural[piece]), skinned);
        assert.ok(d < 0.0008, `${piece}: ${(d * 1000).toFixed(2)} mm`);
    }
    // The whole held build, and its interface, against the factory gun.
    const skin = fakeSkin("align", pieces),
        skinned = createSkinnedHeldWeapon("rifle", {}, skin),
        factory = createHeldWeapon("rifle", {}, "high");
    const d = gap(new T.Box3().setFromObject(factory), new T.Box3().setFromObject(skinned));
    assert.ok(d < 0.0008, `whole gun: ${(d * 1000).toFixed(2)} mm`);
    assert.deepEqual(skinned.userData.muzzle, factory.userData.muzzle);
    for (const slot of ["scope", "laser", "clip", "stock"])
        assert.ok(
            skinned
                .getObjectByName(`mount_${slot}`)!
                .position.equals(factory.getObjectByName(`mount_${slot}`)!.position),
        );
    // One draw for body, clip and stock; a fraction of the authored triangles.
    assert.equal(meshesOf(skinned).length, 1);
    assert.equal(meshesOf(skinned)[0].material, skin.material);
    assert.ok(heldTriangles(skinned) < 8000, `${heldTriangles(skinned)} triangles`);
    assert.ok(heldTriangles(factory) > 4 * heldTriangles(skinned));
});

test("skinned rifle: mirrored into the socket like the procedural gun, faces still outward", () => {
    // Same handedness as the held frame (both mirror, the socket reflects back).
    assert.ok(ARMORY_TO_SOCKET.determinant() < 0);
    const g = createSkinnedHeldWeapon("rifle", {}, fakeSkin("winding")),
        geometry = meshesOf(g)[0].geometry,
        index = geometry.index!.array,
        p = geometry.attributes.position,
        n = geometry.attributes.normal;
    // Rewound after the mirror: each face's winding agrees with its normals.
    let agree = 0;
    const a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3(),
        normal = new T.Vector3();
    for (let t = 0; t < index.length; t += 3) {
        a.fromBufferAttribute(p, index[t]);
        b.fromBufferAttribute(p, index[t + 1]);
        c.fromBufferAttribute(p, index[t + 2]);
        normal.fromBufferAttribute(n, index[t]);
        const face = b.sub(a).cross(c.sub(a));
        if (face.dot(normal) > 0) agree++;
    }
    assert.ok(agree / (index.length / 3) > 0.95, `${agree} of ${index.length / 3}`);
    // Tangents keep their handedness sign (the socket's reflection restores it).
    const source = skinPieces().body.attributes.tangent,
        moved = geometry.attributes.tangent;
    for (let i = 0; i < source.count; i += 97) assert.equal(moved.getW(i), source.getW(i));
});

test("skinned rifle: upgrades stay procedural beside the skinned body", () => {
    const skin = fakeSkin("fitted"),
        fits = { scope: "scope-1", laser: "laser-1", clip: "clip-2" },
        g = createSkinnedHeldWeapon("rifle", fits, skin),
        factory = createHeldWeapon("rifle", fits, "high");
    const materials = meshesOf(g).map((x) => x.material as T.Material);
    assert.ok(materials.includes(skin.material));
    assert.ok(
        materials.some((x) => x !== skin.material),
        "fittings in their own finish",
    );
    // No laser beam on a held gun, as on the procedural one.
    assert.equal(meshesOf(g).length, meshesOf(factory).length);
    const d = gap(new T.Box3().setFromObject(factory), new T.Box3().setFromObject(g));
    assert.ok(d < 0.0008, `fitted gun: ${(d * 1000).toFixed(2)} mm`);
    assert.equal(g.getObjectByName("mount_scope")!.userData.tier, 1);
});

test("skinned builds are shared per (gun, fittings, skin) and hold their skin", () => {
    const pieces = skinPieces(),
        camo = fakeSkin("camo-cache", pieces),
        heavy = fakeSkin("heavy-cache", pieces);
    const a = acquireSkinnedHeldWeapon("rifle", {}, camo),
        b = acquireSkinnedHeldWeapon("rifle", {}, camo),
        c = acquireSkinnedHeldWeapon("rifle", {}, heavy),
        d = acquireSkinnedHeldWeapon("rifle", { scope: "scope-1" }, camo);
    const geometry = (g: T.Group) => meshesOf(g)[0].geometry;
    assert.equal(geometry(a.model), geometry(b.model));
    assert.notEqual(geometry(a.model), geometry(c.model));
    assert.equal(a.model.userData.skin, "rifle:camo-cache");
    // One reference on the skin per build, not per holder.
    assert.equal(camo.refs, 2);
    assert.equal(heavy.refs, 1);
    for (const h of [a, b, c, d]) h.release();
    a.release();
    // Idle builds are kept a little while, then let go of their skin.
    const fillers = ["f1", "f2", "f3", "f4"].map((n) => fakeSkin(n, pieces));
    for (const f of fillers) acquireSkinnedHeldWeapon("rifle", {}, f).release();
    assert.equal(camo.refs, 0);
    assert.equal(heavy.refs, 0);
    assert.ok(!camo.disposed, "the skin's material is the loader's to dispose");
    assert.ok(skinnedHeldCache().every((e) => e.refs === 0));
});

test("EquipmentAssets: a skin that fails to load gives the factory gun", async () => {
    // EquipmentAssets imports without extensions, as the bundler resolves them.
    register(
        "data:text/javascript," +
            encodeURIComponent(`export async function resolve(s, c, next) {
                if (s.startsWith(".") && !/\\.[a-z]+$/.test(s))
                    try { return await next(s + ".ts", c); } catch {}
                return next(s, c);
            }`),
    );
    const { EquipmentAssets } = await import("../../packages/squad/src/studio/equipment-assets.ts");
    const calls: string[] = [];
    const failing = new EquipmentAssets("high", async (_gun, _fits, skin) => {
        calls.push(skin);
        throw Error("offline");
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
        const gun = await failing.get("rifle", {}, "camo");
        assert.equal(gun.userData.skin, undefined);
        assert.equal(heldTriangles(gun), heldTriangles(createHeldWeapon("rifle", {}, "high")));
        // Forgotten, so the next request retries.
        await failing.get("rifle", {}, "camo");
        assert.deepEqual(calls, ["camo", "camo"]);
        // Factory, no skin, unknown skins and guns without skins never load one.
        await failing.get("rifle", {}, "factory");
        await failing.get("rifle", {});
        await failing.get("rifle", {}, "nonsense");
        await failing.get("sniper", {}, "camo");
        assert.equal(calls.length, 2);
    } finally {
        console.warn = warn;
        failing.dispose();
    }
    const skin = fakeSkin("assets");
    const working = new EquipmentAssets("high", async (gun, fits) =>
        acquireSkinnedHeldWeapon(gun, fits, skin),
    );
    const gun = await working.get("rifle", {}, "camo");
    assert.equal(gun.userData.skin, "rifle:assets");
    assert.ok(gun.userData.center && gun.userData.muzzle);
    working.dispose();
});
