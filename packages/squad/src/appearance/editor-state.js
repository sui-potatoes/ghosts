// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { normalizeBody } from "../body.ts";

export const GLASSES = [
    ["none", "None"],
    ["rectangular", "Rectangular acetate"],
    ["round", "Round wire"],
    ["aviator", "Aviator"],
    ["ballistic", "Ballistic wrap"],
];
export const SCARS = [
    ["none", "None"],
    ["fine", "Fine healed cut"],
    ["slash", "Long healed cut"],
    ["paired", "Paired cuts"],
    ["stitched", "Suture marks"],
];
export const HAIR = [
    ["none", "Shaved"],
    ["short01", "Close crop"],
    ["short02", "Short sweep"],
    ["short04", "Textured crop"],
    ["bob01", "Bob"],
    ["ponytail01", "Ponytail"],
    ["braid01", "Braid"],
];
export const BROWS = [
    ["brow001", "Natural"],
    ["brow002", "Soft arch"],
    ["brow003", "High arch"],
    ["brow004", "Straight"],
    ["brow005", "Flat angled"],
    ["brow006", "Pencil"],
    ["brow007", "Fine straight"],
    ["brow008", "Full arch"],
    ["brow009", "Bushy"],
    ["brow010", "Feathered"],
    ["brow011", "Tapered"],
    ["brow012", "Untamed"],
    ["none", "None"],
];
export const BROW_CONTROLS = [
    { key: "browThickness", label: "Brow thickness", low: "Thin", high: "Thick" },
    { key: "browLength", label: "Brow length", low: "Short", high: "Long" },
    { key: "browArch", label: "Brow arch", low: "Flat", high: "Arched" },
    { key: "browTail", label: "Brow tail", low: "Lowered", high: "Lifted" },
    {
        key: "browDensity",
        label: "Brow density",
        low: "Sparse",
        high: "Dense",
        min: 35,
        max: 100,
        default: 1,
    },
];
export const EYE_PRESETS = [
    { name: "Almond", values: { eyeOpen: -0.25, eyeOuterOpen: -0.15, eyeTilt: 0.2, eyefold: 0.1 } },
    {
        name: "Rounded",
        values: { eyeOpen: 0.35, eyeInnerOpen: 0.12, eyeOuterOpen: 0.2, eyeTilt: -0.05 },
    },
    {
        name: "Hooded",
        values: { eyefold: -0.35, eyeFoldVolume: 0.45, eyeFoldAngle: -0.1, eyeOpen: -0.15 },
    },
    {
        name: "Deep set",
        values: { eyeDepth: 0.5, eyeFoldVolume: -0.2, eyeOpen: -0.15, eyeBag: 0.1 },
    },
    {
        name: "Folded lids",
        values: { innerLid: 0.55, eyefold: -0.25, eyeOpen: -0.2, eyeTilt: 0.2 },
    },
];
export const TATTOOS = [
    ["none", "None"],
    ["bars", "Signal bars"],
    ["orbit", "Orbit"],
    ["chevrons", "Chevrons"],
    ["cross", "Cross"],
    ["serial", "Serial 07"],
    ["tear", "Drop"],
    ["diamond", "Diamond"],
    ["dots", "Three dots"],
];
export const baseState = () => ({
    glasses: "none",
    glassesColor: "#272b2c",
    lensColor: "#344448",
    lensTint: 0,
    scar: "none",
    scarPlace: "cheekLeft",
    scarAmount: 0.6,
    version: 1,
    name: "Untitled",
    sex: "female",
    shape: "oval",
    shapeAmount: 0.35,
    values: {},
    body: normalizeBody(null),
    skin: "young_caucasian",
    skinTint: "#ffffff",
    warmth: 0,
    roughness: 0.76,
    blushColor: "#cb667c",
    blushAmount: 0,
    blushPlacement: "apples",
    blushSpread: 0.5,
    eyes: "brown",
    hair: "bob01",
    hairColor: "#352820",
    brows: "brow002",
    browColor: "#423326",
    ...Object.fromEntries(BROW_CONTROLS.map((c) => [c.key, c.default ?? 0])),
    tattoo: "none",
    tattooPlace: "cheekLeft",
    tattooColor: "#262a28",
    tattooOpacity: 0.65,
});
export const presets = [
    {
        name: "Mara",
        sex: "female",
        description: "Oval · soft cheeks · short bridge",
        shape: "oval",
        shapeAmount: 0.65,
        hair: "ponytail01",
        eyes: "green",
        values: {
            headLength: -0.2,
            faceFat: 0.22,
            cheekVolume: 0.28,
            chinWidth: -0.35,
            chinHeight: -0.2,
            noseLength: -0.4,
            noseCurve: -0.35,
            noseAngle: 0.3,
            noseTip: -0.2,
            eyeSpace: 0.3,
            eyeOpen: 0.1,
            upperLip: 0.35,
            lowerLip: 0.25,
            neckWidth: -0.3,
        },
    },
    {
        name: "Imani",
        sex: "female",
        description: "Broad contours · full lips · defined brow",
        skin: "young_african",
        shape: "round",
        shapeAmount: 0.65,
        hair: "braid01",
        eyes: "brown",
        brows: "brow005",
        values: {
            headWidth: 0.32,
            headLength: -0.18,
            faceFat: 0.2,
            cheekVolume: 0.25,
            chinWidth: 0.23,
            noseBridge: 0.5,
            noseWidth: 0.35,
            noseTip: 0.5,
            noseDepth: -0.3,
            eyeSpace: 0.45,
            eyeDepth: 0.2,
            upperLip: 0.65,
            lowerLip: 0.55,
            mouthWidth: 0.2,
            browHeight: -0.2,
        },
    },
    {
        name: "Sora",
        sex: "female",
        description: "Tapered jaw · folded lids · fine mouth",
        skin: "young_asian",
        shape: "invertedtriangular",
        shapeAmount: 0.5,
        hair: "ponytail01",
        hairColor: "#191b20",
        brows: "brow009",
        eyes: "brownlight",
        values: {
            headWidth: 0.1,
            headDepth: -0.2,
            chinWidth: -0.4,
            chinProjection: -0.15,
            eyeOpen: -0.4,
            innerLid: 0.7,
            eyeTilt: 0.4,
            eyeSpace: 0.1,
            noseDepth: -0.3,
            noseLength: -0.25,
            noseTip: 0.15,
            mouthWidth: -0.3,
            upperLip: -0.1,
            neckWidth: -0.25,
        },
    },
    {
        name: "Jonas",
        sex: "male",
        description: "Square jaw · narrow bridge · deep eyes",
        shape: "square",
        shapeAmount: 0.7,
        hair: "short04",
        eyes: "grey",
        skin: "middleage_caucasian",
        brows: "brow005",
        values: {
            headWidth: 0.2,
            headDepth: 0.15,
            faceFat: -0.15,
            cheekbone: 0.25,
            chinWidth: 0.4,
            chinProjection: 0.35,
            neckWidth: 0.4,
            eyeSpace: -0.3,
            eyeDepth: 0.35,
            eyeOpen: -0.3,
            browHeight: -0.25,
            noseBridge: -0.55,
            noseCurve: 0.55,
            noseLength: 0.3,
            mouthWidth: 0.35,
            upperLip: -0.4,
            lowerLip: -0.2,
        },
    },
    {
        name: "Malik",
        sex: "male",
        description: "Rounded outline · broad tip · wide mouth",
        shape: "round",
        shapeAmount: 0.55,
        hair: "short01",
        hairColor: "#201e1e",
        skin: "young_african",
        eyes: "brown",
        brows: "brow001",
        values: {
            headWidth: 0.3,
            faceFat: 0.2,
            cheekVolume: 0.35,
            chinWidth: 0.15,
            noseWidth: 0.45,
            noseBridge: 0.3,
            noseTip: 0.5,
            noseDepth: -0.25,
            eyeSpace: 0.4,
            eyeOpen: 0.12,
            mouthWidth: 0.35,
            upperLip: 0.5,
            lowerLip: 0.45,
            neckWidth: 0.25,
            underChin: 0.1,
        },
    },
    {
        name: "Anton",
        sex: "male",
        description: "Long contour · high bridge · narrow lips",
        shape: "rectangular",
        shapeAmount: 0.45,
        hair: "short02",
        hairColor: "#635244",
        skin: "middleage_caucasian",
        eyes: "blue",
        brows: "brow009",
        values: {
            headWidth: -0.2,
            headLength: 0.35,
            faceFat: -0.3,
            cheekbone: 0.15,
            cheekHeight: 0.25,
            chinHeight: 0.35,
            chinProjection: 0.25,
            noseLength: 0.5,
            noseCurve: 0.5,
            noseDepth: 0.3,
            noseBridge: -0.3,
            noseAngle: -0.25,
            eyeDepth: 0.25,
            eyeOpen: -0.2,
            mouthWidth: -0.2,
            upperLip: -0.3,
            lowerLip: -0.25,
            mouthHeight: -0.12,
        },
    },
];
export function fromPreset(p) {
    return {
        ...baseState(),
        ...structuredClone(p),
        values: { ...p.values },
        skin: p.skin ?? "young_caucasian",
    };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : 0));
