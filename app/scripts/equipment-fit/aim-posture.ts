// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** Keep a modest shooting lean instead of folding the chest over the waist. */
export const MAX_AIM_LEAN = T.MathUtils.degToRad(22);

/** Offline pose correction. Rebase the neck and clavicles so gaze and weapon aim survive it. */
export function relaxAimPosture(root: T.Object3D) {
    const chest = root.getObjectByName("mixamorigSpine2")!;
    const neck = root.getObjectByName("mixamorigNeck")!;
    root.updateMatrixWorld(true);
    const direction = neck.getWorldPosition(new T.Vector3())
        .sub(chest.getWorldPosition(new T.Vector3())).normalize();
    if (Math.acos(T.MathUtils.clamp(direction.y, -1, 1)) <= MAX_AIM_LEAN) return;
    const preserved = [neck, ...["Left", "Right"].map((side) =>
        root.getObjectByName(`mixamorig${side}Shoulder`)!,
    )].map((bone) => ({ bone, rotation: bone.getWorldQuaternion(new T.Quaternion()) }));
    const upright = new T.Vector3(direction.x, 0, direction.z)
        .normalize().multiplyScalar(Math.sin(MAX_AIM_LEAN));
    upright.y = Math.cos(MAX_AIM_LEAN);
    const correction = new T.Quaternion().setFromUnitVectors(direction, upright);
    chest.quaternion.copy(chest.parent!.getWorldQuaternion(new T.Quaternion()).invert()
        .multiply(correction.multiply(chest.getWorldQuaternion(new T.Quaternion()))));
    root.updateMatrixWorld(true);
    for (const { bone, rotation } of preserved) {
        bone.quaternion.copy(bone.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
        bone.updateMatrixWorld(true);
    }
}
