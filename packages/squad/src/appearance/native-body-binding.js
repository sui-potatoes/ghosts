// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
const canonical = (name) => name.replace(/[^a-zA-Z0-9]/g, "");
/** Copy native rest transforms and inverse bind matrices onto matching combat bones. */
export function bindNativeSkeleton(skeleton, rig) {
    // SkeletonUtils clones may share inverse matrices with other operators. Own them before editing.
    skeleton.boneInverses = skeleton.boneInverses.map((matrix) => matrix.clone());
    for (const bone of skeleton.bones) {
        const rest = rig.bones[canonical(bone.name)];
        if (!rest) continue;
        bone.position.fromArray(rest.position);
        bone.quaternion.fromArray(rest.quaternion);
        bone.scale.fromArray(rest.scale);
    }
    for (let i = 0; i < skeleton.bones.length; i++) {
        const rest = rig.bones[canonical(skeleton.bones[i].name)];
        if (rest) skeleton.boneInverses[i].fromArray(rest.inverse);
    }
}
export function remapNativeWeights(geometry, nativeSkeleton, combatSkeleton, skin = true) {
    const remap = nativeSkeleton.bones.map((b) =>
            combatSkeleton.bones.findIndex((c) => canonical(c.name) === canonical(b.name)),
        ),
        head = nativeSkeleton.bones.findIndex((b) => b.name.endsWith("Head"));
    if (remap.some((i) => i < 0)) throw Error("Native body has an unmapped combat joint");
    const sourceJ = geometry.attributes.skinIndex,
        sourceW = geometry.attributes.skinWeight,
        count = geometry.attributes.position.count,
        joints = new Uint16Array(count * 4),
        weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++)
        for (let k = 0; k < 4; k++) {
            joints[i * 4 + k] = remap[skin ? sourceJ.getComponent(i, k) : head];
            weights[i * 4 + k] = skin ? sourceW.getComponent(i, k) : k === 0 ? 1 : 0;
        }
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
}
/** Give the field uniform its own relaxed surface instead of painting fabric
 * directly onto anatomical detail. Weld UV seams only for the smoothing solve;
 * indices, UVs, skin weights and exposed skin remain untouched. */
function tailorUniform(geometry, skeleton) {
    const positions = geometry.attributes.position,
        index = geometry.index;
    const boneY = (name) =>
        skeleton.bones.find((b) => b.name.endsWith(name)).getWorldPosition(new T.Vector3()).y;
    const chest = boneY("Spine2"),
        neck = boneY("Neck"),
        hip = boneY("Hips"),
        knee = boneY("LeftLeg");
    const keys = new Map(),
        vertices = [],
        lookup = [];
    const fade = (a, b, x) => T.MathUtils.smoothstep(x, a, b);
    for (let i = 0; i < positions.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(positions, i);
        const key = p
            .toArray()
            .map((v) => Math.round(v * 1e6))
            .join(",");
        let id = keys.get(key);
        if (id === undefined) {
            id = vertices.length;
            keys.set(key, id);
            const front = fade(0.03, 0.09, p.z);
            const shirt =
                front *
                (1 - fade(0.14, 0.21, Math.abs(p.x))) *
                fade(chest - 0.17, chest - 0.1, p.y) *
                (1 - fade(neck - 0.045, neck - 0.005, p.y));
            const trousers =
                fade(knee + 0.08, hip - 0.18, p.y) *
                (1 - fade(hip - 0.02, hip + 0.06, p.y)) *
                (1 - fade(0.24, 0.35, Math.abs(p.x)));
            vertices.push({ p, ids: [], neighbors: new Set(), shirt, amount: trousers * 0.6 });
        }
        lookup[i] = id;
        vertices[id].ids.push(i);
    }
    for (let i = 0; i < index.count; i += 3) {
        const ids = [lookup[index.getX(i)], lookup[index.getX(i + 1)], lookup[index.getX(i + 2)]];
        for (const a of ids) for (const b of ids) if (a !== b) vertices[a].neighbors.add(b);
    }
    // Sample in physical space, not topological rings: the source has dense
    // nipple loops, which ordinary neighbor smoothing leaves as pointed peaks.
    const cells = new Map();
    for (const { p } of vertices) {
        if (p.z < 0.035 || Math.abs(p.x) > 0.2 || p.y < chest - 0.23 || p.y > neck + 0.015)
            continue;
        const key = `${Math.round(p.x / 0.008)},${Math.round(p.y / 0.008)}`;
        const cell = cells.get(key) || { p: new T.Vector3(), count: 0 };
        cell.p.add(p);
        cell.count++;
        cells.set(key, cell);
    }
    const samples = [...cells.values()].map(({ p, count }) => p.multiplyScalar(1 / count));
    for (const v of vertices) {
        if (!v.shirt) continue;
        let sum = 0,
            depth = 0;
        for (const q of samples) {
            const distance = (q.x - v.p.x) ** 2 + (q.y - v.p.y) ** 2;
            if (distance > 0.08 ** 2) continue;
            const w = Math.exp(-distance / 0.032 ** 2);
            depth += q.z * w;
            sum += w;
        }
        if (sum) v.p.z = T.MathUtils.lerp(v.p.z, depth / sum, v.shirt);
    }
    // Local relaxation softens gluteal/upper-thigh creases without moving joints.
    for (let pass = 0; pass < 16; pass++) {
        const next = vertices.map(({ p, neighbors, amount }) => {
            if (!amount || !neighbors.size) return p.clone();
            const mean = new T.Vector3();
            for (const n of neighbors) mean.add(vertices[n].p);
            return p
                .clone()
                .lerp(mean.multiplyScalar(1 / neighbors.size), 0.36 * amount)
                .setY(p.y);
        });
        vertices.forEach((v, i) => v.p.copy(next[i]));
    }
    for (const v of vertices) for (const i of v.ids) positions.setXYZ(i, v.p.x, v.p.y, v.p.z);
    const originalNormals = geometry.attributes.normal.clone(),
        normals = geometry.attributes.normal;
    const sums = vertices.map(() => new T.Vector3());
    for (let i = 0; i < index.count; i += 3) {
        const ids = [lookup[index.getX(i)], lookup[index.getX(i + 1)], lookup[index.getX(i + 2)]];
        const [a, b, c] = ids.map((id) => vertices[id].p);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        for (const id of ids) sums[id].add(normal);
    }
    sums.forEach((n) => n.normalize());
    for (let pass = 0; pass < 3; pass++) {
        const next = sums.map((n, i) => {
            const v = vertices[i];
            if (!v.shirt) return n.clone();
            const mean = new T.Vector3();
            for (const j of v.neighbors) mean.add(sums[j]);
            return n
                .clone()
                .lerp(mean.normalize(), 0.5 * v.shirt)
                .normalize();
        });
        sums.forEach((n, i) => n.copy(next[i]));
    }
    vertices.forEach((v, id) => {
        const affected =
            v.amount ||
            v.shirt ||
            [...v.neighbors].some((n) => vertices[n].amount || vertices[n].shirt);
        for (const i of v.ids) {
            const n = affected ? sums[id] : new T.Vector3().fromBufferAttribute(originalNormals, i);
            normals.setXYZ(i, n.x, n.y, n.z);
        }
    });
    positions.needsUpdate = normals.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}

