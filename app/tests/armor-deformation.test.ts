import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as T from "three";
import { motionSkeleton, clearEquipment } from "@ghosts/squad/motion/clearance";
import { nativeClip } from "@ghosts/squad/motion/clips";

// Read geometry without loading texture images or requiring a WebGL context.
for (const sex of ["female", "male"])
    for (const kind of ["nyx", "nyx-mid", "nyx-heavy"])
        test(`${kind}/${sex}: raising the rifle cannot pull armor triangles across the back`, () => {
            const file = readFileSync(`public/squad/armor/${kind}-${sex}.glb`),
                data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
            const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString()),
                binary = 28 + file.readUInt32LE(12);
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
            const mount = JSON.parse(
                readFileSync(`public/squad/body/${sex}/weapon-mount.json`, "utf8"),
            );
            const clip = clearEquipment(
                nativeClip(
                    T.AnimationClip.parse(
                        source.find((c: { name: string }) => c.name === "stand_cover_emerge"),
                    ),
                ),
                root,
                mount,
            );
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
                            if (rest[x].y < 1.05 || rest[y].y < 1.05) continue;
                            const extension =
                                posed[x].distanceTo(posed[y]) - rest[x].distanceTo(rest[y]);
                            assert.ok(
                                extension < 0.04,
                                `Armor edge stretched by ${extension}m at ${fraction}`,
                            );
                        }
                });
            }
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
        });
