// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "three";
import { createEyewear } from "../src/appearance/eyewear.js";
import { frontSurface } from "../src/appearance/brow-shape.js";
import { initialSquad } from "../src/model.ts";

function geometry(path: string) {
    const file = readFileSync(new URL(`../../../app/public/squad/${path}.glb`, import.meta.url));
    const json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    const binary = 28 + file.readUInt32LE(12), primitive = json.meshes[0].primitives[0];
    const read = (id: number) => {
        const accessor = json.accessors[id], view = json.bufferViews[accessor.bufferView];
        const size = accessor.type === "VEC3" ? 3 : 1;
        const bytes = accessor.componentType === 5123 ? 2 : 4;
        const values = new Float32Array(accessor.count * size);
        for (let i = 0; i < accessor.count; i++) for (let k = 0; k < size; k++) {
            const at = binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? size * bytes) + k * bytes;
            values[i * size + k] = accessor.componentType === 5126 ? file.readFloatLE(at) : bytes === 2 ? file.readUInt16LE(at) : file.readUInt32LE(at);
        }
        return values;
    };
    return new T.BufferGeometry().setAttribute("position", new T.BufferAttribute(read(primitive.attributes.POSITION), 3))
        .setIndex(Array.from(read(primitive.indices)));
}

for (const sex of ["female", "male"] as const) for (const width of [1, 1.15])
    test(`eyewear arms clear the ${sex} temples at head width ${width}`, () => {
        const skin = geometry(`body/${sex}/skin`).scale(width, 1, 1);
        const eyes = geometry(`editor/${sex}/eyes`).scale(width, 1, 1);
        const position = skin.attributes.position;
        const sides = [-1, 1].map(side => {
            const points = new Float32Array(position.count * 3);
            for (let i = 0; i < position.count; i++) points.set([position.getZ(i), position.getY(i), side * position.getX(i)], i * 3);
            return frontSurface(points, skin.index!.array, .004);
        });
        for (const glasses of ["round", "aviator", "rectangular", "ballistic"]) {
            const parts = createEyewear({ ...initialSquad().recruits[0].appearance, sex, glasses }, skin, eyes);
            try {
                const p = parts[0].g.attributes.position;
                let checked = 0;
                for (let i = 0; i < p.count; i++) {
                    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
                    // The arms behind the lenses must stay outside the real head surface.
                    if (z > .10 || Math.abs(x) < .045) continue;
                    const surface = sides[x < 0 ? 0 : 1](z, y);
                    if (surface === null) continue;
                    assert(Math.abs(x) >= surface + .0003, `${glasses} intersects ${sex} head at ${x},${y},${z}: skin ${surface}`);
                    checked++;
                }
                assert(checked > 100);
            } finally { parts.forEach(p => { p.g.dispose(); p.material.dispose(); }); }
        }
        skin.dispose(); eyes.dispose();
    });
