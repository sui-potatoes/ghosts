import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { NodeIO } from "@gltf-transform/core";
import { MeshoptEncoder } from "meshoptimizer";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

const CONCURRENCY = 4;

/** The JSON chunk of a GLB, enough to tell whether it is already compressed. */
function declaresMeshopt(glb: Buffer) {
    const length = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + length).toString("utf8"));
    return Boolean(json.extensionsUsed?.includes("EXT_meshopt_compression"));
}

function glbFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return glbFiles(path);
        return entry.name.endsWith(".glb") ? [path] : [];
    });
}

/**
 * Meshopt-compresses every `.glb` in the build output, geometry only; the
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
 * transforms and inverse bind matrices). Textures and animations are copied
 * untouched. Set `GHOSTS_RAW_MODELS=1` to ship the raw files.
 *
 * Runs before `ghosts-asset-manifest` hashes the output.
 */
export function meshoptModels(): Plugin {
    let outDir = "";
    return {
        name: "ghosts-meshopt-models",
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
                    converted = 0;
                const queue = [...files];
                const worker = async () => {
                    for (let path = queue.shift(); path; path = queue.shift()) {
                        const raw = readFileSync(path);
                        if (declaresMeshopt(raw)) continue;
                        try {
                            const document = await io.readBinary(new Uint8Array(raw));
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
                                `meshopt compression failed for ${relative(outDir, path)}: ${error}`,
                            );
                        }
                    }
                };
                await Promise.all(Array.from({ length: CONCURRENCY }, worker));
                const mb = (n: number) => (n / 1e6).toFixed(1);
                console.log(
                    `meshopt: ${converted}/${files.length} glb, ${mb(before)} -> ${mb(after)} MB`,
                );
            },
        },
    };
}
