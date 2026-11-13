// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, poseSuffix } from "@ghosts/squad/motion/equipment-poses";
import { seatOf } from "../scripts/equipment-fit/support-grip.ts";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import {
    skinMeshes,
    posedSurface,
    weaponEdges,
    rifleAsset,
    supportContact,
} from "./gear-collision.ts";

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

const configurations = ["female", "male"].flatMap((sex) =>
    (["rifle", "sniper", "plasma"] as const).map((kind) => ({ sex, kind })),
);
for (const { sex, kind } of configurations) {
    test(`${sex}/${kind}: both hands clear all rifles and retain wrist thickness`, () => {
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
        const poses = read(`public/squad/motions/${sex}${poseSuffix(kind)}-equipment.bin`);
        // The palm closes on the gun's own handguard (or forend) seat.
        const seat = seatOf(kind);
        const clips = read(`public/squad/motions/${sex}.bin`).map(
            (c: Parameters<typeof T.AnimationClip.parse>[0]) =>
                equipmentPose(nativeClip(T.AnimationClip.parse(c)), poses),
        ) as T.AnimationClip[];
        const weapons = [kind].flatMap((kind) =>
            [0, 1, 2, 3].map((tier) => {
                const gun = rifleAsset(kind, tier);
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
                return { kind, tier, edges, gun };
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
            const fractions = process.env.FPS
                ? Array.from(
                      { length: Math.ceil(clip.duration * Number(process.env.FPS)) + 1 },
                      (_, i) => Math.min(0.999, i / (clip.duration * Number(process.env.FPS))),
                  )
                : [0, 0.5, 0.99];
            for (const fraction of fractions) {
                action.time = fraction * clip.duration;
                mixer.update(0);
                root.updateMatrixWorld(true);
                for (const wrist of wrists)
                    assert.ok(
                        wrist.thickness() > wrist.rest * 0.65,
                        `${name}@${fraction}: ${wrist.side} wrist collapsed`,
                    );
                const surface = posedSurface(skin); // Deliberately include palms and fingers.
                for (const { kind, tier, edges, gun } of weapons) {
                    const hits = edges
                        .flatMap(([a, b]) =>
                            surface.segment(
                                group.localToWorld(a.clone()),
                                group.localToWorld(b.clone()),
                            ),
                        )
                        .filter((h) => /mixamorig(?:Left|Right)Hand/.test(h.region));
                    if (
                        tier === 0 &&
                        fraction === 0 &&
                        ["idle_weight_shift", "rifle_burst", "rifle_run"].includes(name)
                    ) {
                        group.add(gun);
                        root.updateMatrixWorld(true);
                        // The fore-end around the gun's own seat (the old window was
                        // 0.04-0.16 by 0.04 around the old rifle's, at 0.097 / 0.0005).
                        const contact = supportContact(gun, group, surface, {
                            from: seat.contact.x - 0.06,
                            to: seat.contact.x + 0.06,
                            top: seat.contact.y + 0.04,
                        });
                        group.remove(gun);
                        assert.ok(
                            Math.min(contact.palm, contact.thumb) < 0.005 &&
                                contact.fingers < 0.005,
                            `${kind}/${name}: floating support hand ${JSON.stringify(contact)}`,
                        );
                    }
                    assert.equal(
                        hits.length,
                        0,
                        `${kind}/attachments-${tier}/${name}@${fraction}: ${JSON.stringify(hits.slice(0, 2))}`,
                    );
                }
                // Prevent a collision-free but detached hand: the palm still cups the
                // fore-end. The window is the one the old fore-end had, taken relative to
                // the seat: 32 mm behind to 53 mm ahead of the station, 16-51 mm under it.
                const palm = group
                    .worldToLocal(
                        root
                            .getObjectByName("mixamorigLeftHandMiddle1")!
                            .getWorldPosition(new T.Vector3()),
                    )
                    .sub(seat.contact);
                assert.ok(
                    palm.x > -0.032 && palm.x < 0.053 && palm.y > -0.051 && palm.y < -0.016,
                    `${kind}/${name}@${fraction}: palm ${palm.toArray().map((v) => v.toFixed(3))} off the seat`,
                );
            }
        }
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
    });
}
