// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
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
