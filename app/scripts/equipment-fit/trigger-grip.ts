// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as T from "three";

// Authored hand arcs for the centered, full-size grip.
const HAND_FIT: Record<string, Record<string, number[]>> = {
    female: {
        Thumb1: [-0.8, 0.05, 0.8],
        Thumb2: [0.35, 0.05, 1],
        Thumb3: [0.8, 0.1, 0.8],
    },
    male: {
        Thumb1: [-0.45, 0.3, 1],
        Thumb2: [0.35, 0.05, 1],
        Thumb3: [0.8, 0.1, 0.8],
    },
};

const fingerFrames = new WeakMap<T.Group, Map<string, T.Matrix4>>();
/** Capture anatomical finger roll from the bind pose before fitting any animation. */
export function captureTriggerHand(root: T.Group) {
    root.updateMatrixWorld(true);
    const index = root.getObjectByName("mixamorigRightHandIndex1")!;
    const pinky = root.getObjectByName("mixamorigRightHandPinky1")!;
    const across = index
        .getWorldPosition(new T.Vector3())
        .sub(pinky.getWorldPosition(new T.Vector3()))
        .normalize();
    const frames = new Map<string, T.Matrix4>();
    root.traverse((joint) => {
        if (!/mixamorigRightHand(?:Index|Middle|Ring|Pinky)[123]$/.test(joint.name)) return;
        const child = joint.children.find((o) => o instanceof T.Bone);
        const y = child ? child.position.clone().normalize() : new T.Vector3(0, 1, 0);
        const x = across
            .clone()
            .applyQuaternion(joint.getWorldQuaternion(new T.Quaternion()).invert());
        x.addScaledVector(y, -x.dot(y)).normalize();
        frames.set(joint.name, new T.Matrix4().makeBasis(x, y, x.clone().cross(y)).invert());
    });
    fingerFrames.set(root, frames);
}

/** Fit the trigger hand around the grip's outside surface; keep the wrist/socket invariant. */
export function triggerGrip(root: T.Group, weapon: T.Group, sex: string, firing: boolean) {
    root.updateMatrixWorld(true);
    const bone = (name: string) => root.getObjectByName(`mixamorigRightHand${name}`)!;
    const across = bone("Index1")
        .getWorldPosition(new T.Vector3())
        .sub(bone("Pinky1").getWorldPosition(new T.Vector3()))
        .normalize();
    function aim(name: string, xyz: number[]) {
        const joint = bone(name),
            child = joint.children.find((o) => o instanceof T.Bone);
        const from = child
            ? child
                  .getWorldPosition(new T.Vector3())
                  .sub(joint.getWorldPosition(new T.Vector3()))
                  .normalize()
            : new T.Vector3(0, 1, 0).applyQuaternion(joint.getWorldQuaternion(new T.Quaternion()));
        const to = new T.Vector3(...(HAND_FIT[sex]?.[name] ?? xyz)).transformDirection(
            weapon.matrixWorld,
        );
        const frame = fingerFrames.get(root)?.get(joint.name);
        const x = across.clone().addScaledVector(to, -across.dot(to)).normalize();
        const world = frame
            ? new T.Quaternion().setFromRotationMatrix(
                  new T.Matrix4().makeBasis(x, to, x.clone().cross(to)).multiply(frame),
              )
            : new T.Quaternion()
                  .setFromUnitVectors(from, to)
                  .multiply(joint.getWorldQuaternion(new T.Quaternion()));
        joint.quaternion.copy(
            joint.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(world),
        );
        joint.updateMatrixWorld(true);
    }
    for (const name of ["Middle", "Ring"]) {
        aim(name + "1", [name === "Middle" ? 0.2 : 0.3, name === "Middle" ? -0.22 : 0, 1]);
        aim(name + "2", [-0.1, 0, 1]);
        aim(name + "3", [-0.65, 0, 0.76]);
    }
    aim("Pinky1", [0.4, 0, 1]);
    aim("Pinky2", [0.1, 0, 1]);
    aim("Pinky3", [-0.35, 0, 0.94]);
    aim("Thumb1", [0, 0.2, 1]);
    aim("Thumb2", [0.5, 0.1, 1]);
    aim("Thumb3", [1, 0.1, 0.3]);
    if (firing) {
        // Spread flexion across PIP and DIP; the tip never hooks backward.
        const angles = sex === "female" ? [20, 45, 65] : [20, 50, 70];
        angles.forEach((degrees, index) => {
            const angle = T.MathUtils.degToRad(degrees);
            aim(`Index${index + 1}`, [
                Math.cos(angle),
                sex === "female" ? -0.08 : 0.08,
                Math.sin(angle),
            ]);
        });
    } else {
        aim("Index1", [1, 0.12, 0]);
        aim("Index2", [1, 0.08, 0]);
        aim("Index3", [1, 0.02, 0]);
    }
}
