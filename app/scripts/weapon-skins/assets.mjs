// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// Stage 5: the shipped files, in app/public/squad/weapons/skins/:
//   <gun>.glb: body / clip / stock meshes (and <piece>-glow for indicators) in
//   the Armory weapon frame, one material carrying the shared normal map
//   (lossless WebP) and AO (lossy WebP, 512).
//   <gun>-<skin>-base.webp (sRGB colour) and <gun>-<skin>-rm.webp (G roughness,
//   B metalness), lossy q90. Stale skin maps of the gun are removed.
//   node assets.mjs <gun> <work-dir> [out-dir]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const [gun, work, out = join(here, "../../public/squad/weapons/skins")] = process.argv.slice(2);
if (!gun || !work) {
    console.error("usage: assets.mjs <gun> <work-dir> [out-dir]");
    process.exit(2);
}
mkdirSync(out, { recursive: true });
const tex = (name) => readFileSync(join(work, "textures", `${name}.png`));
const lossless = (png) => sharp(png).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
const lossy = (png) => sharp(png).webp({ quality: 90, effort: 6, smartSubsample: true }).toBuffer();

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(join(work, "geometry.glb"));
const root = doc.getRoot();
for (const t of root.listTextures()) t.dispose();
const image = async (name, data) =>
    doc.createTexture(name).setImage(new Uint8Array(data)).setMimeType("image/webp");
const normal = await image(`${gun}-normal`, await lossless(tex("normal")));
// AO is low-frequency (3 cm reach): half resolution is plenty.
const ao = await image(
    `${gun}-ao`,
    await lossy(await sharp(tex("ao")).resize(512, 512).png().toBuffer()),
);
doc.createExtension(
    ALL_EXTENSIONS.find((e) => e.EXTENSION_NAME === "EXT_texture_webp"),
).setRequired(true);
for (const m of root.listMaterials()) {
    if (m.getName() === "glow") {
        m.setBaseColorFactor([1, 1, 1, 1]);
        continue;
    }
    m.setName(`${gun}/Skin`)
        .setBaseColorFactor([1, 1, 1, 1])
        .setRoughnessFactor(1)
        .setMetallicFactor(1);
    m.setNormalTexture(normal).setOcclusionTexture(ao);
}
// Glow pieces are drawn untextured: no UVs or tangents.
for (const mesh of root.listMeshes())
    if (mesh.getName().endsWith("-glow"))
        for (const p of mesh.listPrimitives())
            for (const a of ["TEXCOORD_0", "TANGENT"]) p.getAttribute(a)?.dispose();
for (const node of root.listNodes())
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const glb = await io.writeBinary(doc);
writeFileSync(join(out, `${gun}.glb`), glb);
const sizes = {
    [`${gun}.glb`]: glb.length,
    normal: normal.getImage().length,
    ao: ao.getImage().length,
};

const recipes = Object.keys(JSON.parse(readFileSync(join(work, "recipes.json"), "utf8")));
const keep = new Set();
for (const skin of recipes)
    for (const kind of ["base", "rm"]) {
        const file = `${gun}-${skin}-${kind}.webp`;
        const webp = await lossy(tex(`${skin}_${kind}`));
        writeFileSync(join(out, file), webp);
        keep.add(file);
        sizes[file] = webp.length;
    }
for (const file of readdirSync(out))
    if (file.startsWith(`${gun}-`) && file.endsWith(".webp") && !keep.has(file)) {
        rmSync(join(out, file));
        console.log("removed stale", file);
    }
console.log(JSON.stringify(sizes, null, 1));
