// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

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
  pair,
  placed,
  plate,
  ribbon,
  ridge,
  sensor,
  smooth,
  sum,
  symmetric,
  type ArmorPiece,
  type ArmorSet,
  type Sex,
  type Surface,
} from "./armor-shapes.ts";
import { balaclava } from "./armor-light.ts";

/** MEDIUM: the assassin look with real protection, the standard operator.
 * An angular cranial shell and a full faceplate with chevron eye slits and a
 * sensor cluster; a faceted cuirass with layered pectoral plates, three
 * abdominal lames and a back plate; angular two-lame pauldrons; upper-arm,
 * elbow and forearm plates; layered thigh plates, knee caps and greaves.
 * The suit shows at every joint. Axis convention: see armor-shapes.ts. */
export function buildMediumArmor(sex: Sex): ArmorSet {
  const fit = new BodyFit(sex);
  return {
    tier: "medium",
    sex,
    pieces: [
      balaclava(fit),
      mediumHelmet(fit),
      mediumFaceplate(fit),
      mediumCollar(fit),
      mediumCuirass(fit),
      ...mediumAbdomen(fit),
      ...mediumBack(fit),
      ...pair(mediumPauldron(fit)),
      ...pair(mediumUpperArm(fit)),
      ...pair(mediumForearm(fit)),
      ...pair(mediumThigh(fit)),
      ...pair(mediumShin(fit)),
    ],
  };
}

/** Lower edge of a cranial shell by yaw: brow line at the front, above the
 * ear at the side, down the nape at the back (degrees). */
export function shellEdge(front: number, side: number, back: number) {
  return (yaw: number) => {
    const c = Math.cos(yaw);
    return c > 0 ? lerp(side, front, c ** 1.6) : lerp(side, back, (-c) ** 0.9);
  };
}

/** Faceted cranial shell: twelve planar facets round a sagittal crest. */
export function cranialShell(
  head: Surface,
  edge: (yaw: number) => number,
  crest: number,
  thickness: number,
) {
  return plate(head, {
    map: (a, b) => {
      const yaw = a * 2 * Math.PI;
      return [yaw, lerp(edge(yaw) * DEG, 90 * DEG, b)];
    },
    cols: 24,
    rows: 10,
    ringA: true,
    thickness,
    facetsA: Array.from({ length: 13 }, (_, k) => k / 12),
    lift: (a, b) =>
      crest *
      Math.max(0, 1 - Math.abs(Math.sin(a * 2 * Math.PI)) / 0.16) *
      smooth(0.15, 0.55, b),
    crease: 22,
  });
}

/** Cranial shell with ear sensor pods. */
export function mediumHelmet(fit: BodyFit): ArmorPiece {
  const head = fit.skull({ offset: 0.017, blur: 3 });
  const p = new Piece("Medium / cranial shell", "helmet", "Head");
  p.add("plate", cranialShell(head, shellEdge(24, -12, -48), 0.007, 0.006));
  for (const side of [-1, 1]) {
    // Ear pod: hex housing, lens ring and a short antenna stub.
    const m = frameAt(head, side * 90 * DEG, -22 * DEG, 0.004);
    const hex = Array.from({ length: 6 }, (_, k) => [
      Math.cos((k * Math.PI) / 3) * 0.024,
      Math.sin((k * Math.PI) / 3) * 0.024,
    ]);
    p.add(
      "plate",
      placed(extrude(hex, 0.014, 0.004).translate(0, 0, 0.006), m.clone()),
    );
    const s = sensor(0.011);
    p.add("metal", placed(s.bezel.translate(0, 0, 0.013), m.clone()));
    p.add("glow", placed(s.lens.translate(0, 0, 0.013), m.clone()));
  }
  p.add(
    "glow",
    inlay(
      head,
      (t) => [Math.PI + lerp(-0.5, 0.5, t), -20 * DEG],
      0.003,
      0.0075,
      8,
    ),
  );
  return p.finish();
}

/** Full faceplate: brow and jaw plates leave two chevron eye slits over a lit
 * visor; a three-lens sensor cluster on the left cheek; chin vents. */
