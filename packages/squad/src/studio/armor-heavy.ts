// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import {
  BodyFit,
  DEG,
  Piece,
  V,
  crown,
  deg,
  extrude,
  fastener,
  frameAt,
  inlay,
  lerp,
  mirrorPiece,
  pair,
  placed,
  plate,
  ridge,
  sensor,
  smooth,
  sum,
  symmetric,
  tube,
  type ArmorPiece,
  type ArmorSet,
  type Sex,
  type Surface,
} from "./armor-shapes.ts";
import { balaclava } from "./armor-light.ts";
import {
  cranialShell,
  mediumAbdomen,
  mediumBack,
  mediumCuirass,
  mediumForearm,
  mediumPauldron,
  mediumShin,
  mediumThigh,
  neckSurface,
  shellEdge,
} from "./armor-medium.ts";

/** HEAVY: the juggernaut, the same sleek family grown heavy. A sealed helmet
 * with a single narrow visor and jaw guards inside a raised gorget; a thick
 * layered cuirass with a sternum overplate and flank plates; a dorsal power
 * pack on a load frame; oversized asymmetric pauldrons (the right one cut
 * back for the rifle stock); heavy vambraces, thigh plates, greaves and
 * sabatons over the boots. Joint gaps stay open so arms can rise to aim and
 * legs can stride. Axis convention: see armor-shapes.ts. */
export function buildHeavyArmor(sex: Sex): ArmorSet {
  const fit = new BodyFit(sex);
  return {
    tier: "heavy",
    sex,
    pieces: [
      balaclava(fit),
      heavyHelmet(fit),
      heavyVisor(fit),
      heavyGorget(fit),
      heavyCuirass(fit),
      ...mediumAbdomen(fit, 0.74, 0.004),
      ...mediumBack(fit),
      heavyPowerPack(fit),
      heavyPauldron(fit, 1.4, true),
      mirrorPiece(heavyPauldron(fit, 1.12, false)),
      ...pair(heavyUpperArm(fit)),
      ...pair(mediumForearm(fit, 1)),
      ...pair(mediumThigh(fit, 1)),
      ...pair(mediumShin(fit, 1)),
      ...pair(heavySabaton(fit)),
    ].map((p) => ({
      ...p,
      name: p.name.replace("Medium /", "Heavy /").replace("Light /", "Heavy /"),
    })),
  };
}

/** Sealed cranial shell with a stepped crest, jaw guards and a nape plate. */
export function heavyHelmet(fit: BodyFit): ArmorPiece {
  const head = fit.skull({ offset: 0.022, blur: 3 });
  const p = new Piece("Heavy / sealed helmet", "helmet", "Head");
  p.add("plate", cranialShell(head, shellEdge(26, -18, -56), 0.01, 0.009));
  const jaw = fit.skull({ offset: 0.026, blur: 2 });
  for (const side of [-1, 1]) {
    p.add(
      "plate",
      plate(jaw, {
        map: (a, b) => {
          const [u, v] = symmetric(
            [
              [0, -66],
              [26, -50],
            ],
            [
              [26, -50],
              [30, -14],
            ],
            [
              [0, -4],
              [30, -14],
            ],
          )(a, b);
          return [side * (u + 76) * DEG, v * DEG];
        },
        cols: 8,
        rows: 8,
        thickness: 0.008,
        facetsA: [0, 0.5, 1],
        lift: ridge(0.5, 0.5, 0.006),
      }),
    );
    const m = frameAt(jaw, side * 84 * DEG, -30 * DEG, 0.012);
    const s = sensor(0.008);
    p.add("metal", placed(s.bezel, m.clone()));
    p.add("glow", placed(s.lens, m.clone()));
  }
  return p.finish();
}

