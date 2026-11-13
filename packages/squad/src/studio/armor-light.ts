// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import {
  BodyFit,
  DEG,
  Piece,
  V,
  crown,
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
  deg,
  overShoulder,
  wraps,
  sum,
  symmetric,
  type ArmorPiece,
  type ArmorSet,
  type Sex,
} from "./armor-shapes.ts";

/** LIGHT: the cyber-assassin kit, an agility choice. A soft hood and a faceted
 * respirator half-mask, a slim chevron sternum plate on a strap harness, a
 * segmented spine plate, small chevron shoulder caps, bound forearms and
 * shins under slim faceted guards, and a waist sash. Most of the body is the
 * suit; joints stay open and nothing crosses a joint.
 * Axis convention and piece rules: see armor-shapes.ts. */
export function buildLightArmor(sex: Sex): ArmorSet {
  const fit = new BodyFit(sex);
  return {
    tier: "light",
    sex,
    pieces: [
      lightHood(fit),
      lightMask(fit),
      lightChest(fit),
      lightBack(fit),
      lightSash(fit),
      ...pair(lightShoulder(fit)),
      ...pair(lightForearm(fit)),
      ...pair(lightShin(fit)),
    ],
  };
}

/** Close-fitting suit balaclava worn under the medium and heavy helmets. */
export const balaclava = (fit: BodyFit) => lightHood(fit, true);

/** Soft hood: loose over the crown, drawn in at the jaw, long at the nape.
 * `tight` gives the balaclava: skin-close, for wear under a helmet. */
export function lightHood(fit: BodyFit, tight = false): ArmorPiece {
  const loose = tight ? 0 : 1;
  const head = fit.skull({
    offset: tight ? 0.005 : 0.017,
    blur: 3,
    // Fuller at the back and crown, like cloth over a skull rather than a cap.
    extra: (yaw, pitch) =>
      loose *
      (0.012 *
        smooth(0.2, -1, Math.cos(yaw)) *
        smooth(-60 * DEG, 10 * DEG, pitch) +
        0.006 * smooth(20 * DEG, 80 * DEG, pitch)),
  });
  const p = new Piece(
    tight ? "Suit / balaclava" : "Light / hood",
    "helmet",
    "Head",
  );
  const half = (pitch: number) =>
    lerp(66, 50, smooth(-50, 10, pitch)) * (1 - smooth(14, 30, pitch));
  const low = -74;
  p.add(
    "suit",
    plate(head, {
      map: (a, b) => {
        const pitch = lerp(low, 90, b);
        const h = half(pitch);
        return [lerp(h, 360 - h, a) * DEG, pitch * DEG];
      },
      cols: tight ? 20 : 26,
      rows: tight ? 9 : 12,
      thickness: 0.004,
      roll: 0.05,
      // A seamed centre fold over the crown.
      lift: (a, b) => ridge(0.5, 0.06, 0.004)(a) * smooth(0.45, 0.8, b),
      crease: 40,
    }),
  );
  return p.finish();
}

/** Respirator half-mask: faceted shell from the nose bridge to under the
 * chin, a lit breathing slit, twin canted filter pods and a head strap. */
export function lightMask(fit: BodyFit): ArmorPiece {
  const head = fit.skull({ offset: 0.014, blur: 2 });
  const p = new Piece("Light / respirator mask", "mask", "Head");
  p.add(
    "plate",
    plate(head, {
      map: deg(
        symmetric(
          [
            [0, -68],
            [28, -60],
            [54, -46],
            [82, -30],
          ],
          [
            [82, -30],
            [82, -16],
          ],
          [
            [0, 0],
            [14, -6],
            [40, -14],
            [82, -16],
          ],
        ),
      ),
      cols: 24,
      rows: 10,
      thickness: 0.005,
      facetsA: [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1],
      lift: sum(ridge(0.5, 0.16, 0.012), crown(0.005)),
      crease: 26,
    }),
  );
  p.add(
    "glow",
    inlay(
      head,
      (t) => [lerp(-26, 26, t) * DEG, (-38 + 5 * Math.abs(t - 0.5)) * DEG],
      0.0035,
      0.0185,
      8,
    ),
  );
  for (const side of [-1, 1]) {
    const m = frameAt(head, side * 44 * DEG, -40 * DEG, 0.012);
    m.multiply(new T.Matrix4().makeRotationZ(side * 0.5));
    const pod = extrude(
      [
        [-0.013, -0.017],
        [0.013, -0.017],
        [0.018, 0.0],
        [0.01, 0.018],
        [-0.01, 0.018],
        [-0.018, 0.0],
      ],
      0.02,
      0.003,
    );
    p.add("plate", placed(pod.translate(0, 0, 0.008), m.clone()));
    const s = sensor(0.0075);
    p.add("metal", placed(s.bezel.translate(0, 0, 0.018), m.clone()));
    p.add("glow", placed(s.lens.translate(0, 0, 0.018), m.clone()));
    const strap = fit.skull({ offset: 0.02, blur: 3 });
    p.add(
      "metal",
      inlay(
        strap,
        (t) => [side * lerp(70, 180, t) * DEG, lerp(-26, -8, t) * DEG],
        0.012,
        0.003,
        12,
      ),
    );
  }
  return p.finish();
}

