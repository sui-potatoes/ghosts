// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import {
    createLongGun,
    BORE_HEIGHT,
    WEAPON_MOUNTS,
    sizedWeaponPoint,
} from "@ghosts/squad/studio/long-guns";
import {
    createWeaponAttachment,
    createStandardFurniture,
} from "../../packages/squad/src/studio/weapon-attachments.ts";
import { weaponFinish } from "../../packages/squad/src/studio/weapon-finish.ts";
import { ATTACHMENTS } from "../../packages/squad/src/catalog.ts";
import { createFieldSupply } from "../../packages/squad/src/studio/field-supplies.ts";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { skinMeshes, posedSurface, rigidAsset } from "./gear-collision.ts";
import { equipmentPose } from "@ghosts/squad/motion/equipment-poses";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";

for (const kind of ["rifle", "sniper", "plasma"] as const) {
    test(`${kind}: complete geometry, empty optics mounts and coherent barrel axis`, () => {
        const gun = createLongGun(kind);
        const bounds = new T.Box3().setFromObject(gun);
        const size = bounds.getSize(new T.Vector3());
        assert.ok(size.y > (kind === "sniper" ? 0.83 : 0.63));
        assert.ok(size.y < (kind === "sniper" ? 0.9 : 0.72));
        let triangles = 0;
        gun.traverse((part) => {
            if (!(part instanceof T.Mesh)) return;
            assert.ok(Array.from(part.geometry.attributes.position.array).every(Number.isFinite));
            assert.ok(Array.from(part.geometry.attributes.normal.array).every(Number.isFinite));
            assert.ok(part.geometry.attributes.uv);
            triangles += part.geometry.attributes.position.count / 3;
        });
        assert.ok(triangles < 40000, `${triangles} triangles`);
        assert.equal(gun.getObjectByName("mount_scope")!.children.length, 0, "no scope by default");
        assert.equal(gun.getObjectByName("mount_laser")!.children.length, 0, "no laser by default");
        // A ray along the bore must meet the muzzle face at the advertised exit.
        const ray = new T.Raycaster(
            new T.Vector3(0, 1, sizedWeaponPoint(new T.Vector3(0, 0, -BORE_HEIGHT)).z),
            new T.Vector3(0, -1, 0),
        );
        const hits = ray.intersectObject(gun);
        assert.ok(hits.length > 0);
        assert.ok(Math.abs(hits[0].point.y - gun.userData.muzzle[1]) < 0.003);
    });
    test(`${kind}: grip and trigger bow form a substantial connected lower assembly`, () => {
        const gun = createLongGun(kind);
        gun.updateMatrixWorld(true);
        const at = (x: number, y: number, z: number) => sizedWeaponPoint(new T.Vector3(-z, x, -y));
        const side = (x: number, y: number, z = 0.1) =>
            new T.Raycaster(at(x, y, z), new T.Vector3(z > 0 ? 1 : -1, 0, 0)).intersectObject(gun);
        // The receiver-to-grip web must remain solid across the former gap.
        for (let y = -0.03; y <= 0.025; y += 0.005)
            assert.ok(side(-0.135, y).length, `${kind}: disconnected grip at y=${y}`);
        // Follow the bottom of the trigger bow all the way back into the grip.
        for (let x = -0.113; x <= -0.043; x += 0.005)
            assert.ok(side(x, -0.043).length, `${kind}: detached trigger guard at x=${x}`);
        const left = side(-0.14, -0.06)[0],
            right = side(-0.14, -0.06, -0.1)[0];
        assert.ok(
            left && right && right.point.x - left.point.x >= 0.023,
            "grip must retain palm-filling thickness",
        );
        const front = new T.Raycaster(at(0, -0.065, 0), new T.Vector3(0, -1, 0)).intersectObject(
            gun,
        )[0];
        const back = new T.Raycaster(at(-0.22, -0.065, 0), new T.Vector3(0, 1, 0)).intersectObject(
            gun,
        )[0];
        assert.ok(
            front && back && front.point.y - back.point.y >= 0.032,
            "grip must retain its fore/aft width",
        );
    });
    for (const sex of ["female", "male"])
        test(`${kind}/${sex}: trigger grip stays in palm through ready, fire, reload and run`, () => {
            const b = readFileSync(`public/squad/body/${sex}/skin.glb`);
            const root = motionSkeleton(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
            const hand = root.getObjectByName("mixamorigRightHand") as T.Bone;
            const skin = skinMeshes(`public/squad/body/${sex}/skin.glb`, root);
            const poses = JSON.parse(
                gunzipSync(readFileSync(`public/squad/motions/${sex}-equipment.bin`)).toString(),
            );
            const gun = createLongGun(kind),
                group = new T.Group();
            gun.quaternion.setFromRotationMatrix(
                new T.Matrix4().makeBasis(
                    new T.Vector3(0, 0, -1),
                    new T.Vector3(1, 0, 0),
                    new T.Vector3(0, -1, 0),
                ),
            );
            group.add(gun);
            group.userData.center = [0, 0, 0];
            group.userData.model = kind;
            mountHandEquipment(
                group,
                hand,
                JSON.parse(readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8")),
            );
            const source = JSON.parse(
                gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
            );
            const mixer = new T.AnimationMixer(root);
            for (const name of [
                "rifle_idle",
                "rifle_burst",
                "sniper_shot",
                "reload",
                "rifle_run",
            ]) {
                mixer.stopAllAction();
                const clip = equipmentPose(
                    nativeClip(
                        T.AnimationClip.parse(
                            source.find((c: { name: string }) => c.name === name),
                        ),
                    ),
                    poses,
                );
                const action = mixer.clipAction(clip).play();
                for (const fraction of [0, 0.3, 0.6, 0.99]) {
                    action.time = clip.duration * fraction;
                    mixer.update(0);
                    root.updateMatrixWorld(true);
                    const surface = posedSurface(skin);
                    let contact = Infinity;
                    // Measure skin-to-grip contact, not distance to the old sizing pivot.
                    for (const y of [-0.025, -0.045, -0.065, -0.085]) {
                        for (const [dx, dz] of [
                            [1, 0],
                            [-1, 0],
                            [0, 1],
                            [0, -1],
                        ]) {
                            const a = gun.localToWorld(
                                sizedWeaponPoint(new T.Vector3(-dz * 0.09, -0.14 + dx * 0.09, -y)),
                            );
                            const b = gun.localToWorld(
                                sizedWeaponPoint(new T.Vector3(0, -0.14, -y)),
                            );
                            const ray = new T.Raycaster(
                                a,
                                b.clone().sub(a).normalize(),
                                0,
                                a.distanceTo(b),
                            );
                            const shells = ray.intersectObject(gun).filter((hit) => {
                                const p = group.worldToLocal(hit.point.clone());
                                return p.x < -0.095 && p.x > -0.19;
                            });
                            const fingers = surface
                                .segment(a, b)
                                .filter((hit) => hit.region.includes("RightHand"));
                            for (const shell of shells)
                                for (const finger of fingers)
                                    contact = Math.min(
                                        contact,
                                        shell.point.distanceTo(new T.Vector3(...finger.point)),
                                    );
                        }
                    }
                    assert.ok(
                        contact < 0.008,
                        `${name}@${fraction}: hand is ${(contact * 1000).toFixed(1)} mm from grip`,
                    );
                }
            }
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
        });
}
test("field supplies are human-scale, finite, and limited to four finishes", () => {
    for (const kind of ["grenade", "medkit"] as const) {
        const group = createFieldSupply(kind),
            size = new T.Box3().setFromObject(group).getSize(new T.Vector3());
        assert.equal(group.children.length, 4);
        assert.ok(size.y < 0.25);
        assert.ok(size.x < (kind === "grenade" ? 0.12 : 0.32));
        for (const mesh of group.children as T.Mesh[])
            assert.ok(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite));
    }
});

test("exported GLBs preserve every socket and contain texture-ready normals, tangents and UVs", () => {
    for (const kind of ["rifle", "sniper", "plasma"]) {
        const bytes = readFileSync(`public/squad/weapons/${kind}.glb`);
        const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
        for (const [slot, xyz] of Object.entries(WEAPON_MOUNTS)) {
            const mount = gltf.nodes.find(
                (n: { extras?: { interface?: string } }) =>
                    n.extras?.interface === `ghosts:${slot}:v1`,
            );
            assert.ok(mount, `${kind}/${slot} exists`);
            const [x, y, z] = kind === "plasma" && slot === "laser" ? [0.27, 0.058, 0.052] : xyz;
            const expected = sizedWeaponPoint(new T.Vector3(-z, x, -y)).toArray();
            assert.ok(mount.translation, `${kind}/${slot} must not lose its transform`);
            assert.ok(
                mount.translation.every((v: number, i: number) => Math.abs(v - expected[i]) < 1e-6),
                `${kind}/${slot}`,
            );
            if (slot === "scope" || slot === "laser") assert.equal(mount.children?.length ?? 0, 0);
        }
        for (const mesh of gltf.meshes)
            for (const primitive of mesh.primitives) {
                for (const attribute of ["NORMAL", "TEXCOORD_0", "TANGENT"]) {
                    assert.notEqual(
                        primitive.attributes[attribute],
                        undefined,
                        `${kind}/${mesh.name}/${attribute}`,
                    );
                    assert.ok(gltf.accessors[primitive.attributes[attribute]].count > 0);
                }
            }
    }
});

test("all twelve attachment meshes assemble on every rifle without modifying the default assets", () => {
    for (const kind of ["rifle", "sniper", "plasma"] as const) {
        const original = createLongGun(kind);
        for (const attachment of ATTACHMENTS) {
            const fitted = createLongGun(kind, { [attachment.slot]: attachment.id });
            const mount = fitted.getObjectByName(`mount_${attachment.slot}`)!;
            assert.equal(mount.children.length, 1);
            assert.equal(mount.children[0].userData.tier, attachment.tier);
            assert.equal(mount.children[0].name, attachment.id);
            assert.ok(mount.children[0].position.length() === 0, "attachment uses socket origin");
            const size = new T.Box3().setFromObject(fitted).getSize(new T.Vector3());
            assert.ok(
                size.x < 0.2 && size.y < 1.1 && size.z < 0.4,
                `${kind}/${attachment.id} bounds`,
            );
            fitted.traverse((o) => {
                if (o instanceof T.Mesh) o.geometry.dispose();
            });
        }
        assert.equal(original.getObjectByName("mount_scope")!.children.length, 0);
    }
});

test("all fifteen exported assets have finite unit-range UVs and material channels", () => {
    for (const id of ["rifle", "sniper", "plasma", ...ATTACHMENTS.map((a) => a.id)]) {
        const bytes = readFileSync(`public/squad/weapons/${id}.glb`);
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
        const binaryOffset = 20 + jsonLength + 8;
        assert.ok(gltf.materials.length > 0);
        for (const material of gltf.materials)
            assert.ok(material.name.includes("/0"), material.name);
        for (const mesh of gltf.meshes)
            for (const primitive of mesh.primitives) {
                const accessor = gltf.accessors[primitive.attributes.TEXCOORD_0];
                const view = gltf.bufferViews[accessor.bufferView];
                const offset = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
                for (let i = 0; i < accessor.count; i++)
                    for (let component = 0; component < 2; component++) {
                        const uv = bytes.readFloatLE(
                            offset + i * (view.byteStride ?? 8) + component * 4,
                        );
                        assert.ok(
                            Number.isFinite(uv) && uv >= -1e-5 && uv <= 1.00001,
                            `${id}: invalid UV ${uv}`,
                        );
                    }
            }
    }
});

test("compact optics and lasers, distinct magazine capacities, and current exported geometry", () => {
    const box = (o: T.Object3D) => new T.Box3().setFromObject(o);
    const size = (o: T.Object3D) => box(o).getSize(new T.Vector3());
    const basic = createWeaponAttachment("scope", 1);
    const opticSize = size(basic);
    assert.ok(opticSize.x < 0.04 && opticSize.y < 0.045 && opticSize.z < 0.04);
    const ray = new T.Raycaster(new T.Vector3(0, 0.1, -0.025 * 0.9), new T.Vector3(0, -1, 0));
    const first = ray.intersectObject(basic)[0].object as T.Mesh;
    assert.equal(
        (first.material as T.Material).name,
        "06_OpticalGlass",
        "lens faces the bore axis",
    );
    let previous = size(createStandardFurniture("clip", "rifle", weaponFinish("rifle"))).z;
    for (const tier of [1, 2, 3] as const) {
        const height = size(createWeaponAttachment("clip", tier)).z;
        assert.ok(height - previous > 0.011, "capacity changes the silhouette");
        previous = height;
        assert.ok(size(createWeaponAttachment("laser", tier)).y < 0.065, "laser stays compact");
    }
    for (const item of ATTACHMENTS) {
        const expected = box(createWeaponAttachment(item.slot, item.tier));
        const bytes = readFileSync(`public/squad/weapons/${item.id}.glb`);
        const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
        const actual = new T.Box3();
        for (const mesh of gltf.meshes)
            for (const primitive of mesh.primitives) {
                const a = gltf.accessors[primitive.attributes.POSITION];
                actual.expandByPoint(new T.Vector3(...a.min));
                actual.expandByPoint(new T.Vector3(...a.max));
            }
        assert.ok(
            actual.min.distanceTo(expected.min) < 2e-6 &&
                actual.max.distanceTo(expected.max) < 2e-6,
            `${item.id}: rebuild the GLB after changing its geometry`,
        );
    }
});

test("exported plasma: rail bridges the receiver and is supported across the shroud", () => {
    const gun = rigidAsset("public/squad/weapons/plasma.glb");
    gun.updateMatrixWorld(true);
    const at = (x: number, y: number, z: number) => sizedWeaponPoint(new T.Vector3(-z, x, -y));
    for (let x = -0.16; x <= 0.32; x += 0.004) {
        const hits = new T.Raycaster(at(x, 0.083, 0.1), new T.Vector3(1, 0, 0)).intersectObject(
            gun,
        );
        assert(hits.length, `top rail has a gap at ${x}`);
    }
    // Each saddle must connect the center rail to both outer shroud panels.
    for (const x of [0.172, 0.243, 0.319]) {
        for (const z of [-0.04, 0, 0.04]) {
            const hits = new T.Raycaster(at(x, 0.1, z), new T.Vector3(0, 0, 1)).intersectObject(
                gun,
            );
            assert(
                hits.some((h) => h.distance < 0.03),
                `unsupported rail saddle at ${x}/${z}`,
            );
        }
    }
});

test("exported plasma: lower shroud saddles and muzzle yokes connect both sides", () => {
    const gun = rigidAsset("public/squad/weapons/plasma.glb");
    gun.updateMatrixWorld(true);
    const at = (x: number, y: number, z: number) => sizedWeaponPoint(new T.Vector3(-z, x, -y));
    const underside = (x: number, z: number) => {
        const hits = new T.Raycaster(at(x, 0, z), new T.Vector3(0, 0, -1)).intersectObject(gun);
        assert(
            hits.some((h) => h.distance < 0.026),
            `missing lower connector at ${x}/${z}`,
        );
    };
    // Scan across the full opening, not just the panel edges or central barrel.
    for (const x of [0.196, 0.245, 0.323])
        for (let z = -0.044; z <= 0.044; z += 0.004) underside(x, z);
    for (const x of [0.337, 0.394]) for (let z = -0.03; z <= 0.03; z += 0.003) underside(x, z);
    // The front saddle must reach the fore-end through a continuous lower spine.
    for (let x = 0.26; x < 0.34; x += 0.004) underside(x, 0);
});

test("exported plasma: all stencil vertices sit immediately above solid panels", () => {
    const gun = rigidAsset("public/squad/weapons/plasma.glb");
    gun.updateMatrixWorld(true);
    const stencils = gun.getObjectByName("plasma_Stencils")!;
    assert(stencils, "export includes warning labels");
    const solids: T.Object3D[] = [];
    gun.traverse((part) => {
        if (part instanceof T.Mesh && part.parent !== stencils) solids.push(part);
    });
    let count = 0;
    stencils.traverse((part) => {
        if (!(part instanceof T.Mesh)) return;
        const positions = part.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const point = new T.Vector3()
                .fromBufferAttribute(positions, i)
                .applyMatrix4(part.matrixWorld);
            const outward = new T.Vector3(Math.sign(point.x), 0, 0);
            const ray = new T.Raycaster(
                point.clone().addScaledVector(outward, 0.002),
                outward.negate(),
                0,
                0.003,
            );
            const hit = ray.intersectObjects(solids, false)[0];
            assert(
                hit && hit.distance >= 0.002 && hit.distance < 0.0024,
                `stencil floats or is buried at ${point.toArray()}: ${hit?.distance}`,
            );
            count++;
        }
    });
    assert(count > 100, "checked every exported label vertex");
});

