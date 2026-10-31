// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { gearFinish } from "./gear-geometry.ts";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Donor-weapon coordinates: +Y muzzle, -Z up. Reference point inside the grip. */
export const SIDEARM_GRIP = [0, -0.078, 0.024] as const;
/** Seats that reference point in the native palm, rather than the rifle's trigger socket. */
export const SIDEARM_MOUNT_OFFSET = [0, -0.042, 0.025] as const;

/** Compact service pistol, metres. All details are merged into four material batches. */
export function createSidearm() {
    const gun = new T.Group();
    gun.name = "K12Sidearm";
    const steel = gearFinish("K12 / machined slide", 0x414853, 0.4, 0.36);
    const polymer = gearFinish(
        "K12 / stippled polymer",
        0x222628,
        0.05,
        0.82,
        0.12,
    );
    const dark = gearFinish("K12 / recesses", 0x0c1012, 0.35, 0.55);
    const sight = new T.MeshStandardMaterial({
        color: 0xb6c3b2,
        metalness: 0.1,
        roughness: 0.45,
    });
    // Author the silhouette with X forward, Y up, Z across the slide.
    const basis = new T.Matrix4().makeBasis(
        new T.Vector3(0, 1, 0),
        new T.Vector3(0, 0, -1),
        new T.Vector3(-1, 0, 0),
    );
    const add = (
        geometry: T.BufferGeometry,
        material: T.Material,
        position = [0, 0, 0],
        rotation?: T.Euler,
    ) => {
        if (rotation)
            geometry.applyMatrix4(
                new T.Matrix4().makeRotationFromEuler(rotation),
            );
        geometry.translate(...(position as [number, number, number]));
        geometry.applyMatrix4(basis);
        gun.add(new T.Mesh(geometry, material));
    };
    const profile = (
        points: number[][],
        depth: number,
        material: T.Material,
        bevel = 0.0015,
        z = 0,
        holes: number[][][] = [],
    ) => {
        const shape = new T.Shape(points.map((p) => new T.Vector2(p[0], p[1])));
        for (const points of holes)
            shape.holes.push(
                new T.Path(points.map((p) => new T.Vector2(p[0], p[1]))),
            );
        const geo = new T.ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: bevel > 0,
            bevelSize: bevel,
            bevelThickness: bevel,
            bevelSegments: 2,
            curveSegments: 8,
            steps: 1,
        });
        geo.translate(0, 0, -depth / 2 + z);
        add(geo, material);
    };
    const box = (
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        material: T.Material,
    ) => add(new T.BoxGeometry(w, h, d), material, [x, y, z]);
    // Chamfered slide with a lower front bevel and a distinct frame seam.
    profile(
        [
            [-0.092, 0.033],
            [0.1, 0.033],
            [0.1, 0.057],
            [0.092, 0.063],
            [-0.084, 0.063],
            [-0.095, 0.055],
        ],
        0.028,
        steel,
    );
    profile(
        [
            [-0.092, 0.024],
            [0.089, 0.024],
            [0.092, 0.031],
            [-0.09, 0.031],
        ],
        0.026,
        polymer,
        0.001,
    );
    // Raised barrel hood and a recessed ejection port on the right side.
    profile(
        [
            [-0.017, 0.04],
            [0.022, 0.04],
            [0.027, 0.047],
            [0.027, 0.062],
            [-0.017, 0.062],
        ],
        0.0006,
        dark,
        0,
        0.0149,
    );
    box(0.002, 0.057, 0.0153, 0.031, 0.009, 0.0009, steel);
    box(0.016, 0.046, 0.0153, 0.01, 0.002, 0.001, steel);
    // Dust cover / accessory rail beneath the front half of the slide.
    profile(
        [
            [-0.035, 0.025],
            [0.085, 0.025],
            [0.083, 0.014],
            [0.028, 0.012],
            [0.015, 0.017],
            [-0.035, 0.017],
        ],
        0.026,
        polymer,
        0.001,
    );
    for (const x of [0.047, 0.061, 0.075])
        box(x, 0.013, 0, 0.002, 0.002, 0.028, dark);
    // Rearward-raked grip, rounded backstrap, high beavertail and a flared magazine heel.
    profile(
        [
            [-0.092, 0.032],
            [-0.065, 0.025],
            [-0.043, 0.012],
            [-0.048, -0.009],
            [-0.066, -0.078],
            [-0.073, -0.085],
            [-0.106, -0.082],
            [-0.111, -0.072],
            [-0.089, 0.003],
            [-0.099, 0.016],
        ],
        0.03,
        polymer,
        0.0025,
    );
    profile(
        [
            [-0.108, -0.074],
            [-0.067, -0.076],
            [-0.063, -0.085],
            [-0.107, -0.09],
            [-0.114, -0.084],
        ],
        0.033,
        dark,
        0.001,
    );
    // Inset grip panels, with fine stippling rather than broad horizontal ladders.
    for (const side of [-1, 1]) {
        profile(
            [
                [-0.084, 0.003],
                [-0.054, -0.008],
                [-0.07, -0.07],
                [-0.101, -0.067],
            ],
            0.0008,
            dark,
            0.0006,
            side * 0.016,
        );
        for (let row = 0; row < 11; row++)
            for (let col = 0; col < 5; col++) {
                const x = -0.081 + col * 0.0045 - row * 0.0015;
                const y = -0.008 - row * 0.005;
                box(x, y, side * 0.0172, 0.0013, 0.0013, 0.0005, polymer);
            }
        // Rear and front cocking serrations are narrow facets on the slide sides.
        for (const start of [-0.083, 0.061])
            for (let i = 0; i < 5; i++) {
                const x = start + i * 0.0048;
                profile(
                    [
                        [x, 0.037],
                        [x + 0.0012, 0.037],
                        [x + 0.004, 0.055],
                        [x + 0.0028, 0.055],
                    ],
                    0.0005,
                    dark,
                    0,
                    side * 0.0147,
                );
            }
        // Frame pins.
        for (const [x, y] of [
            [-0.052, 0.014],
            [-0.077, 0.017],
        ])
            add(
                new T.CylinderGeometry(0.002, 0.002, 0.001, 8),
                steel,
                [x, y, side * 0.0164],
                new T.Euler(Math.PI / 2, 0, 0),
            );
    }
    // Closed rounded guard with real negative space; curved trigger inside it.
    profile(
        [
            [-0.05, 0.018],
            [0.021, 0.018],
            [0.027, 0.01],
            [0.023, -0.019],
            [0.014, -0.028],
            [-0.034, -0.028],
            [-0.048, -0.018],
        ],
        0.012,
        polymer,
        0.001,
        0,
        [
            [
                [-0.037, 0.01],
                [-0.036, -0.016],
                [-0.03, -0.02],
                [0.012, -0.02],
                [0.016, -0.014],
                [0.019, 0.008],
            ],
        ],
    );
    profile(
        [
            [-0.029, 0.019],
            [-0.024, 0.019],
            [-0.023, 0.002],
            [-0.017, -0.011],
            [-0.021, -0.014],
            [-0.028, -0.004],
        ],
        0.008,
        dark,
        0.0006,
    );
    // Left-side controls: slide catch and magazine release.
    profile(
        [
            [-0.063, 0.023],
            [-0.032, 0.023],
            [-0.027, 0.019],
            [-0.031, 0.015],
            [-0.063, 0.016],
        ],
        0.002,
        steel,
        0.0005,
        -0.017,
    );
    profile(
        [
            [-0.051, -0.003],
            [-0.043, -0.005],
            [-0.045, -0.012],
            [-0.053, -0.01],
        ],
        0.002,
        steel,
        0.0005,
        -0.017,
    );
    // Barrel crown and recoil-spring recess. Ring geometry preserves an actual bore.
    add(
        new T.TorusGeometry(0.0055, 0.0017, 6, 16),
        steel,
        [0.102, 0.048, 0],
        new T.Euler(0, Math.PI / 2, 0),
    );
    add(
        new T.CircleGeometry(0.0041, 16),
        dark,
        [0.101, 0.048, 0],
        new T.Euler(0, Math.PI / 2, 0),
    );
    add(
        new T.CircleGeometry(0.0035, 12),
        dark,
        [0.101, 0.037, 0],
        new T.Euler(0, Math.PI / 2, 0),
    );
    // Low-profile front blade and rear notch, with two discreet sight dots.
    box(0.078, 0.066, 0, 0.009, 0.006, 0.005, dark);
    for (const z of [-0.008, 0.008])
        box(-0.08, 0.066, z, 0.01, 0.007, 0.006, dark);
    box(-0.08, 0.063, 0, 0.01, 0.002, 0.022, dark);
    for (const z of [-0.008, 0.008])
        box(-0.0852, 0.067, z, 0.0007, 0.0018, 0.0018, sight);
    box(0.0732, 0.067, 0, 0.0007, 0.0018, 0.0018, sight);

    const batches = new Map<T.Material, T.BufferGeometry[]>();
    for (const child of [...gun.children]) {
        const mesh = child as T.Mesh<T.BufferGeometry, T.Material>;
        let g = mesh.geometry;
        if (g.index) {
            const indexed = g;
            g = g.toNonIndexed();
            indexed.dispose();
        }
        const list = batches.get(mesh.material) ?? [];
        list.push(g);
        batches.set(mesh.material, list);
        gun.remove(mesh);
    }
    for (const [material, geometries] of batches) {
        const merged = mergeGeometries(geometries)!;
        const mesh = new T.Mesh(merged, material);
        mesh.userData.weaponPart = true;
        gun.add(mesh);
        for (const geometry of geometries) geometry.dispose();
    }
    gun.userData.grip = [...SIDEARM_GRIP];
    return gun;
}