/** Sealed faceplate with one narrow visor slit. */
export function heavyVisor(fit: BodyFit): ArmorPiece {
  const p = new Piece("Heavy / sealed faceplate", "mask", "Head");
  const face = fit.skull({ offset: 0.016, blur: 1 });
  const brow = fit.skull({ offset: 0.018, blur: 1 });
  const visor = fit.skull({ offset: 0.012, blur: 1 });
  p.add(
    "plate",
    plate(face, {
      map: deg(
        symmetric(
          [
            [0, -66],
            [26, -60],
            [50, -50],
            [70, -40],
          ],
          [
            [70, -40],
            [72, -2],
          ],
          [
            [0, -1],
            [36, -3.5],
            [72, -3],
          ],
        ),
      ),
      cols: 18,
      rows: 10,
      thickness: 0.008,
      facetsA: [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1],
      lift: sum(ridge(0.5, 0.16, 0.008), crown(0.004)),
      crease: 24,
    }),
  );
  p.add(
    "plate",
    plate(brow, {
      map: deg(
        symmetric(
          [
            [0, 1.5],
            [40, 4],
            [74, 3],
          ],
          [
            [74, 3],
            [72, 22],
          ],
          [
            [0, 32],
            [40, 30],
            [72, 22],
          ],
        ),
      ),
      cols: 12,
      rows: 6,
      thickness: 0.009,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: ridge(0.5, 0.25, 0.006),
      crease: 24,
    }),
  );
  p.add(
    "glow",
    plate(visor, {
      map: (a, b) => [lerp(-66, 66, a) * DEG, lerp(-5, 6, b) * DEG],
      cols: 12,
      rows: 2,
      thickness: 0.002,
      skin: true,
    }),
  );
  // Breather grille: three metal bars low on the faceplate.
  for (const k of [0, 1, 2])
    p.add(
      "metal",
      inlay(
        face,
        (t) => [lerp(-18, 18, t) * DEG, (-44 - 5 * k) * DEG],
        0.004,
        0.0105,
        4,
      ),
    );
  return p.finish();
}

/** Raised gorget: a faceted collar ring, high at the back and sides, cut low
 * at the front for the chin. Rigid on the upper spine. */
export function heavyGorget(fit: BodyFit): ArmorPiece {
  const neck = fit.bone("Neck").y;
  const p = new Piece("Heavy / gorget", "torso", "Spine2");
  const s = neckSurface(fit, 0.07, 0.034);
  p.add(
    "plate",
    plate(s, {
      map: (a, b) => {
        const yaw = a * 2 * Math.PI,
          front = Math.max(0, Math.cos(yaw));
        return [
          yaw,
          lerp(neck - 0.075, neck + 0.075 - 0.075 * front ** 1.5, b),
        ];
      },
      cols: 24,
      rows: 5,
      ringA: true,
      thickness: 0.01,
      facetsA: Array.from({ length: 9 }, (_, k) => k / 8),
      lift: (_a, b) => 0.006 * smooth(0.7, 1, b),
    }),
  );
  return p.finish();
}

/** Thick cuirass: the medium plate widened, a sternum overplate and flank
 * plates, plus load-frame anchors. */
export function heavyCuirass(fit: BodyFit): ArmorPiece {
  const base = mediumCuirass(fit, 1.14, 0.012);
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y,
    chest = fit.bone("Spine2").y;
  const p = new Piece("Heavy / cuirass", "torso", "Spine2");
  for (const [m, g] of Object.entries(base.parts))
    p.add(m as "plate", g as T.BufferGeometry);
  const over = fit.torso({ offset: 0.056, hullY: [mid, neck] });
  p.add(
    "plate",
    plate(over, {
      map: symmetric(
        [
          [0, mid + 0.02],
          [0.2, mid + 0.05],
        ],
        [
          [0.2, mid + 0.05],
          [0.24, chest + 0.02],
          [0.16, neck - 0.11],
        ],
        [
          [0, neck - 0.1],
          [0.16, neck - 0.11],
        ],
      ),
      cols: 8,
      rows: 10,
      thickness: 0.008,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.01),
    }),
  );
  p.add(
    "glow",
    inlay(over, (t) => [0, lerp(mid + 0.06, chest, t)], 0.003, 0.0195, 6),
  );
  const flank = fit.torso({ offset: 0.026, hullY: [mid, neck] });
  for (const side of [-1, 1]) {
    p.add(
      "plate",
      plate(flank, {
        map: (a, b) => {
          const [u, v] = symmetric(
            [
              [0, mid + 0.0],
              [0.3, mid + 0.02],
            ],
            [
              [0.3, mid + 0.02],
              [0.3, chest - 0.05],
            ],
            [
              [0, chest - 0.03],
              [0.3, chest - 0.05],
            ],
          )(a, b);
          return [side * (1.5 + u), v];
        },
        cols: 8,
        rows: 6,
        thickness: 0.008,
        facetsA: [0, 0.5, 1],
        lift: ridge(0.5, 0.5, 0.005),
      }),
    );
    for (const dy of [0.0, 0.05])
      p.add(
        "metal",
        placed(
          fastener(0.004),
          frameAt(flank, side * 1.5, chest - 0.08 + dy, 0.01),
        ),
      );
  }
  return p.finish();
}

