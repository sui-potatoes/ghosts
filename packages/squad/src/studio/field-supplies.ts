// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { GearGeometry, gearFinish } from "./gear-geometry.ts";

/** Inventory props use the same small material budget as the held weapons. */
export function createFieldSupply(kind: "grenade" | "medkit") {
    const g = new GearGeometry();
    const shell = gearFinish(
        "Field supply / olive shell",
        0x56604b,
        0.16,
        0.74,
        0.08,
    );
    const fabric = gearFinish(
        "Field supply / woven webbing",
        0x303c3b,
        0,
        0.94,
        0.14,
    );
    const metal = gearFinish(
        "Field supply / hardware",
        0x79817d,
        0.7,
        0.38,
        0.02,
    );
    const marking = new T.MeshStandardMaterial({
        name: "Field supply / identification",
        color: 0xc6c5a3,
        roughness: 0.85,
    });
    if (kind === "grenade") {
        // Rounded shell, rolled seams, distinct neck, curved lever and pull ring.
        g.add(new T.CapsuleGeometry(0.036, 0.048, 5, 20), shell);
        for (const y of [-0.027, 0.027])
            g.ring([0, y, 0], 0.036, 0.0015, fabric, "y");
        g.cylinder([0, 0.065, 0], 0.018, 0.019, fabric, "y");
        g.cylinder([0, 0.075, 0], 0.019, 0.006, metal, "y");
        g.profile(
            [
                [-0.018, 0.082],
                [0.026, 0.082],
                [0.047, 0.042],
                [0.044, -0.034],
                [0.037, -0.037],
                [0.039, 0.039],
                [0.021, 0.074],
                [-0.018, 0.074],
            ],
            0.013,
            metal,
            0,
            0.001,
        );
        g.cylinder([-0.012, 0.073, 0], 0.0035, 0.032, metal, "z");
        g.ring([-0.033, 0.075, 0.017], 0.017, 0.0018, metal, "z");
        g.box([0, 0.01, 0.036], [0.025, 0.019, 0.001], fabric);
        for (let i = 0; i < 4; i++)
            g.box(
                [-0.008 + i * 0.005, 0.011, 0.037],
                [0.002, 0.01, 0.0005],
                marking,
            );
        g.ring([0, -0.01, 0], 0.0365, 0.002, marking, "y");
    } else {
        // Sewn soft case with a gusset, zip, webbing handle and quick-release straps.
        const outline = [
            [-0.145, -0.07],
            [-0.133, -0.09],
            [0.132, -0.09],
            [0.146, -0.075],
            [0.146, 0.075],
            [0.13, 0.091],
            [-0.13, 0.091],
            [-0.145, 0.074],
        ];
        g.profile(outline, 0.092, shell, 0, 0.008);
        g.profile(
            outline.map(([x, y]) => [x * 0.93, y * 0.91]),
            0.003,
            fabric,
            0.051,
            0.005,
        );
        g.profile(
            outline.map(([x, y]) => [x * 0.93, y * 0.91]),
            0.003,
            fabric,
            -0.051,
            0.005,
        );
        // Continuous piping and small stitches around the front face.
        for (const y of [-0.071, 0.071])
            for (let x = -0.118; x < 0.12; x += 0.009)
                g.box([x, y, 0.059], [0.004, 0.001, 0.001], marking);
        for (const x of [-0.128, 0.128])
            for (let y = -0.06; y < 0.065; y += 0.009)
                g.box([x, y, 0.059], [0.001, 0.004, 0.001], marking);
        for (const x of [-0.092, 0.092]) {
            g.box([x, 0, 0.061], [0.021, 0.176, 0.004], fabric);
            g.profile(
                [
                    [x - 0.014, -0.023],
                    [x + 0.014, -0.023],
                    [x + 0.014, 0.023],
                    [x - 0.014, 0.023],
                ],
                0.005,
                metal,
                0.066,
                0.002,
                [
                    [
                        [x - 0.008, -0.015],
                        [x + 0.008, -0.015],
                        [x + 0.008, 0.015],
                        [x - 0.008, 0.015],
                    ],
                ],
            );
            g.box([x, 0, 0.071], [0.023, 0.003, 0.002], fabric);
        }
        g.box([0, 0.094, 0], [0.232, 0.004, 0.004], metal);
        for (let x = -0.11; x < 0.12; x += 0.007)
            g.box([x, 0.096, 0], [0.002, 0.002, 0.009], fabric);
        g.ring([0.104, 0.104, 0], 0.009, 0.0015, metal, "z");
        g.profile(
            [
                [-0.06, 0.096],
                [-0.06, 0.131],
                [-0.044, 0.141],
                [0.044, 0.141],
                [0.06, 0.131],
                [0.06, 0.096],
                [0.049, 0.096],
                [0.049, 0.125],
                [0.04, 0.13],
                [-0.04, 0.13],
                [-0.049, 0.125],
                [-0.049, 0.096],
            ],
            0.019,
            fabric,
            0,
            0.002,
        );
        g.box([0, 0, 0.057], [0.08, 0.065, 0.004], shell);
        g.box([0, 0, 0.06], [0.051, 0.014, 0.002], marking);
        g.box([0, 0, 0.06], [0.014, 0.051, 0.002], marking);
        g.box([0.045, -0.071, 0.057], [0.029, 0.009, 0.002], marking);
    }
    return g.finish(kind === "grenade" ? "M7Fragmentation" : "FieldTraumaKit");
}
