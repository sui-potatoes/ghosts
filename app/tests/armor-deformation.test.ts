// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, type EquipmentPoses } from "@ghosts/squad/motion/equipment-poses";

// Read geometry without loading texture images or requiring a WebGL context.
for (const sex of ["female", "male"])
    for (const kind of ["spectre", "nyx", "nyx-mid", "nyx-heavy", "field-kit"])
        test(`${kind}/${sex}: equipment retains its shape through all 38 poses`, () => {
            const file = readFileSync(`public/squad/armor/${kind}-${sex}.glb`),
                data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
            const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString()),
                binary = 28 + file.readUInt32LE(12);
            if (kind === "spectre") {
                assert.equal(
                    json.meshes[0].primitives.length,
                    4,
                    "surface detail keeps four material batches",
                );
                assert.equal(
                    json.materials.filter((m: { normalTexture?: unknown }) => m.normalTexture)
                        .length,
                    2,
                    "cloth and ceramic both carry embedded normal textures",
                );
                assert(
                    json.meshes[0].primitives.every(
                        (p: { material: number; attributes: Record<string, number> }) =>
                            !json.materials[p.material].normalTexture ||
                            p.attributes.TEXCOORD_0 !== undefined,
                    ),
                    "surface detail has authored UV coordinates",
                );
            }
            const root = motionSkeleton(data);
            const attr = (id: number) => {
                const a = json.accessors[id],
                    v = json.bufferViews[a.bufferView];
                const size: number = (
                    { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>
                )[a.type];
                const bytes = a.componentType === 5123 ? 2 : 4,
                    out = new Float32Array(a.count * size),
                    view = new DataView(data);
                const start = binary + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
                for (let i = 0; i < a.count; i++)
                    for (let k = 0; k < size; k++) {
                        const offset = start + i * (v.byteStride ?? size * bytes) + k * bytes;
                        out[i * size + k] =
                            a.componentType === 5126
                                ? view.getFloat32(offset, true)
                                : bytes === 2
                                  ? view.getUint16(offset, true)
                                  : view.getUint32(offset, true);
                    }
                return new T.BufferAttribute(out, size);
            };
            const skin = json.skins[0],
                inverse = attr(skin.inverseBindMatrices);
            const skeleton = new T.Skeleton(
                skin.joints.map(
                    (i: number) =>
                        root.getObjectByName(
                            T.PropertyBinding.sanitizeNodeName(json.nodes[i].name),
                        ) as T.Bone,
                ),
                skin.joints.map((_: number, i: number) =>
                    new T.Matrix4().fromArray(inverse.array, i * 16),
                ),
            );
            const meshes = json.meshes[0].primitives.map(
                (p: { attributes: Record<string, number>; indices: number }) => {
                    const g = new T.BufferGeometry();
                    for (const [from, to] of [
                        ["POSITION", "position"],
                        ["JOINTS_0", "skinIndex"],
                        ["WEIGHTS_0", "skinWeight"],
                    ])
                        g.setAttribute(to, attr(p.attributes[from]));
                    g.setIndex(new T.Uint32BufferAttribute(attr(p.indices).array, 1));
                    const mesh = new T.SkinnedMesh(g, new T.MeshBasicMaterial());
                    mesh.bind(skeleton, new T.Matrix4());
                    root.add(mesh);
                    return mesh;
                },
            ) as T.SkinnedMesh[];
            const source = JSON.parse(
                gunzipSync(readFileSync(`public/squad/motions/${sex}.bin`)).toString(),
            );
            const fitted: EquipmentPoses = JSON.parse(
                gunzipSync(readFileSync(`public/squad/motions/${sex}-equipment.bin`)).toString(),
            );
            for (const raw of source) {
                const motion = raw.name;
                const clip = equipmentPose(nativeClip(T.AnimationClip.parse(raw)), fitted);
                const original = meshes.map((mesh) =>
                    Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) =>
                        new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i),
                    ),
                );
                const mixer = new T.AnimationMixer(root),
                    action = mixer.clipAction(clip).play();
                for (const fraction of [0, 0.35, 0.7, 0.999]) {
                    action.time = clip.duration * fraction;
                    mixer.update(0);
                    root.updateMatrixWorld(true);
                    skeleton.update();
                    meshes.forEach((mesh, n) => {
                        const rest = original[n],
                            posed = rest.map((p, i) => mesh.applyBoneTransform(i, p.clone())),
                            index = mesh.geometry.index!;
                        for (let i = 0; i < index.count; i += 3)
                            for (const [a, b] of [
                                [0, 1],
                                [1, 2],
                                [2, 0],
                            ]) {
                                const x = index.getX(i + a),
                                    y = index.getX(i + b);
                                if (kind !== "field-kit" && (rest[x].y < 1.05 || rest[y].y < 1.05))
                                    continue;
                                const extension =
                                    posed[x].distanceTo(posed[y]) - rest[x].distanceTo(rest[y]);
                                assert.ok(
                                    extension < 0.04,
                                    `${motion}: ${json.materials[json.meshes[0].primitives[n].material].name} edge ${x}-${y} stretched by ${extension}m at ${fraction}, rest ${rest[x].toArray()} / ${rest[y].toArray()}`,
                                );
                            }
                    });
                }
                mixer.stopAllAction();
                mixer.uncacheRoot(root);
            }
        });
