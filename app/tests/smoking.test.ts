// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { nativeClip, captureClip } from "@ghosts/squad/motion/clips";
import {
    SmokingEffect,
    smokingPhase,
    SMOKING_DURATION,
    SMOKING_SOURCE_START,
    SMOKING_SOURCE_END,
    smokingHandRoll,
    MOUTH_OFFSET,
} from "@ghosts/squad/motion/smoking";
import { soleMinimum, soleProbeIndices } from "@ghosts/squad/motion/sole-contact";
import { skinMeshes } from "./gear-collision.ts";
const sourceBytes = readFileSync("scripts/smoking/source.bin");
const source = JSON.parse(gunzipSync(sourceBytes).toString());
for (const sex of ["female", "male"]) {
    test(`${sex}: smoking keeps a neutral torso, grounds soles, closes its loop and fits cigarette transfers`, () => {
        const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
        const root = motionSkeleton(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
        );
        const body = skinMeshes(`public/squad/body/${sex}/skin.glb`, root)[0];
        const torso = ["Hips", "Spine", "Spine1", "Spine2"].map((suffix) => {
            const bone = root.getObjectByName(`mixamorig${suffix}`)!;
            return { bone, rest: bone.quaternion.clone() };
        });
        const freeHand = root.getObjectByName("mixamorigLeftHand")!;
        const freeHandRest = freeHand.matrixWorld.clone().invert();
        const handPoints: { index: number; local: T.Vector3 }[] = [];
        const { position, skinIndex, skinWeight } = body.geometry.attributes;
        for (let i = 0; i < position.count; i++) {
            let handWeight = 0;
            for (let k = 0; k < 4; k++)
                if (
                    body.skeleton.bones[skinIndex.getComponent(i, k)].name.startsWith(
                        "mixamorigLeftHand",
                    )
                )
                    handWeight += skinWeight.getComponent(i, k);
            if (handWeight > 0.99999)
                handPoints.push({
                    index: i,
                    local: new T.Vector3()
                        .fromBufferAttribute(position, i)
                        .applyMatrix4(freeHandRest),
                });
        }
        assert.ok(handPoints.length > 100, "inspect the actual palm and finger mesh");
        const raw = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}-smoking.bin`)).toString(),
        );
        assert.equal(raw.sourceSHA256, createHash("sha256").update(sourceBytes).digest("hex"));
        assert.equal(raw.rigSHA256, createHash("sha256").update(file).digest("hex"));
        const clip = nativeClip(T.AnimationClip.parse(raw));
        assert.equal(clip.duration, SMOKING_DURATION);
        assert.deepEqual(raw.sourceRange, [SMOKING_SOURCE_START, SMOKING_SOURCE_END]);
        assert.equal(clip.duration, 5);
        for (const track of clip.tracks) {
            const size = track.getValueSize();
            assert.ok(Array.from(track.values).every(Number.isFinite), track.name);
            for (let i = 0; i < size; i++)
                assert.ok(
                    Math.abs(track.values[i] - track.values[track.values.length - size + i]) < 1e-5,
                    `loop seam: ${track.name}`,
                );
        }
        const roundTrip = nativeClip(captureClip(clip));
        roundTrip.tracks.forEach((t, i) =>
            t.values.forEach((v, j) => assert.ok(Math.abs(v - clip.tracks[i].values[j]) < 1e-5)),
        );
        const feet = ["Right", "Left"].map((side) => {
            const bone = root.getObjectByName(`mixamorig${side}Foot`)!;
            return {
                bone,
                rest: bone.getWorldQuaternion(new T.Quaternion()),
                first: new T.Vector3(),
                probes: soleProbeIndices(body.geometry).filter(
                    (i) => body.geometry.attributes.position.getX(i) < 0 === (side === "Right"),
                ),
            };
        });
        const mixer = new T.AnimationMixer(root),
            action = mixer.clipAction(clip).play();
        const effect = new SmokingEffect(root);
        for (
            let f = 0;
            f <= Math.round((SMOKING_SOURCE_END - SMOKING_SOURCE_START) * source.fps);
            f += 15
        ) {
            action.time = f / source.fps;
            mixer.update(0);
            root.updateMatrixWorld(true);
            assert.ok(Math.abs(soleMinimum(body)) < 0.001, `ground at ${action.time}`);
            const wrist = root
                .getObjectByName("mixamorigRightHand")!
                .getWorldQuaternion(new T.Quaternion());
            const expectedWrist = new T.Quaternion()
                .fromArray(
                    source.frames[f + Math.round(SMOKING_SOURCE_START * source.fps)].rotations
                        .mixamorigRightHand,
                )
                .multiply(
                    new T.Quaternion().setFromAxisAngle(
                        new T.Vector3(0, 1, 0),
                        smokingHandRoll(root.getObjectByName("mixamorigRightHand")!),
                    ),
                );
            assert.ok(wrist.angleTo(expectedWrist) < 0.005, "anatomical palm roll");
            // A wrist-only twist rotates the finger bend directions and visibly
            // tears the grip. Every digit must keep its captured segment direction.
            root.traverse((bone) => {
                if (!/mixamorigRight(?:Hand|Arm$|ForeArm$)/.test(bone.name)) return;
                // The smoking arm is fitted to the mouth; its segment directions
                // intentionally differ from the source during contact.
                if (/mixamorigRight(?:Arm|ForeArm)$/.test(bone.name) && f / source.fps < 0.9)
                    return;
                const captured =
                    source.frames[f + Math.round(SMOKING_SOURCE_START * source.fps)].rotations[
                        bone.name
                    ];
                if (!captured) return;
                const direction = new T.Vector3(0, 1, 0).applyQuaternion(
                    bone.getWorldQuaternion(new T.Quaternion()),
                );
                const expected = new T.Vector3(0, 1, 0).applyQuaternion(
                    new T.Quaternion().fromArray(captured),
                );
                assert.ok(
                    direction.angleTo(expected) < 0.005,
                    `${bone.name} bend direction @ ${action.time}`,
                );
            });
            // Preserve the captured gesture around the neutral native torso.
            for (const suffix of ["Head"]) {
                const name = `mixamorig${suffix}`;
                const q = root.getObjectByName(name)!.getWorldQuaternion(new T.Quaternion());
                assert.ok(
                    q.angleTo(
                        new T.Quaternion().fromArray(
                            source.frames[f + Math.round(SMOKING_SOURCE_START * source.fps)]
                                .rotations[name],
                        ),
                    ) < 0.005,
                    `${name} @ ${action.time}`,
                );
            }
        }
        // Check each foot throughout the loop, including the return blend.
        // A single global minimum missed the old tilted, floating opposite foot.
        for (let f = 0; f < clip.duration * source.fps; f++) {
            action.time = f / source.fps;
            mixer.update(0);
            root.updateMatrixWorld(true);
            for (const { bone, rest } of torso) {
                assert.ok(
                    bone.quaternion.clone().normalize().angleTo(rest.clone().normalize()) < 0.00001,
                    `${bone.name} bends the torso @ ${action.time}`,
                );
            }
            // The free hand must retain the original palm/finger shape, including
            // the return blend; bone lengths alone cannot catch a twisted palm.
            const handFrame = freeHand.matrixWorld.clone().invert();
            for (const { index, local } of handPoints) {
                const point = body
                    .applyBoneTransform(index, new T.Vector3().fromBufferAttribute(position, index))
                    .applyMatrix4(handFrame);
                assert.ok(
                    point.distanceTo(local) < 0.00001,
                    `left palm/fingers deform @ ${action.time}`,
                );
            }
            for (const foot of feet) {
                const position = foot.bone.getWorldPosition(new T.Vector3());
                if (f === 0) foot.first.copy(position);
                assert.ok(position.distanceTo(foot.first) < 0.001, `ankle drift @ ${action.time}`);
                const delta = foot.bone
                    .getWorldQuaternion(new T.Quaternion())
                    .multiply(foot.rest.clone().invert());
                assert.ok(
                    new T.Vector3(0, 1, 0).applyQuaternion(delta).y > 0.999,
                    `tilted sole @ ${action.time}`,
                );
                const floor = Math.min(
                    ...foot.probes.map((i) => {
                        const p = new T.Vector3().fromBufferAttribute(
                            body.geometry.attributes.position,
                            i,
                        );
                        return body.applyBoneTransform(i, p).y;
                    }),
                );
                assert.ok(
                    Math.abs(floor) < 0.001,
                    `${foot.bone.name} floats ${floor} @ ${action.time}`,
                );
            }
            effect.update(true, action.time, 0);
            assert.equal(effect.cigarette.visible, true);
            assert.ok(effect.light.intensity > 0);
        }
        for (const time of [0, 0.1, SMOKING_DURATION - 0.01]) {
            action.time = time;
            mixer.update(0);
            effect.update(true, time, 0);
            const mouth = root
                .getObjectByName("mixamorigHead")!
                .localToWorld(new T.Vector3(...MOUTH_OFFSET));
            const filter = effect.cigarette.localToWorld(new T.Vector3(0, 0, -0.026));
            assert.ok(
                filter.distanceTo(mouth) < 0.007,
                `filter/lip gap ${filter.distanceTo(mouth)} at ${time}`,
            );
        }
        action.time = 1;
        mixer.update(0);
        for (let i = 0; i < 600; i++)
            effect.update(true, 1 + ((i / 30) % SMOKING_DURATION), 1 / 30);
        const smoke = effect.group.children.find(
            (o) => o instanceof T.InstancedMesh,
        ) as T.InstancedMesh;
        assert.ok(smoke.count > 0 && smoke.count <= 96);
        const matrix = smoke.instanceMatrix.array.slice();
        effect.update(true, 1, 0);
        assert.deepEqual(smoke.instanceMatrix.array, matrix);
        // Combat wraps centimetre/Z-up bones in a scaled, rotated model under
        // the unit root. Its cigarette and mouth sockets must stay in metre space.
        const combatRoot = new T.Group();
        const combatModel = motionSkeleton(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.length),
        );
        combatModel.traverse((b) => {
            if (b.name.startsWith("mixamorig")) b.position.multiplyScalar(100);
        });
        combatModel.scale.setScalar(0.01);
        combatModel.rotation.x = Math.PI / 2;
        combatRoot.add(combatModel);
        combatRoot.position.set(2, 0, -1);
        combatRoot.rotation.y = 0.7;
        const combatMixer = new T.AnimationMixer(combatModel);
        const combatAction = combatMixer.clipAction(captureClip(clip)).play();
        combatAction.time = 1;
        combatMixer.update(0);
        const combatEffect = new SmokingEffect(combatRoot);
        combatEffect.update(true, 1, 0);
        assert.ok(combatEffect.cigarette.position.distanceTo(effect.cigarette.position) < 0.001);
        assert.ok(combatEffect.cigarette.quaternion.angleTo(effect.cigarette.quaternion) < 0.005);
        combatEffect.dispose();
        effect.update(false, 0, 0);
        assert.equal(smoke.count, 0);
        assert.equal(effect.light.intensity, 0);
        assert.equal(effect.group.visible, false);
        effect.dispose();
        assert.equal(effect.group.parent, null);
    });
}
test("smoking loop stays lit, exhales after the drag, and excludes the discard", () => {
    assert.equal(smokingPhase(0).visible, true);
    assert.equal(smokingPhase(0).lit, 1);
    assert.equal(smokingPhase(0).mouth, 1);
    assert.equal(smokingPhase(0).inhale, 1);
    assert.equal(smokingPhase(0).exhale, 0);
    assert.equal(smokingPhase(1.3).mouth, 0);
    assert.equal(smokingPhase(1.3).exhale, 1);
    assert.equal(smokingPhase(4).lit, 1);
    assert.deepEqual(smokingPhase(SMOKING_DURATION), smokingPhase(0));
});
