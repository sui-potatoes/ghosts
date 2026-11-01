// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// Test-only geometry reader and triangle BVH. No renderer, texture downloads, or
// proxy volumes: these checks use the shipped mesh and its actual skin weights.
import { readFileSync } from "node:fs";
import * as T from "three";
export function skinMeshes(path: string, root: T.Group) {
    const file = readFileSync(path),
        length = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + length).toString()),
        binary = 28 + length;
    const read = (id: number) => {
        const a = json.accessors[id],
            v = json.bufferViews[a.bufferView];
        const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[
            a.type
        ];
        const bytes = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[
            a.componentType
        ];
        const values = new Float32Array(a.count * size);
        for (let i = 0; i < a.count; i++)
            for (let k = 0; k < size; k++) {
                const at =
                    binary +
                    (v.byteOffset ?? 0) +
                    (a.byteOffset ?? 0) +
                    i * (v.byteStride ?? size * bytes) +
                    k * bytes;
                values[i * size + k] =
                    a.componentType === 5126
                        ? file.readFloatLE(at)
                        : bytes === 1
                          ? file.readUInt8(at)
                          : bytes === 2
                            ? file.readUInt16LE(at)
                            : file.readUInt32LE(at);
            }
        return new T.BufferAttribute(values, size);
    };
    const skin = json.skins[0],
        inverse = read(skin.inverseBindMatrices);
    const skeleton = new T.Skeleton(
        skin.joints.map(
            (i: number) =>
                root.getObjectByName(
                    T.PropertyBinding.sanitizeNodeName(json.nodes[i].name),
                ) as T.Bone,
        ),
        skin.joints.map((_: number, i: number) => new T.Matrix4().fromArray(inverse.array, i * 16)),
    );
    return json.meshes[0].primitives.map(
        (p: { attributes: Record<string, number>; indices: number; material: number }) => {
            const g = new T.BufferGeometry();
            for (const [from, to] of [
                ["POSITION", "position"],
                ["JOINTS_0", "skinIndex"],
                ["WEIGHTS_0", "skinWeight"],
            ])
                g.setAttribute(to, read(p.attributes[from]));
            g.setIndex(new T.Uint32BufferAttribute(read(p.indices).array, 1));
            const mesh = new T.SkinnedMesh(g, new T.MeshBasicMaterial());
            mesh.name = json.materials[p.material].name;
            mesh.bind(skeleton, new T.Matrix4());
            root.add(mesh);
            return mesh;
        },
    ) as T.SkinnedMesh[];
}
interface Face {
    triangle: T.Triangle;
    box: T.Box3;
    center: T.Vector3;
    region: string;
}
interface Branch {
    box: T.Box3;
    faces?: Face[];
    left?: Branch;
    right?: Branch;
}
interface SurfaceCache {
    tree: Branch;
    faces: Face[];
    sources: { mesh: T.SkinnedMesh; points: T.Vector3[] }[];
}
const surfaces = new WeakMap<T.SkinnedMesh[], SurfaceCache>();
export function posedSurface(meshes: T.SkinnedMesh[], excludeHands = false, _bounds?: T.Box3) {
    let cached = surfaces.get(meshes);
    if (!cached) {
        const faces: Face[] = [],
            sources: SurfaceCache["sources"] = [];
        for (const mesh of meshes) {
            const g = mesh.geometry,
                p = g.attributes.position,
                joints = g.attributes.skinIndex,
                weights = g.attributes.skinWeight;
            const points = Array.from({ length: p.count }, (_, i) =>
                new T.Vector3().fromBufferAttribute(p, i),
            );
            sources.push({ mesh, points });
            const names = points.map((_, i) => {
                let largest = 0;
                for (let k = 1; k < 4; k++)
                    if (weights.getComponent(i, k) > weights.getComponent(i, largest)) largest = k;
                return mesh.skeleton.bones[joints.getComponent(i, largest)].name;
            });
            const index = g.index!;
            for (let i = 0; i < index.count; i += 3) {
                const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
                const triangle = new T.Triangle(points[ids[0]], points[ids[1]], points[ids[2]]),
                    box = new T.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
                faces.push({
                    triangle,
                    box,
                    center: triangle.getMidpoint(new T.Vector3()),
                    region: names[ids[0]],
                });
            }
        }
        function branch(items: Face[]): Branch {
            const box = new T.Box3();
            items.forEach((f) => box.union(f.box));
            if (items.length <= 12) return { box, faces: items };
            const size = box.getSize(new T.Vector3()),
                axis =
                    size.x > size.y ? (size.x > size.z ? "x" : "z") : size.y > size.z ? "y" : "z";
            items.sort((a, b) => a.center[axis] - b.center[axis]);
            const mid = items.length >> 1;
            return { box, left: branch(items.slice(0, mid)), right: branch(items.slice(mid)) };
        }
        cached = { tree: branch(faces), faces, sources };
        surfaces.set(meshes, cached);
    }
    for (const { mesh, points } of cached.sources) {
        mesh.skeleton.update();
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < points.length; i++)
            mesh.applyBoneTransform(i, points[i].fromBufferAttribute(p, i)).applyMatrix4(
                mesh.matrixWorld,
            );
    }
    for (const { triangle: t, box } of cached.faces) {
        box.makeEmpty().expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
    }
    function refit(node: Branch) {
        node.box.makeEmpty();
        if (node.faces) {
            for (const f of node.faces) node.box.union(f.box);
        } else {
            refit(node.left!);
            refit(node.right!);
            node.box.union(node.left!.box).union(node.right!.box);
        }
    }
    refit(cached.tree);
    const tree = cached.tree,
        closest = new T.Vector3(),
        normal = new T.Vector3(),
        hit = new T.Vector3();
    const inside = (point: T.Vector3) => {
        if (!tree.box.containsPoint(point)) return null;
        const ray = new T.Ray(point, new T.Vector3(0.719, 0.231, 0.655).normalize());
        const crossings: { distance: number; sign: number }[] = [],
            stack = [tree];
        while (stack.length) {
            const node = stack.pop()!;
            if (!ray.intersectsBox(node.box)) continue;
            if (node.faces) {
                for (const face of node.faces) {
                    if (
                        ray.intersectTriangle(
                            face.triangle.a,
                            face.triangle.b,
                            face.triangle.c,
                            false,
                            hit,
                        )
                    )
                        crossings.push({
                            distance: hit.distanceTo(point),
                            sign: Math.sign(face.triangle.getNormal(normal).dot(ray.direction)),
                        });
                }
            } else stack.push(node.left!, node.right!);
        }
        crossings.sort((a, b) => a.distance - b.distance);
        const unique = crossings.filter(
            (d, i) => i === 0 || d.distance - crossings[i - 1].distance > 0.00001,
        );
        if (Math.abs(unique.reduce((sum, h) => sum + h.sign, 0)) === 0) return null;
        let distance = Infinity,
            nearest: Face | undefined;
        stack.push(tree);
        while (stack.length) {
            const node = stack.pop()!;
            if (node.box.distanceToPoint(point) > distance) continue;
            if (node.faces) {
                for (const face of node.faces) {
                    const d = face.triangle.closestPointToPoint(point, closest).distanceTo(point);
                    if (d < distance) {
                        distance = d;
                        nearest = face;
                    }
                }
            } else {
                const a = node.left!,
                    b = node.right!;
                if (a.box.distanceToPoint(point) < b.box.distanceToPoint(point)) stack.push(b, a);
                else stack.push(a, b);
            }
        }
        if (!nearest || distance < 0.001 || (excludeHands && nearest.region.includes("Hand")))
            return null;
        nearest.triangle.closestPointToPoint(point, closest);
        nearest.triangle.getNormal(normal);
        if (normal.dot(point.clone().sub(closest)) >= 0) return null;
        return { depth: distance, region: nearest.region, point: point.toArray() };
    };
    const segment = (a: T.Vector3, b: T.Vector3) => {
        const length = a.distanceTo(b),
            ray = new T.Ray(a, b.clone().sub(a).normalize()),
            stack = [tree],
            results: { region: string; point: number[]; distance: number }[] = [];
        while (stack.length) {
            const node = stack.pop()!;
            if (node.box.distanceToPoint(a) > length || !ray.intersectsBox(node.box)) continue;
            if (node.faces) {
                for (const f of node.faces) {
                    if (excludeHands && f.region.includes("Hand")) continue;
                    if (
                        ray.intersectTriangle(f.triangle.a, f.triangle.b, f.triangle.c, false, hit)
                    ) {
                        const distance = hit.distanceTo(a);
                        if (distance > 0.002 && distance < length - 0.002)
                            results.push({ region: f.region, point: hit.toArray(), distance });
                    }
                }
            } else stack.push(node.left!, node.right!);
        }
        return results;
    };
    const regionBranches = new Map<string, Set<Branch>>();
    const nearest = (point: T.Vector3, region: RegExp) => {
        let allowed = regionBranches.get(region.source);
        if (!allowed) {
            allowed = new Set<Branch>();
            const collect = (node: Branch): boolean => {
                const match = node.faces
                    ? node.faces.some((f) => region.test(f.region))
                    : [collect(node.left!), collect(node.right!)].some(Boolean);
                if (match) allowed!.add(node);
                return match;
            };
            collect(tree);
            regionBranches.set(region.source, allowed);
        }
        let distance = Infinity;
        const stack = [tree];
        while (stack.length) {
            const node = stack.pop()!;
            if (!allowed.has(node) || node.box.distanceToPoint(point) >= distance) continue;
            if (node.faces) {
                for (const face of node.faces)
                    if (region.test(face.region))
                        distance = Math.min(
                            distance,
                            face.triangle.closestPointToPoint(point, closest).distanceTo(point),
                        );
            } else stack.push(node.left!, node.right!);
        }
        return distance;
    };
    return Object.assign(inside, { segment, nearest });
}
export function weaponEdges(gun: T.Object3D) {
    const result = new Map<string, [T.Vector3, T.Vector3]>();
    gun.updateWorldMatrix(true, true);
    gun.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const p = o.geometry.attributes.position,
            index = o.geometry.index;
        for (let i = 0; i < (index?.count ?? p.count); i += 3) {
            const v = [0, 1, 2].map((k) =>
                new T.Vector3()
                    .fromBufferAttribute(p, index ? index.getX(i + k) : i + k)
                    .applyMatrix4(o.matrixWorld),
            );
            for (const [a, b] of [
                [0, 1],
                [1, 2],
                [2, 0],
            ]) {
                if (v[a].distanceTo(v[b]) < 0.006) continue;
                const key = [v[a], v[b]]
                    .map((p) =>
                        p
                            .toArray()
                            .map((n) => Math.round(n * 10000))
                            .join(","),
                    )
                    .sort()
                    .join(":");
                result.set(key, [v[a].clone(), v[b].clone()]);
            }
        }
    });
    return [...result.values()];
}
/** Vertices and triangle interiors, voxel-deduplicated at 3 mm. */
export function weaponSamples(gun: T.Object3D) {
    const unique = new Map<string, T.Vector3>();
    const add = (p: T.Vector3) => {
        unique.set(
            p
                .toArray()
                .map((v) => Math.round(v / 0.003))
                .join(","),
            p,
        );
    };
    gun.updateWorldMatrix(true, true);
    gun.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
            const a = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld),
                b = new T.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld),
                c = new T.Vector3().fromBufferAttribute(p, i + 2).applyMatrix4(o.matrixWorld);
            add(a);
            add(b);
            add(c);
            const steps = Math.max(
                1,
                Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / 0.012),
            );
            for (let u = 0; u <= steps; u++)
                for (let v = 0; v <= steps - u; v++)
                    add(
                        a
                            .clone()
                            .addScaledVector(b.clone().sub(a), u / steps)
                            .addScaledVector(c.clone().sub(a), v / steps),
                    );
        }
    });
    return [...unique.values()];
}