/** Plate carrier front: a slim chevron sternum plate with a layered collar
 * plate, a soft backing, shoulder straps and a side cummerbund. */
export function lightChest(fit: BodyFit): ArmorPiece {
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y;
  const p = new Piece("Light / chest rig", "torso", "Spine2");
  const carrier = fit.torso({ offset: 0.008, hullY: [mid, neck] });
  const shell = fit.torso({ offset: 0.015, hullY: [mid, neck] });
  const top = neck - 0.07,
    y0 = mid + 0.03;
  const outline = symmetric(
    [
      [0, y0 - 0.025],
      [0.3, y0 + 0.02],
      [0.5, y0 + 0.06],
    ],
    [
      [0.5, y0 + 0.06],
      [0.6, lerp(y0, top, 0.6)],
      [0.52, top],
    ],
    [
      [0, top - 0.045],
      [0.16, top - 0.012],
      [0.52, top],
    ],
  );
  p.add(
    "suit",
    plate(carrier, {
      map: (a, b) => {
        const [u, v] = outline(a, b);
        return [u * 1.14, v + (b - 0.5) * 0.02];
      },
      cols: 8,
      rows: 6,
      thickness: 0.006,
    }),
  );
  p.add(
    "plate",
    plate(shell, {
      map: outline,
      cols: 16,
      rows: 10,
      thickness: 0.006,
      facetsA: [0, 0.25, 0.5, 0.75, 1],
      lift: sum(ridge(0.5, 0.25, 0.008), crown(0.004)),
    }),
  );
  // Layered collar plate over the upper third.
  const collar = fit.torso({ offset: 0.027, hullY: [mid, neck] });
  p.add(
    "plate",
    plate(collar, {
      map: symmetric(
        [
          [0, top - 0.085],
          [0.3, top - 0.05],
        ],
        [
          [0.3, top - 0.05],
          [0.36, top - 0.012],
        ],
        [
          [0, top - 0.05],
          [0.14, top - 0.02],
          [0.36, top - 0.012],
        ],
      ),
      cols: 12,
      rows: 6,
      thickness: 0.004,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.007),
    }),
  );
  for (const side of [-1, 1]) {
    p.add(
      "glow",
      inlay(
        collar,
        (t) => [side * lerp(0.08, 0.28, t), lerp(top - 0.07, top - 0.044, t)],
        0.003,
        0.0085,
        6,
      ),
    );
    // Straps: plate corner, over the trapezius, to the back plate.
    p.add(
      "suit",
      overShoulder(
        fit,
        carrier.at(side * 0.48, top - 0.01),
        carrier.at(Math.PI - side * 0.36, top + 0.01),
        side,
      ),
    );
    // Cummerbund round the ribs to the back plate, with a side buckle.
    const band = [0.55, 1.0, 1.45, 1.95, 2.45].map((a) =>
      carrier.at(side * a, y0 + 0.035),
    );
    const centre = V(0, y0, fit.torso({ offset: 0 }).at(0, y0).z - 0.09);
    p.add(
      "suit",
      ribbon(band, 0.03, 0.004, (q) => q.clone().sub(centre).setY(0)),
    );
    const m = frameAt(carrier, side * 1.25, y0 + 0.035, 0.005);
    p.add(
      "metal",
      placed(
        extrude(
          [
            [-0.012, -0.016],
            [0.012, -0.016],
            [0.012, 0.016],
            [-0.012, 0.016],
          ],
          0.005,
          0.003,
        ),
        m,
      ),
    );
    for (const dy of [0.07, 0.11])
      p.add(
        "metal",
        placed(fastener(0.0028), frameAt(shell, side * 0.42, y0 + dy, 0.006)),
      );
  }
  return p.finish();
}

