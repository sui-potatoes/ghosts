// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { officeIdle } from "../../packages/squad/src/studio/office-worker.ts";

for (const sex of ["female", "male"]) {
    test(`${sex} office clothing stays on the native rig through extraction poses`, async () => {
        const file = readFileSync(`public/squad/armor/office-worker-${sex}.glb`);
        const { scene } = await new GLTFLoader().parseAsync(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
            "",
        );
        const meshes: T.SkinnedMesh[] = [];
        scene.traverse((o) => {
            if (o instanceof T.SkinnedMesh) meshes.push(o);
        });
        assert.equal(meshes.length, 6, "six shared material batches per outfit");
        const rest = meshes.map((mesh) => {
            const p = mesh.geometry.attributes.position,
                weights = mesh.geometry.attributes.skinWeight;
            for (let i = 0; i < p.count; i++) {
                assert(
                    Math.abs(
                        [0, 1, 2, 3].reduce((sum, k) => sum + weights.getComponent(i, k), 0) - 1,
                    ) < 0.001,
                );
                assert(Math.abs(p.getX(i)) < 0.65, "no belt points extending out toward the hands");
            }
            return Array.from({ length: p.count }, (_, i) =>
                new T.Vector3().fromBufferAttribute(p, i),
            );
        });
        const source = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
        );
        const names = [
            "idle_weight_shift",
            "run",
            "crouch_idle",
            "hunker_down",
            "take_damage",
            "death",
        ];
        const clips = source
            .filter((c: { name: string }) => names.includes(c.name))
            .map((c: Parameters<typeof T.AnimationClip.parse>[0]) =>
                nativeClip(T.AnimationClip.parse(c)),
            ) as T.AnimationClip[];
        const bindPose: { bone: T.Bone; quaternion: number[] }[] = [];
        scene.traverse((o) => {
            if (o instanceof T.Bone) bindPose.push({ bone: o, quaternion: o.quaternion.toArray() });
        });
        const idle = officeIdle(scene);
        for (const { bone, quaternion } of bindPose)
            assert.deepEqual(
                bone.quaternion.toArray(),
                quaternion,
                "idle authoring preserves cached bind pose",
            );
        for (const track of idle.tracks) {
            const size = track.getValueSize();
            for (let k = 0; k < size; k++)
                assert(
                    Math.abs(track.values[k] - track.values[track.values.length - size + k]) < 1e-6,
                    "civilian breathing loops seamlessly",
                );
        }
        const standingFeet = new Map<string, T.Vector3>();
        const mixer = new T.AnimationMixer(scene);
        for (const clip of clips) {
            const action = mixer.clipAction(clip.name === "idle_weight_shift" ? idle : clip).play();
            for (const fraction of [0, 0.25, 0.5, 0.75, 0.999]) {
                action.time = fraction * clip.duration;
                mixer.update(0);
                scene.updateMatrixWorld(true);
                for (const [n, mesh] of meshes.entries()) {
                    const posed = rest[n].map((p, i) => mesh.applyBoneTransform(i, p.clone()));
                    assert(
                        posed.every((p) => Number.isFinite(p.length()) && p.length() < 3),
                        "finite, bounded clothing",
                    );
                    const index = mesh.geometry.index!;
                    for (let i = 0; i < index.count; i += 3)
                        for (const [a, b] of [
                            [0, 1],
                            [1, 2],
                            [2, 0],
                        ]) {
                            const ia = index.getX(i + a),
                                ib = index.getX(i + b);
                            const before = rest[n][ia].distanceTo(rest[n][ib]),
                                after = posed[ia].distanceTo(posed[ib]);
                            assert(
                                after < before * 4 + 0.025,
                                `${clip.name}/${(mesh.material as T.Material).name}/${rest[n][ia].toArray()}/${rest[n][ib].toArray()}: cloth edge tears (${before.toFixed(3)} → ${after.toFixed(3)})`,
                            );
                        }
                }
                if (clip.name === "idle_weight_shift") {
                    const position = (name: string) =>
                        scene
                            .getObjectByName(`mixamorig${name}`)!
                            .getWorldPosition(new T.Vector3());
                    const hips = scene
                        .getObjectByName("mixamorigHips")!
                        .getWorldPosition(new T.Vector3());
                    for (const side of ["Left", "Right"]) {
                        const hand = scene
                            .getObjectByName(`mixamorig${side}Hand`)!
                            .getWorldPosition(new T.Vector3());
                        assert(
                            hand.y > hips.y + 0.2 && hand.y < hips.y + 0.55,
                            "folded hands stay at chest height",
                        );
                        assert(
                            side === "Left" ? hand.x < 0 : hand.x > 0,
                            "each wrist crosses the torso centerline",
                        );
                        const hip = position(`${side}UpLeg`),
                            knee = position(`${side}Leg`),
                            foot = position(`${side}Foot`);
                        const bend = knee.clone().sub(hip).angleTo(foot.clone().sub(knee));
                        assert(
                            bend > 0.015 && bend < 0.18,
                            "soft standing knees, not the tactical crouch",
                        );
                        const shoulder = position(`${side}Arm`),
                            elbow = position(`${side}ForeArm`);
                        const elbowBend = elbow
                            .clone()
                            .sub(shoulder)
                            .angleTo(hand.clone().sub(elbow));
                        assert(
                            elbowBend > 1.3 && elbowBend < 2.1,
                            "folded elbows preserve the sourced cross-arm silhouette",
                        );
                        if (!standingFeet.has(side)) standingFeet.set(side, foot.clone());
                        assert(
                            foot.distanceTo(standingFeet.get(side)!) < 1e-6,
                            "feet never slide or bounce during breathing",
                        );
                    }
                    const left = position("LeftFoot"),
                        right = position("RightFoot");
                    assert(
                        left.x - right.x > 0.19 && left.x - right.x < 0.29,
                        "feet sit at hip width",
                    );
                    assert(Math.abs(left.y - right.y) < 0.008, "both shoes share the floor");
                }
            }
            mixer.stopAllAction();
        }
        mixer.uncacheRoot(scene);
    });
}
