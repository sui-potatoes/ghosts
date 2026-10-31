// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { armTo } from "@ghosts/squad/motion/clearance";

/** Offline cupped support grip for the common fore-end. No runtime IK or bone scaling. */
export function supportGrip(root: T.Group, weapon: T.Group, sex: string) {
    const bone = (name: string) => root.getObjectByName(`mixamorigLeft${name}`)!;
    const hand = bone("Hand");
    root.updateMatrixWorld(true);
    // The donor socket has a reflected scale: transform directions with its full
    // matrix, and conjugate rotations instead of discarding the reflection.
    const rotation = weapon.matrixWorld.clone().multiply(new T.Matrix4().makeRotationY(.5))
        .multiply(weapon.matrixWorld.clone().invert());
    const orientation = new T.Quaternion().setFromRotationMatrix(rotation)
        .multiply(hand.getWorldQuaternion(new T.Quaternion()));
    const goal = weapon.localToWorld(new T.Vector3(.095, -.016, sex === "male" ? .081 : .063));
    armTo(bone("Shoulder"), bone("Arm"), bone("ForeArm"), hand, goal);
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(orientation));
    hand.updateMatrixWorld(true);
    function aim(name: string, direction: T.Vector3) {
        const joint = bone(name), child = joint.children.find(o => o instanceof T.Bone);
        const from = child
            ? child.getWorldPosition(new T.Vector3()).sub(joint.getWorldPosition(new T.Vector3())).normalize()
            : new T.Vector3(0, 1, 0).applyQuaternion(joint.getWorldQuaternion(new T.Quaternion()));
        const worldDirection = direction.transformDirection(weapon.matrixWorld);
        const rotation = new T.Quaternion().setFromUnitVectors(from, worldDirection)
            .multiply(joint.getWorldQuaternion(new T.Quaternion()));
        joint.quaternion.copy(joint.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
        joint.updateMatrixWorld(true);
    }
    for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
        const joint = bone(`Hand${finger}1`);
        const p = weapon.worldToLocal(joint.getWorldPosition(new T.Vector3()));
        aim(`Hand${finger}1`, new T.Vector3(0, .003 - p.y, -.034 - p.z));
        aim(`Hand${finger}2`, new T.Vector3(0, 1, .04));
        aim(`Hand${finger}3`, new T.Vector3(0, 1, .12));
    }
    aim("HandThumb1", new T.Vector3(.6, .8, 0));
    aim("HandThumb2", new T.Vector3(1, .2, -.05));
    aim("HandThumb3", new T.Vector3(1, .1, -.05));
}