/** Dorsal power pack on a load frame: two rails over the shoulder blades, a
 * chamfered housing with heat-sink fins and lit vents, and cables that run
 * forward over the shoulders to the pauldrons. */
export function heavyPowerPack(fit: BodyFit): ArmorPiece {
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y,
    chest = fit.bone("Spine2").y;
  const p = new Piece("Heavy / power pack", "back", "Spine2");
  const back = fit.torso({ offset: 0.03, hullY: [mid, neck] });
  // Load-frame rails on the back plate.
  for (const side of [-1, 1]) {
    const pts = [mid + 0.01, chest, neck - 0.08, neck - 0.03].map((y, k) =>
      back.at(Math.PI - side * (0.5 - 0.06 * k), y),
    );
    p.add("metal", tube(pts, 0.007, 6));
  }
  // Housing: a chamfered hexagonal section, standing off the back plate.
  const centre = back.at(Math.PI, lerp(mid, neck, 0.48));
  const w = fit.sex === "male" ? 0.11 : 0.1,
    h = (neck - mid) * 0.36;
  const body = extrude(
    [
      [-w, -h],
      [w, -h],
      [w * 1.1, -h * 0.2],
      [w * 0.85, h],
      [-w * 0.85, h],
      [-w * 1.1, -h * 0.2],
    ],
    0.07,
    0.012,
    0.004,
  );
  // Housing frame follows the slope of the back: z out of the back plate.
  const m = frameAt(back, Math.PI, lerp(mid, neck, 0.48), 0.035);
  p.add("plate", placed(body, m.clone()));
  // Heat-sink fins on the outer face and lit vents between them.
  for (let k = 0; k < 5; k++) {
    const x = lerp(-w * 0.6, w * 0.6, k / 4);
    const fin = extrude(
      [
        [-0.004, -h * 0.7],
        [0.004, -h * 0.7],
        [0.004, h * 0.6],
        [-0.004, h * 0.6],
      ],
      0.016,
      0.002,
    );
    fin.rotateY(Math.PI / 2).translate(x, 0, 0.04);
    p.add("metal", placed(fin, m.clone()));
    if (k < 4) {
      const vent = extrude(
        [
          [-0.003, -h * 0.5],
          [0.003, -h * 0.5],
          [0.003, h * 0.4],
          [-0.003, h * 0.4],
        ],
        0.004,
        0.001,
      ).translate(x + (w * 1.2) / 8, 0, 0.034);
      p.add("glow", placed(vent, m.clone()));
    }
  }
  // Cables from the pack over each shoulder.
  for (const side of [-1, 1]) {
    const a = centre.clone().add(V(side * w * 0.9, h * 0.7, -0.03));
    const sh = fit.bone(side > 0 ? "LeftArm" : "RightArm");
    const pts = [
      a,
      a.clone().add(V(side * 0.03, 0.05, 0.0)),
      V(sh.x * 0.75, neck - 0.0, sh.z - 0.05),
      V(sh.x * 0.82, neck - 0.03, sh.z - 0.0),
    ];
    p.add("suit", tube(pts, 0.0065, 5));
  }
  for (const side of [-1, 1])
    for (const dy of [-h * 0.6, h * 0.6])
      p.add(
        "metal",
        placed(
          fastener(0.0045).translate(side * w * 0.8, dy, 0.037),
          m.clone(),
        ),
      );
  return p.finish();
}

/** Oversized pauldron: the medium pauldron scaled up and stood off further
 * (most on the left, shield side) with an extra lower lame. */
