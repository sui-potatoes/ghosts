// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { SIDEARM_MOUNT_OFFSET } from "./sidearm.ts";

interface HandMount {
    position: number[];
    quaternion: number[];
    scale: number[];
    correction: number[];
    translation: number[];
}

/** Undo inventory centering and bind a clone to the native hand's authored socket. */
export function mountHandEquipment(gun: T.Group, hand: T.Bone, mount: HandMount) {
    const correction = new T.Quaternion().fromArray(mount.correction);
    const basis = new T.Quaternion().setFromRotationMatrix(
        new T.Matrix4().makeBasis(
            new T.Vector3(0, 0, -1),
            new T.Vector3(1, 0, 0),
            new T.Vector3(0, -1, 0),
        ),
    );
    const socketOffset =
        gun.userData.model === "pistol"
            ? new T.Vector3(...SIDEARM_MOUNT_OFFSET).applyQuaternion(basis)
            : new T.Vector3();
    // Cloned inventory models carry the original centering vector. Apply once.
    if (!gun.userData.held) {
        const center = new T.Vector3().fromArray(gun.userData.center);
        for (const child of gun.children) child.position.add(center).add(socketOffset);
        gun.userData.held = true;
    }
    gun.quaternion
        .copy(correction)
        .multiply(new T.Quaternion().fromArray(mount.quaternion))
        .multiply(basis.invert());
    gun.position
        .fromArray(mount.position)
        .applyQuaternion(correction)
        .add(new T.Vector3().fromArray(mount.translation))
        .multiplyScalar(0.01);
    gun.scale.fromArray(mount.scale).multiplyScalar(0.01);
    hand.add(gun);
}
