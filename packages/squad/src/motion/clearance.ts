// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mountHandEquipment } from "../studio/held-equipment.ts";

interface RigNode {
    name?: string;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
}
export function motionSkeleton(buffer: ArrayBuffer) {
    const length = new DataView(buffer).getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
    const nodes = gltf.nodes.map((n: RigNode) => {
        const bone = new T.Bone();
        bone.name = T.PropertyBinding.sanitizeNodeName(n.name ?? "");
        if (n.translation) bone.position.fromArray(n.translation);
        if (n.rotation) bone.quaternion.fromArray(n.rotation);
        if (n.scale) bone.scale.fromArray(n.scale);
        if (n.matrix)
            new T.Matrix4()
                .fromArray(n.matrix)
                .decompose(bone.position, bone.quaternion, bone.scale);
        return bone;
    });
    gltf.nodes.forEach((n: RigNode, i: number) =>
        n.children?.forEach((j) => nodes[i].add(nodes[j])),
    );
    const root = new T.Group();
    gltf.scenes[gltf.scene ?? 0].nodes.forEach((i: number) => root.add(nodes[i]));
    root.updateMatrixWorld(true);
    return root;
}
const world = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
function rotateWorld(bone: T.Object3D, q: T.Quaternion) {
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));
    bone.updateMatrixWorld(true);
}
/** Preserve the captured elbow plane and wrist orientation while moving the hand. */
export function armTo(
    shoulder: T.Object3D,
    arm: T.Object3D,
    elbow: T.Object3D,
    hand: T.Object3D,
    goal: T.Vector3,
    swivel = 0,
) {
    const wrist = hand.getWorldQuaternion(new T.Quaternion());
    const reach = world(arm).distanceTo(world(elbow)) + world(elbow).distanceTo(world(hand));
    // Let the clavicle protract before straightening the elbow to its limit.
    for (let i = 0; i < 16 && world(arm).distanceTo(goal) > reach - 0.002; i++) {
        const pivot = world(shoulder),
            from = world(arm).sub(pivot).normalize(),
            to = goal.clone().sub(pivot).normalize();
        const q = new T.Quaternion().setFromUnitVectors(from, to);
        q.identity().slerp(new T.Quaternion().setFromUnitVectors(from, to), 0.16);
        rotateWorld(shoulder, q.multiply(shoulder.getWorldQuaternion(new T.Quaternion())));
    }
    const a = world(arm),
        b = world(elbow),
        c = world(hand);
    const ab = b.clone().sub(a),
        bc = c.clone().sub(b),
        axis = goal.clone().sub(a);
    const length = T.MathUtils.clamp(
        axis.length(),
        Math.abs(ab.length() - bc.length()) + 0.0001,
        ab.length() + bc.length() - 0.0001,
    );
    axis.normalize();
    const pole = ab
        .clone()
        .addScaledVector(axis, -ab.dot(axis))
        .normalize()
        .applyAxisAngle(axis, swivel);
    const along = (ab.lengthSq() - bc.lengthSq() + length * length) / (2 * length);
    const bend = a
        .clone()
        .addScaledVector(axis, along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, ab.lengthSq() - along * along)));
    rotateWorld(
        arm,
        new T.Quaternion()
            .setFromUnitVectors(ab.normalize(), bend.sub(a).normalize())
            .multiply(arm.getWorldQuaternion(new T.Quaternion())),
    );
    const pivot = world(elbow);
    rotateWorld(
        elbow,
        new T.Quaternion()
            .setFromUnitVectors(
                world(hand).sub(pivot).normalize(),
                goal.clone().sub(pivot).normalize(),
            )
            .multiply(elbow.getWorldQuaternion(new T.Quaternion())),
    );
    rotateWorld(hand, wrist);
}

// Sample the stock, receiver and scope envelope, including the sniper attachment.
const weaponPoints: T.Vector3[] = [];
for (let x = -0.33; x <= 0.12; x += 0.025)
    for (const y of [0.015, 0.055])
        for (const z of [-0.031, 0.031]) weaponPoints.push(new T.Vector3(x, y, z));
for (let x = -0.14; x <= 0.09; x += 0.025)
    for (const y of [0.115, 0.167])
        for (const z of [-0.03, 0.03]) weaponPoints.push(new T.Vector3(x, y, z));
const coverClips = new Set([
    "cover_peek",
    "stand_cover_idle",
    "stand_cover_emerge",
    "cover_return",
    "stand_cover_move",
    "cover_move_left",
    "crouch_reload",
    "crouch_shooting",
    "rifle_crouch_idle",
]);

