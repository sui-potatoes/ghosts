// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Bakes the hire presets into the ghosts Move package: the character presets
 * from `@ghosts/squad` topped up with seeded random identities to sixteen per
 * sex (`PRESETS_PER_GENDER`), each with its own seeded proportions, encoded
 * with the appearance codec and written between the `presets:begin` /
 * `presets:end` markers of `ghosts::ghosts::visual_presets`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ARMOR_FINISHES } from "../../packages/squad/src/armor-colors.ts";
import { AREAS, encodeVisuals, packArea } from "../../packages/squad/src/appearance/codec.ts";
import {
    fromPreset,
    normalize,
    presets,
    randomIdentity,
} from "../../packages/squad/src/appearance/editor-state.js";
import { schema } from "../../packages/squad/src/appearance/schema.ts";
import type { Appearance, Sex } from "../../packages/squad/src/types.ts";

const TARGET = fileURLToPath(
    new URL("../../move/packages/ghosts/sources/ghosts.move", import.meta.url),
);
const PER_SEX = 16;

/** Park–Miller: the seeded identities never change between runs. */
function seeded(seed: number) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Seeded proportions, so hires don't share one silhouette; field-fit, not extreme. */
function proportions(random: () => number) {
    const dial = (min: number, max: number) => +(min + (max - min) * random()).toFixed(2);
    return {
        height: dial(-0.35, 0.4),
        build: dial(-0.3, 0.4),
        muscle: dial(0, 0.55),
        chest: dial(-0.2, 0.3),
        waist: dial(-0.3, 0.2),
        hips: dial(-0.2, 0.25),
    };
}

/** Styles that read as the preset's sex on the field kit; random identities pick from every style. */
const HAIR_BY_SEX: Record<Sex, string[]> = {
    male: ["none", "short01", "short02", "short04"],
    female: ["bob01", "ponytail01", "braid01"],
};

function looks(sex: Sex): Appearance[] {
    const own = presets.filter((p) => p.sex === sex).map((p) => normalize(fromPreset(p), schema));
    const random = seeded(sex === "male" ? 4111 : 2087);
    while (own.length < PER_SEX) {
        const look = randomIdentity(schema, sex, random, own.at(-1));
        const hair = HAIR_BY_SEX[sex];
        if (!hair.includes(look.hair)) look.hair = hair[Math.floor(random() * hair.length)];
        own.push(look);
    }
    return own.slice(0, PER_SEX).map((a) => normalize({ ...a, body: proportions(random) }, schema));
}

const rows = [...looks("male"), ...looks("female")].map((appearance, i) => {
    const areas = encodeVisuals(appearance, ARMOR_FINISHES[i % ARMOR_FINISHES.length].colors);
    return AREAS.map((area) => `0x${packArea(areas[area]).toString(16)}`);
});

const body = [
    "    vector[",
    ...rows.map((row) => `        vector[${row.join(", ")}],`),
    "    ]",
].join("\n");

const source = readFileSync(TARGET, "utf8");
const pattern = /(\/\/ presets:begin[^\n]*\n)[\s\S]*?(\n\s*\/\/ presets:end)/;
if (!pattern.test(source)) throw Error(`presets markers not found in ${TARGET}`);
writeFileSync(TARGET, source.replace(pattern, `$1${body}$2`));
console.log(`wrote ${rows.length} presets to ${TARGET}`);
