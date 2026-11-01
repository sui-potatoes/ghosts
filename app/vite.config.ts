import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

/** The checked-out commit, read once when the config loads; null outside a git checkout. */
function lastCommit() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        target: "es2022",
    },
    define: {
        __COMMIT__: JSON.stringify(lastCommit()),
    },
    plugins: [tailwindcss(), react()],
    // The Sui Potatoes app takes 5173; keep both dev servers runnable side by side.
    server: { port: 5174 },
});