/** Read shipped rigid GLB geometry with its complete node transforms, without textures. */
export function rigidAsset(path: string): T.Group {
    const file = readFileSync(path),
        length = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + length).toString()),
        binary = 28 + length;
    function read(id: number) {
        const a = json.accessors[id],
            v = json.bufferViews[a.bufferView];
        const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
        const bytes = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[
            a.componentType
        ];
        const out = new Float32Array(a.count * size);
        for (let i = 0; i < a.count; i++)
            for (let k = 0; k < size; k++) {
                const at =
                    binary +
                    (v.byteOffset ?? 0) +
                    (a.byteOffset ?? 0) +
                    i * (v.byteStride ?? size * bytes) +
                    k * bytes;
                out[i * size + k] =
                    a.componentType === 5126
                        ? file.readFloatLE(at)
                        : bytes === 1
                          ? file.readUInt8(at)
                          : bytes === 2
                            ? file.readUInt16LE(at)
                            : file.readUInt32LE(at);
            }
        return new T.BufferAttribute(out, size);
    }
    function node(id: number): T.Group {
        const n = json.nodes[id],
            out = new T.Group();
        out.name = n.name ?? "";
        out.userData = n.extras ?? {};
        if (n.matrix) out.applyMatrix4(new T.Matrix4().fromArray(n.matrix));
        else {
            if (n.translation) out.position.fromArray(n.translation);
            if (n.rotation) out.quaternion.fromArray(n.rotation);
            if (n.scale) out.scale.fromArray(n.scale);
        }
        if (n.mesh !== undefined)
            for (const p of json.meshes[n.mesh].primitives) {
                const g = new T.BufferGeometry().setAttribute(
                    "position",
                    read(p.attributes.POSITION),
                );
                if (p.indices !== undefined)
                    g.setIndex(new T.Uint32BufferAttribute(read(p.indices).array, 1));
                out.add(new T.Mesh(g, new T.MeshBasicMaterial({ side: T.DoubleSide })));
            }
        for (const child of n.children ?? []) out.add(node(child));
        return out;
    }
    const root = new T.Group();
    for (const id of json.scenes[json.scene ?? 0].nodes) root.add(node(id));
    return root;
}

