// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motions } from "@ghosts/squad/motion/catalog";
import { nativeClip, captureClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, type EquipmentPoses } from "@ghosts/squad/motion/equipment-poses";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { mountHandEquipment } from "@ghosts/squad/studio/held-equipment";
import { WeaponCarry } from "@ghosts/squad/motion/weapon-carry";
import { MAX_AIM_LEAN, relaxAimPosture } from "../scripts/equipment-fit/aim-posture.ts";
const unpack = (path: string) => JSON.parse(gunzipSync(readFileSync(path)).toString());
const configurations = ["female", "male"].flatMap((sex) =>
    ["rifle", "sniper"].map((model) => ({ sex, model })),
);
for (const { sex, model } of configurations) {
    const poses: EquipmentPoses = unpack(
        `public/squad/motions/${sex}${model === "sniper" ? "-sniper" : ""}-equipment.bin`,
    );
    const clips = unpack(`public/squad/motions/${sex}.bin`).map(
        (c: Parameters<typeof T.AnimationClip.parse>[0]) => nativeClip(T.AnimationClip.parse(c)),
    ) as T.AnimationClip[];
        test(`${sex}/${model}: firing poses keep a modest back bend throughout the animation`, () => {
            const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
            const root = motionSkeleton(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
            for (const name of ["shooting", "crouch_shooting", "rifle_burst", "sniper_shot", "cover_peek", "overwatch_ready"]) {
                const clip = equipmentPose(clips.find((c) => c.name === name)!, poses);
                const samplers = clip.tracks.map((track) => ({
                    bone: root.getObjectByName(track.name.split(".")[0])!,
                    property: track.name.split(".")[1],
                    sample: track.createInterpolant(),
                }));
                for (let frame = 0; frame <= 60; frame++) {
                    for (const { bone, property, sample } of samplers) {
                        const value = sample.evaluate(clip.duration * frame / 60);
                        if (property === "quaternion") bone.quaternion.fromArray(value);
                        else if (property === "position") bone.position.fromArray(value);
                    }
                    root.updateMatrixWorld(true);
                    const chest = root.getObjectByName("mixamorigSpine2")!.getWorldPosition(new T.Vector3());
                    const direction = root.getObjectByName("mixamorigNeck")!.getWorldPosition(new T.Vector3()).sub(chest).normalize();
                    const lean = Math.acos(T.MathUtils.clamp(direction.y, -1, 1));
                    assert(lean <= MAX_AIM_LEAN + T.MathUtils.degToRad(0.35), `${name}@${frame}: upper back bends ${T.MathUtils.radToDeg(lean)} degrees`);
                }
            }
        });
        test(`${sex}/${model}: relaxing the back preserves weapon and gaze directions`, () => {
            const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
            const root = motionSkeleton(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
            const references = JSON.parse(readFileSync("scripts/equipment-fit/references.json", "utf8"));
            for (const [name, pose] of Object.entries(references[sex].aim.rotations))
                root.getObjectByName(name)!.quaternion.fromArray((pose as { local: number[] }).local);
            root.updateMatrixWorld(true);
            const bones = ["RightHand", "LeftHand", "Head"].map((name) => root.getObjectByName(`mixamorig${name}`)!);
            const before = bones.map((bone) => bone.getWorldQuaternion(new T.Quaternion()).normalize());
            relaxAimPosture(root);
            bones.forEach((bone, i) => assert(before[i].angleTo(bone.getWorldQuaternion(new T.Quaternion()).normalize()) < 1e-6));
        });
    test(`${sex}/${model}: every shipped pose has current equipment calibration`, () => {
        assert.deepEqual(
            Object.keys(poses.clips).sort(),
            motions
                .filter(([, , group]) => group !== "Ambient")
                .map(([name]) => name)
                .sort(),
        );
        for (const [path, hash] of Object.entries(poses.sources))
            assert.equal(
                createHash("sha256").update(readFileSync(path)).digest("hex"),
                hash,
                `Rebuild equipment poses after changing ${path}`,
            );
        for (const source of clips) {
            const before = T.AnimationClip.toJSON(source),
                fitted = equipmentPose(source, poses);
            assert.deepEqual(
                T.AnimationClip.toJSON(source),
                before,
                "Fitting must not mutate cached source clips",
            );
            assert.equal(fitted.duration, source.duration);
            for (const track of fitted.tracks) {
                const size = track.name.endsWith(".quaternion") ? 4 : 3;
                assert.equal(
                    track.values.length,
                    track.times.length * size,
                    `${source.name}/${track.name}: stride`,
                );
                assert.ok(Array.from(track.values).every(Number.isFinite));
                assert.ok(
                    Array.from(track.times).every(
                        (t, i) => Number.isFinite(t) && (i === 0 || t > track.times[i - 1]),
                    ),
                );
                if (size === 4)
                    for (let i = 0; i < track.values.length; i += 4)
                        assert.ok(
                            Math.abs(new T.Quaternion().fromArray(track.values, i).length() - 1) <
                                0.001,
                        );
                if (track.name.endsWith(".position"))
                    assert.deepEqual(
                        track.values,
                        source.tracks.find((t) => t.name === track.name)!.values,
                        "Preserve root travel and limb lengths",
                    );
            }
            const roundtrip = nativeClip(captureClip(fitted));
            for (const track of fitted.tracks) {
                const copy = roundtrip.tracks.find((t) => t.name === track.name)!;
                track.values.forEach((v, i) => assert.ok(Math.abs(v - copy.values[i]) < 1e-5));
            }
        }
    });
    test(`${sex}/${model}: Squad's frozen idle uses the same corrected hold`, () => {
        const idle = nativeClip(
            T.AnimationClip.parse(
                JSON.parse(readFileSync(`public/squad/body/${sex}/idle.json`, "utf8")),
            ),
        );
        const studio = equipmentPose(idle, poses),
            game = equipmentPose(
                clips.find((c) => c.name === "idle_weight_shift")!,
                poses,
            );
        for (const track of studio.tracks.filter(
            (t) => /Arm|Hand|Shoulder/.test(t.name) && t.name.endsWith(".quaternion"),
        )) {
            const other = game.tracks.find((t) => t.name === track.name)!;
            assert.deepEqual(
                track.createInterpolant().evaluate(0.8),
                other.createInterpolant().evaluate(0.8),
            );
        }
    });
    test(`${sex}/${model}: throw handoff is independent of the preceding pose and restores the grip`, () => {
        const file = readFileSync(`public/squad/body/${sex}/skin.glb`),
            root = motionSkeleton(
                file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
            );
        const weapon = new T.Group();
        weapon.userData.center = [0, 0, 0];
        const right = root.getObjectByName("mixamorigRightHand") as T.Bone,
            left = root.getObjectByName("mixamorigLeftHand")!;
        mountHandEquipment(
            weapon,
            right,
            JSON.parse(readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8")),
        );
        const carry = new WeaponCarry(weapon, left),
            rest = weapon.matrix.clone(),
            throwClip = equipmentPose(
                clips.find((c) => c.name === "toss_grenade")!,
                poses,
            );
        let expected: number[] | undefined;
        for (const name of ["rifle_idle", "crouch_idle", "sniper_shot", "vault"]) {
            const clip = equipmentPose(
                clips.find((c) => c.name === name)!,
                poses,
            );
            for (const track of clip.tracks) {
                const [name, property] = track.name.split("."),
                    bone = root.getObjectByName(name)!,
                    value = track.createInterpolant().evaluate(clip.duration * 0.5);
                if (property === "quaternion") bone.quaternion.fromArray(value);
                else if (property === "position") bone.position.fromArray(value);
            }
            root.updateMatrixWorld(true);
            const before = right.matrixWorld.clone();
            carry.prepare(throwClip, root);
            assert.ok(
                before.elements.every(
                    (v, i) => Math.abs(v - right.matrixWorld.elements[i]) < 1e-10,
                ),
                "Preparing must restore the currently playing pose",
            );
            carry.update(true);
            weapon.updateMatrix();
            assert.equal(weapon.parent, left);
            if (expected)
                weapon.matrix.elements.forEach((v, i) =>
                    assert.ok(Math.abs(v - expected![i]) < 1e-6),
                );
            else expected = weapon.matrix.toArray();
            carry.update(false);
            weapon.updateMatrix();
            assert.equal(weapon.parent, right);
            weapon.matrix.elements.forEach((v, i) =>
                assert.ok(Math.abs(v - rest.elements[i]) < 1e-6),
            );
        }
    });
}
