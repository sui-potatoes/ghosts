// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { frontSurface } from "./brow-shape.js";

// Appearance-time fit in native metres. Two batches; no textures, transmission or update loop.
/** Lens opacity for a tint in [0, 1]: never fully clear, never fully opaque. */
export const lensOpacity = (tint) => 0.025 + tint * 0.9;

export function createEyewear(state, skin, eyes) {
    if (!state.glasses || state.glasses === "none") return [];
    const surface = frontSurface(skin.attributes.position.array, skin.index.array),
        ep = eyes.attributes.position;
    const centers = [-1, 1].map((side) => {
        const b = new T.Box3();
        for (let i = 0; i < ep.count; i++)
            if (Math.sign(ep.getX(i)) === side)
                b.expandByPoint(new T.Vector3().fromBufferAttribute(ep, i));
        return b.getCenter(new T.Vector3());
    });
    const tactical = state.glasses === "ballistic",
        round = state.glasses === "round",
        aviator = state.glasses === "aviator";
    const separation = centers[1].x - centers[0].x,
        fit = T.MathUtils.clamp(separation / 0.062, 0.88, 1.08);
    const halfW = (round ? 0.017 : aviator ? 0.02 : 0.0195) * fit,
        halfH = (round ? 0.016 : aviator ? 0.013 : 0.0105) * fit;
    // The male nose saddle sits lower relative to the eye globe than the female fit.
    const eyeLine = (centers[0].y + centers[1].y) / 2;
    const y = eyeLine + (state.sex === "male" ? -0.0045 : 0.001);
    const earY = eyeLine + 0.001;
    const bridgeY = y + 0.003;
    const bridgeZ = (surface(0, bridgeY) ?? Math.max(...centers.map((c) => c.z)) + 0.018) + 0.0025;
    const frame = [],
        lenses = [];
    // Preserve manufactured curvature. Clearance moves the whole front, never individual vertices.
    const frontClearance = (points) =>
        points.reduce((offset, p) => Math.max(offset, (surface(p.x, p.y) ?? -1) + 0.002 - p.z), 0);
    const tube = (points, radius, closed = false) => {
        const curve = new T.CatmullRomCurve3(points, closed, "centripetal");
        frame.push(
            new T.TubeGeometry(
                curve,
                closed ? 40 : Math.max(8, points.length * 4),
                radius,
                5,
                closed,
            ),
        );
    };
    // Sample each side of the edited head, including the brow-to-ear transition.
    // A single width measured near the ear lets the curved arms cut across the temples.
    const sideSurfaces = [-1, 1].map((side) => {
        const p = skin.attributes.position,
            projected = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
            projected[i * 3] = p.getZ(i);
            projected[i * 3 + 1] = p.getY(i);
            projected[i * 3 + 2] = side * p.getX(i);
        }
        const indices = [],
            source = skin.index.array;
        for (let i = 0; i < source.length; i += 3) {
            const tri = [source[i], source[i + 1], source[i + 2]];
            if (tri.some((v) => Math.abs(p.getY(v) - eyeLine) < 0.04)) indices.push(...tri);
        }
        return frontSurface(projected, indices, 0.004);
    });
    function arm(start, side) {
        const radius = tactical ? 0.00125 : 0.00085;
        const surfaceAt = sideSurfaces[side === -1 ? 0 : 1];
        const temple = surfaceAt(0.08, earY) ?? separation / 2 + 0.029;
        const curve = new T.CatmullRomCurve3(
            [
                start,
                new T.Vector3(side * (Math.abs(start.x) + 0.004), start.y, start.z - 0.003),
                new T.Vector3(side * (temple + 0.002), earY + 0.003, 0.08),
                new T.Vector3(side * (temple + 0.001), earY + 0.001, 0.037),
                new T.Vector3(side * (temple - 0.002), earY - 0.008, 0.018),
            ],
            false,
            "centripetal",
        );
        const points = curve.getPoints(96);
        for (const point of points) {
            let width = Math.abs(point.x);
            // Clearance includes the tube radius and nearby surface slope.
            for (const dy of [-radius * 2, 0, radius * 2])
                for (const dz of [-radius * 2, 0, radius * 2]) {
                    const skinX = surfaceAt(point.z + dz, point.y + dy);
                    if (skinX !== null) width = Math.max(width, skinX + radius + 0.001);
                }
            point.x = side * width;
        }
        // Linear segments preserve the clearance envelope; another spline can overshoot inward.
        const fitted = new T.CurvePath();
        for (let i = 1; i < points.length; i++)
            fitted.add(new T.LineCurve3(points[i - 1], points[i]));
        frame.push(new T.TubeGeometry(fitted, 144, radius, 5, false));
    }
    const lensMesh = (points, wrapWidth = 0) => {
        // Triangulate the silhouette, then retain its shallow face curvature.
        const faces = T.ShapeUtils.triangulateShape(
                points.map((p) => new T.Vector2(p.x, p.y)),
                [],
            ),
            g = new T.BufferGeometry();
        g.setAttribute(
            "position",
            new T.Float32BufferAttribute(
                points.flatMap((p) => p.toArray()),
                3,
            ),
        );
        g.setIndex(faces.flat());
        const normals = points.flatMap((p) =>
            new T.Vector3(
                wrapWidth
                    ? (0.032 * Math.sign(p.x) * (Math.abs(p.x) / wrapWidth) ** 0.6) / wrapWidth
                    : 0.08 * Math.sign(p.x),
                0,
                1,
            )
                .normalize()
                .toArray(),
        );
        g.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
        lenses.push(g);
    };
    if (tactical) {
        // One wrapped shield, with a nose cutout and only an upper frame. The lens itself
        // provides coverage; thick rings around each eye made the old version read as goggles.
        const width = separation / 2 + 0.023 * fit;
        const contour = [
            [-1, 0.002],
            [-0.94, 0.011],
            [-0.6, 0.013],
            [-0.22, 0.01],
            [0, 0.009],
            [0.22, 0.01],
            [0.6, 0.013],
            [0.94, 0.011],
            [1, 0.002],
            [0.91, -0.01],
            [0.6, -0.014],
            [0.29, -0.01],
            [0.14, -0.001],
            [0, 0.003],
            [-0.14, -0.001],
            [-0.29, -0.01],
            [-0.6, -0.014],
            [-0.91, -0.01],
        ];
        const point = ([x, h]) => {
            const xx = x * width,
                yy = y + h * fit;
            return new T.Vector3(xx, yy, bridgeZ - 0.02 * Math.abs(x) ** 1.6);
        };
        const rim = contour.map(point),
            offset = frontClearance(rim);
        rim.forEach((p) => (p.z += offset));
        lensMesh(rim, width);
        tube(rim.slice(0, 9), 0.0014);
        for (const side of [-1, 1]) arm(rim[side === -1 ? 1 : 7], side);
        // Short rubber nose saddle, connected to the shield's cutout.
        tube([rim[12], rim[13], rim[14]], 0.00085);
    } else {
        function ringPoint(c, a) {
            const co = Math.cos(a),
                si = Math.sin(a),
                power = round ? 1 : aviator ? 0.85 : 0.45;
            const x = c.x + halfW * Math.sign(co) * Math.abs(co) ** power;
            const yy =
                y +
                halfH * Math.sign(si) * Math.abs(si) ** power -
                (aviator ? Math.max(0, -si) * 0.003 : 0);
            return new T.Vector3(x, yy, bridgeZ - 0.08 * Math.abs(x));
        }
        const rings = centers.map((c) =>
            Array.from({ length: 40 }, (_, i) => ringPoint(c, (i * Math.PI) / 20)),
        );
        const offset = frontClearance(rings.flat());
        const fitted = (c, a) => ringPoint(c, a).add(new T.Vector3(0, 0, offset));
        const inner = [];
        for (let k = 0; k < 2; k++) {
            const side = k === 0 ? -1 : 1,
                c = centers[k],
                ring = rings[k].map((p) => p.add(new T.Vector3(0, 0, offset)));
            tube(ring, round || aviator ? 0.00062 : 0.00095, true);
            lensMesh(ring);
            arm(fitted(c, side > 0 ? 0.36 : Math.PI - 0.36), side);
            inner.push(fitted(c, side < 0 ? 0.38 : Math.PI - 0.38));
        }
        tube(
            [inner[0], new T.Vector3(0, bridgeY + 0.002, bridgeZ + offset + 0.0005), inner[1]],
            round || aviator ? 0.00065 : 0.0009,
        );
        if (aviator) {
            const left = fitted(centers[0], 0.85),
                right = fitted(centers[1], Math.PI - 0.85);
            tube([left, new T.Vector3(0, y + halfH * 0.9, bridgeZ + offset), right], 0.0006);
        }
    }
    const merge = (parts) => {
        const g = mergeGeometries(parts);
        parts.forEach((p) => p.dispose());
        g.computeBoundingSphere();
        return g;
    };
    return [
        {
            key: "glasses-frame",
            g: merge(frame),
            material: new T.MeshStandardMaterial({
                color: state.glassesColor,
                roughness: tactical ? 0.55 : 0.32,
                metalness: round || aviator ? 0.55 : 0.08,
            }),
        },
        {
            key: "glasses-lens",
            g: merge(lenses),
            material: new T.MeshStandardMaterial({
                color: state.lensColor,
                roughness: 0.13,
                metalness: 0,
                transparent: true,
                opacity: lensOpacity(state.lensTint),
                depthWrite: false,
                side: T.DoubleSide,
            }),
        },
    ];
}
