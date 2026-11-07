// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
// Retarget the user's Mixamo Smoking capture. Run from app/: pnpm build:smoking.
// source.bin contains the original sampled transforms, never the reference mesh.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton, armTo } from "@ghosts/squad/motion/clearance";
import { captureClip } from "@ghosts/squad/motion/clips";
import { soleMinimum, soleProbeIndices } from "@ghosts/squad/motion/sole-contact";
import {
    SMOKING_DURATION,
    SMOKING_SOURCE_START,
    SMOKING_SOURCE_END,
    MOUTH_OFFSET,
} from "@ghosts/squad/motion/smoking";
import { skinMeshes } from "../tests/gear-collision.ts";

type Source = {
    fps: number;
    rest: Record<string, { q: number[]; p: number[] }>;
    frames: { hips: number[]; rotations: Record<string, number[]> }[];
};
const sourceBytes = fs.readFileSync("scripts/smoking/source.bin");
const source: Source = JSON.parse(gunzipSync(sourceBytes).toString());
// Two-bone leg fit: hold the ankle while preserving the captured knee plane
// and the corrected foot orientation. No runtime IK is needed.
function legTo(upper: T.Object3D, knee: T.Object3D, foot: T.Object3D, goal: T.Vector3) {
    const world = (b: T.Object3D) => b.getWorldPosition(new T.Vector3());
    const rotate = (b: T.Object3D, q: T.Quaternion) => {
        b.quaternion.copy(b.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));
        b.updateMatrixWorld(true);
    };
    const footQ = foot.getWorldQuaternion(new T.Quaternion());
    const a = world(upper),
        b = world(knee),
        c = world(foot);
    const ab = b.clone().sub(a),
        bc = c.clone().sub(b),
        axis = goal.clone().sub(a);
    const distance = T.MathUtils.clamp(
        axis.length(),
        Math.abs(ab.length() - bc.length()) + 0.0001,
        ab.length() + bc.length() - 0.0001,
    );
    axis.normalize();
    const pole = ab.clone().addScaledVector(axis, -ab.dot(axis)).normalize();
    const along = (ab.lengthSq() - bc.lengthSq() + distance * distance) / (2 * distance);
    const bend = axis
        .clone()
        .multiplyScalar(along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, ab.lengthSq() - along * along)));
    rotate(
        upper,
        new T.Quaternion()
            .setFromUnitVectors(ab.normalize(), bend.normalize())
            .multiply(upper.getWorldQuaternion(new T.Quaternion())),
    );
    const pivot = world(knee);
    rotate(
        knee,
        new T.Quaternion()
            .setFromUnitVectors(
                world(foot).sub(pivot).normalize(),
                goal.clone().sub(pivot).normalize(),
            )
            .multiply(knee.getWorldQuaternion(new T.Quaternion())),
    );
    rotate(foot, footQ);
}
for (const sex of ["female", "male"]) {
    const file = fs.readFileSync(`public/squad/body/${sex}/skin.glb`);
    const root = motionSkeleton(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
    const body = skinMeshes(`public/squad/body/${sex}/skin.glb`, root)[0];
    const nodes: T.Object3D[] = [];
    root.traverse((b) => {
        if (source.rest[b.name]) nodes.push(b);
    });
    const rest = nodes.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
    const leftArm = root.getObjectByName("mixamorigLeftArm")!;
    const leftElbow = root.getObjectByName("mixamorigLeftForeArm")!;
    const leftHand = root.getObjectByName("mixamorigLeftHand")!;
    const aimSegment = (bone: T.Object3D, child: T.Object3D, direction: T.Vector3) => {
        const from = child
            .getWorldPosition(new T.Vector3())
            .sub(bone.getWorldPosition(new T.Vector3()))
            .normalize();
        const world = new T.Quaternion()
            .setFromUnitVectors(from, direction.normalize())
            .multiply(bone.getWorldQuaternion(new T.Quaternion()));
        bone.quaternion.copy(
            bone.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(world),
        );
        bone.updateMatrixWorld(true);
    };
    // Native and Mixamo arm/hand bones have different transverse axes. Match
    // the anatomical roll along the entire chain, not just the wrist: otherwise
    // the forearm twists against the corrected hand and collapses the elbow.
    const corrections = new Map<string, T.Quaternion>();
    for (const side of ["Right"]) {
        const name = (s: string) => `mixamorig${side}Hand${s}`;
        const position = (s: string) =>
            root.getObjectByName(name(s))!.getWorldPosition(new T.Vector3());
        const sourcePosition = (s: string) => new T.Vector3().fromArray(source.rest[name(s)].p);
        const normal = (p: typeof position) =>
            p("Index1")
                .sub(p("Pinky1"))
                .cross(p("Middle1").sub(p("")))
                .normalize();
        const nativeNormal = normal(position),
            sourceNormal = normal(sourcePosition);
        const frame = (q: T.Quaternion, n: T.Vector3) => {
            const y = new T.Vector3(0, 1, 0).applyQuaternion(q);
            const x = y.clone().cross(n).normalize();
            return new T.Quaternion().setFromRotationMatrix(
                new T.Matrix4().makeBasis(x, y, x.clone().cross(y)),
            );
        };
        for (const b of nodes.filter(
            (b) =>
                b.name.startsWith(name("")) ||
                b.name === `mixamorig${side}Arm` ||
                b.name === `mixamorig${side}ForeArm`,
        )) {
            const nativeQ = b.getWorldQuaternion(new T.Quaternion());
            const sourceQ = new T.Quaternion().fromArray(source.rest[b.name].q);
            corrections.set(
                b.name,
                sourceQ
                    .clone()
                    .invert()
                    .multiply(frame(sourceQ, sourceNormal))
                    .multiply(frame(nativeQ, nativeNormal).invert())
                    .multiply(nativeQ),
            );
        }
    }
    // Foot and toe axes differ in pitch and roll, even though both rigs use
    // Mixamo names. Retarget their motion relative to each rig's flat bind feet.
    for (const b of nodes.filter((b) => /(?:Foot|ToeBase)$/.test(b.name))) {
        corrections.set(
            b.name,
            new T.Quaternion()
                .fromArray(source.rest[b.name].q)
                .invert()
                .multiply(b.getWorldQuaternion(new T.Quaternion())),
        );
    }
    // Keep the native pelvis, spine and clavicles neutral. Absolute source
    // orientations bend the differently aligned native chest; smoking is an
    // arm/head action. Arm contact fitting may adjust a clavicle if needed.
    // Descendants are still fitted in world space against this neutral torso.
    const hips = root.getObjectByName("mixamorigHips")!;
    const hipRest = hips.position.clone();
    const ratio = hips.getWorldPosition(new T.Vector3()).y / source.rest.mixamorigHips.p[1];
    const times = Array.from(
        { length: SMOKING_DURATION * source.fps + 1 },
        (_, i) => i / source.fps,
    );
    const legs = ["Right", "Left"].map((side) => ({
        upper: root.getObjectByName(`mixamorig${side}UpLeg`)!,
        knee: root.getObjectByName(`mixamorig${side}Leg`)!,
        foot: root.getObjectByName(`mixamorig${side}Foot`)!,
        anchor: new T.Vector3(),
        probes: soleProbeIndices(body.geometry).filter(
            (i) => body.geometry.attributes.position.getX(i) < 0 === (side === "Right"),
        ),
    }));
    const positions: number[] = [],
        rotations = nodes.map(() => [] as number[]);
    const duration = times[times.length - 1];
    const firstRotations: T.Quaternion[] = [];
    let firstHip: T.Vector3;
    times.forEach((time, f) => {
        const sourceTime = Math.min(SMOKING_SOURCE_END, SMOKING_SOURCE_START + time);
        const frame = source.frames[Math.round(sourceTime * source.fps)];
        nodes.forEach((b, i) => {
            b.position.copy(rest[i].p);
            if (
                /^mixamorig(?:Hips|Spine[12]?|Left(?:Shoulder|Arm|ForeArm|Hand.*)|RightShoulder)$/.test(
                    b.name,
                )
            ) {
                b.quaternion.copy(rest[i].q);
                b.updateMatrixWorld(true);
                return;
            }
            const world = new T.Quaternion().fromArray(frame.rotations[b.name]);
            if (corrections.has(b.name)) world.multiply(corrections.get(b.name)!);
            b.quaternion.copy(
                b.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(world),
            );
            b.updateMatrixWorld(true);
        });
        hips.position
            .copy(hipRest)
            .add(
                new T.Vector3()
                    .fromArray(frame.hips)
                    .sub(new T.Vector3().fromArray(source.rest.mixamorigHips.p))
                    .multiplyScalar(ratio),
            );
        // Keep captured weight shifts, remove the source character's scene offset.
        hips.position.x -= source.frames[0].hips[0] * ratio;
        hips.position.z -= source.frames[0].hips[2] * ratio;
        root.updateMatrixWorld(true);
        // The free arm hangs beside the body with a small natural elbow bend.
        // Preserve native wrist/palm/finger relationships instead of importing
        // the source's hip gesture and independently twisted finger frames.
        aimSegment(leftArm, leftElbow, new T.Vector3(0.15, -1, -0.02));
        aimSegment(leftElbow, leftHand, new T.Vector3(0.08, -1, 0.13));
        // Fit the drag contact to native proportions while preserving the
        // corrected wrist orientation and captured elbow plane.
        const contact = 1 - T.MathUtils.smoothstep(sourceTime, 8.5, 9.1);
        if (contact > 0) {
            const bone = (n: string) => root.getObjectByName(`mixamorig${n}`)!;
            const head = bone("Head"),
                hand = bone("RightHand");
            const mouth = head.localToWorld(new T.Vector3(...MOUTH_OFFSET));
            const desired = mouth.add(
                new T.Vector3(0, 0, 0.026).applyQuaternion(
                    head.getWorldQuaternion(new T.Quaternion()),
                ),
            );
            const grip = bone("RightHandIndex2")
                .getWorldPosition(new T.Vector3())
                .lerp(bone("RightHandMiddle2").getWorldPosition(new T.Vector3()), 0.5);
            const goal = hand
                .getWorldPosition(new T.Vector3())
                .add(desired.sub(grip).multiplyScalar(contact));
            armTo(bone("RightShoulder"), bone("RightArm"), bone("RightForeArm"), hand, goal);
        }
        // End before the discard. Return from the captured resting hand to the drag.
        if (f === 0) {
            firstHip = hips.position.clone();
            nodes.forEach((b) => firstRotations.push(b.quaternion.clone()));
        }
        const close = T.MathUtils.smoothstep(
            time,
            SMOKING_SOURCE_END - SMOKING_SOURCE_START,
            duration,
        );
        nodes.forEach((b, i) => b.quaternion.slerp(firstRotations[i], close));
        hips.position.lerp(firstHip!, close);
        root.updateMatrixWorld(true);
        if (f === 0) {
            for (const leg of legs) {
                let floor = Infinity;
                for (const i of leg.probes) {
                    const p = new T.Vector3().fromBufferAttribute(
                        body.geometry.attributes.position,
                        i,
                    );
                    body.applyBoneTransform(i, p);
                    floor = Math.min(floor, p.y);
                }
                leg.foot.getWorldPosition(leg.anchor);
                leg.anchor.y -= floor;
            }
        }
        // Both feet are planted in this source interval. Correct the native
        // proportions independently, instead of grounding only the lowest toe.
        let lower = 0;
        for (const leg of legs) {
            const upper = leg.upper.getWorldPosition(new T.Vector3());
            const knee = leg.knee.getWorldPosition(new T.Vector3());
            const foot = leg.foot.getWorldPosition(new T.Vector3());
            const reach = upper.distanceTo(knee) + knee.distanceTo(foot) - 0.001;
            const horizontal = (upper.x - leg.anchor.x) ** 2 + (upper.z - leg.anchor.z) ** 2;
            lower = Math.max(
                lower,
                upper.y - leg.anchor.y - Math.sqrt(Math.max(0, reach * reach - horizontal)),
            );
        }
        hips.position.y -= lower;
        root.updateMatrixWorld(true);
        for (const leg of legs) legTo(leg.upper, leg.knee, leg.foot, leg.anchor);
        root.updateMatrixWorld(true);
        hips.position.y -= soleMinimum(body);
        root.updateMatrixWorld(true);
        hips.position.toArray(positions, positions.length);
        nodes.forEach((b, i) =>
            b.quaternion.normalize().toArray(rotations[i], rotations[i].length),
        );
    });
    const clip = new T.AnimationClip("standing_smoking", duration, [
        new T.VectorKeyframeTrack("mixamorigHips.position", times, positions).optimize(),
        ...nodes.map((b, i) =>
            new T.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rotations[i]).optimize(),
        ),
    ]);
    const serialized = {
        ...T.AnimationClip.toJSON(captureClip(clip)),
        sourceRange: [SMOKING_SOURCE_START, SMOKING_SOURCE_END],
        sourceSHA256: createHash("sha256").update(sourceBytes).digest("hex"),
        rigSHA256: createHash("sha256").update(file).digest("hex"),
    };
    // Stable asset bytes on rebuild, independent of Three's random object UUIDs.
    serialized.uuid = `mixamo-smoking-${sex}`;
    const output = `public/squad/motions/${sex}-smoking.bin`;
    fs.writeFileSync(
        output,
        gzipSync(
            JSON.stringify(serialized, (_key, value) =>
                typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value,
            ),
        ),
    );
    console.log(`${sex}: ${duration}s Mixamo capture; ${fs.statSync(output).size} bytes`);
}
