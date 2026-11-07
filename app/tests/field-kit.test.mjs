// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import * as T from "three";

// Read the exported binary directly: these checks need neither Blender nor a browser.
function glb(path) {
    const data = readFileSync(new URL(`../public/squad/${path}`, import.meta.url));
    const jsonLength = data.readUInt32LE(12);
    const doc = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
    const binary = data.subarray(28 + jsonLength);
    function accessor(index) {
        const a = doc.accessors[index],
            view = doc.bufferViews[a.bufferView];
        const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
        const types = {
            5126: ["getFloat32", 4],
            5125: ["getUint32", 4],
            5123: ["getUint16", 2],
            5121: ["getUint8", 1],
        };
        const [get, bytes] = types[a.componentType];
        const dv = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
        return Array.from({ length: a.count }, (_, i) =>
            Array.from({ length: size }, (_, k) => {
                const value = dv[get](
                    (view.byteOffset || 0) +
                        (a.byteOffset || 0) +
                        i * (view.byteStride || size * bytes) +
                        k * bytes,
                    true,
                );
                return a.normalized ? value / (2 ** (8 * bytes) - 1) : value;
            }),
        );
    }
    return { doc, accessor };
}
for (const sex of ["female", "male"]) {
    const body = glb(`body/${sex}/skin.glb`);
    const nativeSkin = body.doc.skins[0];
    const nativeJoints = nativeSkin.joints.map((i) => body.doc.nodes[i].name);
    const nativeInverse = body.accessor(nativeSkin.inverseBindMatrices);
    for (const kind of ["field-kit", "spectre", "nyx", "nyx-mid", "nyx-heavy"])
        test(`${sex} ${kind}: native bind, valid weights and bounded geometry`, () => {
            const { doc, accessor } = glb(`armor/${kind}-${sex}.glb`);
            const skin = doc.skins[0],
                joints = skin.joints.map((i) => doc.nodes[i].name);
            const inverses = accessor(skin.inverseBindMatrices);
            for (let i = 0; i < joints.length; i++) {
                const original = nativeJoints.indexOf(joints[i]);
                assert.ok(original >= 0);
                for (let k = 0; k < 16; k++)
                    assert.ok(Math.abs(inverses[i][k] - nativeInverse[original][k]) < 1e-6);
            }
            const primitives = doc.meshes.flatMap((m) => m.primitives);
            assert.equal(
                primitives.length,
                kind === "field-kit" ? 3 : kind.startsWith("nyx") ? 5 : 4,
            );
            let triangles = 0;
            for (const p of primitives) {
                const positions = accessor(p.attributes.POSITION),
                    weights = accessor(p.attributes.WEIGHTS_0),
                    indices = accessor(p.attributes.JOINTS_0);
                triangles += accessor(p.indices).length / 3;
                positions.forEach((v, i) => {
                    assert.ok(v.every(Number.isFinite));
                    assert.ok(
                        Math.abs(v[0]) < 0.65 && v[1] > -0.06 && v[1] < 1.7 && Math.abs(v[2]) < 0.5,
                    );
                    assert.ok(Math.abs(weights[i].reduce((a, b) => a + b, 0) - 1) < 1e-5);
                    assert.ok(indices[i].every((j) => j >= 0 && j < joints.length));
                });
            }
            if (kind.startsWith("nyx")) {
                // A plate on one thigh must not be pulled by the opposite leg.
                // Test the exported triangles, after material batching and welding.
                const hip = nativeJoints.findIndex((name) => /LeftUpLeg$/.test(name));
                const thighTop =
                    new T.Matrix4().fromArray(nativeInverse[hip]).invert().elements[13] - 0.08;
                for (const p of primitives) {
                    const positions = accessor(p.attributes.POSITION);
                    const weights = accessor(p.attributes.WEIGHTS_0);
                    const boneIds = accessor(p.attributes.JOINTS_0);
                    const indices = accessor(p.indices).flat();
                    for (let i = 0; i < indices.length; i += 3) {
                        const corners = indices.slice(i, i + 3);
                        if (corners.some((id) => positions[id][1] > thighTop)) continue;
                        const influenced = ["Left", "Right"].map((side) =>
                            corners.some(
                                (id) =>
                                    weights[id].reduce(
                                        (sum, w, k) =>
                                            sum + (joints[boneIds[id][k]].includes(side) ? w : 0),
                                        0,
                                    ) > 0.1,
                            ),
                        );
                        assert.ok(
                            !influenced.every(Boolean),
                            "Armor triangle bridges opposite legs",
                        );
                    }
                }
            }
            assert.ok(
                triangles <
                    (kind === "nyx-heavy"
                        ? 58000
                        : kind.startsWith("nyx")
                          ? 55000
                          : kind === "field-kit"
                            ? 15000
                            : 9000),
                `${triangles} triangles exceeds kit budget`,
            );
            assert.equal(doc.textures?.length || 0, 2);
            if (kind.startsWith("nyx")) {
                assert.equal(
                    doc.meshes[0].extras.armorClass,
                    kind.endsWith("heavy") ? "heavy" : kind.endsWith("mid") ? "medium" : "light",
                );
                assert.ok(doc.meshes[0].extras.parts.every((name) => !/hood/i.test(name)));
                for (const p of primitives.filter((p) => doc.materials[p.material].normalTexture)) {
                    assert.ok(p.attributes.TEXCOORD_0 !== undefined);
                    assert.ok(
                        accessor(p.attributes.TEXCOORD_0).every((uv) => uv.every(Number.isFinite)),
                    );
                }
            }
        });
    test(`${sex}: boot soles cover both feet and remain on the podium in the studio pose`, () => {
        const { doc, accessor } = glb(`armor/field-kit-${sex}.glb`);
        const skin = doc.skins[0];
        const nodes = body.doc.nodes.map((n) => {
            const o = new T.Bone();
            o.name = T.PropertyBinding.sanitizeNodeName(n.name || "");
            o.position.fromArray(n.translation || [0, 0, 0]);
            o.quaternion.fromArray(n.rotation || [0, 0, 0, 1]);
            o.scale.fromArray(n.scale || [1, 1, 1]);
            return o;
        });
        body.doc.nodes.forEach((n, i) => (n.children || []).forEach((j) => nodes[i].add(nodes[j])));
        const root = new T.Group();
        nodes.filter((n) => !n.parent).forEach((n) => root.add(n));
        const clip = T.AnimationClip.parse(
            JSON.parse(
                readFileSync(new URL(`../public/squad/body/${sex}/idle.json`, import.meta.url)),
            ),
        );
        const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
        for (const track of clip.tracks) {
            if (track.name.endsWith(".position"))
                for (let i = 0; i < track.values.length; i += 3) {
                    const v = new T.Vector3().fromArray(track.values, i).multiplyScalar(0.01);
                    if (track.name.startsWith("mixamorigHips.")) v.applyQuaternion(turn);
                    v.toArray(track.values, i);
                }
            if (track.name === "mixamorigHips.quaternion")
                for (let i = 0; i < track.values.length; i += 4)
                    new T.Quaternion()
                        .fromArray(track.values, i)
                        .premultiply(turn)
                        .toArray(track.values, i);
        }
        const mixer = new T.AnimationMixer(root);
        mixer.clipAction(clip).play();
        mixer.setTime(0.8);
        root.updateMatrixWorld(true);
        const matrices = skin.joints.map((j, i) => {
            const bone = nodes.find(
                (n) => n.name === T.PropertyBinding.sanitizeNodeName(doc.nodes[j].name),
            );
            return bone.matrixWorld
                .clone()
                .multiply(new T.Matrix4().fromArray(accessor(skin.inverseBindMatrices)[i]));
        });
        const sole = { Left: [], Right: [] };
        for (const p of doc.meshes.flatMap((m) => m.primitives)) {
            const pos = accessor(p.attributes.POSITION),
                w = accessor(p.attributes.WEIGHTS_0),
                idx = accessor(p.attributes.JOINTS_0);
            pos.forEach((v, i) => {
                if (v[1] > 0.012) return;
                const side = v[0] > 0 ? "Left" : "Right";
                const posed = new T.Vector3();
                for (let k = 0; k < 4; k++)
                    posed.addScaledVector(
                        new T.Vector3().fromArray(v).applyMatrix4(matrices[idx[i][k]]),
                        w[i][k],
                    );
                sole[side].push(posed.y);
            });
        }
        assert.ok(sole.Left.length > 20 && sole.Right.length > 20);
        // A few mm of idle weight shift is acceptable; neither boot should float above the other.
        assert.ok(Math.abs(Math.min(...sole.Left) - Math.min(...sole.Right)) < 0.018);
    });
}