/** Spine plate: stacked chevron segments down a soft backing. */
export function lightBack(fit: BodyFit): ArmorPiece {
  const neck = fit.bone("Neck").y,
    mid = fit.bone("Spine1").y;
  const p = new Piece("Light / spine plate", "back", "Spine2");
  const carrier = fit.torso({ offset: 0.008, hullY: [mid, neck] });
  const shell = fit.torso({ offset: 0.015, hullY: [mid, neck] });
  const top = neck - 0.06,
    bottom = mid + 0.01;
  p.add(
    "suit",
    plate(carrier, {
      map: (a, b) => {
        const w = lerp(0.42, 0.36, b);
        return [Math.PI + lerp(-w, w, a), lerp(bottom - 0.01, top + 0.01, b)];
      },
      cols: 8,
      rows: 6,
      thickness: 0.006,
    }),
  );
  const n = 4;
  for (let k = 0; k < n; k++) {
    const y0 = lerp(bottom, top, k / n),
      y1 = lerp(bottom, top, (k + 1) / n) + 0.008,
      w = lerp(0.3, 0.24, k / (n - 1));
    const o = fit.torso({ offset: 0.015 + 0.003 * k, hullY: [mid, neck] });
    p.add(
      "plate",
      plate(o, {
        map: (a, b) => {
          const [u, v] = symmetric(
            [
              [0, y0 - 0.014],
              [w, y0 + 0.004],
            ],
            [
              [w, y0 + 0.004],
              [w * 0.9, y1],
            ],
            [
              [0, y1 - 0.01],
              [w * 0.9, y1],
            ],
          )(a, b);
          return [Math.PI + u, v];
        },
        cols: 8,
        rows: 4,
        thickness: 0.005,
        facetsA: [0, 0.5, 1],
        lift: ridge(0.5, 0.5, 0.006),
      }),
    );
  }
  p.add(
    "glow",
    inlay(
      shell,
      (t) => [Math.PI, lerp(bottom + 0.02, top - 0.02, t)],
      0.003,
      0.022,
      8,
    ),
  );
  return p.finish();
}

/** Waist sash: a wrapped band over the lower abdomen with a tail at the back. */
export function lightSash(fit: BodyFit): ArmorPiece {
  const spine = fit.bone("Spine").y;
  const p = new Piece("Light / waist sash", "waist", "Hips");
  const y = spine + 0.012;
  const waist = fit.torso({ offset: 0.008, hullY: [y - 0.08, y + 0.08] });
  p.add(
    "suit",
    plate(waist, {
      map: (a, b) => [
        a * 2 * Math.PI,
        lerp(y - 0.022, y + 0.022, b) + 0.006 * Math.sin(a * 2 * Math.PI * 3),
      ],
      cols: 36,
      rows: 3,
      thickness: 0.004,
      ringA: true,
      roll: 0.1,
    }),
  );
  // Knot on the back-left and a short tail kept wide of the thigh.
  const knot = frameAt(waist, Math.PI - 0.55, y, 0.006);
  p.add(
    "suit",
    placed(
      extrude(
        [
          [-0.022, -0.02],
          [0.024, -0.016],
          [0.02, 0.022],
          [-0.022, 0.018],
        ],
        0.02,
        0.008,
      ),
      knot,
    ),
  );
  const start = waist.at(Math.PI - 0.55, y - 0.02);
  const out = start.clone().setY(0).normalize();
  const tail = [0, 0.33, 0.66, 1].map((t) =>
    start
      .clone()
      .addScaledVector(out, 0.012 + 0.02 * t)
      .add(V(0.008 * t, -0.17 * t, 0)),
  );
  p.add(
    "suit",
    ribbon(tail, 0.05, 0.004, () => out.clone()),
  );
  return p.finish();
}

