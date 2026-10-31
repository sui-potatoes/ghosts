// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Static, metre-scale details, collapsed to one draw per finish at construction. */
export class GearGeometry {
    offset = new T.Vector3();
    private parts = new Map<T.Material, T.BufferGeometry[]>();
    add(g: T.BufferGeometry, m: T.Material, position = [0, 0, 0], rotation?: T.Euler) {
        if (rotation) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(rotation));
        g.translate(
            position[0] + this.offset.x,
            position[1] + this.offset.y,
            position[2] + this.offset.z,
        );
        const parts = this.parts.get(m) ?? [];
        parts.push(g.index ? g.toNonIndexed() : g);
        if (g.index) g.dispose();
        this.parts.set(m, parts);
    }
    box(p: number[], size: number[], m: T.Material, rotation?: T.Euler) {
        this.add(new T.BoxGeometry(size[0], size[1], size[2]), m, p, rotation);
    }
    profile(
        points: number[][],
        depth: number,
        m: T.Material,
        z = 0,
        bevel = 0.0015,
        holes: number[][][] = [],
    ) {
        const shape = new T.Shape(points.map((p) => new T.Vector2(...(p as [number, number]))));
        for (const hole of holes)
            shape.holes.push(
                new T.Path(hole.map((p) => new T.Vector2(...(p as [number, number])))),
            );
        const g = new T.ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: bevel > 0,
            bevelSize: bevel,
            bevelThickness: bevel,
            bevelSegments: 1,
            curveSegments: 8,
            steps: 1,
        });
        this.add(g, m, [0, 0, z - depth / 2]);
    }
    cylinder(
        p: number[],
        radius: number,
        length: number,
        m: T.Material,
        axis: "x" | "y" | "z" = "x",
        endRadius = radius,
        segments = 16,
    ) {
        this.add(
            new T.CylinderGeometry(endRadius, radius, length, segments),
            m,
            p,
            axis === "x"
                ? new T.Euler(0, 0, -Math.PI / 2)
                : axis === "z"
                  ? new T.Euler(Math.PI / 2, 0, 0)
                  : undefined,
        );
    }
    ring(p: number[], radius: number, tube: number, m: T.Material, axis: "x" | "y" | "z" = "x") {
        this.add(
            new T.TorusGeometry(radius, tube, 5, 20),
            m,
            p,
            axis === "x"
                ? new T.Euler(0, Math.PI / 2, 0)
                : axis === "y"
                  ? new T.Euler(Math.PI / 2, 0, 0)
                  : undefined,
        );
    }
    finish(name: string, basis?: T.Matrix4) {
        const root = new T.Group();
        root.name = name;
        for (const [material, parts] of this.parts) {
            const geometry = mergeGeometries(parts)!;
            parts.forEach((g) => g.dispose());
            if (basis) geometry.applyMatrix4(basis);
            const mesh = new T.Mesh(geometry, material);
            mesh.name = material.name;
            mesh.userData.weaponPart = true;
            root.add(mesh);
        }
        this.parts.clear();
        return root;
    }
}

/** Tiny deterministic micro-surface. No image downloads, canvas or render-time work. */
export function gearFinish(
    name: string,
    color: number,
    metalness: number,
    roughness: number,
    grain = 0.035,
) {
    const size = 64,
        pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const hash = ((x * 1973 + y * 9277) ^ (x * y * 26699)) >>> 0;
            pixels[i] = 128 + Math.round(Math.sin(hash) * grain * 127);
            pixels[i + 1] = 128 + Math.round(Math.cos(hash * 0.7) * grain * 127);
            pixels[i + 2] = 255;
            pixels[i + 3] = 255;
        }
    const normalMap = new T.DataTexture(pixels, size, size);
    normalMap.wrapS = normalMap.wrapT = T.RepeatWrapping;
    normalMap.magFilter = T.LinearFilter;
    normalMap.minFilter = T.LinearMipmapLinearFilter;
    normalMap.generateMipmaps = true;
    normalMap.repeat.set(4, 4);
    normalMap.needsUpdate = true;
    return new T.MeshStandardMaterial({
        name,
        color,
        metalness,
        roughness,
        normalMap,
        normalScale: new T.Vector2(0.22, 0.22),
    });
}

/** Inventory authoring coordinates (+X muzzle, +Y up) to the shared hand socket. */
export const WEAPON_BASIS = new T.Matrix4().makeBasis(
    new T.Vector3(0, 1, 0),
    new T.Vector3(0, 0, -1),
    new T.Vector3(-1, 0, 0),
);
