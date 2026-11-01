// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as T from "three";

// Authored hand arcs for the centered, full-size grip.
const HAND_FIT: Record<string, Record<string, number[]>> = {
    female: {
        Thumb1: [-0.507817, 0.012727, 0.839902],
        Thumb2: [0.457715, -0.054879, 0.937395],
        Thumb3: [1, 0.1, 0.3],
        Middle3: [-1, 0, 0.25],
        Ring3: [-1, 0, 0.25],
        Middle1: [-0.105492, -0.674895, 0.742532],
        Middle2: [-0.2, 0, 1],
    },
    male: {
        Thumb1: [-0.255827, 0.377884, 0.944429],
        Thumb2: [0.916742, -0.01955, 1.727203],
        Thumb3: [0.633155, 0.154538, 0.840291],
        Middle3: [-1, 0, 0.25],
        Ring3: [-0.814817, -0.258262, 0.54198],
    },
};

/** Fit the trigger hand around the grip's outside surface; keep the wrist/socket invariant. */
export function triggerGrip(root: T.Group, weapon: T.Group, sex: string, firing: boolean) {
    root.updateMatrixWorld(true);
    const bone = (name: string) => root.getObjectByName(`mixamorigRightHand${name}`)!;
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
        const world = new T.Quaternion()
            .setFromUnitVectors(from, to)
            .multiply(joint.getWorldQuaternion(new T.Quaternion()));
        joint.quaternion.copy(
            joint.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(world),
        );
        joint.updateMatrixWorld(true);
    }
    for (const name of ["Middle", "Ring"]) {
        aim(name + "1", [0, -0.5, 1]);
        aim(name + "2", [-0.2, 0, 1]);
        aim(name + "3", [-1, 0, 0.25]);
    }
    aim("Pinky1", [0.1, -0.2, 1]);
    aim("Pinky2", [-0.1, -0.1, 1]);
    aim("Pinky3", [-0.7, 0, 0.7]);
    aim("Thumb1", [0, 0.2, 1]);
    aim("Thumb2", [0.5, 0.1, 1]);
    aim("Thumb3", [1, 0.1, 0.3]);
    if (firing) {
        // Separate finger arcs accommodate the two donor hand lengths.
        if (sex === "female") {
            aim("Index1", [1, -0.125822, -0.202614]);
            aim("Index2", [1, -0.514115, 1.035369]);
            aim("Index3", [-2.520621, 1.457501, 1]);
        } else {
            aim("Index1", [1, -0.83561, -0.228045]);
            aim("Index2", [0.969019, -0.428388, 0.968634]);
            aim("Index3", [-0.073637, 0.241341, 1]);
        }
    } else {
        aim("Index1", [1, -0.3, -0.3]);
        aim("Index2", [1, 0, -0.2]);
        aim("Index3", [1, 0, -0.1]);
    }
}
