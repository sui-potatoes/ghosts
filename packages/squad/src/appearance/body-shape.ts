// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { normalizeBody, bodyHeightScale, type BodyShape } from "../body.ts";

const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const bell = (center: number, radius: number, value: number) =>
    1 - smooth(0, radius, Math.abs(value - center));

interface Segment {
    start: T.Vector3;
    axis: T.Vector3;
    length: number;
}

/** A continuous rest-space warp fits skin and flexible garments. Rigid equipment
 * follows assembly anchors without changing its authored proportions.
 * It changes cross-sections without moving joints, so captured motion and hand
 * sockets remain compatible. Stature scales the entire assembled native rig. */
export class BodyDeformation {
    readonly shape: BodyShape;
    readonly heightScale: number;
    readonly active: boolean;
    private hip: T.Vector3;
    private waist: T.Vector3;
    private chest: T.Vector3;
    private neck: T.Vector3;
    private shoulder: number;
    private arms: Segment[][];
    private legs: Segment[][];
    private wrist: T.Vector3[];
    private ankle: number;

    constructor(body: T.SkinnedMesh, shape: unknown) {
        this.shape = normalizeBody(shape);
        this.heightScale = bodyHeightScale(this.shape);
        this.active = Object.entries(this.shape).some(
            ([key, value]) => key !== "height" && value !== 0,
        );
        body.updateWorldMatrix(true, false);
        const bone = (name: string) => {
            const joint = body.skeleton.bones.find((b) => b.name.endsWith(name));
            if (!joint) throw Error(`Missing body-shape joint: ${name}`);
            return body.worldToLocal(joint.getWorldPosition(new T.Vector3()));
        };
        const segment = (a: string, b: string): Segment => {
            const start = bone(a),
                axis = bone(b).sub(start),
                length = axis.length();
            return { start, axis: axis.normalize(), length };
        };
        this.hip = bone("Hips");
        this.waist = bone("Spine");
        this.chest = bone("Spine2");
        this.neck = bone("Neck");
        this.shoulder = Math.abs(bone("LeftArm").x);
        this.wrist = [bone("RightHand"), bone("LeftHand")];
        this.ankle = bone("LeftFoot").y;
        this.arms = ["Right", "Left"].map((side) => [
            segment(`${side}Arm`, `${side}ForeArm`),
            segment(`${side}ForeArm`, `${side}Hand`),
        ]);
        this.legs = ["Right", "Left"].map((side) => [
            segment(`${side}UpLeg`, `${side}Leg`),
            segment(`${side}Leg`, `${side}Foot`),
        ]);
    }

