import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** The checked-out commit, read once when the config loads; null outside a git checkout. */
function lastCommit() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

/** Build output the service worker never caches: documents, its own files, notes. */
const UNCACHED =
    /(^|\/)(index\.html|sw\.js|asset-manifest\.json|_headers|\.DS_Store)$|\.(map|md|txt)$/;

/**
 * Writes `asset-manifest.json` next to the build: every shipped file with a
 * short content hash. `public/sw.js` reads it on each visit, downloads what is
 * new or changed in the background and serves the rest from its cache, so the
 * game's assets survive reloads and catch up with a deploy by the next one.
 */
function assetManifest(): Plugin {
    let outDir = "";
    return {
        name: "ghosts-asset-manifest",
        apply: "build",
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
            const files: Record<string, string> = {};
            const walk = (dir: string) => {
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const path = join(dir, entry.name);
                    if (entry.isDirectory()) walk(path);
                    else {
                        const url = "/" + relative(outDir, path).split(sep).join("/");
                        if (UNCACHED.test(url)) continue;
                        files[url] = createHash("sha1")
                            .update(readFileSync(path))
                            .digest("hex")
                            .slice(0, 12);
                    }
                }
            };
            walk(outDir);
            writeFileSync(join(outDir, "asset-manifest.json"), JSON.stringify({ files }));
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        target: "es2022",
    },
    define: {
        __COMMIT__: JSON.stringify(lastCommit()),
    },
    plugins: [tailwindcss(), react(), assetManifest()],
    // The Sui Potatoes app takes 5173; keep both dev servers runnable side by side.
    server: { port: 5174 },
});
