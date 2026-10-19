import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { nativeClip, captureClip } from "../src/features/squad/motion/clips.ts";
import { clearEquipment, motionSkeleton } from "../src/features/squad/motion/clearance.ts";
import { WeaponCarry } from "../src/features/squad/motion/weapon-carry.ts";
import { mountHandEquipment } from "../src/features/squad/studio/held-equipment.ts";

function assets(sex: string) {
    const b = readFileSync(`public/squad/body/${sex}/skin.glb`);
    return {
        root: motionSkeleton(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
        mount: JSON.parse(readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8")),
        clips: JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
        ).map((c: Parameters<typeof T.AnimationClip.parse>[0]) =>
            nativeClip(T.AnimationClip.parse(c)),
        ) as T.AnimationClip[],
    };
}
function pose(root: T.Group, clip: T.AnimationClip, time: number) {
    for (const t of clip.tracks) {
        const [name, property] = t.name.split("."),
            bone = root.getObjectByName(name)!;
        const value = t.createInterpolant().evaluate(time);
        if (property === "quaternion") bone.quaternion.fromArray(value);
        else if (property === "position") bone.position.fromArray(value);
        else if (property === "scale") bone.scale.fromArray(value);
    }
    root.updateMatrixWorld(true);
}
for (const sex of ["female", "male"]) {
    test(`${sex}: cover corrections retain both grips, preserve torso motion and survive combat conversion`, () => {
        for (const name of [
            "cover_peek",
            "stand_cover_emerge",
            "cover_return",
            "crouch_reload",
            "crouch_shooting",
        ]) {
            const { root, mount, clips } = assets(sex),
                original = clips.find((c) => c.name === name)!;
            const before = JSON.stringify(T.AnimationClip.toJSON(original));
            const corrected = clearEquipment(original, root, mount);
            assert.equal(JSON.stringify(T.AnimationClip.toJSON(original)), before);
            const roundtrip = nativeClip(captureClip(corrected));
            for (const t of corrected.tracks) {
                assert.ok(Array.from(t.values).every(Number.isFinite));
                const copy = roundtrip.tracks.find((c) => c.name === t.name)!;
                t.values.forEach((v, i) => assert.ok(Math.abs(v - copy.values[i]) < 0.00001));
            }
            const world = (name: string) =>
                root.getObjectByName("mixamorig" + name)!.getWorldPosition(new T.Vector3());
            let greatestShift = 0;
            for (let frame = 0; frame <= 100; frame++) {
                const time = (original.duration * frame) / 100;
                pose(root, original, time);
                const r = world("RightHand"),
                    l = world("LeftHand"),
                    chest = world("Spine2");
                pose(root, corrected, time);
                const dr = world("RightHand").sub(r),
                    dl = world("LeftHand").sub(l);
                assert.ok(
                    dr.distanceTo(dl) < 0.015,
                    `${name}@${time}: grip drift ${dr.distanceTo(dl)}`,
                );
                assert.ok(chest.distanceTo(world("Spine2")) < 1e-6);
                greatestShift = Math.max(greatestShift, dr.length());
            }
            if (name === "cover_peek")
                assert.ok(greatestShift > 0.05, "Peek must clear the original chest intersection");
        }
    });
    test(`${sex}: vault knees hinge without axial flips or a fully crushed fold`, () => {
        const { root, mount, clips } = assets(sex),
            clip = clearEquipment(
                clips.find((c) => c.name === "vault")!,
                root,
                mount,
            );
        for (let i = 0; i <= 100; i++) {
            pose(root, clip, (clip.duration * i) / 100);
            const p = (name: string) =>
                root.getObjectByName("mixamorig" + name)!.getWorldPosition(new T.Vector3());
            for (const side of ["Right", "Left"]) {
                const upper = p(side + "Leg").sub(p(side + "UpLeg")),
                    lower = p(side + "Foot").sub(p(side + "Leg"));
                assert.ok(upper.angleTo(lower) < T.MathUtils.degToRad(125));
            }
        }
        for (const side of ["Right", "Left"]) {
            const t = clip.tracks.find((t) => t.name === `mixamorig${side}Leg.quaternion`)!;
            for (let i = 4; i < t.values.length; i += 4)
                assert.ok(
                    new T.Quaternion()
                        .fromArray(t.values, i)
                        .angleTo(new T.Quaternion().fromArray(t.values, i - 4)) < 0.6,
                    "No single-frame knee reversal",
                );
        }
    });
    test(`${sex}: grenade rifle remains fixed to left hand and returns to the right socket`, () => {
        const { root, mount, clips } = assets(sex),
            clip = clips.find((c) => c.name === "toss_grenade")!;
        const right = root.getObjectByName("mixamorigRightHand") as T.Bone,
            left = root.getObjectByName("mixamorigLeftHand")!;
        const gun = new T.Group();
        gun.userData.center = [0, 0, 0];
        mountHandEquipment(gun, right, mount);
        const original = gun.position.clone(),
            carry = new WeaponCarry(gun, left);
        pose(root, clip, 0);
        root.updateMatrixWorld(true);
        const start = gun.getWorldPosition(new T.Vector3());
        carry.update(true);
        assert.ok(start.distanceTo(gun.getWorldPosition(new T.Vector3())) < 1e-6);
        const grip = gun.position.clone();
        for (const f of [0.2, 0.5, 0.8, 1]) {
            pose(root, clip, f * clip.duration);
            carry.update(true);
            assert.equal(gun.parent, left);
            assert.ok(gun.position.distanceTo(grip) < 1e-6);
            assert.equal(gun.visible, true);
        }
        carry.update(false);
        assert.equal(gun.parent, right);
        assert.ok(gun.position.distanceTo(original) < 1e-6);
    });
}