export function normalize(input, schema) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw Error("Expected an identity object.");
    const d = baseState(),
        s = { ...d },
        allowed = (key, list) => {
            if (list.includes(input[key])) s[key] = input[key];
        };
    s.name =
        String(input.name ?? "Untitled")
            .trim()
            .slice(0, 40) || "Untitled";
    allowed("sex", ["male", "female"]);
    allowed("shape", ["none", ...schema.shapes]);
    for (const [key, list] of [
        ["glasses", GLASSES],
        ["scar", SCARS],
        ["hair", HAIR],
        ["brows", BROWS],
        ["tattoo", TATTOOS],
    ])
        allowed(
            key,
            list.map((x) => x[0]),
        );
    allowed("scarPlace", ["cheekLeft", "cheekRight", "temple", "bridge"]);
    allowed("blushPlacement", ["apples", "high"]);
    allowed("skin", [
        "young_caucasian",
        "young_asian",
        "young_african",
        "middleage_caucasian",
        "middleage_asian",
        "middleage_african",
    ]);
    allowed("eyes", [
        "brown",
        "brownlight",
        "green",
        "bluegreen",
        "blue",
        "grey",
        "deepblue",
        "ice",
    ]);
    allowed("tattooPlace", ["cheekLeft", "cheekRight", "temple", "forehead"]);
    for (const key of [
        "glassesColor",
        "lensColor",
        "blushColor",
        "skinTint",
        "hairColor",
        "browColor",
        "tattooColor",
    ])
        if (/^#[\da-f]{6}$/i.test(input[key])) s[key] = input[key];
    for (const [key, min, max] of [
        ["lensTint", 0, 1],
        ["scarAmount", 0, 1],
        ["blushAmount", 0, 1],
        ["blushSpread", 0, 1],
        ["shapeAmount", 0, 1],
        ["warmth", -1, 1],
        ["roughness", 0.45, 1],
        ["tattooOpacity", 0, 1],
    ])
        s[key] = input[key] === undefined ? d[key] : clamp(input[key], min, max);
    for (const c of BROW_CONTROLS)
        s[c.key] =
            input[c.key] === undefined
                ? d[c.key]
                : clamp(input[c.key], (c.min ?? -100) / 100, (c.max ?? 100) / 100);
    s.values = Object.fromEntries(
        schema.controls.map((c) => [c.key, clamp(input.values?.[c.key] ?? 0, -1, 1)]),
    );
    s.body = normalizeBody(input.body);
    return s;
}
export function weights(s) {
    const w = {};
    if (s.shape !== "none") w["shape_" + s.shape] = s.shapeAmount;
    for (const [k, v] of Object.entries(s.values))
        if (Math.abs(v) > 0.0001) w[k + "_" + (v < 0 ? "negative" : "positive")] = Math.abs(v);
    return w;
}
const pick = (items, random, previous) => {
    const pool = items.filter((item) => item !== previous);
    return (pool.length ? pool : items)[
        Math.min(
            (pool.length || items.length) - 1,
            Math.floor(random() * (pool.length || items.length)),
        )
    ];
};
const between = (random, a, b) => a + (b - a) * random();
const jitter = (random, radius) => (random() + random() - 1) * radius;
// Coherent profiles give the nose an identity instead of tiny variations on one bridge.
const NOSE_PROFILES = [
    {
        noseWidth: -0.4,
        noseLength: 0.4,
        noseDepth: 0.35,
        noseBridge: -0.5,
        noseCurve: 0.5,
        noseTip: -0.35,
        noseAngle: -0.2,
        nostrils: -0.25,
    },
    {
        noseWidth: 0.5,
        noseLength: -0.2,
        noseDepth: -0.25,
        noseBridge: 0.35,
        noseCurve: -0.2,
        noseTip: 0.45,
        noseAngle: 0.15,
        nostrils: 0.4,
    },
    {
        noseWidth: -0.2,
        noseLength: -0.45,
        noseDepth: -0.15,
        noseBridge: -0.25,
        noseCurve: -0.4,
        noseTip: 0.05,
        noseAngle: 0.45,
        nostrils: -0.15,
    },
    {
        noseWidth: 0.2,
        noseLength: 0.35,
        noseDepth: 0.5,
        noseBridge: 0.25,
        noseCurve: 0.35,
        noseTip: 0.15,
        noseAngle: -0.35,
        nostrils: 0.1,
    },
    {
        noseWidth: -0.3,
        noseLength: 0.1,
        noseDepth: 0.1,
        noseBridge: -0.4,
        noseCurve: 0,
        noseTip: -0.4,
        noseAngle: 0.05,
        nostrils: -0.25,
    },
    {
        noseWidth: 0.35,
        noseLength: -0.1,
        noseDepth: 0.15,
        noseBridge: -0.1,
        noseCurve: -0.15,
        noseTip: 0.5,
        noseAngle: 0.2,
        nostrils: 0.25,
    },
];
function anatomyCandidate(schema, sex, random, previous) {
    const pool = presets.filter((p) => p.sex === sex),
        s = fromPreset(pick(pool, random));
    s.name = "New identity";
    s.values = {};
    // Sample foundations per region, so eyes, jaw and mouth aren't locked to one preset.
    for (const group of new Set(schema.controls.map((c) => c.group))) {
        const foundation = pick(pool, random);
        for (const c of schema.controls.filter((c) => c.group === group))
            s.values[c.key] = clamp(
                (foundation.values[c.key] ?? 0) * 0.65 + jitter(random, 0.4),
                -0.65,
                0.65,
            );
    }
    s.shape = pick(schema.shapes, random, previous?.shape);
    s.shapeAmount = between(random, 0.3, 0.65);
    const length = between(random, -0.5, 0.5),
        breadth = between(random, -0.5, 0.5),
        fullness = between(random, -0.45, 0.5);
    Object.assign(s.values, {
        headLength: length,
        headWidth: breadth,
        headDepth: between(random, -0.4, 0.4),
        faceFat: fullness,
        cheekVolume: clamp(fullness * 0.7 + jitter(random, 0.24), -0.5, 0.55),
        cheekbone: clamp(-fullness * 0.35 + jitter(random, 0.35), -0.45, 0.45),
        chinWidth: clamp(breadth * 0.45 + jitter(random, 0.4), -0.55, 0.55),
        chinHeight: clamp(length * 0.35 + jitter(random, 0.38), -0.5, 0.5),
        underChin: clamp(fullness * 0.6 + jitter(random, 0.25), -0.45, 0.5),
        jaw: between(random, -0.5, 0.5),
        neckWidth: between(random, -0.4, 0.4),
    });
    // Avoid stacking a square outline with every jaw-width target at its extreme.
    if (["square", "rectangular"].includes(s.shape)) {
        s.values.jaw = Math.min(s.values.jaw, 0.25);
        s.values.chinWidth = Math.min(s.values.chinWidth, 0.35);
    }
    for (const [k, v] of Object.entries(pick(NOSE_PROFILES, random)))
        s.values[k] = clamp(v + jitter(random, 0.18), -0.65, 0.65);
    const lips = between(random, -0.55, 0.6);
    s.values.upperLip = clamp(lips + jitter(random, 0.2), -0.65, 0.7);
    s.values.lowerLip = clamp(lips * 0.8 + jitter(random, 0.25), -0.65, 0.7);
    s.values.mouthWidth = between(random, -0.5, 0.55);
    s.values.mouthHeight = between(random, -0.4, 0.4);
    Object.assign(s.values, pick(EYE_PRESETS, random).values);
    for (const c of schema.controls.filter((c) => c.group === "Eyes"))
        s.values[c.key] = clamp(s.values[c.key] + jitter(random, 0.18), -0.6, 0.65);
    s.values.eyeSpace = between(random, -0.5, 0.55);
    s.values.eyeDepth = between(random, -0.35, 0.4);
    s.values.eyeSize = between(random, -0.28, 0.3);
    s.values.eyeHeight = between(random, -0.3, 0.3);
    s.brows = pick(
        BROWS.filter(([k]) => k !== "none").map(([k]) => k),
        random,
        previous?.brows,
    );
    for (const c of BROW_CONTROLS)
        s[c.key] =
            c.key === "browDensity" ? between(random, 0.65, 1) : between(random, -0.65, 0.65);
    return s;
}
function anatomyDistance(a, b, schema) {
    return Math.sqrt(
        schema.controls.reduce(
            (sum, c) => sum + ((a.values[c.key] ?? 0) - (b.values[c.key] ?? 0)) ** 2,
            0,
        ) / schema.controls.length,
    );
}
export function randomIdentity(schema, sex, random = Math.random, previous = null) {
    let s,
        bestDistance = -1;
    // Bounded rejection keeps repeat clicks meaningfully different, without a render loop.
    for (let attempt = 0; attempt < (previous ? 8 : 1); attempt++) {
        const candidate = anatomyCandidate(schema, sex, random, previous),
            distance = previous ? anatomyDistance(candidate, previous, schema) : 1;
        if (distance > bestDistance) {
            s = candidate;
            bestDistance = distance;
        }
        if (distance >= 0.3) break;
    }
    s.skin = pick(
        [
            "young_caucasian",
            "young_asian",
            "young_african",
            "middleage_caucasian",
            "middleage_asian",
            "middleage_african",
        ],
        random,
        previous?.skin,
    );
    s.skinTint = pick(
        ["#ffffff", "#f7e7dc", "#eee5ca", "#e5dfdd", "#ead3bf"],
        random,
        previous?.skinTint,
    );
    s.warmth = between(random, -0.3, 0.35);
    s.roughness = between(random, 0.6, 0.88);
    s.hair = pick(
        HAIR.map(([k]) => k),
        random,
        previous?.hair,
    );
    s.eyes = pick(
        ["brown", "brownlight", "green", "bluegreen", "blue", "grey", "deepblue", "ice"],
        random,
        previous?.eyes,
    );
    s.hairColor = pick(
        ["#211e1c", "#493526", "#786044", "#bd9c64", "#868079", "#4d2a20", "#b8b4a7", "#6e3526"],
        random,
        previous?.hairColor,
    );
    // Related brow/hair colors keep the larger cosmetic shuffle plausible.
    s.browColor =
        s.hairColor === "#b8b4a7" ? "#635e56" : s.hairColor === "#bd9c64" ? "#806344" : s.hairColor;
    s.blushColor = pick(["#cb667c", "#d58c70", "#a74e69", "#bb6d54"], random);
    s.blushAmount = random() < 0.5 ? 0 : between(random, 0.1, 0.32);
    s.blushPlacement = pick(["apples", "high"], random);
    s.blushSpread = between(random, 0.3, 0.75);
    s.tattoo =
        random() < 0.4
            ? pick(
                  TATTOOS.filter(([k]) => k !== "none").map(([k]) => k),
                  random,
                  previous?.tattoo,
              )
            : "none";
    s.tattooPlace = pick(["cheekLeft", "cheekRight", "temple", "forehead"], random);
    s.tattooColor = pick(["#262a28", "#393b42", "#503d36"], random);
    s.tattooOpacity = between(random, 0.4, 0.75);
    s.glasses =
        random() < 0.25
            ? pick(
                  GLASSES.slice(1).map(([k]) => k),
                  random,
              )
            : "none";
    s.glassesColor = pick(["#272b2c", "#5c4634", "#a5967b"], random);
    s.lensTint = s.glasses === "ballistic" ? 0.45 : s.glasses === "aviator" ? 0.65 : 0;
    s.scar =
        random() < 0.3
            ? pick(
                  SCARS.slice(1).map(([k]) => k),
                  random,
              )
            : "none";
    s.scarPlace = pick(["cheekLeft", "cheekRight", "temple", "bridge"], random);
    s.scarAmount = between(random, 0.35, 0.7);
    return normalize(s, schema);
}
// Face shuffle explores the eye region independently: a different jaw must not
// satisfy the variation check while the eyes remain nearly identical.
function shuffledEyes(schema, current, random) {
    const keys = schema.controls.filter((c) => c.group === "Eyes").map((c) => c.key);
    const profiles = [
        ...EYE_PRESETS.map((p) => p.values),
        { eyeOpen: -0.4, eyeOuterOpen: -0.25, eyeTilt: 0.45, eyefold: 0.25, innerLid: 0.2 },
        { eyeOpen: 0.12, eyeOuterOpen: 0.15, eyeTilt: -0.4, eyefold: 0.2, eyeFoldVolume: 0.15 },
    ];
    let best,
        bestScore = -Infinity;
    for (let attempt = 0; attempt < 10; attempt++) {
        const profile = pick(profiles, random),
            v = {};
        v.eyeOpen = clamp((profile.eyeOpen ?? 0) * 1.35 + jitter(random, 0.2), -0.6, 0.6);
        v.eyeInnerOpen = clamp(
            v.eyeOpen * 0.5 + (profile.eyeInnerOpen ?? 0) * 0.6 + jitter(random, 0.3),
            -0.6,
            0.6,
        );
        v.eyeOuterOpen = clamp(
            v.eyeOpen * 0.5 + (profile.eyeOuterOpen ?? 0) * 0.6 + jitter(random, 0.3),
            -0.6,
            0.6,
        );
        v.eyeTilt = clamp((profile.eyeTilt ?? 0) * 1.3 + jitter(random, 0.32), -0.65, 0.65);
        v.eyeInnerAngle = between(random, -0.4, 0.4);
        v.eyefold = clamp((profile.eyefold ?? 0) * 1.35 + jitter(random, 0.38), -0.7, 0.7);
        v.innerLid = clamp((profile.innerLid ?? 0) * 1.15 + jitter(random, 0.5), -0.6, 0.7);
        v.eyeFoldVolume = clamp(
            (profile.eyeFoldVolume ?? 0) - v.eyefold * 0.25 + jitter(random, 0.4),
            -0.65,
            0.65,
        );
        v.eyeFoldAngle = clamp(v.eyeTilt * 0.4 + jitter(random, 0.4), -0.6, 0.6);
        v.eyeBag = between(random, -0.45, 0.5);
        v.eyeBagHeight = between(random, -0.45, 0.45);
        v.eyeSpace = between(random, -0.6, 0.65);
        v.eyeDepth = between(random, -0.4, 0.45);
        v.eyeSize = between(random, -0.35, 0.38);
        v.eyeHeight = between(random, -0.35, 0.35);
        const differences = keys.map((k) => Math.abs(v[k] - (current.values[k] ?? 0)));
        const score = Math.sqrt(differences.reduce((sum, d) => sum + d * d, 0) / keys.length);
        if (score > bestScore) {
            best = v;
            bestScore = score;
        }
        if (score >= 0.34 && differences.filter((d) => d >= 0.3).length >= 5) break;
    }
    return best;
}
/** Shuffle anatomy and surface nuances; preserve the base complexion, iris, hair and gear. */
export function shuffleFace(schema, current, random = Math.random) {
    const r = randomIdentity(schema, current.sex, random, current);
    return normalize(
        {
            ...current,
            shape: r.shape,
            shapeAmount: r.shapeAmount,
            warmth: r.warmth,
            roughness: r.roughness,
            blushColor: r.blushColor,
            blushAmount: r.blushAmount,
            blushPlacement: r.blushPlacement,
            blushSpread: r.blushSpread,
            values: { ...r.values, ...shuffledEyes(schema, current, random) },
            brows: r.brows,
            ...Object.fromEntries(BROW_CONTROLS.map((c) => [c.key, r[c.key]])),
        },
        schema,
    );
}