/** Chevron shoulder cap with a smaller lame beneath it. */
export function lightShoulder(fit: BodyFit): ArmorPiece {
  const p = new Piece("Light / left shoulder cap", "shoulders", "LeftArm");
  const cap = fit.deltoid({ offset: 0.016, blur: 3 });
  p.add(
    "plate",
    plate(cap, {
      map: deg(
        symmetric(
          [
            [0, -22],
            [26, -10],
            [48, -2],
          ],
          [
            [48, -2],
            [52, 22],
            [40, 50],
          ],
          [
            [0, 58],
            [20, 56],
            [40, 50],
          ],
        ),
        90,
      ),
      cols: 12,
      rows: 8,
      thickness: 0.005,
      facetsA: [0, 0.5, 1],
      lift: sum(ridge(0.5, 0.5, 0.006), crown(0.004)),
    }),
  );
  const lame = fit.deltoid({ offset: 0.012, blur: 3 });
  p.add(
    "plate",
    plate(lame, {
      map: deg(
        symmetric(
          [
            [0, -34],
            [18, -24],
            [30, -18],
          ],
          [
            [30, -18],
            [32, -6],
          ],
          [
            [0, -8],
            [32, -6],
          ],
        ),
        90,
      ),
      cols: 8,
      rows: 4,
      thickness: 0.004,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.004),
    }),
  );
  p.add(
    "glow",
    inlay(
      cap,
      (t) => [lerp(68, 112, t) * DEG, (2 - 8 * Math.sin(Math.PI * t)) * DEG],
      0.003,
      0.0095,
      8,
    ),
  );
  return p.finish();
}

/** Bound forearm under a slim tapered guard on the outer face. */
export function lightForearm(fit: BodyFit): ArmorPiece {
  const s = fit.limb("forearm", { offset: 0.004, blur: 2 });
  const guard = fit.limb("forearm", { offset: 0.012, blur: 2 });
  const p = new Piece("Light / left forearm wraps", "arms", "LeftForeArm");
  wraps(p, s, 0.2, 0.86, 6);
  p.add(
    "plate",
    plate(guard, {
      map: deg(
        symmetric(
          [
            [0, 0.2],
            [30, 0.27],
            [48, 0.32],
          ],
          [
            [48, 0.32],
            [46, 0.6],
            [36, 0.82],
          ],
          [
            [0, 0.86],
            [20, 0.84],
            [36, 0.82],
          ],
        ),
        90,
        false,
      ),
      cols: 8,
      rows: 10,
      thickness: 0.005,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.007),
    }),
  );
  p.add(
    "glow",
    inlay(guard, (t) => [90 * DEG, lerp(0.34, 0.74, t)], 0.003, 0.0125, 6),
  );
  return p.finish();
}

/** Bound shin under a slim greave with a pointed knee cap. */
export function lightShin(fit: BodyFit): ArmorPiece {
  const s = fit.limb("shin", { offset: 0.004, blur: 2 });
  const guard = fit.limb("shin", {
    offset: 0.014,
    blur: 2,
    // Clear the boot cuff at the bottom of the greave.
    extra: (_phi, t) => 0.012 * smooth(0.45, 0.62, t),
  });
  const p = new Piece("Light / left shin wraps", "legs", "LeftLeg");
  wraps(p, s, 0.36, 0.6, 4);
  p.add(
    "plate",
    plate(guard, {
      map: deg(
        symmetric(
          [
            [0, 0.62],
            [22, 0.57],
            [34, 0.53],
          ],
          [
            [34, 0.53],
            [44, 0.32],
            [40, 0.14],
          ],
          [
            [0, 0.1],
            [22, 0.12],
            [40, 0.14],
          ],
        ),
        0,
        false,
      ),
      cols: 8,
      rows: 10,
      thickness: 0.006,
      facetsA: [0, 0.5, 1],
      lift: ridge(0.5, 0.5, 0.009),
    }),
  );
  const knee = fit.limb("shin", { offset: 0.024, blur: 2 });
  p.add(
    "plate",
    plate(knee, {
      map: deg(
        symmetric(
          [
            [0, 0.08],
            [34, 0.04],
          ],
          [
            [34, 0.04],
            [30, -0.05],
          ],
          [
            [0, -0.1],
            [30, -0.05],
          ],
        ),
        0,
        false,
      ),
      cols: 8,
      rows: 6,
      thickness: 0.006,
      facetsA: [0, 0.5, 1],
      lift: sum(ridge(0.5, 0.5, 0.007), crown(0.004)),
    }),
  );
  p.add(
    "glow",
    inlay(guard, (t) => [0, lerp(0.2, 0.5, t)], 0.003, 0.0165, 6),
  );
  return p.finish();
}
