// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Appearance tab at the real character editor's depth
 * (features/squad/components/AppearancePanel.tsx), in the shared language,
 * shared by Headquarters and the `/ui-sample` reference:
 * eight sections stepped from the top row (Body, Face, Eyes, Brows, Hair,
 * Skin, Details, Kit) so no list gets long; steppers for small sets, a grid
 * picker for large ones (the stage wears the tile under the cursor), sliders
 * for the continuous values. Everything edits the real `Appearance` (and the
 * armor colours), so the character on the stage really changes.
 */

import { ARMOR_FINISHES } from "@ghosts/squad/armor-colors";
import { schema } from "@ghosts/squad/appearance/schema";
import {
    BROW_CONTROLS,
    BROWS,
    DEFAULT_LENS_TINT,
    EYE_PRESETS,
    fromPreset,
    GLASSES,
    HAIR,
    normalize,
    presets,
    randomIdentity,
    SCARS,
    shuffleFace,
    TATTOOS,
} from "@ghosts/squad/appearance/editor-state";
import { BODY_CONTROLS, normalizeBody } from "@ghosts/squad/body";
import type { Appearance, ArmorColors } from "@ghosts/squad/types";
import { useState, type ReactNode } from "react";

import {
    GridPicker,
    List,
    Slider,
    SlotRow,
    Stepper,
    SwatchRow,
    type Command,
    type GridOption,
} from "../../../ui";

type Look = { appearance: Appearance; armorColors: ArmorColors };