export function heavyPauldron(
  fit: BodyFit,
  size: number,
  shield: boolean,
): ArmorPiece {
  const base = mediumPauldron(fit, size, shield ? 0.03 : 0.018);
  const p = new Piece("Heavy / left pauldron", "shoulders", "LeftArm");
  for (const [m, g] of Object.entries(base.parts))
    p.add(m as "plate", g as T.BufferGeometry);
  const lower = fit.deltoid({
    offset: 0.016 * size + (shield ? 0.022 : 0.012),
    blur: 3,
  });
  p.add(
    "plate",
    plate(lower, {
      map: deg(
        symmetric(
          [
            [0, -56 * size],
            [24 * size, -46 * size],
            [40 * size, -38 * size],
          ],
          [
            [40 * size, -38 * size],
            [44 * size, -26 * size],
          ],
          [
            [0, -30 * size],
            [44 * size, -26 * size],
          ],
        ),
        90,
      ),
      cols: 8,
      rows: 4,
      thickness: 0.007,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.005),
    }),
  );
  return p.finish();
}

/** Upper arm front and rear shells. */
export function heavyUpperArm(fit: BodyFit): ArmorPiece {
  const s = fit.limb("upperArm", { offset: 0.016, blur: 2 });
  const p = new Piece("Heavy / left upper arm shells", "arms", "LeftArm");
  for (const centre of [55, 145])
    p.add(
      "plate",
      plate(s, {
        map: deg(
          symmetric(
            [
              [0, 0.84],
              [40, 0.8],
            ],
            [
              [40, 0.8],
              [44, 0.34],
            ],
            [
              [0, 0.3],
              [44, 0.34],
            ],
          ),
          centre,
          false,
        ),
        cols: 8,
        rows: 8,
        thickness: 0.008,
        facetsA: [0, 0.5, 1],
        lift: ridge(0.5, 0.5, 0.006),
      }),
    );
  return p.finish();
}

/** Sabaton over the boot: instep plate, toe cap and a heel guard. */
export function heavySabaton(fit: BodyFit): ArmorPiece {
  const foot = fit.bone("LeftFoot"),
    toe = fit.bone("LeftToeBase");
  const male = fit.sex === "male";
  const half = male ? 0.058 : 0.054;
  // Ellipse over the boot: φ across (−90° inner, 0 top, 90° outer), s from
  // the ankle front to the toe.
  const z0 = foot.z + 0.05,
    z1 = toe.z + 0.075;
  // Past s = 0.7 the section rolls down round the toe (ψ to 80°), closing
  // the front of the cap instead of leaving an open sleeve.
  const zt = lerp(z0, z1, 0.7);
  const boot: Surface = {
    at: (phi, s) => {
      const psi = smooth(0.7, 1, s) * 80 * DEG;
      const h = lerp(0.11, 0.052, smooth(0, 0.7, s)) - 0.012 + 0.014;
      const w = half * (1 - 0.18 * smooth(0.6, 1, s)) + 0.012;
      const reach = z1 - zt;
      const z = s < 0.7 ? lerp(z0, z1, s) : zt + Math.sin(psi) * reach;
      const k = Math.cos(psi);
      return V(
        foot.x + Math.sin(phi) * w * (0.6 + 0.4 * k),
        0.012 + Math.cos(phi) * h * k,
        z,
      );
    },
    out: (phi, s) => {
      const psi = smooth(0.7, 1, s) * 80 * DEG;
      return V(
        Math.sin(phi) * Math.cos(psi),
        Math.cos(phi) * Math.cos(psi),
        Math.sin(psi) + 0.3,
      );
    },
  };
  const p = new Piece("Heavy / left sabaton", "legs", "LeftFoot");
  p.add(
    "plate",
    plate(boot, {
      map: deg(
        symmetric(
          [
            [0, 0.0],
            [70, 0.08],
          ],
          [
            [70, 0.08],
            [72, 0.58],
          ],
          [
            [0, 0.6],
            [72, 0.58],
          ],
        ),
        0,
        false,
      ),
      cols: 8,
      rows: 8,
      thickness: 0.007,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: ridge(0.5, 0.25, 0.006),
    }),
  );
  p.add(
    "plate",
    plate(boot, {
      map: (a, b) => [lerp(-80, 80, a) * DEG, lerp(0.62, 1.0, b)],
      cols: 8,
      rows: 4,
      thickness: 0.008,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
    }),
  );
  return p.finish();
}