export function mediumFaceplate(fit: BodyFit, slit = 1): ArmorPiece {
  const p = new Piece("Medium / faceplate", "mask", "Head");
  const face = fit.skull({ offset: 0.011, blur: 1 });
  const brow = fit.skull({ offset: 0.014, blur: 1 });
  const visor = fit.skull({ offset: 0.006, blur: 1 });
  const open = (y: number) => y * slit;
  p.add(
    "plate",
    plate(face, {
      map: deg(
        symmetric(
          [
            [0, -64],
            [28, -60],
            [54, -46],
            [78, -26],
          ],
          [
            [78, -26],
            [80, 0],
          ],
          [
            [0, 5],
            [10, open(1)],
            [30, open(-1)],
            [52, open(1)],
            [80, 0],
          ],
        ),
      ),
      cols: 24,
      rows: 10,
      thickness: 0.006,
      facetsA: [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1],
      lift: sum(ridge(0.5, 0.16, 0.007), crown(0.003)),
      crease: 24,
    }),
  );
  p.add(
    "plate",
    plate(brow, {
      map: deg(
        symmetric(
          [
            [0, 7],
            [10, 6 + open(5)],
            [30, 6 + open(7)],
            [52, 6 + open(4)],
            [78, 6],
          ],
          [
            [78, 6],
            [74, 20],
          ],
          [
            [0, 30],
            [36, 28],
            [74, 20],
          ],
        ),
      ),
      cols: 16,
      rows: 6,
      thickness: 0.006,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: ridge(0.5, 0.25, 0.005),
      crease: 24,
    }),
  );
  p.add(
    "glow",
    plate(visor, {
      map: (a, b) => [lerp(-56, 56, a) * DEG, lerp(-3, 16, b) * DEG],
      cols: 12,
      rows: 2,
      thickness: 0.002,
      skin: true,
    }),
  );
  // Sensor cluster: a hex plate with three lenses, left cheek.
  const m = frameAt(face, 54 * DEG, -14 * DEG, 0.008);
  p.add(
    "plate",
    placed(
      extrude(
        [
          [-0.018, -0.02],
          [0.016, -0.02],
          [0.024, 0.0],
          [0.012, 0.022],
          [-0.02, 0.018],
        ],
        0.012,
        0.003,
      ).translate(0, 0, 0.004),
      m.clone(),
    ),
  );
  for (const [x, y, r] of [
    [-0.006, 0.006, 0.0065],
    [0.01, 0.008, 0.0045],
    [0.004, -0.009, 0.0045],
  ]) {
    const s = sensor(r);
    p.add("metal", placed(s.bezel.translate(x, y, 0.01), m.clone()));
    p.add("glow", placed(s.lens.translate(x, y, 0.01), m.clone()));
  }
  for (const side of [-1, 1])
    for (const k of [0, 1, 2])
      p.add(
        "metal",
        inlay(
          face,
          (t) => [
            side * (16 + 7 * k) * DEG,
            lerp(-50 + 2 * k, -36 + 2 * k, t) * DEG,
          ],
          0.003,
          0.009,
          3,
        ),
      );
  return p.finish();
}

/** A soft stand-up collar at the neck base, between cuirass and helmet. */
export function neckSurface(
  fit: BodyFit,
  flare: number,
  offset: number,
): Surface {
  const neck = fit.bone("Neck"),
    head = fit.bone("Head"),
    r = fit.sex === "male" ? 0.062 : 0.054;
  const at = (a: number, y: number) => {
    const f = smooth(neck.y + 0.03, neck.y - 0.05, y);
    const rx = r * 1.06 + offset + flare * f * 1.4,
      rz = r + offset + flare * f;
    const z = lerp(neck.z, head.z, smooth(neck.y, head.y, y)) - 0.004;
    return V(Math.sin(a) * rx, y, z + Math.cos(a) * rz);
  };
  return { at, out: (a) => V(Math.sin(a), 0, Math.cos(a)) };
}

export function mediumCollar(fit: BodyFit): ArmorPiece {
  const neck = fit.bone("Neck").y;
  const p = new Piece("Medium / collar", "torso", "Spine2");
  const s = neckSurface(fit, 0.03, 0.006);
  p.add(
    "suit",
    plate(s, {
      map: (a, b) => [
        a * 2 * Math.PI,
        lerp(neck - 0.05, neck + 0.035 - 0.012 * Math.cos(a * 2 * Math.PI), b),
      ],
      cols: 24,
      rows: 4,
      ringA: true,
      thickness: 0.006,
      facetsA: Array.from({ length: 9 }, (_, k) => k / 8),
    }),
  );
  return p.finish();
}

