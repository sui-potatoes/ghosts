// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** Transfer at the two-handed starting pose, retaining the fore-end grip. */
export class WeaponCarry {
    private weapon: T.Object3D;
    private right: T.Object3D;
    private left: T.Object3D;
    private rest: T.Matrix4;
    private leftGrip?: T.Matrix4;
    constructor(weapon: T.Object3D, left: T.Object3D) {
        this.weapon = weapon;
        this.right = weapon.parent!;
        this.left = left;
        weapon.updateMatrix();
        this.rest = weapon.matrix.clone();
    }
    /** Derive the handoff from the throw's own first frame, not the previous action. */
    prepare(clip: T.AnimationClip, root: T.Object3D) {
        this.update(false);
        const saved = new Map<T.Object3D, [T.Vector3, T.Quaternion, T.Vector3]>();
        for (const track of clip.tracks) {
            const [name, property] = track.name.split(".");
            const node = root.getObjectByName(name);
            if (!node) continue;
            if (!saved.has(node))
                saved.set(node, [
                    node.position.clone(),
                    node.quaternion.clone(),
                    node.scale.clone(),
                ]);
            const value = track.createInterpolant().evaluate(0);
            if (property === "position") node.position.fromArray(value);
            else if (property === "quaternion") node.quaternion.fromArray(value);
            else if (property === "scale") node.scale.fromArray(value);
        }
        root.updateMatrixWorld(true);
        this.weapon.updateWorldMatrix(true, false);
        this.leftGrip = this.left.matrixWorld.clone().invert().multiply(this.weapon.matrixWorld);
        for (const [node, [p, q, s]] of saved) {
            node.position.copy(p);
            node.quaternion.copy(q);
            node.scale.copy(s);
        }
        root.updateMatrixWorld(true);
    }
    update(throwing: boolean) {
        if (throwing && this.weapon.parent !== this.left) {
            if (this.leftGrip) {
                this.left.add(this.weapon);
                this.leftGrip.decompose(
                    this.weapon.position,
                    this.weapon.quaternion,
                    this.weapon.scale,
                );
            } else {
                this.weapon.updateWorldMatrix(true, false);
                this.left.attach(this.weapon);
            }
        } else if (!throwing && this.weapon.parent !== this.right) {
            this.right.add(this.weapon);
            this.rest.decompose(this.weapon.position, this.weapon.quaternion, this.weapon.scale);
        }
    }
}
