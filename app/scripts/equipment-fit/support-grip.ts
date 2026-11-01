// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { armTo } from "@ghosts/squad/motion/clearance";

/** Offline support grip. The slim sharpshooter gets a tighter wrap; weapons and bones retain their scale. */
export function supportGrip(root: T.Group, weapon: T.Group, sex: string, model = "rifle") {
    const bone = (name: string) => root.getObjectByName(`mixamorigLeft${name}`)!;
    const hand = bone("Hand");
    root.updateMatrixWorld(true);
    // The donor socket has a reflected scale: transform directions with its full
    // matrix, and conjugate rotations instead of discarding the reflection.
    const rotation = weapon.matrixWorld
        .clone()
        .multiply(new T.Matrix4().makeRotationY(0.5))
        .multiply(weapon.matrixWorld.clone().invert());
    const orientation = new T.Quaternion()
        .setFromRotationMatrix(rotation)
        .multiply(hand.getWorldQuaternion(new T.Quaternion()));
    const goal = weapon.localToWorld(
        new T.Vector3(
            0.062,
            (sex === "male" ? -0.041 : -0.037) +
                (model === "sniper" ? (sex === "male" ? 0.006 : 0.007) : 0),
            (sex === "male" ? 0.081 : 0.063) -
                (model === "sniper" ? (sex === "male" ? 0.002 : 0.003) : 0),
        ),
    );
    armTo(bone("Shoulder"), bone("Arm"), bone("ForeArm"), hand, goal);
    hand.quaternion.copy(
        hand.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(orientation),
    );
    hand.updateMatrixWorld(true);
    function aim(name: string, direction: T.Vector3) {
        const joint = bone(name),
            child = joint.children.find((o) => o instanceof T.Bone);
        const from = child
            ? child
                  .getWorldPosition(new T.Vector3())
                  .sub(joint.getWorldPosition(new T.Vector3()))
                  .normalize()
            : new T.Vector3(0, 1, 0).applyQuaternion(joint.getWorldQuaternion(new T.Quaternion()));
        const worldDirection = direction.transformDirection(weapon.matrixWorld);
        const rotation = new T.Quaternion()
            .setFromUnitVectors(from, worldDirection)
            .multiply(joint.getWorldQuaternion(new T.Quaternion()));
        joint.quaternion.copy(
            joint.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation),
        );
        joint.updateMatrixWorld(true);
    }
    for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
        const joint = bone(`Hand${finger}1`);
        const p = weapon.worldToLocal(joint.getWorldPosition(new T.Vector3()));
        aim(
            `Hand${finger}1`,
            new T.Vector3(0, 0.003 - p.y, (model === "sniper" ? -0.047 : -0.058) - p.z),
        );
        aim(`Hand${finger}2`, new T.Vector3(0, 1, model === "sniper" ? 0.12 : 0.05));
        aim(`Hand${finger}3`, new T.Vector3(0, 1, 0.15));
    }
    aim(
        "HandThumb1",
        sex === "female"
            ? new T.Vector3(0.123988, 0.757271, 0.523058)
            : new T.Vector3(0, 1, model === "sniper" ? 0.15 : 0.3),
    );
    aim("HandThumb2", new T.Vector3(0.15, 1, model === "sniper" ? -0.25 : -0.1));
    aim("HandThumb3", new T.Vector3(0.7, 0.5, model === "sniper" ? -0.2 : -0.1));
}