/** Front cuirass: a four-facet chest plate with a keel and two layered
 * pectoral plates edged in light; side straps to the back plate. */
export function mediumCuirass(fit: BodyFit, scale = 1, bulk = 0): ArmorPiece {
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y,
    chest = fit.bone("Spine2").y;
  const p = new Piece("Medium / cuirass", "torso", "Spine2");
  const base = fit.torso({ offset: 0.016 + bulk, hullY: [mid, neck] });
  const pec = fit.torso({ offset: 0.03 + bulk * 1.4, hullY: [mid, neck] });
  const top = neck - 0.065,
    y0 = mid + 0.035;
  const w = 1.0 * scale;
  p.add(
    "plate",
    plate(base, {
      map: symmetric(
        [
          [0, y0 - 0.02],
          [0.5 * w, y0],
          [w, y0 + 0.02],
        ],
        [
          [w, y0 + 0.02],
          [1.06 * w, lerp(y0, top, 0.6)],
          [0.86 * w, top + 0.004],
        ],
        [
          [0, top - 0.04],
          [0.22, top - 0.008],
          [0.86 * w, top + 0.004],
        ],
      ),
      cols: 20,
      rows: 12,
      thickness: 0.007,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: sum(ridge(0.5, 0.25, 0.01), crown(0.006)),
    }),
  );
  for (const side of [-1, 1]) {
    // Upper-chest plates over the collarbone line, above the bust on either
    // body, so they never read as cups.
    const lo = chest + 0.012;
    const outline = symmetric(
      [
        [0, lo - 0.022],
        [0.2, lo - 0.01],
        [0.32, lo + 0.004],
      ],
      [
        [0.32, lo + 0.004],
        [0.33, top - 0.012],
      ],
      [
        [0, top - 0.02],
        [0.33, top - 0.012],
      ],
    );
    p.add(
      "plate",
      plate(pec, {
        map: (a, b) => {
          const [u, v] = outline(a, b);
          return [side * (0.47 * scale + u * 1.05), v];
        },
        cols: 8,
        rows: 6,
        thickness: 0.006,
        facetsA: [0, 0.5, 1],
        lift: sum(ridge(0.5, 0.5, 0.006), crown(0.003)),
      }),
    );
    p.add(
      "glow",
      inlay(
        pec,
        (t) => [
          side * (0.47 * scale + lerp(-0.3, 0.3, t)),
          lo - 0.016 + 0.024 * Math.abs(t - 0.5) * 2 + 0.006,
        ],
        0.003,
        0.0105,
        6,
      ),
    );
    // Side strap and buckle under the arm to the back plate.
    const band = [w - 0.04, 1.4, 1.75, 2.15].map((a) =>
      base.at(side * a, lerp(y0, chest, 0.5)),
    );
    const centre = V(0, chest, fit.torso({ offset: 0 }).at(0, chest).z - 0.09);
    p.add(
      "suit",
      ribbon(band, 0.035, 0.004, (q) => q.clone().sub(centre).setY(0)),
    );
    p.add(
      "metal",
      placed(
        extrude(
          [
            [-0.013, -0.018],
            [0.013, -0.018],
            [0.013, 0.018],
            [-0.013, 0.018],
          ],
          0.006,
          0.004,
        ),
        frameAt(base, side * 1.55, lerp(y0, chest, 0.5), 0.004),
      ),
    );
    for (const dy of [0.03, 0.09])
      p.add(
        "metal",
        placed(fastener(), frameAt(base, side * 0.85 * w, y0 + dy, 0.009)),
      );
  }
  return p.finish();
}

