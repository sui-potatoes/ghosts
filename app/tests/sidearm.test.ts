import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { createSidearm, SIDEARM_GRIP } from "../src/features/squad/studio/sidearm.ts";
import { mountHandEquipment } from "../src/features/squad/studio/held-equipment.ts";
import { nativeClip } from "../src/features/squad/motion/clips.ts";

function inventoryGun() {
    const group = new T.Group(),
        pistol = createSidearm();
    pistol.quaternion.setFromRotationMatrix(
        new T.Matrix4().makeBasis(
            new T.Vector3(0, 0, -1),
            new T.Vector3(1, 0, 0),
            new T.Vector3(0, -1, 0),
        ),
    );
    group.add(pistol);
    const center = new T.Box3().setFromObject(group).getCenter(new T.Vector3());
    pistol.position.sub(center);
    group.userData.center = center.toArray();
    group.userData.model = "pistol";
    return { group, pistol };
}
test("sidearm has finite compact geometry and a bounded rendering cost", () => {
    const gun = createSidearm();
    const size = new T.Box3().setFromObject(gun).getSize(new T.Vector3());
    assert.ok(size.x > 0.025 && size.x < 0.045);
    assert.ok(size.y > 0.18 && size.y < 0.24);
    assert.ok(size.z > 0.12 && size.z < 0.17);
    assert.equal(gun.children.length, 4);
    let triangles = 0;
    gun.traverse((o) => {
        if (o instanceof T.Mesh) {
            triangles += o.geometry.attributes.position.count / 3;
            assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));
        }
    });
    assert.ok(triangles < 3500);
});
for (const sex of ["female", "male"])
    test(`${sex}: grip stays inside palm through all four pistol clips; reattachment never compounds offsets`, () => {
        const file = readFileSync(`public/squad/body/${sex}/skin.glb`);
        const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
        const nodes = gltf.nodes.map(
            (n: {
                name?: string;
                translation?: number[];
                rotation?: number[];
                scale?: number[];
                matrix?: number[];
            }) => {
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
            },
        );
        gltf.nodes.forEach((n: { children?: number[] }, i: number) =>
            n.children?.forEach((j) => nodes[i].add(nodes[j])),
        );
        const root = new T.Group();
        gltf.scenes[gltf.scene ?? 0].nodes.forEach((i: number) => root.add(nodes[i]));
        const hand = root.getObjectByName("mixamorigRightHand") as T.Bone;
        const mount = JSON.parse(
            readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8"),
        );
        const { group, pistol } = inventoryGun();
        mountHandEquipment(group, hand, mount);
        const pos = pistol.position.clone();
        mountHandEquipment(group, hand, mount);
        assert.ok(pos.equals(pistol.position));
        const clips = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
        );
        const mixer = new T.AnimationMixer(root);
        for (const name of ["pistol_idle", "pistol_ready", "pistol_shot", "pistol_reload"]) {
            mixer.stopAllAction();
            const clip = nativeClip(
                T.AnimationClip.parse(clips.find((c: { name: string }) => c.name === name)),
                true,
            );
            const action = mixer.clipAction(clip);
            action.play();
            for (const fraction of [0, 0.25, 0.5, 0.75, 0.99]) {
                action.time = clip.duration * fraction;
                mixer.update(0);
                root.updateMatrixWorld(true);
                const grip = pistol.localToWorld(new T.Vector3(...SIDEARM_GRIP));
                const knuckle = root
                    .getObjectByName("mixamorigRightHandMiddle1")!
                    .getWorldPosition(new T.Vector3());
                const wrist = hand.getWorldPosition(new T.Vector3());
                // Palm, not beyond the finger tips (the old socket was ~6 cm too far forward).
                const palm = wrist.clone().lerp(knuckle, 0.8);
                assert.ok(
                    grip.distanceTo(palm) < 0.032,
                    `${name}@${fraction}: ${grip.distanceTo(palm)}`,
                );
                assert.ok(grip.distanceTo(wrist) < knuckle.distanceTo(wrist) + 0.005);
            }
        }
    });
