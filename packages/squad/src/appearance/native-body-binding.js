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
/** The neckline is evaluated per fragment, so the fabric edge cannot reveal mesh triangles. */
export function installBodySuit(mesh, top, nativeSkeleton, gloves = false) {
    const g = mesh.geometry;
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
