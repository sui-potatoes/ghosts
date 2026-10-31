// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BodyDeformation } from "@ghosts/squad/appearance/body-shape";
import { BODY_CONTROLS, normalizeBody } from "@ghosts/squad/body";
import { normalize, shuffleFace } from "@ghosts/squad/appearance/editor-state";
import { schema } from "@ghosts/squad/appearance/schema";
import { initialSquad, editRecruit, restoreSquad } from "@ghosts/squad/model";
import { nativeClip } from "@ghosts/squad/motion/clips";

// Parse real geometry and rigs without browser image decoding; no network access.
async function load(path: string) {
    const bytes = readFileSync(path),
        jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    json.materials = json.materials.map((m: { name: string }) => ({ name: m.name }));
    delete json.images;
    delete json.textures;
    delete json.samplers;
    const encoded = Buffer.from(JSON.stringify(json));
    const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
    encoded.copy(padded);
    const binaryChunk = bytes.subarray(20 + jsonLength);
    const glb = Buffer.alloc(20 + padded.length + binaryChunk.length);
    bytes.copy(glb, 0, 0, 20);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12);
    padded.copy(glb, 20);
    binaryChunk.copy(glb, 20 + padded.length);
    return (
        await new GLTFLoader().parseAsync(
            glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
            "",
        )
    ).scene;
}
function skins(root: T.Object3D) {
    const result: T.SkinnedMesh[] = [];
    root.traverse((o) => {
        if (o instanceof T.SkinnedMesh) result.push(o);
    });
    return result;
}

test("body controls migrate old saves, validate input and persist independently of facial morphs", () => {
    const squad = initialSquad(),
        appearance = squad.recruits[0].appearance;
    const old = structuredClone(squad);
    delete (old.recruits[0].appearance as Partial<typeof appearance>).body;
    assert.deepEqual(restoreSquad(old).recruits[0].appearance.body, normalizeBody(null));
    assert.deepEqual(
        normalizeBody({ height: Infinity, build: 7, muscle: -3, waist: "1", hips: NaN }),
        { height: 0, build: 1, muscle: -1, chest: 0, waist: 0, hips: 0 },
    );
    const body = { height: 0.6, build: -0.5, muscle: 0.7, chest: 0.4, waist: -0.6, hips: 0.3 };
    const saved = editRecruit(squad, squad.recruits[0].id, { appearance: { ...appearance, body } });
    const restored = restoreSquad(JSON.parse(JSON.stringify(saved))).recruits[0].appearance;
    assert.deepEqual(restored.body, body);
    assert.deepEqual(restored.values, appearance.values);
    assert.deepEqual(shuffleFace(schema, restored).body, body);
    assert.deepEqual(normalize({ ...restored, body: null }, schema).body, normalizeBody(null));
    assert.deepEqual(
        appearance.body,
        normalizeBody(null),
        "editing never mutates a cached identity",
    );
});