for (const sex of ["female", "male"]) {
    test(`${sex}: trigger fingers keep distinct rows and a rounded joint bend`, () => {
        const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
        const root = motionSkeleton(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
        );
        const source = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
        );
        const poses = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}-equipment.bin`)).toString(),
        );
        const mixer = new T.AnimationMixer(root);
        const joint = (finger: string, n: number) =>
            root.getObjectByName(`mixamorigRightHand${finger}${n}`)!;
        const point = (finger: string, n: number) =>
            joint(finger, n).getWorldPosition(new T.Vector3());
        for (const name of ["idle_weight_shift", "rifle_burst", "sniper_shot", "reload"]) {
            mixer.stopAllAction();
            const clip = equipmentPose(
                nativeClip(
                    T.AnimationClip.parse(source.find((c: { name: string }) => c.name === name)),
                ),
                poses,
            );
            const action = mixer.clipAction(clip).play();
            for (const fraction of [0, 0.5, 0.99]) {
                action.time = clip.duration * fraction;
                mixer.update(0);
                root.updateMatrixWorld(true);
                for (const [a, b] of [
                    ["Middle", "Ring"],
                    ["Ring", "Pinky"],
                ]) {
                    const spacing = point(a, 2).distanceTo(point(b, 2));
                    const knuckles = point(a, 1).distanceTo(point(b, 1));
                    assert(spacing >= knuckles * 0.6, `${name}: ${a}/${b} bunch together`);
                }
                for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
                    const segments = [
                        point(finger, 2).sub(point(finger, 1)).normalize(),
                        point(finger, 3).sub(point(finger, 2)).normalize(),
                        new T.Vector3(0, 1, 0)
                            .applyQuaternion(
                                joint(finger, 3).getWorldQuaternion(new T.Quaternion()),
                            )
                            .normalize(),
                    ];
                    for (let i = 1; i < segments.length; i++)
                        assert(
                            segments[i - 1].dot(segments[i]) > 0,
                            `${name}: ${finger} folds more than 90 degrees at joint ${i + 1}`,
                        );
                }
            }
        }
    });
}

for (const sex of ["female", "male"]) {
    for (const model of ["rifle", "sniper"]) {
        test(`${sex}/${model}: thumb web stays relaxed and the trigger fingertip does not hook back`, () => {
            const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
            const root = motionSkeleton(
                file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
            );
            const source = JSON.parse(
                gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
            );
            const poses = JSON.parse(
                gunzipSync(
                    readFileSync(
                        `public/squad/motions/${sex}${model === "sniper" ? "-sniper" : ""}-equipment.bin`,
                    ),
                ).toString(),
            );
            const reference = JSON.parse(
                readFileSync("scripts/equipment-fit/references.json", "utf8"),
            )[sex];
            const thumb = root.getObjectByName("mixamorigLeftHandThumb1")!;
            const neutral = new T.Quaternion().fromArray(
                reference.ready.rotations[thumb.name].local,
            );
            const index = [1, 2, 3].map((n) =>
                root.getObjectByName(`mixamorigRightHandIndex${n}`)!,
            );
            const mixer = new T.AnimationMixer(root);
            for (const name of [
                "idle_weight_shift",
                "rifle_idle",
                "rifle_run",
                "rifle_burst",
                "sniper_shot",
            ]) {
                mixer.stopAllAction();
                const clip = equipmentPose(
                    nativeClip(
                        T.AnimationClip.parse(
                            source.find((c: { name: string }) => c.name === name),
                        ),
                    ),
                    poses,
                );
                const action = mixer.clipAction(clip).play();
                for (const fraction of [0, 0.5, 0.99]) {
                    action.time = clip.duration * fraction;
                    mixer.update(0);
                    root.updateMatrixWorld(true);
                    assert(
                        thumb.quaternion.angleTo(neutral) < T.MathUtils.degToRad(45),
                        `${name}: support thumb metacarpal pulls the web away from the palm`,
                    );
                    const segments = [
                        index[1]
                            .getWorldPosition(new T.Vector3())
                            .sub(index[0].getWorldPosition(new T.Vector3()))
                            .normalize(),
                        index[2]
                            .getWorldPosition(new T.Vector3())
                            .sub(index[1].getWorldPosition(new T.Vector3()))
                            .normalize(),
                        new T.Vector3(0, 1, 0)
                            .applyQuaternion(index[2].getWorldQuaternion(new T.Quaternion()))
                            .normalize(),
                    ];
                    assert(
                        segments[0].dot(segments[2]) > 0,
                        `${name}: trigger fingertip reverses direction`,
                    );
                    assert(
                        segments[1].angleTo(segments[2]) < T.MathUtils.degToRad(35),
                        `${name}: trigger finger has a sharp distal hook`,
                    );
                }
            }
        });
    }
}
