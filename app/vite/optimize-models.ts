import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { type Document, NodeIO, PropertyType } from "@gltf-transform/core";
import { dedup } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { Plugin } from "vite";

const CONCURRENCY = 4;

/** The JSON chunk of a GLB, enough to tell whether it is already compressed. */
function declaresMeshopt(glb: Buffer) {
    const length = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
    return Boolean(json.extensionsUsed?.includes("EXT_meshopt_compression"));
}

/**
 * Lossless WebP for every PNG, kept only when smaller; the loader reads it
 * through EXT_texture_webp, as it already does for the armor and body models.
 * `exact` keeps the colour under transparent pixels, so decoded RGBA matches
 * the PNG's bit for bit.
 */
async function recompressTextures(document: Document) {
    for (const texture of document.getRoot().listTextures()) {
        if (texture.getMimeType() !== "image/png") continue;
        const image = texture.getImage();
        if (!image) continue;
        const webp = await sharp(image).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
        if (webp.length >= image.length) continue;
        texture.setImage(new Uint8Array(webp)).setMimeType("image/webp");
    }
}

function textureBytes(document: Document) {
    return document
        .getRoot()
        .listTextures()
        .reduce((sum, texture) => sum + (texture.getImage()?.length ?? 0), 0);
}

function glbFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return glbFiles(path);
        return entry.name.endsWith(".glb") ? [path] : [];
    });
}

/**
 * Optimizes every `.glb` in the build output: meshopt geometry and lighter
 * textures. The
 * sources in `public/` stay raw, and the loaders register the decoder
 * unconditionally (`@ghosts/squad/studio/gltf-loader`), so dev loads the raw
 * files and production the compressed ones.
 *
 * The compression is lossless on purpose: no reorder, no quantization, no
 * weld/dedupe. Vertex data stays Float32 in the original vertex order and
 * count, because the `*.morphs.bin` files index vertices by position in the
 * array, `_RIGID_FIT` groups and skin weights are per vertex, and the squad
 * code rewrites `position.array` as a Float32Array and adds morph deltas in
 * absolute model units (KHR_mesh_quantization would move that scale into node
 * transforms and inverse bind matrices). Animations are copied untouched.
 *
 * Textures: byte-identical images inside one file are merged (`dedup` on
 * textures only, never accessors or meshes), then PNGs become lossless WebP.
 * Pixels, sizes, channels, samplers and UV transforms are unchanged. Set `GHOSTS_RAW_MODELS=1` to ship the raw files.
 *
 * Runs before `ghosts-asset-manifest` hashes the output.
 */
export function optimizeModels(): Plugin {
    let outDir = "";
    return {
        name: "ghosts-optimize-models",
        apply: "build",
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle: {
            order: "pre",
            sequential: true,
            async handler() {
                if (process.env.GHOSTS_RAW_MODELS === "1") return;
                const files = glbFiles(outDir);
                await MeshoptEncoder.ready;
                const io = new NodeIO()
                    .registerExtensions(ALL_EXTENSIONS)
                    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
                let before = 0,
                    after = 0,
                    converted = 0,
                    texturesBefore = 0,
                    texturesAfter = 0;
                const queue = [...files];
                const worker = async () => {
                    for (let path = queue.shift(); path; path = queue.shift()) {
                        const raw = readFileSync(path);
                        if (declaresMeshopt(raw)) continue;
                        try {
                            const document = await io.readBinary(new Uint8Array(raw));
                            texturesBefore += textureBytes(document);
                            await document.transform(
                                dedup({ propertyTypes: [PropertyType.TEXTURE] }),
                            );
                            await recompressTextures(document);
                            texturesAfter += textureBytes(document);
                            document
                                .createExtension(EXTMeshoptCompression)
                                .setRequired(true)
                                .setEncoderOptions({
                                    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
                                });
                            const packed = await io.writeBinary(document);
                            writeFileSync(path, packed);
                            before += raw.length;
                            after += packed.length;
                            converted++;
                        } catch (error) {
                            throw new Error(
                                `model optimization failed for ${relative(outDir, path)}: ${error}`,
                                { cause: error },
                            );
                        }
                    }
                };
                await Promise.all(Array.from({ length: CONCURRENCY }, worker));
                const mb = (n: number) => (n / 1e6).toFixed(1);
                console.log(
                    `models: ${converted}/${files.length} glb, ${mb(before)} -> ${mb(after)} MB ` +
                        `(textures ${mb(texturesBefore)} -> ${mb(texturesAfter)} MB)`,
                );
            },
        },
    };
}