for (const sex of ["male", "female"]) {
    test(`${sex}: controls change body volume while preserving face, hands, feet and bind skeleton`, async () => {
        const root = await load(`public/squad/body/${sex}/skin.glb`),
            body = skins(root)[0];
        const original = body.geometry.attributes.position.array.slice();
        const originalPositions = body.geometry.attributes.position;
        const inverse = body.skeleton.boneInverses.map((m) => m.toArray());
        const neutral = new BodyDeformation(body, normalizeBody(null));
        neutral.geometry(body.geometry);
        assert.deepEqual(
            body.geometry.attributes.position.array,
            original,
            "neutral is an exact no-op",
        );
        const normal = body.geometry.attributes.normal;
        const neck = body.skeleton.bones
            .find((b) => b.name.endsWith("Neck"))!
            .getWorldPosition(new T.Vector3());
        for (const { key } of BODY_CONTROLS) {
            if (key === "height") continue;
            const warp = new BodyDeformation(body, { [key]: 1 });
            const geometry = body.geometry.clone();
            warp.geometry(geometry);
            const position = geometry.attributes.position;
            let maxDelta = 0;
            for (let i = 0; i < position.count; i++) {
                const p = new T.Vector3().fromBufferAttribute(originalPositions, i),
                    moved = new T.Vector3().fromBufferAttribute(position, i);
                const delta = p.distanceTo(moved);
                maxDelta = Math.max(maxDelta, delta);
                assert(Number.isFinite(delta));
                if (p.y > neck.y || p.y < 0.13)
                    assert(delta < 1e-6, `${key}: face/feet stay intact`);
                const indices = body.geometry.attributes.skinIndex,
                    weights = body.geometry.attributes.skinWeight;
                let handWeight = 0;
                for (let k = 0; k < 4; k++)
                    if (body.skeleton.bones[indices.getComponent(i, k)].name.includes("Hand"))
                        handWeight += weights.getComponent(i, k);
                if (handWeight > 0.99) assert(delta < 1e-6, `${key}: hands retain weapon grips`);
                const n = new T.Vector3().fromBufferAttribute(geometry.attributes.normal, i);
                assert(
                    Math.abs(n.length() - 1) < 0.001 ||
                        new T.Vector3().fromBufferAttribute(normal, i).length() === 0,
                );
            }
            assert(maxDelta > 0.008, `${key} visibly changes the surface`);
            assert(maxDelta < 0.15, `${key} stays within the fitted range`);
            geometry.dispose();
        }
        assert.deepEqual(
            body.skeleton.boneInverses.map((m) => m.toArray()),
            inverse,
        );
        assert.deepEqual(
            body.geometry.attributes.position.array,
            original,
            "cached body is untouched",
        );
        assert.equal(new BodyDeformation(body, { height: 1 }).heightScale, 1.09);
        assert.equal(new BodyDeformation(body, { height: -1 }).heightScale, 0.91);
    });

    test(`${sex}: every armor and civilian outfit follows the same shape field through motion`, async () => {
        const source = await load(`public/squad/body/${sex}/skin.glb`),
            body = skins(source)[0];
        const raw = JSON.parse(
            gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
        );
        const clips = raw
            .filter((c: { name: string }) =>
                ["idle_weight_shift", "run", "crouch_idle"].includes(c.name),
            )
            .map((c: Parameters<typeof T.AnimationClip.parse>[0]) =>
                nativeClip(T.AnimationClip.parse(c)),
            ) as T.AnimationClip[];
        for (const kind of [
            "field-kit",
            "spectre",
            "nyx",
            "nyx-mid",
            "nyx-heavy",
            "office-worker",
        ]) {
            const root = await load(`public/squad/armor/${kind}-${sex}.glb`);
            const meshes = skins(root);
            const originals = meshes.map((mesh) => mesh.geometry.clone());
            for (const sign of [-1, 1]) {
                const warp = new BodyDeformation(
                    body,
                    Object.fromEntries(BODY_CONTROLS.map(({ key }) => [key, sign])),
                );
                const before = originals.map((g) => g.attributes.position);
                for (const [n, mesh] of meshes.entries()) {
                    mesh.geometry = originals[n].clone();
                    warp.geometry(mesh.geometry);
                    const positions = mesh.geometry.attributes.position;
                    for (let i = 0; i < positions.count; i += 53) {
                        const expected = warp.point(
                            new T.Vector3().fromBufferAttribute(before[n], i),
                            new T.Vector3(),
                        );
                        assert(
                            expected.distanceTo(new T.Vector3().fromBufferAttribute(positions, i)) <
                                1e-6,
                            "cloth and body share identical spatial deformation",
                        );
                    }
                }
                root.scale.setScalar(warp.heightScale);
                const mixer = new T.AnimationMixer(root);
                for (const clip of clips) {
                    const action = mixer.clipAction(clip).play();
                    for (const fraction of [0, 0.5, 0.999]) {
                        action.time = clip.duration * fraction;
                        mixer.update(0);
                        root.updateMatrixWorld(true);
                        for (const mesh of meshes) {
                            const pos = mesh.geometry.attributes.position;
                            for (let i = 0; i < pos.count; i += 17) {
                                const p = mesh.applyBoneTransform(
                                    i,
                                    new T.Vector3().fromBufferAttribute(pos, i),
                                );
                                assert(
                                    Number.isFinite(p.length()) && p.length() < 3,
                                    `${kind}: bounded posed geometry`,
                                );
                            }
                        }
                    }
                    mixer.stopAllAction();
                }
                mixer.uncacheRoot(root);
                for (const mesh of meshes) mesh.geometry.dispose();
            }
            originals.forEach((g) => g.dispose());
        }
    });
}
