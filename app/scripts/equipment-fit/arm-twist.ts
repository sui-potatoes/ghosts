// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as T from "three";

export type ArmRest = Map<string, T.Quaternion>;
export function captureArmRest(root: T.Group): ArmRest {
    const rest: ArmRest = new Map();
    root.traverse((b) => {
        if (/mixamorig(?:Left|Right)(?:Arm|ForeArm|Hand)$/.test(b.name))
            rest.set(b.name, b.quaternion.clone());
    });
    return rest;
}
/** Roll the long bones instead of twisting the skinned wrist like a candy wrapper.
 * Each roll preserves joint locations and the child's world orientation. */
export function distributeArmTwist(root: T.Group, side: "Left" | "Right", rest: ArmRest) {
    const bone = (name: string) => root.getObjectByName(`mixamorig${side}${name}`)!;
    for (const [name, childName] of [
        ["ForeArm", "Hand"],
        ["Arm", "ForeArm"],
    ]) {
        const joint = bone(name),
            child = bone(childName);
        const world = joint.getWorldQuaternion(new T.Quaternion());
        const childWorld = child.getWorldQuaternion(new T.Quaternion());
        const desired = childWorld.clone().multiply(rest.get(child.name)!.clone().invert());
        const delta = desired.multiply(world.clone().invert());
        const axis = child
            .getWorldPosition(new T.Vector3())
            .sub(joint.getWorldPosition(new T.Vector3()))
            .normalize();
        const v = new T.Vector3(delta.x, delta.y, delta.z);
        const along = axis.multiplyScalar(v.dot(axis));
        const twist = new T.Quaternion(along.x, along.y, along.z, delta.w).normalize();
        // Share the remaining roll at the elbow and shoulder instead of turning
        // the entire shoulder (and its armor) with the wrist.
        if (name === "Arm")
            twist
                .identity()
                .slerp(new T.Quaternion(along.x, along.y, along.z, delta.w).normalize(), 0.5);
        joint.quaternion.copy(
            joint
                .parent!.getWorldQuaternion(new T.Quaternion())
                .invert()
                .multiply(twist.multiply(world)),
        );
        joint.updateMatrixWorld(true);
        child.quaternion.copy(
            joint.getWorldQuaternion(new T.Quaternion()).invert().multiply(childWorld),
        );
        child.updateMatrixWorld(true);
    }
}