/** Three overlapping abdominal lames, each rigid on the spine bone it rides. */
export function mediumAbdomen(
  fit: BodyFit,
  width = 0.62,
  extraThick = 0,
): ArmorPiece[] {
  const mid = fit.bone("Spine1").y,
    low = fit.bone("Spine").y;
  const out: ArmorPiece[] = [];
  const rows = [
    { y: mid + 0.012, bone: "Spine1" },
    { y: lerp(low, mid, 0.5) + 0.004, bone: "Spine1" },
    { y: low + 0.0, bone: "Spine" },
  ];
  rows.forEach(({ y, bone }, k) => {
    const s = fit.torso({
      offset: 0.022 - 0.003 * k,
      hullY: [low - 0.05, mid + 0.05],
    });
    const p = new Piece(`Medium / abdominal lame ${k + 1}`, "torso", bone);
    const w = width * (1 - 0.06 * k);
    p.add(
      "plate",
      plate(s, {
        map: symmetric(
          [
            [0, y - 0.034],
            [w * 0.6, y - 0.018],
            [w, y - 0.004],
          ],
          [
            [w, y - 0.004],
            [w * 0.9, y + 0.026],
          ],
          [
            [0, y + 0.012],
            [w * 0.5, y + 0.02],
            [w * 0.9, y + 0.026],
          ],
        ),
        cols: 12,
        rows: 4,
        thickness: 0.005 + extraThick,
        facetsA: [0, 0.25, 0.5, 0.75, 1],
        lift: ridge(0.5, 0.25, 0.006),
      }),
    );
    out.push(p.finish());
  });
  return out;
}

/** Back plate: a faceted scapular shell with a lit spine channel over two
 * lower lames (the lower one rides Spine1 so the back can flex). */
export function mediumBack(fit: BodyFit): ArmorPiece[] {
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y,
    chest = fit.bone("Spine2").y;
  const top = neck - 0.055;
  const upper = new Piece("Medium / back plate", "back", "Spine2");
  const s = fit.torso({ offset: 0.016, hullY: [mid, neck] });
  const split = chest - 0.03;
  upper.add(
    "plate",
    plate(s, {
      map: (a, b) => {
        const [u, v] = symmetric(
          [
            [0, split - 0.03],
            [0.45, split - 0.01],
            [0.95, split + 0.02],
          ],
          [
            [0.95, split + 0.02],
            [1.02, lerp(split, top, 0.5)],
            [0.8, top],
          ],
          [
            [0, top - 0.02],
            [0.3, top],
            [0.8, top],
          ],
        )(a, b);
        return [Math.PI + u, v];
      },
      cols: 16,
      rows: 8,
      thickness: 0.007,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: sum(
        crown(0.005),
        (a) => -0.004 * Math.max(0, 1 - Math.abs(a - 0.5) / 0.04),
      ),
    }),
  );
  upper.add(
    "glow",
    inlay(
      s,
      (t) => [Math.PI, lerp(split + 0.0, top - 0.03, t)],
      0.003,
      0.0115,
      6,
    ),
  );
  const pieces = [upper.finish()];
  [
    {
      y0: lerp(mid, split, 0.5) - 0.004,
      y1: split + 0.004,
      bone: "Spine2",
      w: 0.8,
    },
    {
      y0: mid - 0.005,
      y1: lerp(mid, split, 0.5) + 0.008,
      bone: "Spine1",
      w: 0.7,
    },
  ].forEach(({ y0, y1, bone, w }, k) => {
    const o = fit.torso({
      offset: 0.019 - 0.003 * k,
      hullY: [mid - 0.05, neck],
    });
    const p = new Piece(`Medium / back lame ${k + 1}`, "back", bone);
    p.add(
      "plate",
      plate(o, {
        map: (a, b) => {
          const [u, v] = symmetric(
            [
              [0, y0 - 0.02],
              [w, y0],
            ],
            [
              [w, y0],
              [w * 1.04, y1],
            ],
            [
              [0, y1 - 0.012],
              [w * 1.04, y1],
            ],
          )(a, b);
          return [Math.PI + u, v];
        },
        cols: 12,
        rows: 4,
        thickness: 0.006,
        facetsA: [0, 0.25, 0.5, 0.75, 1],
        lift: ridge(0.5, 0.25, 0.005),
      }),
    );
    pieces.push(p.finish());
  });
  return pieces;
}

