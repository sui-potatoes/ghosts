// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import crossedArms from "./crossed-arms-reference.ts";

/** A civilian stance authored against the native bind rig, independent of the
 * rifle idle's crouched hips and wide feet. */
export function officeIdle(root: T.Object3D): T.AnimationClip {
    const bones: T.Bone[] = [];
    root.traverse((o) => {
        if (o instanceof T.Bone) bones.push(o);
    });
    const saved = bones.map((bone) => ({ bone, q: bone.quaternion.clone() }));
    const joint = (name: string) => {
        const bone = root.getObjectByName(`mixamorig${name}`);
        if (!(bone instanceof T.Bone)) throw Error(`Missing civilian joint: ${name}`);
        return bone;
    };
    const aim = (name: string, child: string, direction: T.Vector3) => {
        root.updateMatrixWorld(true);
        const bone = joint(name),
            next = joint(child);
        const axis = next
            .getWorldPosition(new T.Vector3())
            .sub(bone.getWorldPosition(new T.Vector3()))
            .normalize();
        const world = bone
            .getWorldQuaternion(new T.Quaternion())
            .premultiply(new T.Quaternion().setFromUnitVectors(axis, direction.normalize()));
        bone.quaternion.copy(
            bone.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(world),
        );
    };
    const tracks: T.KeyframeTrack[] = [];
    const duration = 5;
    try {
        for (const side of ["Left", "Right"]) {
            const sign = side === "Left" ? 1 : -1;
            root.updateMatrixWorld(true);
            const foot = joint(`${side}Foot`);
            const footWorld = foot.getWorldQuaternion(new T.Quaternion());
            const toe = joint(`${side}ToeBase`)
                .getWorldPosition(new T.Vector3())
                .sub(foot.getWorldPosition(new T.Vector3()));
            // Preserve the shoe's flat bind orientation; only turn its heading.
            footWorld.premultiply(
                new T.Quaternion().setFromAxisAngle(
                    new T.Vector3(0, 1, 0),
                    sign * 0.09 - Math.atan2(toe.x, toe.z),
                ),
            );
            // The left foot rests slightly ahead, with a soft knee; the right
            // leg carries the stance. Both soles retain their level orientation.
            aim(
                `${side}UpLeg`,
                `${side}Leg`,
                new T.Vector3(sign * 0.025, -1, sign === 1 ? 0.1 : 0.025),
            );
            aim(`${side}Leg`, `${side}Foot`, new T.Vector3(sign * 0.015, -1, -0.025));
            root.updateMatrixWorld(true);
            foot.quaternion.copy(
                foot.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(footWorld),
            );

            // Umplix's Cross Arms hold, fitted by segment direction so the
            // reference character's long arms do not change native proportions.
            const reference = crossedArms[side as keyof typeof crossedArms];
            const upper = new T.Vector3()
                .fromArray(reference.ForeArm)
                .sub(new T.Vector3().fromArray(reference.Arm));
            const lower = new T.Vector3()
                .fromArray(reference.Hand)
                .sub(new T.Vector3().fromArray(reference.ForeArm));
            aim(`${side}Arm`, `${side}ForeArm`, upper);
            aim(`${side}ForeArm`, `${side}Hand`, lower);
            aim(
                `${side}Hand`,
                `${side}HandMiddle1`,
                new T.Vector3(-sign, sign === 1 ? 0.45 : 0.08, -0.25),
            );
        }

        // A quiet, seamless breath loop. Legs and pelvis are constant so the
        // shoes stay planted; captured combat sway never enters this clip.
        const times = Array.from({ length: 21 }, (_, i) => (i * duration) / 20);
        for (const bone of bones) {
            const values: number[] = [];
            const amplitude = bone.name.endsWith("Spine2")
                ? 0.006
                : bone.name.endsWith("Spine1")
                  ? 0.003
                  : bone.name.endsWith("Neck")
                    ? -0.004
                    : /(?:Left|Right)Arm$/.test(bone.name)
                      ? 0.003
                      : 0;
            for (const time of times) {
                const breath = Math.sin((time / duration) * Math.PI * 2);
                const q = bone.quaternion
                    .clone()
                    .multiply(
                        new T.Quaternion().setFromAxisAngle(
                            new T.Vector3(1, 0, 0),
                            breath * amplitude,
                        ),
                    );
                values.push(...q.toArray());
            }
            tracks.push(new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
        }
        const hips = joint("Hips");
        tracks.push(
            new T.VectorKeyframeTrack(
                `${hips.name}.position`,
                [0, duration],
                [...hips.position.toArray(), ...hips.position.toArray()],
            ),
        );
    } finally {
        for (const { bone, q } of saved) bone.quaternion.copy(q);
        root.updateMatrixWorld(true);
    }
    return new T.AnimationClip("idle_weight_shift", duration, tracks);
}