const SECTIONS = [
    ["body", "Body"],
    ["face", "Face"],
    ["eyes", "Eyes"],
    ["brows", "Brows"],
    ["hair", "Hair"],
    ["skin", "Skin"],
    ["details", "Details"],
    ["kit", "Kit"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/** Sections that work on the head: the stage frames the face for them. */
export const HEAD_SECTIONS = new Set<SectionId>([
    "face",
    "eyes",
    "brows",
    "hair",
    "skin",
    "details",
]);

const SKINS: [string, string][] = [
    ["young_caucasian", "Clear · light"],
    ["young_asian", "Clear · medium"],
    ["young_african", "Clear · deep"],
    ["middleage_caucasian", "Mature · light"],
    ["middleage_asian", "Mature · medium"],
    ["middleage_african", "Mature · deep"],
];

const EYES: [string, string][] = [
    "brown",
    "brownlight",
    "green",
    "bluegreen",
    "blue",
    "grey",
    "deepblue",
    "ice",
].map((key) => {
    const name = key.replace("light", " light").replace("deep", "deep ");
    return [key, name.charAt(0).toUpperCase() + name.slice(1)];
});

/*
 * Colour palettes. The real editor takes any colour from a native picker;
 * a console screen offers a curated set instead (the current colour is
 * always kept as the first swatch when it is not one of them).
 */
const HAIR_COLORS: [string, string][] = [
    ["#211e1c", "Black"],
    ["#423326", "Dark brown"],
    ["#786044", "Brown"],
    ["#bd9c64", "Dark blond"],
    ["#868079", "Ash"],
    ["#4d2a20", "Auburn"],
    ["#b8b4a7", "Silver"],
    ["#6e3526", "Copper"],
];
const SKIN_TINTS: [string, string][] = [
    ["#ffffff", "Neutral"],
    ["#fbe9df", "Rosy"],
    ["#f6ead2", "Golden"],
    ["#e9e4dc", "Ashen"],
    ["#efdcd0", "Ruddy"],
];
const BLUSH: [string, string][] = [
    ["#cb667c", "Rose"],
    ["#c97a62", "Peach"],
    ["#a65446", "Brick"],
    ["#b0627e", "Berry"],
];
const FRAMES: [string, string][] = [
    ["#272b2c", "Graphite"],
    ["#0f1011", "Black"],
    ["#8a8478", "Steel"],
    ["#5a3c2a", "Tortoise"],
];
const LENSES: [string, string][] = [
    ["#344448", "Smoke"],
    ["#1d2a2f", "Dark"],
    ["#3e5a4a", "Green"],
    ["#5a4630", "Amber"],
];
const INKS: [string, string][] = [
    ["#262a28", "Black"],
    ["#1f2a3c", "Navy"],
    ["#4a1f22", "Oxblood"],
    ["#2d3a2c", "Olive"],
];

const PLACES: [string, string][] = [
    ["cheekLeft", "Left cheek"],
    ["cheekRight", "Right cheek"],
    ["temple", "Temple"],
];

const swatches = (palette: [string, string][], value: string) =>
    (palette.some(([c]) => c === value)
        ? palette
        : [[value, "Current"] as [string, string], ...palette]
    ).map(([color, name]) => ({ id: color, name, colors: [color] }));

const FACE_REGIONS = [...new Set(schema.controls.map((c) => c.group))].filter(
    (g) => g !== "Eyes" && g !== "Brow & forehead",
);

/** The eye shape preset the eye morphs match, if any. */
function eyeShape(values: Record<string, number>): string {
    const hit = EYE_PRESETS.find((p) =>
        Object.entries(p.values).every(([k, v]) => Math.abs((values[k] ?? 0) - v) < 0.001),
    );
    return hit?.name ?? "custom";
}

type Grid = {
    id: string;
    title: string;
    options: GridOption[];
    value: string;
    patch: (id: string) => Partial<Appearance>;
    columns?: number;
};

type Props = {
    look: Look;
    dirty: boolean;
    edit: (patch: Partial<Appearance>, colors?: ArmorColors) => void;
    /** The stage wears this on top of the draft while a grid tile is under the cursor. */
    preview: (patch: Partial<Appearance> | null) => void;
    save: () => void;
    discard: () => void;
    /** The section's framing: the face for head sections. */
    onSection: (section: SectionId) => void;
    toRoster: Command;
};

export function AppearanceEditor({
    look,
    dirty,
    edit,
    preview,
    save,
    discard,
    onSection,
    toRoster,
}: Props) {
    const [section, setSection] = useState<SectionId>("body");
    const [region, setRegion] = useState(FACE_REGIONS[0]);
    const [grid, setGrid] = useState<Grid | null>(null);
    const s = look.appearance;

    const randomise = () => {
        const r = randomIdentity(schema, s.sex, Math.random, s);
        const morphs = (groups: string[]) =>
            Object.fromEntries(
                schema.controls
                    .filter((c) => groups.includes(c.group))
                    .map((c) => [c.key, r.values[c.key] ?? 0]),
            );
        switch (section) {
            case "body":
                return edit({
                    body: Object.fromEntries(
                        BODY_CONTROLS.map(({ key }) => [
                            key,
                            Math.round((Math.random() * 1.2 - 0.6) * 10) / 10,
                        ]),
                    ) as Appearance["body"],
                });
            case "face": {
                const f = shuffleFace(schema, s);
                return edit({
                    values: { ...s.values, ...morphs(FACE_REGIONS), ...f.values },
                    shape: f.shape,
                    shapeAmount: f.shapeAmount,
                });
            }
            case "eyes":
                return edit({ eyes: r.eyes, values: { ...s.values, ...morphs(["Eyes"]) } });
            case "brows":
                return edit({
                    brows: r.brows,
                    browColor: r.browColor,
                    browThickness: r.browThickness,
                    browLength: r.browLength,
                    browArch: r.browArch,
                    browTail: r.browTail,
                    browDensity: r.browDensity,
                    values: { ...s.values, ...morphs(["Brow & forehead"]) },
                });
            case "hair":
                return edit({ hair: r.hair, hairColor: r.hairColor });
            case "skin":
                return edit({
                    skin: r.skin,
                    skinTint: r.skinTint,
                    warmth: r.warmth,
                    roughness: r.roughness,
                    blushColor: r.blushColor,
                    blushAmount: r.blushAmount,
                    blushPlacement: r.blushPlacement,
                    blushSpread: r.blushSpread,
                });
            case "details":
                return edit({
                    glasses: r.glasses,
                    glassesColor: r.glassesColor,
                    lensColor: r.lensColor,
                    lensTint: r.lensTint,
                    scar: r.scar,
                    scarPlace: r.scarPlace,
                    scarAmount: r.scarAmount,
                    tattoo: r.tattoo,
                    tattooPlace: r.tattooPlace,
                    tattooColor: r.tattooColor,
                    tattooOpacity: r.tattooOpacity,
                });
            case "kit":
                return edit(
                    {},
                    ARMOR_FINISHES[Math.floor(Math.random() * ARMOR_FINISHES.length)].colors,
                );
        }
    };

    const reset: Command[] = dirty
        ? [{ action: "reset", label: "Reset", tone: "danger", run: discard }]
        : [];
    const valueCommands: Command[] = [
        { action: "nav", label: "Change", glyph: "lr" },
        dirty
            ? { action: "confirm", label: "Save look", tone: "primary", run: save }
            : { action: "confirm", label: "Randomise", run: randomise },
        ...reset,
        toRoster,
    ];
    const gridCommands = (open: () => void): Command[] => [
        { action: "confirm", label: "Choose", tone: "primary", run: open },
        ...reset,
        toRoster,
    ];

    if (grid)
        return (
            <GridPicker
                id={grid.id}
                title={grid.title}
                options={grid.options}
                value={grid.value}
                columns={grid.columns}
                onPreview={(id) => preview(grid.patch(id))}
                onPick={(id) => {
                    preview(null);
                    edit(grid.patch(id));
                    setGrid(null);
                }}
                onClose={() => {
                    preview(null);
                    setGrid(null);
                }}
            />
        );

    const focus = (id: string, title: string, hint?: string) => ({
        id: `look-${id}`,
        group: "inspector",
        title,
        hint,
        commands: valueCommands,
    });

    const stepper = (
        id: string,
        label: string,
        options: [string, string][],
        value: string,
        onChange: (v: string) => void,
        hint?: string,
    ) => (
        <Stepper
            key={id}
            label={label}
            options={options}
            value={value}
            onChange={onChange}
            {...focus(id, label, hint)}
        />
    );

    const slider = (
        id: string,
        label: string,
        value: number,
        onChange: (v: number) => void,
        min = -1,
        max = 1,
        hint?: string,
    ) => (
        <Slider
            key={id}
            label={label}
            value={value}
            min={min}
            max={max}
            onChange={onChange}
            {...focus(id, label, hint)}
        />
    );

    const swatchRow = (
        id: string,
        label: string,
        palette: [string, string][],
        value: string,
        onChange: (v: string) => void,
    ) => (
        <SwatchRow
            key={id}
            label={label}
            swatches={swatches(palette, value)}
            value={value}
            onChange={onChange}
            {...focus(id, label)}
        />
    );

    const pick = (id: string, label: string, current: string | undefined, open: () => void) => (
        <SlotRow
            key={id}
            id={`look-${id}`}
            instant
            group="inspector"
            slot={label}
            item={current}
            title={label}
            hint="The stage wears the option under the cursor"
            commands={gridCommands(open)}
        />
    );

    const morphs = (group: string) =>
        schema.controls
            .filter((c) => c.group === group)
            .map((c) =>
                slider(
                    c.key,
                    c.label,
                    s.values[c.key] ?? 0,
                    (v) => edit({ values: { ...s.values, [c.key]: v } }),
                    -1,
                    1,
                    `${c.low} · ${c.high}`,
                ),
            );

    const nameOf = (list: [string, string][], id: string) =>
        list.find(([k]) => k === id)?.[1] ?? id;

    let rows: ReactNode;
    switch (section) {
        case "body":
            rows = (
                <>
                    {stepper(
                        "sex",
                        "Frame",
                        [
                            ["female", "Female"],
                            ["male", "Male"],
                        ],
                        s.sex,
                        (sex) => edit({ sex: sex as Appearance["sex"] }),
                        "Rebuilds the body; face and colours carry over",
                    )}
                    {BODY_CONTROLS.map((c) =>
                        slider(
                            c.key,
                            c.label,
                            normalizeBody(s.body)[c.key],
                            (v) => edit({ body: { ...normalizeBody(s.body), [c.key]: v } }),
                            -1,
                            1,
                            `${c.low} · ${c.high}`,
                        ),
                    )}
                </>
            );
            break;
        case "face":
            rows = (
                <>
                    {pick("identity", "Identity", s.name || "Custom", () =>
                        setGrid({
                            id: "grid-identity",
                            title: "Starting identity",
                            columns: 2,
                            value: "",
                            options: presets
                                .map((p, i) => ({
                                    id: String(i),
                                    label: `${p.name} · ${p.sex === "female" ? "F" : "M"}`,
                                }))
                                .filter((o) => presets[+o.id].sex === s.sex),
                            patch: (i) =>
                                i === ""
                                    ? {}
                                    : normalize(
                                          {
                                              ...fromPreset(presets[+i]),
                                              name: s.name,
                                              body: s.body,
                                          },
                                          schema,
                                      ),
                        }),
                    )}
                    {stepper(
                        "region",
                        "Region",
                        FACE_REGIONS.map((g) => [g, g]),
                        region,
                        setRegion,
                    )}
                    {region === "Contour" && (
                        <>
                            {stepper(
                                "shape",
                                "Outline",
                                [
                                    ["none", "Natural"],
                                    ...schema.shapes.map((k): [string, string] => [
                                        k,
                                        k.charAt(0).toUpperCase() +
                                            k.slice(1).replace("inverted", "inverted "),
                                    ]),
                                ],
                                s.shape,
                                (shape) => edit({ shape }),
                            )}
                            {slider(
                                "shape-amount",
                                "Strength",
                                s.shapeAmount,
                                (shapeAmount) => edit({ shapeAmount }),
                                0,
                                1,
                            )}
                        </>
                    )}
                    {morphs(region)}
                </>
            );
            break;
        case "eyes":
            rows = (
                <>
                    {stepper("eyes", "Iris", EYES, s.eyes, (eyes) => edit({ eyes }))}
                    {stepper(
                        "eye-shape",
                        "Shape",
                        [
                            ...EYE_PRESETS.map((p): [string, string] => [p.name, p.name]),
                            ["custom", "Custom"],
                        ],
                        eyeShape(s.values),
                        (name) => {
                            const p = EYE_PRESETS.find((e) => e.name === name);
                            if (p) edit({ values: { ...s.values, ...p.values } });
                        },
                        "A starting shape; the sliders below refine it",
                    )}
                    {morphs("Eyes")}
                </>
            );
            break;
        case "brows":
            rows = (
                <>
                    {pick("brows", "Style", nameOf(BROWS, s.brows), () =>
                        setGrid({
                            id: "grid-brows",
                            title: "Brow style",
                            value: s.brows,
                            options: BROWS.map(([id, label]) => ({ id, label })),
                            patch: (brows) => ({ brows }),
                        }),
                    )}
                    {swatchRow("brow-color", "Colour", HAIR_COLORS, s.browColor, (browColor) =>
                        edit({ browColor }),
                    )}
                    {BROW_CONTROLS.map((c) =>
                        slider(
                            c.key,
                            c.label,
                            s[c.key],
                            (v) => edit({ [c.key]: v }),
                            (c.min ?? -100) / 100,
                            (c.max ?? 100) / 100,
                            `${c.low} · ${c.high}`,
                        ),
                    )}
                    {morphs("Brow & forehead")}
                </>
            );
            break;
        case "hair":
            rows = (
                <>
                    {pick("hair", "Style", nameOf(HAIR, s.hair), () =>
                        setGrid({
                            id: "grid-hair",
                            title: "Hair style",
                            value: s.hair,
                            options: HAIR.map(([id, label]) => ({ id, label })),
                            patch: (hair) => ({ hair }),
                        }),
                    )}
                    {swatchRow("hair-color", "Colour", HAIR_COLORS, s.hairColor, (hairColor) =>
                        edit({ hairColor }),
                    )}
                </>
            );
            break;
        case "skin":
            rows = (
                <>
                    {pick("skin", "Texture", nameOf(SKINS, s.skin), () =>
                        setGrid({
                            id: "grid-skin",
                            title: "Skin texture",
                            columns: 2,
                            value: s.skin,
                            options: SKINS.map(([id, label]) => ({ id, label })),
                            patch: (skin) => ({ skin }),
                        }),
                    )}
                    {swatchRow("skin-tint", "Tint", SKIN_TINTS, s.skinTint, (skinTint) =>
                        edit({ skinTint }),
                    )}
                    {slider(
                        "warmth",
                        "Warmth",
                        s.warmth,
                        (warmth) => edit({ warmth }),
                        -1,
                        1,
                        "Cool · Warm",
                    )}
                    {slider(
                        "roughness",
                        "Roughness",
                        s.roughness,
                        (roughness) => edit({ roughness }),
                        0.45,
                        1,
                    )}
                    {swatchRow("blush-color", "Blush", BLUSH, s.blushColor, (blushColor) =>
                        edit({ blushColor }),
                    )}
                    {slider(
                        "blush-amount",
                        "Strength",
                        s.blushAmount,
                        (blushAmount) => edit({ blushAmount }),
                        0,
                        1,
                    )}
                    {stepper(
                        "blush-place",
                        "Placement",
                        [
                            ["apples", "Cheeks"],
                            ["high", "High cheeks"],
                        ],
                        s.blushPlacement,
                        (blushPlacement) => edit({ blushPlacement }),
                    )}
                    {slider(
                        "blush-spread",
                        "Spread",
                        s.blushSpread,
                        (blushSpread) => edit({ blushSpread }),
                        0,
                        1,
                    )}
                </>
            );
            break;
        case "details":
            rows = (
                <>
                    {stepper("glasses", "Eyewear", GLASSES, s.glasses, (glasses) =>
                        edit(
                            s.glasses === "none"
                                ? { glasses, lensTint: DEFAULT_LENS_TINT }
                                : { glasses },
                        ),
                    )}
                    {s.glasses !== "none" && (
                        <>
                            {swatchRow("frame", "Frame", FRAMES, s.glassesColor, (glassesColor) =>
                                edit({ glassesColor }),
                            )}
                            {swatchRow("lens", "Lens", LENSES, s.lensColor, (lensColor) =>
                                edit({ lensColor }),
                            )}
                            {slider(
                                "lens-tint",
                                "Tint",
                                s.lensTint,
                                (lensTint) => edit({ lensTint }),
                                0,
                                1,
                            )}
                        </>
                    )}
                    {stepper("scar", "Scar", SCARS, s.scar, (scar) => edit({ scar }))}
                    {s.scar !== "none" && (
                        <>
                            {stepper(
                                "scar-place",
                                "Placement",
                                [...PLACES, ["bridge", "Nose bridge"]],
                                s.scarPlace,
                                (scarPlace) => edit({ scarPlace }),
                            )}
                            {slider(
                                "scar-amount",
                                "Definition",
                                s.scarAmount,
                                (scarAmount) => edit({ scarAmount }),
                                0,
                                1,
                            )}
                        </>
                    )}
                    {pick("tattoo", "Tattoo", nameOf(TATTOOS, s.tattoo), () =>
                        setGrid({
                            id: "grid-tattoo",
                            title: "Tattoo",
                            value: s.tattoo,
                            options: TATTOOS.map(([id, label]) => ({ id, label })),
                            patch: (tattoo) => ({ tattoo }),
                        }),
                    )}
                    {s.tattoo !== "none" && (
                        <>
                            {stepper(
                                "tattoo-place",
                                "Placement",
                                [...PLACES, ["forehead", "Forehead"]],
                                s.tattooPlace,
                                (tattooPlace) => edit({ tattooPlace }),
                            )}
                            {swatchRow("ink", "Ink", INKS, s.tattooColor, (tattooColor) =>
                                edit({ tattooColor }),
                            )}
                            {slider(
                                "ink-opacity",
                                "Opacity",
                                s.tattooOpacity,
                                (tattooOpacity) => edit({ tattooOpacity }),
                                0,
                                1,
                            )}
                        </>
                    )}
                </>
            );
            break;
        case "kit":
            rows = (
                <SwatchRow
                    id="look-armor"
                    group="inspector"
                    label="Armor"
                    swatches={ARMOR_FINISHES.map((finish) => ({
                        id: finish.name,
                        name: finish.name,
                        colors: [
                            finish.colors.primary,
                            finish.colors.secondary,
                            finish.colors.accent,
                        ],
                    }))}
                    value={
                        ARMOR_FINISHES.find(
                            (f) => JSON.stringify(f.colors) === JSON.stringify(look.armorColors),
                        )?.name ?? ARMOR_FINISHES[0].name
                    }
                    onChange={(name) =>
                        edit({}, ARMOR_FINISHES.find((f) => f.name === name)?.colors)
                    }
                    title="Armor finish"
                    hint="Primary, secondary and accent plates"
                    commands={valueCommands}
                />
            );
            break;
    }

    return (
        <>
            <Stepper
                id="look-section"
                group="inspector"
                label="Section"
                options={SECTIONS.map(([id, label]) => [id, label])}
                value={section}
                onChange={(id) => {
                    setSection(id as SectionId);
                    onSection(id as SectionId);
                }}
                title="Appearance"
                hint="Body, face, eyes, brows, hair, skin, details, kit"
                commands={[
                    { action: "nav", label: "Section", glyph: "lr" },
                    { action: "confirm", label: "Randomise", run: randomise },
                    ...reset,
                    toRoster,
                ]}
            />
            <List label="Appearance" key={section}>
                {rows}
            </List>
        </>
    );
}