/** Bake once when loading the library. Runtime mixers blend ordinary quaternion tracks. */
export function clearEquipment(
    source: T.AnimationClip,
    root: T.Group,
    mount: Parameters<typeof mountHandEquipment>[2],
) {
    if (!coverClips.has(source.name) && source.name !== "vault") return source;
    const bone = (n: string) => root.getObjectByName("mixamorig" + n)!;
    const chest = bone("Spine2"),
        head = bone("Head");
    const restChest = chest.matrixWorld.clone(),
        restHead = head.matrixWorld.clone();
    // Torso envelope includes the heavy cuirass; these centers follow the bones.
    const chestFrame = new T.Matrix4().makeTranslation(
        ...(world(chest)
            .add(new T.Vector3(0, 0.025, 0.025))
            .toArray() as [number, number, number]),
    );
    const headFrame = new T.Matrix4().makeTranslation(
        ...(world(head)
            .add(new T.Vector3(0, 0.075, 0.015))
            .toArray() as [number, number, number]),
    );
    const chestLocal = restChest.invert().multiply(chestFrame),
        headLocal = restHead.invert().multiply(headFrame);
    const gun = new T.Group();
    gun.userData.center = [0, 0, 0];
    mountHandEquipment(gun, bone("RightHand") as T.Bone, mount);
    const arms = ["Right", "Left"].map((s) => [
        bone(s + "Shoulder"),
        bone(s + "Arm"),
        bone(s + "ForeArm"),
        bone(s + "Hand"),
    ]);
    const knees = ["Left", "Right"].map((side) => {
        const knee = bone(side + "Leg");
        return {
            side,
            knee,
            thigh: bone(side + "UpLeg"),
            thighRest: bone(side + "UpLeg").getWorldQuaternion(new T.Quaternion()),
            thighDirection: world(knee)
                .sub(world(bone(side + "UpLeg")))
                .normalize(),
            foot: bone(side + "Foot"),
            footRest: bone(side + "Foot").quaternion.clone(),
            rest: knee.getWorldQuaternion(new T.Quaternion()),
            direction: world(bone(side + "Foot"))
                .sub(world(knee))
                .normalize(),
        };
    });
    const changed =
        source.name === "vault" ? knees.flatMap((k) => [k.thigh, k.knee, k.foot]) : arms.flat();
    const saved = new Map<T.Object3D, [T.Vector3, T.Quaternion, T.Vector3]>();
    root.traverse((o) => saved.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
    const values = changed.map(() => [] as number[]),
        times: number[] = [];
    const samplers = source.tracks.map((track) => {
        const [name, property] = track.name.split(".");
        return {
            target: root.getObjectByName(name)!,
            property,
            interpolant: track.createInterpolant(),
        };
    });
    const frames = Math.ceil(source.duration * 60);
    for (let frame = 0; frame <= frames; frame++) {
        const time = (source.duration * frame) / frames;
        for (const { target, property, interpolant } of samplers) {
            const value = interpolant.evaluate(time);
            if (property === "quaternion") target.quaternion.fromArray(value);
            else if (property === "position") target.position.fromArray(value);
            else if (property === "scale") target.scale.fromArray(value);
        }
        root.updateMatrixWorld(true);
        if (source.name === "vault") {
            for (const {
                side,
                thigh,
                thighRest,
                thighDirection,
                knee,
                foot,
                footRest,
                rest,
                direction,
            } of knees) {
                const hip = bone(side + "UpLeg");
                const upper = world(knee).sub(world(hip)).normalize(),
                    lower = world(foot).sub(world(knee)).normalize();
                const flex = upper.angleTo(lower),
                    limit = T.MathUtils.degToRad(112);
                if (flex > limit)
                    lower.applyAxisAngle(
                        new T.Vector3().crossVectors(lower, upper).normalize(),
                        flex - limit,
                    );
                // Retain the captured ankle trajectory, but reconstruct the shin
                // without the source IK's axial flips and over-folded knee.
                rotateWorld(
                    thigh,
                    new T.Quaternion()
                        .setFromUnitVectors(thighDirection, upper)
                        .multiply(thighRest),
                );
                rotateWorld(
                    knee,
                    new T.Quaternion().setFromUnitVectors(direction, lower).multiply(rest),
                );
                foot.quaternion.copy(footRest);
                knee.updateMatrixWorld(true);
            }
        } else {
            const chestWorld = chest.matrixWorld.clone().multiply(chestLocal),
                headWorld = head.matrixWorld.clone().multiply(headLocal);
            const forward = new T.Vector3(0, 0, 1).transformDirection(chestWorld),
                right = new T.Vector3(-1, 0, 0).transformDirection(headWorld);
            const points = weaponPoints.map((p) => gun.localToWorld(p.clone())),
                delta = new T.Vector3();
            // Find the smallest displacement along a chosen escape direction that
            // takes every intersecting weapon sample outside the protected volume.
            for (const [matrix, radii, direction] of [
                [chestWorld, new T.Vector3(0.17, 0.23, 0.16), forward],
                [headWorld, new T.Vector3(0.115, 0.15, 0.125), right],
            ] as const) {
                const inv = matrix.clone().invert();
                const d = direction.clone().transformDirection(inv).divide(radii);
                let distance = 0;
                for (const point of points) {
                    const p = point.clone().add(delta).applyMatrix4(inv).divide(radii);
                    if (p.lengthSq() >= 1) continue;
                    const dot = p.dot(d),
                        a = d.lengthSq();
                    distance = Math.max(
                        distance,
                        (-dot + Math.sqrt(dot * dot + a * (1 - p.lengthSq()))) / a,
                    );
                }
                delta.addScaledVector(direction, distance);
            }
            const goals = arms.map(([, , , hand]) => world(hand).add(delta));
            arms.forEach(([s, a, b, c], i) => armTo(s, a, b, c, goals[i]));
        }
        times.push(time);
        changed.forEach((b, i) => b.quaternion.toArray(values[i], values[i].length));
    }
    gun.removeFromParent();
    for (const [o, [p, q, s]] of saved) {
        o.position.copy(p);
        o.quaternion.copy(q);
        o.scale.copy(s);
    }
    root.updateMatrixWorld(true);
    const names = new Set(changed.map((b) => b.name + ".quaternion"));
    const result = source.clone();
    result.tracks = result.tracks.filter((t) => !names.has(t.name));
    changed.forEach((b, i) =>
        result.tracks.push(new T.QuaternionKeyframeTrack(b.name + ".quaternion", times, values[i])),
    );
    return result;
}