    /** No skin weights are used here: coincident garment/body points get identical offsets. */
    point(input: T.Vector3, output: T.Vector3): T.Vector3 {
        output.copy(input);
        if (!this.active) return output;
        const { build, muscle, chest, waist, hips } = this.shape;
        const side = input.x < 0 ? 0 : 1;
        const upper = smooth(this.hip.y - 0.14, this.hip.y + 0.12, input.y);
        const head = 1 - smooth(this.neck.y - 0.1, this.neck.y - 0.015, input.y);
        // The pelvis is wider than the rib cage. Reusing the shoulder cutoff here
        // pinched the outer hips while expanding their neighbors into angular lobes.
        const ribMask = 1 - smooth(this.shoulder * 0.65, this.shoulder * 1.3, Math.abs(input.x));
        const pelvisMask = 1 - smooth(this.shoulder * 1.3, this.shoulder * 2, Math.abs(input.x));
        const torso = T.MathUtils.lerp(
            pelvisMask,
            ribMask,
            smooth(this.hip.y + 0.06, this.hip.y + 0.28, input.y),
        );
        const chestArea = bell(this.chest.y + 0.055, 0.23, input.y);
        const waistArea = bell(this.waist.y, 0.19, input.y);
        const hipArea = bell(this.hip.y - 0.04, 0.22, input.y);
        const torsoWeight = torso * head * smooth(this.hip.y - 0.24, this.hip.y - 0.06, input.y);
        const width =
            0.14 * build +
            0.1 * muscle * chestArea -
            0.035 * muscle * waistArea +
            0.15 * chest * chestArea +
            0.22 * waist * waistArea +
            0.12 * hips * hipArea;
        const depth =
            0.14 * build +
            0.08 * muscle * chestArea +
            0.18 * chest * chestArea +
            0.28 * waist * waistArea +
            0.15 * hips * hipArea;
        const zCenter = T.MathUtils.lerp(
            this.hip.z,
            this.neck.z,
            T.MathUtils.clamp((input.y - this.hip.y) / (this.neck.y - this.hip.y), 0, 1),
        );
        output.x += input.x * width * torsoWeight;
        output.z += (input.z - zCenter) * depth * torsoWeight;

        // Blend the nearest two limb axes around knees/elbows. Fade to zero at
        // hands, neck and footwear to preserve grips, identity and sole contact.
        const addLimb = (segments: Segment[], amount: number) => {
            let sum = 0,
                dx = 0,
                dy = 0,
                dz = 0;
            for (const segment of segments) {
                const x = input.x - segment.start.x,
                    y = input.y - segment.start.y,
                    z = input.z - segment.start.z;
                const along = T.MathUtils.clamp(
                    x * segment.axis.x + y * segment.axis.y + z * segment.axis.z,
                    0,
                    segment.length,
                );
                const rx = x - segment.axis.x * along,
                    ry = y - segment.axis.y * along,
                    rz = z - segment.axis.z * along;
                const weight = 1 / (0.0025 + rx * rx + ry * ry + rz * rz);
                dx += rx * weight;
                dy += ry * weight;
                dz += rz * weight;
                sum += weight;
            }
            output.x += (dx / sum) * amount;
            output.y += (dy / sum) * amount;
            output.z += (dz / sum) * amount;
        };
        const wrist = this.wrist[side],
            forearm = this.arms[side][1].axis;
        const pastWrist =
            (input.x - wrist.x) * forearm.x +
            (input.y - wrist.y) * forearm.y +
            (input.z - wrist.z) * forearm.z;
        const hand = 1 - smooth(-0.12, -0.025, pastWrist);
        addLimb(
            this.arms[side],
            (0.15 * build + 0.16 * muscle) * (1 - torso) * upper * head * hand,
        );
        const legWeight =
            (1 - torsoWeight) *
            (1 - upper) *
            smooth(this.ankle + 0.07, this.ankle + 0.23, input.y) *
            (1 - smooth(this.shoulder * 0.9, this.shoulder * 1.75, Math.abs(input.x)));
        // The pelvis joins both legs. A hard side switch here moves adjacent
        // center-seam vertices toward opposite thigh axes, folding the surface
        // and flipping the normals sampled across it (front and back alike).
        const leftLeg = smooth(-0.06, 0.06, input.x);
        const legAmount = (0.15 * build + 0.12 * muscle + 0.07 * hips) * legWeight;
        if (leftLeg < 1) addLimb(this.legs[0], legAmount * (1 - leftLeg));
        if (leftLeg > 0) addLimb(this.legs[1], legAmount * leftLeg);
        return output;
    }

    /** Called once on owned geometry, never per animation frame or on cached GLTFs. */
    geometry(geometry: T.BufferGeometry) {
        if (!this.active) return;
        const groups = geometry.getAttribute("_rigid_fit");
        const anchors = geometry.userData.rigidFit as { center: number[] }[] | undefined;
        const offsets = anchors?.map(({ center }) => {
            const p = new T.Vector3().fromArray(center);
            return this.point(p, new T.Vector3()).sub(p);
        });
        const positions = geometry.getAttribute("position"),
            normals = geometry.getAttribute("normal");
        const p = new T.Vector3(),
            moved = new T.Vector3(),
            n = new T.Vector3();
        const u = new T.Vector3(),
            v = new T.Vector3(),
            a = new T.Vector3(),
            b = new T.Vector3(),
            probe = new T.Vector3();
        for (let i = 0; i < positions.count; i++) {
            p.fromBufferAttribute(positions, i);
            const group = groups?.getX(i) ?? 0;
            if (group) {
                const offset = offsets?.[group - 1];
                if (!offset) throw Error(`Missing rigid fit assembly ${group}`);
                moved.copy(p).add(offset);
                positions.setXYZ(i, moved.x, moved.y, moved.z);
                continue; // Translation preserves normals, UVs and all pairwise distances.
            }
            this.point(p, moved);
            if (normals) {
                n.fromBufferAttribute(normals, i).normalize();
                u.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0)
                    .cross(n)
                    .normalize();
                v.crossVectors(n, u);
                this.point(probe.copy(p).addScaledVector(u, 0.0001), a).sub(moved);
                this.point(probe.copy(p).addScaledVector(v, 0.0001), b).sub(moved);
                n.crossVectors(a, b).normalize();
                normals.setXYZ(i, n.x, n.y, n.z);
            }
            positions.setXYZ(i, moved.x, moved.y, moved.z);
        }
        positions.needsUpdate = true;
        if (normals) normals.needsUpdate = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
    }
}
