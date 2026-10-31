// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose } from "@ghosts/squad/motion/equipment-poses";
import { createLongGun } from "@ghosts/squad/studio/long-guns";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { skinMeshes, posedSurface, weaponEdges } from "./gear-collision.ts";

// Track the actual wrist skin ring, so a clear but collapsed wrist cannot pass.
function wristRings(root: T.Group, skin: T.SkinnedMesh[]) {
    root.updateMatrixWorld(true);
    skin.forEach((m) => m.skeleton.update());
    return ["Left", "Right"].map((side) => {
        const hand = root.getObjectByName(`mixamorig${side}Hand`)!;
        const forearm = hand.parent!;
        const center = hand.getWorldPosition(new T.Vector3());
        const axis = center.clone().sub(forearm.getWorldPosition(new T.Vector3())).normalize();
        const palm = root
            .getObjectByName(`mixamorig${side}HandMiddle1`)!
            .getWorldPosition(new T.Vector3())
            .distanceTo(center);
        const vertices: { mesh: T.SkinnedMesh; index: number }[] = [];
        for (const mesh of skin)
            for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
                const point = mesh
                    .applyBoneTransform(
                        index,
                        new T.Vector3().fromBufferAttribute(
                            mesh.geometry.attributes.position,
                            index,
                        ),
                    )
                    .applyMatrix4(mesh.matrixWorld)
                    .sub(center);
                if (Math.abs(point.dot(axis)) < palm * 0.1 && point.length() < palm * 0.5)
                    vertices.push({ mesh, index });
            }
        assert.ok(vertices.length > 8, `${side}: wrist ring is sampled`);
        function thickness() {
            skin.forEach((m) => m.skeleton.update());
            const axis = hand
                .getWorldPosition(new T.Vector3())
                .sub(forearm.getWorldPosition(new T.Vector3()))
                .normalize();
            const x = new T.Vector3(0, 1, 0).cross(axis).normalize(),
                y = axis.clone().cross(x);
            const points = vertices.map(({ mesh, index }) =>
                mesh
                    .applyBoneTransform(
                        index,
                        new T.Vector3().fromBufferAttribute(
                            mesh.geometry.attributes.position,
                            index,
                        ),
                    )
                    .applyMatrix4(mesh.matrixWorld),
            );
            const mean = points
                .reduce((sum, p) => sum.add(p), new T.Vector3())
                .divideScalar(points.length);
            let xx = 0,
                yy = 0,
                xy = 0;
            for (const point of points) {
                point.sub(mean);
                const a = point.dot(x),
                    b = point.dot(y);
                xx += a * a;
                yy += b * b;
                xy += a * b;
            }
            return Math.sqrt(
                (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / points.length / 2,
            );
        }
        return { side, rest: thickness(), thickness };
    });
}

for (const sex of ["female", "male"]) {
    test(`${sex}: both hands clear all rifles and retain wrist thickness`, () => {
        const file = fs.readFileSync(`public/squad/body/${sex}/skin.glb`);
        const root = motionSkeleton(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
        );
        const skin = skinMeshes(`public/squad/body/${sex}/skin.glb`, root);
        const wrists = wristRings(root, skin);
        const group = new T.Group();
        group.userData.center = [0, 0, 0];
        group.userData.model = "rifle";
        mountHandEquipment(
            group,
            root.getObjectByName("mixamorigRightHand") as T.Bone,
            JSON.parse(fs.readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8")),
        );
        const read = (path: string) => JSON.parse(gunzipSync(fs.readFileSync(path)).toString());
        const poses = read(`public/squad/motions/${sex}-equipment.bin`);
        const clips = read(`public/squad/motions/${sex}.bin`).map(
            (c: Parameters<typeof T.AnimationClip.parse>[0]) =>
                equipmentPose(nativeClip(T.AnimationClip.parse(c)), poses),
        ) as T.AnimationClip[];
        const weapons = ["rifle", "sniper", "plasma"].flatMap((kind) =>
            [1, 2, 3].map((tier) => {
                const gun = createLongGun(kind as "rifle" | "sniper" | "plasma", {
                    laser: `laser-${tier}`,
                });
                gun.quaternion.setFromRotationMatrix(
                    new T.Matrix4().makeBasis(
                        new T.Vector3(0, 0, -1),
                        new T.Vector3(1, 0, 0),
                        new T.Vector3(0, -1, 0),
                    ),
                );
                group.add(gun);
                root.updateMatrixWorld(true);
                const edges = weaponEdges(gun).map((e) =>
                    e.map((p) => group.worldToLocal(p.clone())),
                );
                group.remove(gun);
                return { kind, tier, edges };
            }),
        );
        const mixer = new T.AnimationMixer(root);
        for (const name of [
            "idle_weight_shift",
            "rifle_idle",
            "rifle_run",
            "rifle_burst",
            "sniper_shot",
            "rifle_crouch_idle",
            "cover_peek",
            "crouch_enter",
            "stand_cover_emerge",
            "take_damage",
            "crouch_idle",
            "crouch_shooting",
            "idle",
            "run",
            "shooting",
            "stand_cover_idle",
            "stand_cover_move",
            "crouch_exit",
            "cover_return",
            "overwatch_ready",
            "hunker_down",
            "cover_move_left",
            "heavy_hit",
            "crouch_hit",
        ]) {
            mixer.stopAllAction();
            const clip = clips.find((c) => c.name === name)!;
            const action = mixer.clipAction(clip).play();
            for (const fraction of [0, 0.5, 0.99]) {
                action.time = fraction * clip.duration;
                mixer.update(0);
                root.updateMatrixWorld(true);
                for (const wrist of wrists)
                    assert.ok(
                        wrist.thickness() > wrist.rest * 0.65,
                        `${name}@${fraction}: ${wrist.side} wrist collapsed`,
                    );
                const surface = posedSurface(skin); // Deliberately include palms and fingers.
                for (const { kind, tier, edges } of weapons) {
                    const hits = edges
                        .flatMap(([a, b]) =>
                            surface.segment(
                                group.localToWorld(a.clone()),
                                group.localToWorld(b.clone()),
                            ),
                        )
                        .filter((h) => /mixamorig(?:Left|Right)Hand/.test(h.region));
                    assert.equal(
                        hits.length,
                        0,
                        `${kind}/laser-${tier}/${name}@${fraction}: ${JSON.stringify(hits.slice(0, 2))}`,
                    );
                }
                // Prevent a collision-free but detached hand: the palm still cups the fore-end.
                const palm = group.worldToLocal(
                    root
                        .getObjectByName("mixamorigLeftHandMiddle1")!
                        .getWorldPosition(new T.Vector3()),
                );
                assert.ok(palm.x > 0.065 && palm.x < 0.15 && palm.y > -0.06 && palm.y < -0.025);
            }
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
    });
}
