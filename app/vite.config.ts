import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        target: "es2022",
        rollupOptions: {
            input: {
                main: "index.html",
                demo: "demo-runtime/index.html",
            },
        },
    },
    plugins: [tailwindcss(), react()],
    // `app/` takes 5173; keep both dev servers runnable side by side.
    server: { port: 5174 },
});