/** Angular pauldron: a faceted chevron cap over one lame. */
export function mediumPauldron(
  fit: BodyFit,
  size = 1,
  standoff = 0,
): ArmorPiece {
  const p = new Piece("Medium / left pauldron", "shoulders", "LeftArm");
  const cap = fit.deltoid({ offset: 0.026 * size + standoff, blur: 3 });
  const lame = fit.deltoid({ offset: 0.02 * size + standoff * 0.8, blur: 3 });
  const k = size;
  p.add(
    "plate",
    plate(cap, {
      map: deg(
        symmetric(
          [
            [0, -28 * k],
            [30 * k, -14 * k],
            [56 * k, -4],
          ],
          [
            [56 * k, -4],
            [60 * k, 24],
            [46 * k, 56],
          ],
          [
            [0, 66],
            [24 * k, 63],
            [46 * k, 56],
          ],
        ),
        90,
      ),
      cols: 12,
      rows: 10,
      thickness: 0.007,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: sum(ridge(0.5, 0.25, 0.008), crown(0.006)),
    }),
  );
  p.add(
    "plate",
    plate(lame, {
      map: deg(
        symmetric(
          [
            [0, -42 * k],
            [28 * k, -30 * k],
            [46 * k, -22 * k],
          ],
          [
            [46 * k, -22 * k],
            [50 * k, -8 * k],
          ],
          [
            [0, -12 * k],
            [50 * k, -8 * k],
          ],
        ),
        90,
      ),
      cols: 8,
      rows: 4,
      thickness: 0.006,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.005),
    }),
  );
  p.add(
    "glow",
    inlay(
      cap,
      (t) => [lerp(64, 116, t) * DEG, (-4 - 10 * Math.sin(Math.PI * t)) * DEG],
      0.003,
      0.012,
      8,
    ),
  );
  return p.finish();
}

/** Outer upper-arm plate under the pauldron. */
export function mediumUpperArm(fit: BodyFit): ArmorPiece {
  const s = fit.limb("upperArm", { offset: 0.013, blur: 2 });
  const p = new Piece("Medium / left upper arm plate", "arms", "LeftArm");
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
            [46, 0.36],
          ],
          [
            [0, 0.32],
            [46, 0.36],
          ],
        ),
        90,
        false,
      ),
      cols: 8,
      rows: 8,
      thickness: 0.006,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.006),
    }),
  );
  return p.finish();
}

/** Elbow cap and a two-layer forearm vambrace. */
export function mediumForearm(fit: BodyFit, heavy = 0): ArmorPiece {
  const p = new Piece("Medium / left vambrace", "arms", "LeftForeArm");
  const s = fit.limb("forearm", { offset: 0.012 + heavy * 0.006, blur: 2 });
  const top = fit.limb("forearm", { offset: 0.02 + heavy * 0.008, blur: 2 });
  const elbow = fit.limb("forearm", { offset: 0.022, blur: 2 });
  p.add(
    "plate",
    plate(s, {
      map: deg(
        symmetric(
          [
            [0, 0.2],
            [50, 0.24],
            [70 + 20 * heavy, 0.3],
          ],
          [
            [70 + 20 * heavy, 0.3],
            [64 + 20 * heavy, 0.84],
          ],
          [
            [0, 0.88],
            [64 + 20 * heavy, 0.84],
          ],
        ),
        90,
        false,
      ),
      cols: 12,
      rows: 10,
      thickness: 0.006,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
    }),
  );
  p.add(
    "plate",
    plate(top, {
      map: deg(
        symmetric(
          [
            [0, 0.3],
            [26, 0.36],
          ],
          [
            [26, 0.36],
            [24, 0.74],
          ],
          [
            [0, 0.78],
            [24, 0.74],
          ],
        ),
        90,
        false,
      ),
      cols: 8,
      rows: 6,
      thickness: 0.005,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.005),
    }),
  );
  p.add(
    "glow",
    inlay(top, (t) => [(90 + 20) * DEG, lerp(0.4, 0.7, t)], 0.0025, 0.0075, 5),
  );
  p.add(
    "plate",
    plate(elbow, {
      map: deg(
        symmetric(
          [
            [0, 0.12],
            [36, 0.06],
          ],
          [
            [36, 0.06],
            [34, -0.06],
          ],
          [
            [0, -0.12],
            [34, -0.06],
          ],
        ),
        180,
        false,
      ),
      cols: 8,
      rows: 6,
      thickness: 0.006,
      facetsA: [0, 0.5, 1],
      lift: sum(ridge(0.5, 0.5, 0.008), crown(0.004)),
    }),
  );
  return p.finish();
}

