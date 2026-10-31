// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as THREE from "three";
import type { TitleSurfaces } from "./title-surfaces";
import { referencePoint } from "./title-skyline";
import { createModelKit, type GroundReflection } from "./title-model-kit";

/** Physical paving, curb stones, barriers, street furniture and luminaires. */
export function createTitleStreet(
    scene: THREE.Scene,
    reflection: GroundReflection,
    surfaces: TitleSurfaces,
) {
    const kit = createModelKit(scene, "Pavement and street furniture", reflection, surfaces);
    const { box, beam, pipe, palette: p, random } = kit;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const left = (z: number) => -6.2 + Math.min(-z, 100) * 0.042;
    const right = (z: number) => 5.1 + Math.max(0, Math.min(-z - 16, 68)) * 0.085;
    // The pavement is several metres deep. Individual slab edges and raised
    // curb blocks catch grazing light.
    for (let z = 8; z > -310;) {
        const dz = z > -70 ? 1.05 : 3,
            dx = z > -70 ? 0.78 : 2.4;
        const west = z > -60 ? -18.5 : -25;
        const east = z > -60 ? 18 : z > -103 ? 21 : 18.5;
        for (const [from, to] of [
            [west, left(z) - 0.14],
            [right(z) + 0.14, east],
        ])
            box(
                "Continuous pavement foundation",
                (from + to) / 2,
                0.015,
                z,
                to - from,
                0.22,
                dz,
                p.pavement,
            );
        for (let x = west; x < east; x += dx) {
            if (x + dx / 2 > left(z) - 0.2 && x - dx / 2 < right(z) + 0.2) continue;
            box(
                "Paving slab",
                x,
                0.075 + (random() - 0.5) * 0.006,
                z,
                dx - 0.015,
                0.18,
                dz - 0.018,
                p.pavement,
            );
        }
        for (const [x, sign] of [
            [left(z), -1],
            [right(z), 1],
        ]) {
            const curb = box("Raised curb stone", x, 0.115, z, 0.28, 0.3, dz - 0.012, p.curb);
            const slope = sign < 0 ? 0.042 : z < -16 && z > -84 ? 0.085 : 0;
            curb.rotation.y = Math.atan(slope);
        }
        z -= dz;
    }
    const fenceCorner = v(-12.6, 0, -18);
    const fenceEnd = v(-8.5, 0, -120);
    const railing = (a: THREE.Vector3, b: THREE.Vector3, height: number, spacing: number) => {
        const count = Math.ceil(a.distanceTo(b) / spacing);
        for (const y of [0.45, 1.15, height])
            beam(
                "Forecourt guardrail",
                a.clone().setY(y + 0.16),
                b.clone().setY(y + 0.16),
                0.045,
                0.055,
                p.steel,
            );
        for (let i = 0; i <= count; i++) {
            const at = a.clone().lerp(b, i / count);
            box("Railing upright", at.x, height / 2 + 0.16, at.z, 0.065, height, 0.065, p.steel);
            box("Railing foot plate", at.x, 0.19, at.z, 0.22, 0.05, 0.22, p.edge);
        }
    };
    railing(v(-43, 0, -18), fenceCorner, 1.95, 2.1);
    railing(fenceCorner, fenceEnd, 1.95, 2.5);
    for (const z of [-18, -25, -32, -42, -55, -72, -95, -120]) {
        const x = -12.6 + ((-z - 18) / 102) * 4.1;
        box("Forecourt concrete pier", x, 1.1, z, 0.72, 1.9, 0.82, p.darkConcrete);
        box("Pier cap stone", x, 2.1, z, 0.88, 0.2, 0.99, p.concrete);
        box("Pier plinth", x, 0.3, z, 0.9, 0.32, 1.05, p.concrete);
    }
    // Drain channels, individual grating bars and utility cabinets.
    for (let z = -20; z > -160; z -= 14) {
        const x = left(z) + 0.35;
        box("Drain recess", x, -0.01, z, 0.5, 0.05, 0.85, p.darkConcrete);
        for (let i = 0; i < 9; i++)
            box("Drain grating bar", x, 0.018, z - 0.38 + i * 0.09, 0.48, 0.025, 0.025, p.steel);
    }
    for (const [x, z] of [
        [-17, -46],
        [-13, -29],
        [-9, -90],
    ]) {
        box("Electrical cabinet", x, 0.95, z, 0.6, 1.55, 0.42, p.steel);
        box("Cabinet inset door", x, 0.96, z + 0.22, 0.52, 1.4, 0.025, p.edge);
        box("Cabinet rain hood", x, 1.77, z, 0.7, 0.08, 0.54, p.steel);
    }
    for (const z of [-44, -69, -102, -139]) {
        const x = right(z) + 2.8;
        for (let i = 0; i < 5; i++)
            box("Bench seat slat", x, 0.66, z - 0.26 + i * 0.13, 2.4, 0.075, 0.105, p.rust);
        for (let i = 0; i < 4; i++)
            box("Bench back slat", x, 0.9 + i * 0.14, z + 0.33, 2.4, 0.1, 0.055, p.rust);
        for (const dx of [-0.9, 0.9]) {
            box("Bench leg", x + dx, 0.34, z, 0.07, 0.65, 0.55, p.steel);
            beam(
                "Bench back support",
                v(x + dx, 0.3, z + 0.28),
                v(x + dx, 1.42, z + 0.4),
                0.055,
                0.055,
                p.steel,
            );
        }
        box("Street litter bin", x + 1.9, 0.75, z, 0.55, 1.2, 0.55, p.steel);
        box("Litter bin cap", x + 1.9, 1.38, z, 0.61, 0.1, 0.61, p.edge);
    }
    const extraGeometries: THREE.BufferGeometry[] = [];
    for (const z of [-91, -98, -107]) {
        const curve = new THREE.CatmullRomCurve3([
            v(-16, 10.9, z),
            v(-4, 10.25, z),
            v(5, 10.15, z),
            v(15, 10.9, z),
        ]);
        const g = new THREE.TubeGeometry(curve, 32, 0.018, 4, false);
        extraGeometries.push(g);
        const mesh = new THREE.Mesh(g, p.steel);
        mesh.name = "Suspended utility cable";
        kit.root.add(mesh);
    }
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const ctx = glowCanvas.getContext("2d")!,
        gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(200,240,255,.6)");
    gradient.addColorStop(0.15, "rgba(130,215,240,.13)");
    gradient.addColorStop(1, "rgba(130,215,240,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const glowMap = new THREE.CanvasTexture(glowCanvas);
    const glowMaterials: THREE.SpriteMaterial[] = [];
    const cold = kit.glow(0xa9eaff, 3),
        warm = kit.glow(0xffbc77, 2);
    const lamps: { pivot: THREE.Group; phase: number; tilt: number }[] = [];
    function lamp(
        headX: number,
        headY: number,
        poleX: number,
        distance: number,
        phase: number,
        amber = false,
        wall = false,
    ) {
        const head = referencePoint(headX, headY, distance),
            mount = referencePoint(poleX, headY + 9, distance);
        if (phase === 0 || phase === 1) {
            // Mount outside the factory face, including the pivot's small sway.
            // Screen-space placement alone left the second fitting inside a pier.
            mount.x = -17.15;
            head.x = -16.8;
        }
        const pivot = new THREE.Group();
        pivot.name = "Moving luminaire assembly";
        pivot.userData.animated = true;
        pivot.position.copy(mount);
        kit.root.add(pivot);
        const local = head.clone().sub(mount);
        if (!wall) {
            pipe("Streetlight mast", v(mount.x, 0.32, mount.z), mount, 0.075, p.steel);
            box("Streetlight pedestal", mount.x, 0.6, mount.z, 0.4, 1.05, 0.4, p.steel);
            box("Pedestal base", mount.x, 0.2, mount.z, 0.65, 0.18, 0.65, p.edge);
        }
        pipe("Streetlight outreach arm", new THREE.Vector3(), local, 0.04, p.steel, pivot);
        const length = ((wall ? 15 : 18) / 941) * 2 * Math.tan((23 * Math.PI) / 180) * distance;
        box(
            "Luminaire metal housing",
            local.x,
            local.y + 0.065,
            local.z,
            length + 0.12,
            0.11,
            0.26,
            p.edge,
            pivot,
        );
        box(
            "Recessed illuminated lens",
            local.x,
            local.y - 0.04,
            local.z + 0.012,
            length,
            0.05,
            0.2,
            amber ? warm : cold,
            pivot,
        );
        const haloMaterial = new THREE.SpriteMaterial({
            map: glowMap,
            color: amber ? 0xffc58d : 0xa0e1f5,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        glowMaterials.push(haloMaterial);
        const halo = new THREE.Sprite(haloMaterial);
        halo.position.copy(local);
        halo.scale.setScalar(phase === 2 || phase === 3 ? 5.5 : 3.8);
        pivot.add(halo);
        // Only nearby lamps illuminate geometry. Distant fittings retain their
        // emissive lens/halo without adding a light loop to every fragment.
        if (phase === 4 || phase === 5) {
            const light = new THREE.PointLight(0x91cddd, 120, 27, 2);
            light.position.copy(local).add(v(0, -0.12, 0.1));
            pivot.add(light);
        }
        if (phase === 0 || phase === 1 || phase === 12 || phase === 13) {
            const spot = new THREE.SpotLight(0xa9e6f4, phase >= 12 ? 1800 : 650, 30, 0.9, 1, 2);
            spot.position.copy(local).add(v(0, -0.16, 0.28));
            spot.target.position.copy(local).add(phase >= 12 ? v(-3, -4, 0) : v(-0.7, -4, -0.3));
            pivot.add(spot, spot.target);
        }
        lamps.push({ pivot, phase, tilt: wall ? -0.32 : phase >= 4 ? -0.18 : 0.12 });
    }
    const wallDistance = (x: number) =>
        -17.6 / (((x / 1672 - 0.758) * 2 * Math.tan((23 * Math.PI) / 180) * 1672) / 941);
    lamp(732, 385, 725, wallDistance(732) - 0.3, 0, false, true);
    lamp(837, 481, 831, wallDistance(837) - 0.3, 1, false, true);
    lamp(971, 546, 964, 85, 12, false, true);
    lamp(1012, 601, 1006, 95, 13, false, true);
    lamp(1074, 400, 1055, 91, 2);
    lamp(1137, 461, 1116, 101, 3);
    lamp(1559, 377, 1590, 43, 4);
    lamp(1488, 532, 1510, 48, 5);
    lamp(1417, 565, 1430, 72, 6);
    lamp(1359, 626, 1367, 103, 7);
    lamp(1208, 641, 1200, 135, 8);
    lamp(1326, 651, 1334, 158, 9);
    lamp(1357, 675, 1360, 125, 10, true);
    lamp(1068, 634, 1062, 78, 11, true, true);
    box("Kiosk strip-light housing", -16.5, 7.05, -61.72, 1.05, 0.12, 0.22, p.steel);
    box("Kiosk cool tube", -16.5, 6.98, -61.65, 0.9, 0.06, 0.08, cold);
    const kioskLight = new THREE.PointLight(0x91c6cf, 110, 13, 2);
    kioskLight.position.set(-16.5, 6.7, -60.8);
    kit.root.add(kioskLight);
    // Door spill comes from actual warm lamps inside the street-facing shops.
    for (const z of [-39, -84]) {
        const light = new THREE.PointLight(0xe8ab73, 180, 17, 2);
        light.position.set(13.3, 2.6, z);
        kit.root.add(light);
    }
    kit.finish();
    return {
        update(t: number) {
            lamps.forEach(({ pivot, phase, tilt }) => {
                pivot.rotation.z = tilt + Math.sin(t * 0.52 + phase) * 0.006;
            });
            kit.update();
        },
        dispose() {
            kit.dispose();
            glowMap.dispose();
            glowMaterials.forEach((m) => m.dispose());
            extraGeometries.forEach((g) => g.dispose());
        },
    };
}
