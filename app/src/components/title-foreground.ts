// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import * as THREE from "three";
import { createModelKit } from "./title-model-kit";
import type { TitleSurfaces } from "./title-surfaces";

/** Actual buildings assembled in metres, with wall openings, rooms, structural
 * frames and separate glazed panes. No image of the scene is used as a material. */
export function createTitleForeground(scene: THREE.Scene, surfaces: TitleSurfaces) {
    const kit = createModelKit(
        scene,
        "Modeled industrial street architecture",
        undefined,
        surfaces,
    );
    const { box, beam, pipe, frame, palette: p, glazing, random } = kit;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const opening = (
        parent: THREE.Object3D,
        name: string,
        x: number,
        y: number,
        w: number,
        h: number,
        cellW: number,
        cellH: number,
        wall: THREE.Material,
        lit: THREE.Material,
        cols = 3,
        rows = 2,
        recess = 0.42,
    ) => {
        const edge = (cellW - w) / 2,
            above = (cellH - h) / 2,
            paneZ = 0.325 - recess;
        box(name + " left jamb", x - cellW / 2 + edge / 2, y, 0, edge, cellH, 0.65, wall, parent);
        box(name + " right jamb", x + cellW / 2 - edge / 2, y, 0, edge, cellH, 0.65, wall, parent);
        box(name + " lintel", x, y + h / 2 + above / 2, 0, w, above, 0.65, wall, parent);
        box(name + " apron", x, y - h / 2 - above / 2, 0, w, above, 0.65, wall, parent);
        box(name + " recessed room", x, y, paneZ - 0.65, w, h, 0.06, p.darkConcrete, parent);
        box(name + " glazed panes", x, y, paneZ, w - 0.06, h - 0.06, 0.025, lit, parent);
        for (let c = 0; c <= cols; c++)
            box(
                name + " vertical glazing bar",
                x - w / 2 + (c * w) / cols,
                y,
                paneZ + 0.04,
                0.045,
                h + 0.08,
                0.1,
                p.steel,
                parent,
            );
        for (let r = 0; r <= rows; r++)
            box(
                name + " horizontal glazing bar",
                x,
                y - h / 2 + (r * h) / rows,
                paneZ + 0.04,
                w + 0.08,
                0.04,
                0.11,
                p.steel,
                parent,
            );
        box(
            name + " projecting sill",
            x,
            y - h / 2 - 0.06,
            0.08,
            w + 0.24,
            0.12,
            0.45,
            p.paleConcrete,
            parent,
        );
        if (lit !== glazing.dark && random() < 0.42)
            box(
                name + " blind",
                x,
                y + h * 0.35,
                paneZ + 0.025,
                w - 0.12,
                h * 0.25,
                0.02,
                p.darkConcrete,
                parent,
            );
    };
    // Both street-facing elevations share the street's longitudinal axis.
    // The old diagonal footprint introduced a second vanishing point.
    const a = v(-17.95, 0.16, -12);
    const b = v(-17.95, 0.16, -60.5);
    const length = a.distanceTo(b);
    const factory = frame(
        "West factory — deep bays and cantilevered upper floors",
        a,
        b.clone().sub(a),
    );
    const upperBays = 11;
    const bayW = length / upperBays;
    const firstLoadingBay = 6;
    const loadingStart = firstLoadingBay * bayW;
    // A closed building body. The street wall is assembled around its openings.
    box("Factory rear wall", length / 2, 30, -11.5, length, 60, 1.2, p.darkConcrete, factory);
    for (const x of [0, length])
        box("Factory end wall", x, 30, -5.6, 1.2, 60, 12, p.concrete, factory);
    box("Factory roof", length / 2, 60, -5.6, length, 1.3, 12, p.concrete, factory);
    box(
        "Main blank loading-hall wall",
        loadingStart / 2,
        10.4,
        -0.9,
        loadingStart,
        20.8,
        0.8,
        p.darkConcrete,
        factory,
    );
    // The floor beam bears on the same column faces above and below it.
    box("Factory floor soffit", length / 2, 21, -5.25, length, 1.2, 11.8, p.darkConcrete, factory);
    for (let i = 0; i < 5; i++) {
        const x = loadingStart + (i + 0.5) * bayW;
        box("Lower bay upper lintel", x, 15.8, -0.3, bayW - 0.4, 10, 0.8, p.darkConcrete, factory);
        box("Loading-door backing", x, 4.7, -1, bayW - 0.6, 9.4, 0.2, p.steel, factory);
        for (let j = 0; j < 48; j++)
            box(
                "Steel shutter slat",
                x,
                0.3 + j * 0.185,
                -0.8,
                bayW - 0.68,
                0.13,
                0.08,
                j % 4 === 0 ? p.edge : p.steel,
                factory,
            );
        for (const dx of [-bayW * 0.39, bayW * 0.39])
            box("Shutter guide channel", x + dx, 4.7, -0.48, 0.11, 9.4, 0.16, p.edge, factory);
        box("Bay concrete lintel", x, 10.3, 0.2, bayW - 0.2, 0.65, 1.25, p.concrete, factory);
        pipe(
            "Rainwater downpipe",
            v(x + bayW * 0.43, 0.4, 0.63),
            v(x + bayW * 0.43, 22, 0.63),
            0.09,
            p.steel,
            factory,
        );
        for (let y = 2; y < 21; y += 3)
            box("Pipe fixing strap", x + bayW * 0.43, y, 0.57, 0.3, 0.09, 0.2, p.edge, factory);
    }
    const uw = bayW;
    for (let floor = 0; floor < 8; floor++)
        for (let i = 0; i < upperBays; i++) {
            const x = (i + 0.5) * uw,
                y = 23.1 + floor * 4.6;
            opening(
                factory,
                "Factory clerestory",
                x,
                y,
                uw * 0.72,
                1.1,
                uw,
                4.6,
                p.concrete,
                (i + floor * 3) % 13 === 0 ? glazing.warm[1] : glazing.dark,
                4,
                2,
                0.45,
            );
        }
    for (const y of [21.7, 30.1, 39.3, 48.5, 57.7])
        box(
            "Factory horizontal belt course",
            length / 2,
            y,
            0.35,
            length,
            0.28,
            0.55,
            p.edge,
            factory,
        );
    // Continuous members cannot drift at the floor line: one mesh per column,
    // and the loading bays and upper windows use these same centre lines.
    for (let i = 0; i <= upperBays; i++) {
        const startY = i < firstLoadingBay ? 21.6 : 0;
        box(
            "Continuous factory column",
            i * bayW,
            (startY + 60) / 2,
            0.25,
            i === upperBays ? 0.85 : 0.48,
            60 - startY,
            1.35,
            p.concrete,
            factory,
        );
    }
    // Turn the masonry band around a substantial corner. The recessed steel
    // gallery begins behind this return, visibly distinct from facade decoration.
    box(
        "Factory corner band return",
        length + 0.22,
        21.35,
        -2.6,
        0.6,
        0.8,
        6.5,
        p.concrete,
        factory,
    );
    box("Factory corner coping", length, 21.85, 0.25, 1.2, 0.18, 1.65, p.paleConcrete, factory);
    const annex = frame("West service annex behind the gallery", v(-24.5, 0.16, -60), v(0, 0, -1));
    box("Annex rear wall", 65, 13, -7, 130, 26, 0.6, p.darkConcrete, annex);
    box("Annex roof", 65, 26, -3.5, 130, 0.6, 7, p.concrete, annex);
    for (let i = 0; i < 26; i++)
        for (let row = 0; row < 5; row++)
            opening(
                annex,
                "Annex window bay",
                (i + 0.5) * 5,
                2.6 + row * 5.2,
                2.5,
                3.3,
                5,
                5.2,
                p.darkConcrete,
                (i + row * 5) % 7 === 0 ? glazing.cool[1] : glazing.dark,
                3,
                3,
                0.6,
            );
    // A separate two-storey utility workshop: four walls, a roof, rooms and door.
    const kiosk = frame("Loading kiosk", v(-18.5, 0.16, -62), v(1, 0, 0));
    const kw = 6.4,
        kh = 7.5,
        kd = 9;
    box("Kiosk back wall", kw / 2, kh / 2, -kd, kw, kh, 0.32, p.blueBrick, kiosk);
    for (const x of [0, kw])
        box("Kiosk side wall", x, kh / 2, -kd / 2, 0.3, kh, kd, p.blueBrick, kiosk);
    box("Kiosk floor", kw / 2, 0.02, -kd / 2, kw, 0.18, kd, p.concrete, kiosk);
    box("Kiosk roof slab", kw / 2, kh, -kd / 2, kw + 0.35, 0.3, kd + 0.45, p.concrete, kiosk);
    box(
        "Kiosk projecting roof flashing",
        kw / 2,
        kh + 0.2,
        0.1,
        kw + 0.5,
        0.16,
        0.5,
        p.edge,
        kiosk,
    );
    // Door and transom are actual openings, with frames and a recessed leaf.
    opening(
        kiosk,
        "Kiosk entrance",
        2.4,
        2.8,
        1.55,
        4.6,
        kw,
        5.6,
        p.blueBrick,
        p.steel,
        1,
        1,
        0.38,
    );
    box("Kiosk door lower leaf", 2.4, 1.3, -0.24, 1.43, 2.4, 0.08, p.steel, kiosk);
    box("Kiosk wire-glass transom", 2.4, 4.5, -0.22, 1.38, 0.85, 0.04, glazing.cool[1], kiosk);
    for (let i = 0; i < 5; i++)
        box("Transom wire bar", 1.8 + i * 0.3, 4.5, -0.18, 0.018, 0.85, 0.025, p.edge, kiosk);
    pipe("Door pull", v(3, 2, -0.09), v(3, 2.65, -0.09), 0.035, p.edge, kiosk);
    opening(
        kiosk,
        "Kiosk upper vent",
        kw / 2,
        6.55,
        2.7,
        0.9,
        kw,
        1.9,
        p.blueBrick,
        glazing.dark,
        4,
        1,
        0.4,
    );
    for (let y = 6.25; y < 6.95; y += 0.11)
        box("Kiosk ventilation louvre", kw / 2, y, 0.02, 2.65, 0.055, 0.18, p.steel, kiosk);
    pipe("Kiosk conduit", v(0.35, 0.2, 0.22), v(0.35, 7, 0.22), 0.045, p.steel, kiosk);
    box("Kiosk fuse box", 0.6, 3.6, 0.3, 0.62, 0.85, 0.25, p.edge, kiosk);
    // Closed side-room windows and door surrounds on the return, facing the street.
    const kioskSide = frame("Kiosk side room", v(-12.1, 0.16, -71), v(0, 0, 1));
    for (let i = 0; i < 3; i++)
        opening(
            kioskSide,
            "Kiosk return window",
            1.5 + i * 3,
            4.3,
            1.35,
            1.9,
            3,
            7.2,
            p.blueBrick,
            i === 1 ? glazing.warm[1] : glazing.dark,
            2,
            2,
            0.3,
        );
    box("Kiosk roof ventilation box", kw / 2 + 1, kh + 0.45, -4, 1.6, 0.7, 1.8, p.steel, kiosk);
    for (let j = 0; j < 7; j++)
        box(
            "Kiosk rooftop louvre",
            kw / 2 + 1,
            kh + 0.17 + j * 0.08,
            -3.07,
            1.45,
            0.04,
            0.06,
            p.edge,
            kiosk,
        );
    box("Kiosk service hatch", 4.9, 2.9, 0.2, 1.2, 1.8, 0.12, p.darkConcrete, kiosk);
    box("Kiosk faded metal notice", 0.88, 4.6, 0.35, 0.75, 1, 0.04, p.paleConcrete, kiosk);
    for (let j = 0; j < 5; j++)
        box(
            "Printed notice line",
            0.88,
            4.85 - j * 0.13,
            0.38,
            0.48,
            0.025,
            0.01,
            p.darkConcrete,
            kiosk,
        );
    box("Kiosk safety placard", 4.9, 4.2, 0.22, 0.65, 0.38, 0.025, p.rust, kiosk);
    for (const x of [1.2, 4.3]) {
        pipe("Kiosk roof rail post", v(x, kh, -0.4), v(x, kh + 0.65, -0.4), 0.025, p.steel, kiosk);
    }
    beam(
        "Kiosk roof rail",
        v(1.2, kh + 0.65, -0.4),
        v(4.3, kh + 0.65, -0.4),
        0.035,
        0.035,
        p.steel,
        kiosk,
    );
    // Elevated gallery: horizontal walking slab, two continuous girders, real
    // columns, crossbeams, diagonal bracing and guardrails.
    const galleryX = -17.95,
        galleryY = 24.25,
        zFront = -60.5,
        zBack = -255,
        depth = zFront - zBack;
    for (const [from, to] of [
        [zFront, -137.3],
        [-140.7, zBack],
    ])
        box(
            "Gallery walking slab",
            galleryX - 2.25,
            galleryY - 0.12,
            (from + to) / 2,
            4.7,
            0.24,
            from - to,
            p.concrete,
        );
    for (const x of [galleryX, galleryX - 4.5]) {
        box(
            "Gallery steel web",
            x,
            galleryY - 0.65,
            (zFront + zBack) / 2,
            0.18,
            1.1,
            depth,
            p.steel,
        );
        for (const y of [galleryY - 0.16, galleryY - 1.18])
            box("Gallery flange", x, y, (zFront + zBack) / 2, 0.5, 0.1, depth, p.edge);
        const joinsBridge = x === galleryX;
        const runs = joinsBridge
            ? [
                  [zFront, -137.1],
                  [-140.9, zBack],
              ]
            : [[zFront, zBack]];
        for (const [from, to] of runs) {
            for (const y of [galleryY + 0.45, galleryY + 1.05])
                beam("Gallery rail", v(x, y, from), v(x, y, to), 0.045, 0.045, p.steel);
            for (let z = from; z > to; z -= 2.2)
                box("Gallery upright", x, galleryY + 0.53, z, 0.045, 1.06, 0.045, p.steel);
        }
        for (let z = -68; z > zBack; z -= 14) {
            box(
                "Gallery concrete column",
                x,
                (galleryY - 1.2) / 2,
                z,
                0.48,
                galleryY - 1.2,
                0.65,
                p.darkConcrete,
            );
            box("Column foundation", x, 0.23, z, 0.9, 0.45, 1.05, p.concrete);
            beam(
                "Gallery bracket",
                v(x, galleryY - 3.3, z),
                v(x, galleryY - 1.2, z - 2.1),
                0.18,
                0.23,
                p.steel,
            );
        }
    }
    for (let z = zFront; z > zBack; z -= 3.4)
        box(
            "Gallery transverse beam",
            galleryX - 2.25,
            galleryY - 0.5,
            z,
            4.7,
            0.35,
            0.19,
            p.steel,
        );
    // Level junction: the cross-street deck extends through this gallery.
    // There is no step or guardrail across the walking route.

    // Telephone exchange: a warm stairwell, dark office wing, stepped rooftop
    // plant rooms, aerials and parapets. It is not a uniformly repeated tower.
    const phone = frame(
        "Telephone exchange — stairwell and office wing",
        v(16.8, 0.16, -102),
        v(1, 0, 0),
    );
    phone.scale.setScalar(104 / 77);
    const pw = 10.8,
        ph = 34,
        pd = 13;
    box("Exchange rear wall", pw / 2, ph / 2, -pd, pw, ph, 0.8, p.concrete, phone);
    for (const x of [0, pw])
        box("Exchange return wall", x, ph / 2, -pd / 2, 0.65, ph, pd, p.concrete, phone);
    box("Exchange roof slab", pw / 2, ph, -pd / 2, pw + 0.3, 0.55, pd + 0.3, p.concrete, phone);
    for (let row = 0; row < 9; row++) {
        const y = 2 + row * 3.65;
        opening(
            phone,
            "Lit stairwell bay",
            2.4,
            y,
            2.35,
            1.95,
            4.8,
            3.65,
            p.concrete,
            row > 0 ? glazing.warm[1] : glazing.cool[1],
            3,
            2,
            0.55,
        );
        opening(
            phone,
            "Exchange office",
            7.8,
            y,
            1.35,
            1.75,
            6,
            3.65,
            p.concrete,
            row % 3 === 0 ? glazing.warm[1] : glazing.dark,
            2,
            2,
            0.5,
        );
        box(
            "Exchange floor stringcourse",
            pw / 2,
            y + 1.78,
            0.2,
            pw,
            0.13,
            0.45,
            p.concrete,
            phone,
        );
    }
    for (const x of [0.25, 4.8, 10.5])
        box("Exchange vertical masonry rib", x, ph / 2, 0.22, 0.3, ph, 0.7, p.concrete, phone);
    box("Exchange parapet", pw / 2, ph + 0.55, 0, pw, 1.1, 0.35, p.darkConcrete, phone);
    box("Tall stairwell headhouse", 4.4, ph + 1.9, -3, 2.5, 3.8, 4, p.darkConcrete, phone);
    box("Lower plant room", 8.5, ph + 1.15, -4, 2.9, 2.3, 5, p.concrete, phone);
    for (let i = 0; i < 10; i++)
        box(
            "Plant room ventilation grille",
            8.5,
            ph + 0.4 + i * 0.15,
            -1.42,
            2.2,
            0.07,
            0.05,
            p.steel,
            phone,
        );
    for (const [x, h] of [
        [4.3, 10],
        [8.4, 6.2],
        [3.7, 4.2],
    ]) {
        pipe("Roof aerial", v(x, ph + 3, -3), v(x, ph + 3 + h, -3), 0.027, p.edge, phone);
        box("Aerial beacon", x, ph + 3 + h, -3, 0.07, 0.09, 0.07, kit.glow(0xad4c3c, 0.6), phone);
    }
    for (const y of [ph + 1.15, ph + 1.7])
        beam("Roof maintenance railing", v(0.6, y, -1), v(3, y, -1), 0.035, 0.035, p.steel, phone);
    for (const x of [5.2, 8.8]) {
        box(
            "Exchange recessed service chase",
            x,
            ph / 2,
            -0.05,
            0.4,
            ph,
            0.12,
            p.darkConcrete,
            phone,
        );
        pipe(
            "Exchange exposed copper riser",
            v(x, 0.3, 0.44),
            v(x, ph + 1, 0.44),
            0.065,
            p.rust,
            phone,
        );
        for (let y = 2; y < ph; y += 3.65)
            box("Riser anchor", x, y, 0.48, 0.26, 0.1, 0.25, p.edge, phone);
    }
    for (const [x, y] of [
        [6.2, 27],
        [9.5, 12.5],
        [7.4, 5],
    ]) {
        box("Exchange ventilation unit", x, y, 0.65, 1.05, 0.7, 1.1, p.darkConcrete, phone);
        for (let j = 0; j < 6; j++)
            box(
                "Ventilation-unit slat",
                x,
                y - 0.25 + j * 0.1,
                1.22,
                0.92,
                0.035,
                0.03,
                p.edge,
                phone,
            );
        beam(
            "Ventilation-unit bracket",
            v(x - 0.35, y - 0.8, 0.3),
            v(x - 0.35, y - 0.3, 1),
            0.06,
            0.06,
            p.steel,
            phone,
        );
    }
    pipe("Exchange drainpipe", v(0.55, 0.3, 0.65), v(0.55, ph, 0.65), 0.085, p.steel, phone);

    // Nearest eastern building: long side elevation with deep window bays,
    // heavy floor courses, stone piers, shop doors and projecting steel canopies.
    const near = frame(
        "East tenement — stone piers and warm industrial glazing",
        v(17, 0.16, -59),
        v(0, 0, 1),
    );
    const nw = 34,
        nh = 57,
        nd = 12,
        bays = 8,
        cw = nw / bays;
    box("Tenement back wall", nw / 2, nh / 2, -nd, nw, nh, 1, p.darkConcrete, near);
    for (const x of [0, nw])
        box("Tenement end wall", x, nh / 2, -nd / 2, 0.8, nh, nd, p.blueBrick, near);
    box("Tenement roof", nw / 2, nh, -nd / 2, nw, 0.6, nd, p.concrete, near);
    for (let row = 0; row < 12; row++)
        for (let col = 0; col < bays; col++) {
            const y = 2.3 + row * 4.6,
                x = (col + 0.5) * cw;
            const lit = (row * 5 + col * 3) % 7;
            opening(
                near,
                "Tenement factory window",
                x,
                y,
                2.6,
                row === 0 ? 3.6 : 2.95,
                cw,
                4.6,
                p.blueBrick,
                lit < 3
                    ? glazing.warm[(row + col) % 3]
                    : lit === 3
                      ? glazing.cool[1]
                      : glazing.dark,
                3,
                3,
                0.12,
            );
            if (row === 0) {
                box("Shop canopy", x, 4.05, 0.75, 3.15, 0.16, 1.7, p.steel, near);
                beam(
                    "Canopy bracket",
                    v(x - 1.2, 3.35, 0.1),
                    v(x - 1.2, 4, 0.95),
                    0.06,
                    0.08,
                    p.edge,
                    near,
                );
                box("Shop threshold", x, 0.08, 0.28, 2.8, 0.16, 0.65, p.concrete, near);
            }
            if (col === 0)
                box(
                    "Tenement floor cornice",
                    nw / 2,
                    y + 2.2,
                    0.3,
                    nw,
                    0.28,
                    0.65,
                    p.concrete,
                    near,
                );
        }
    for (let i = 0; i <= bays; i++)
        box(
            "Tenement full-height pier",
            i * cw,
            nh / 2,
            0.12,
            0.32,
            nh,
            0.48,
            p.darkConcrete,
            near,
        );
    for (const x of [cw * 0.2, cw * 4.2])
        pipe("Tenement service riser", v(x, 0.2, 0.75), v(x, nh, 0.75), 0.1, p.steel, near);

    // Recessed workshop occupies the court between the tower and tenement;
    // it leaves the tower's front and the pedestrian route unobstructed.
    const court = frame("Recessed repair workshop", v(20.3, 0.16, -101), v(0, 0, 1));
    box("Workshop back wall", 21, 4.8, -7, 42, 9.6, 0.5, p.brick, court);
    box("Workshop roof", 21, 9.6, -3.5, 42, 0.45, 7, p.concrete, court);
    for (let i = 0; i < 7; i++) {
        opening(
            court,
            "Workshop tall door",
            3 + i * 6,
            2.6,
            3.4,
            4.8,
            6,
            5.2,
            p.brick,
            i % 3 === 0 ? glazing.warm[1] : glazing.dark,
            2,
            3,
            0.55,
        );
        opening(
            court,
            "Workshop upper transom",
            3 + i * 6,
            7.4,
            3,
            1.25,
            6,
            4.4,
            p.brick,
            i % 2 === 0 ? glazing.warm[1] : glazing.dark,
            4,
            1,
            0.4,
        );
        if (i % 2 === 0)
            box(
                "Workshop projecting rain hood",
                3 + i * 6,
                5.3,
                0.9,
                4.1,
                0.13,
                1.8,
                p.steel,
                court,
            );
    }
    // Individual lower street buildings with different heights, bay spacing,
    // masonry, roof profiles and light occupancy.
    const blocks = [
        { z: -151, w: 26, h: 24, c: 6, m: p.brick },
        { z: -185, w: 32, h: 19, c: 7, m: p.blueBrick },
        { z: -224, w: 35, h: 22, c: 8, m: p.darkConcrete },
        { z: -269, w: 40, h: 16, c: 8, m: p.brick },
    ];
    blocks.forEach((block, index) => {
        const g = frame("Eastern block " + index, v(17.3 + index * 0.2, 0.16, block.z), v(0, 0, 1));
        box("Block rear volume", block.w / 2, block.h / 2, -8, block.w, block.h, 1, block.m, g);
        for (const x of [0, block.w])
            box("Block end return", x, block.h / 2, -4, 0.6, block.h, 8, block.m, g);
        box("Block roof and parapet", block.w / 2, block.h, -4, block.w, 0.6, 8, block.m, g);
        const bw = block.w / block.c,
            floors = Math.floor(block.h / 3.8),
            fh = block.h / floors;
        for (let row = 0; row < floors; row++)
            for (let col = 0; col < block.c; col++)
                opening(
                    g,
                    "Street block window",
                    (col + 0.5) * bw,
                    (row + 0.5) * fh,
                    bw * 0.52,
                    2.25,
                    bw,
                    fh,
                    block.m,
                    (col * 7 + row * 3 + index) % 5 < 2
                        ? glazing.warm[(col + index) % 3]
                        : glazing.dark,
                    2,
                    2,
                    0.4,
                );
        for (let col = 0; col < block.c; col += 2)
            box("Ground-floor awning", (col + 0.5) * bw, 3.5, 0.7, bw * 0.9, 0.12, 1.5, p.steel, g);
    });
    kit.finish();
    return { dispose: kit.dispose };
}