/** Layered thigh plates over the front and outer thigh. */
export function mediumThigh(fit: BodyFit, heavy = 0): ArmorPiece {
  const p = new Piece("Medium / left thigh plates", "legs", "LeftUpLeg");
  const lames = [
    { t0: 0.12, t1: 0.46, off: 0.02 },
    { t0: 0.4, t1: 0.74, off: 0.016 },
  ];
  for (const l of lames) {
    const s = fit.limb("thigh", { offset: l.off + heavy * 0.004, blur: 2 });
    p.add(
      "plate",
      plate(s, {
        map: deg(
          symmetric(
            [
              [0, l.t0 - 0.02],
              [46 + 15 * heavy, l.t0 + 0.03],
            ],
            [
              [46 + 15 * heavy, l.t0 + 0.03],
              [40 + 15 * heavy, l.t1],
            ],
            [
              [0, l.t1 + 0.03],
              [24, l.t1 + 0.012],
              [40 + 15 * heavy, l.t1],
            ],
          ),
          40,
          false,
        ),
        cols: 12,
        rows: 6,
        thickness: 0.006 + heavy * 0.003,
        facetsA: [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1],
        lift: ridge(0.5, 0.25, 0.006),
      }),
    );
  }
  const s = fit.limb("thigh", { offset: 0.03, blur: 2 });
  p.add(
    "glow",
    inlay(s, (t) => [40 * DEG, lerp(0.18, 0.38, t)], 0.003, 0.0025, 5),
  );
  return p.finish();
}

/** Knee cap, greave and calf plate. */
export function mediumShin(fit: BodyFit, heavy = 0): ArmorPiece {
  const p = new Piece("Medium / left greave", "legs", "LeftLeg");
  const guard = fit.limb("shin", {
    offset: 0.015 + heavy * 0.008,
    blur: 2,
    extra: (_phi, t) => (0.012 + heavy * 0.012) * smooth(0.45, 0.62, t),
  });
  const knee = fit.limb("shin", { offset: 0.026 + heavy * 0.01, blur: 2 });
  const w = 56 + 24 * heavy;
  p.add(
    "plate",
    plate(guard, {
      map: deg(
        symmetric(
          [
            [0, 0.66],
            [w * 0.6, 0.6],
            [w * 0.8, 0.56],
          ],
          [
            [w * 0.8, 0.56],
            [w, 0.3],
            [w * 0.9, 0.12],
          ],
          [
            [0, 0.1],
            [w * 0.5, 0.11],
            [w * 0.9, 0.12],
          ],
        ),
        0,
        false,
      ),
      cols: 12,
      rows: 10,
      thickness: 0.007,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: ridge(0.5, 0.25, 0.01),
    }),
  );
  p.add(
    "plate",
    plate(knee, {
      map: deg(
        symmetric(
          [
            [0, 0.1],
            [40 + 10 * heavy, 0.05],
          ],
          [
            [40 + 10 * heavy, 0.05],
            [36 + 10 * heavy, -0.07],
          ],
          [
            [0, -0.13 - 0.04 * heavy],
            [36 + 10 * heavy, -0.07],
          ],
        ),
        0,
        false,
      ),
      cols: 8,
      rows: 6,
      thickness: 0.007,
      facetsA: [0, 0.5, 1],
      lift: sum(ridge(0.5, 0.5, 0.009), crown(0.005)),
    }),
  );
  const calf = fit.limb("shin", { offset: 0.012, blur: 2 });
  p.add(
    "plate",
    plate(calf, {
      map: (a, b) => [lerp(140, 220, a) * DEG, lerp(0.42, 0.18, b)],
      cols: 8,
      rows: 6,
      thickness: 0.005,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.004),
    }),
  );
  p.add(
    "glow",
    inlay(guard, (t) => [0, lerp(0.18, 0.5, t)], 0.003, 0.018, 6),
  );
  return p.finish();
}