export function rifleAsset(kind: string, tier = 0) {
    const gun = rigidAsset(`public/squad/weapons/${kind}.glb`);
    const sockets: T.Object3D[] = [];
    gun.traverse((o) => {
        if (o.name.startsWith("mount_")) sockets.push(o);
    });
    if (sockets.length !== 4) throw Error(`${kind}: expected four exported sockets`);
    if (tier)
        for (const socket of sockets) {
            const slot = socket.userData.interface.match(/^ghosts:(.+):v1$/)[1];
            socket.clear();
            socket.add(rigidAsset(`public/squad/weapons/${slot}-${tier}.glb`));
        }
    return gun;
}

/** Closest support contact on the shipped fore-end, measured against skinned triangles. */
export function supportContact(
    gun: T.Object3D,
    holder: T.Object3D,
    surface: ReturnType<typeof posedSurface>,
) {
    let palm = Infinity,
        fingers = Infinity,
        thumb = Infinity;
    const seen = new Set<string>();
    gun.updateWorldMatrix(true, true);
    gun.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const world = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            const p = holder.worldToLocal(world.clone());
            if (p.x < 0.04 || p.x > 0.16 || p.y > 0.04) continue;
            const key = p
                .toArray()
                .map((v) => Math.round(v * 2000))
                .join(",");
            if (seen.has(key)) continue;
            seen.add(key);
            thumb = Math.min(thumb, surface.nearest(world, /^mixamorigLeftHandThumb/));
            palm = Math.min(palm, surface.nearest(world, /^mixamorigLeftHand$/));
            fingers = Math.min(
                fingers,
                surface.nearest(world, /^mixamorigLeftHand(?:Index|Middle|Ring|Pinky)/),
            );
        }
    });
    return { palm, fingers, thumb };
}