/** The neckline is evaluated per fragment, so the fabric edge cannot reveal mesh triangles. */
export function installBodySuit(mesh, top, nativeSkeleton, gloves = false) {
    const g = mesh.geometry;
    mesh.updateWorldMatrix(true, false);
    tailorUniform(g, nativeSkeleton);
    const joints = g.attributes.skinIndex,
        weights = g.attributes.skinWeight;
    const depth = new Float32Array(joints.count),
        hands = new Float32Array(joints.count),
        head = new Float32Array(joints.count);
    for (let i = 0; i < joints.count; i++) {
        // Use the edited surface, so neck morphs do not warp the fabric boundary.
        depth[i] = top - g.attributes.position.getY(i);
        for (let k = 0; k < 4; k++) {
            if (/Hand/.test(nativeSkeleton.bones[joints.getComponent(i, k)].name))
                hands[i] += weights.getComponent(i, k);
            if (/Head$/.test(nativeSkeleton.bones[joints.getComponent(i, k)].name))
                head[i] += weights.getComponent(i, k);
        }
    }
    g.setAttribute("suitDepth", new T.BufferAttribute(depth, 1));
    g.setAttribute("suitHand", new T.BufferAttribute(hands, 1));
    g.setAttribute("suitHead", new T.BufferAttribute(head, 1));
    const material = mesh.material,
        previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader) => {
        previous(shader);
        shader.vertexShader =
            "attribute float suitDepth; attribute float suitHand; attribute float suitHead; varying vec3 vSuit;\n" +
            shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvSuit=vec3(suitDepth,suitHand,suitHead);",
        );
        shader.fragmentShader = "varying vec3 vSuit;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            float collarAA = max(fwidth(vSuit.x), 0.0006);
            float headAA = max(fwidth(vSuit.z), 0.003);
            float fabric = smoothstep(0.235-collarAA, 0.235+collarAA, vSuit.x)
                * ${gloves ? "1.0" : "(1.0-smoothstep(0.15, 0.85, vSuit.y))"}
                * (1.0-smoothstep(0.85-headAA, 0.85+headAA, vSuit.z));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.028,0.033,0.04), fabric);
        `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <roughnessmap_fragment>",
            "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, fabric);",
        );
    };
    material.customProgramCacheKey = () =>
        `mpfb-continuous-body-fragment-collar-v7-head-mask-gloves-${gloves}`;
    material.needsUpdate = true;
}
