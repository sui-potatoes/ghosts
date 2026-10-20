// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** Transfer at the two-handed starting pose, retaining the fore-end grip. */
export class WeaponCarry {
    private weapon: T.Object3D;
    private right: T.Object3D;
    private left: T.Object3D;
    private rest: T.Matrix4;
    constructor(weapon: T.Object3D, left: T.Object3D) {
        this.weapon = weapon;
        this.right = weapon.parent!;
        this.left = left;
        weapon.updateMatrix();
        this.rest = weapon.matrix.clone();
    }
    update(throwing: boolean) {
        if (throwing && this.weapon.parent !== this.left) {
            this.weapon.updateWorldMatrix(true, false);
            this.left.attach(this.weapon);
        } else if (!throwing && this.weapon.parent !== this.right) {
            this.right.add(this.weapon);
            this.rest.decompose(this.weapon.position, this.weapon.quaternion, this.weapon.scale);
        }
    }
}
