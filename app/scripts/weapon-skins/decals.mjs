// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// The skins' marking images (white or coloured on transparent), drawn from SVG.
// Fictional markings only. Each image covers its decal's footprint in skins.py
// (stencil 52 x 22 mm, roundel 27 mm, small text 200 x 4 mm).
//   node decals.mjs <out-dir>
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
if (!out) {
    console.error("usage: decals.mjs <out-dir>");
    process.exit(2);
}
mkdirSync(out, { recursive: true });
const font = "font-family='Helvetica, Arial, sans-serif'";
const png = (name, w, h, body) =>
    sharp(
        Buffer.from(
            `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`,
        ),
    )
        .png()
        .toFile(`${out}/${name}`);

// Stencil block, 20 px per mm.
const mm = 20;
const line = (text, y, size) =>
    `<text x='${2 * mm}' y='${y * mm}' font-size='${size * mm}' ${font} fill='white' letter-spacing='${size * 0.1 * mm}'>${text}</text>`;
await png(
    "stencil.png",
    52 * mm,
    22 * mm,
    line("SABLE / 04", 7.5, 4.05) +
        line("GHOST SYSTEMS", 13.5, 2.34) +
        line("SN 004-271", 19, 1.98),
);
const roundel = (number) =>
    `<circle cx='500' cy='500' r='490' fill='#1d3b8f'/><circle cx='500' cy='500' r='360' fill='#f2efe6'/>` +
    `<circle cx='500' cy='500' r='250' fill='#b3231d'/><text x='500' y='590' text-anchor='middle' font-size='260' font-weight='bold' ${font} fill='#f2efe6'>${number}</text>`;
await png("roundel_L.png", 1000, 1000, roundel("7"));
await png("roundel_R.png", 1000, 1000, roundel("13"));
await png(
    "smalltext.png",
    4000,
    80,
    `<text x='2000' y='62' text-anchor='middle' font-size='70' ${font} fill='#111316'>PROPERTY OF GHOST SYSTEMS · INSPECTION ARTICLE · LOT 004-271 · DO NOT REMOVE</text>`,
);
console.log("DECALS", out);
