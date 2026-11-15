// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Takes the reference screenshot of the demo level: a fresh build served by
 * `vite preview` on a free port, `/demo?shot=…` (the engine's dev-only pinned
 * camera and held frame, `packages/engine/src/scene/shot.ts`) in a headless
 * Chromium at 1600x900, device pixel ratio 1, sound muted.
 *
 *   node app/scripts/capture-shot.mjs before     → docs/design/visuals/before.png
 *   node app/scripts/capture-shot.mjs after      → docs/design/visuals/after.png
 *
 * Options: `--no-build` reuses the last build this script made, `--shot=…`
 * overrides the camera (`px,py,pz,tx,ty,tz,fov[,seconds]`), `--route=/demo-2`
 * shoots the office level, `--time=day` picks a time of day (morning, day,
 * evening, night), `--weather=snow` the weather (clear, rain, snow), `--battery` keeps battery saver on (the cheaper render
 * tier), `--plain` bypasses the post pipeline, `--query=noair` appends any
 * other dev flag to the URL, `--profile` prints the frame's
 * draw calls and timings. `BROWSER=/path/to/binary` picks the browser; any
 * Chromium works (Chrome, Chromium, Brave, Edge). No dependencies: the browser
 * is driven over the DevTools protocol. Everything started here is stopped on
 * the way out.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The reference pose: camera position, target, field of view. */
const SHOT = "14,9,17,0,1,-1,39";
const WIDTH = 1600;
const HEIGHT = 900;
/** Sound off, and full render resolution: battery saver would draw this viewport at 0.83x. */
const SETTINGS = { audio: { muted: true }, display: { batterySaver: false } };

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(app, "..");
const args = process.argv.slice(2);
const option = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const name = args.find((a) => !a.startsWith("--")) ?? "before";
const out = isAbsolute(name)
    ? name
    : resolve(repo, "docs/design/visuals", name.endsWith(".png") ? name : `${name}.png`);
const shot = option("shot") ?? SHOT;
const route = option("route") ?? "/demo";
const time = option("time");
const weather = option("weather");
const profiling = args.includes("--profile");
SETTINGS.display.batterySaver = args.includes("--battery");
/** Its own output folder, so the build never touches `app/dist`. */
const dist = join(app, "node_modules", ".cache", "capture-shot");

const BROWSERS = [
    process.env.BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
];

const children = [];
const profile = mkdtempSync(join(tmpdir(), "ghosts-shot-"));
function cleanup() {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(1));

function run(command, argv, options = {}) {
    const child = spawn(command, argv, { cwd: app, stdio: "inherit", ...options });
    children.push(child);
    return child;
}

function done(child) {
    return new Promise((ok, fail) => {
        child.on("error", fail);
        child.on("exit", (code) =>
            code === 0 ? ok() : fail(new Error(`${child.spawnfile} exited with ${code}`)),
        );
    });
}

function freePort() {
    return new Promise((ok, fail) => {
        const server = createServer();
        server.on("error", fail);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => ok(port));
        });
    });
}

async function until(what, check, seconds) {
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
        if (await check().catch(() => false)) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 250));
    }
}

/** A DevTools protocol connection: `send(method, params, sessionId)` resolves with the result. */
function devtools(url) {
    return new Promise((ok, fail) => {
        const socket = new WebSocket(url);
        const pending = new Map();
        let id = 0;
        socket.onerror = () => fail(new Error("DevTools connection failed"));
        socket.onmessage = ({ data }) => {
            const message = JSON.parse(data);
            const call = pending.get(message.id);
            if (!call) return;
            pending.delete(message.id);
            if (message.error) call.fail(new Error(message.error.message));
            else call.ok(message.result);
        };
        socket.onopen = () =>
            ok(
                (method, params = {}, sessionId) =>
                    new Promise((ok, fail) => {
                        pending.set(++id, { ok, fail });
                        socket.send(JSON.stringify({ id, method, params, sessionId }));
                    }),
            );
    });
}

async function main() {
    const browser = BROWSERS.find((path) => path && existsSync(path));
    if (!browser) throw new Error("No Chromium browser found; set BROWSER=/path/to/binary");

    if (!args.includes("--no-build") || !existsSync(join(dist, "index.html"))) {
        await done(run("pnpm", ["exec", "vite", "build", "--outDir", dist, "--emptyOutDir"]));
    }

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    run(
        "pnpm",
        // prettier-ignore
        ["exec", "vite", "preview", "--outDir", dist, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        { stdio: "ignore" },
    );
    await until("vite preview", async () => (await fetch(origin)).ok, 30);

    const chrome = run(
        browser,
        [
            "--headless=new",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            `--window-size=${WIDTH},${HEIGHT}`,
            "--force-device-scale-factor=1",
            "--hide-scrollbars",
            "--mute-audio",
            "--no-first-run",
            "--no-default-browser-check",
            "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );
    const endpoint = await new Promise((ok, fail) => {
        let log = "";
        chrome.stderr.on("data", (chunk) => {
            log += chunk;
            const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) ok(match[1]);
        });
        chrome.on("exit", () => fail(new Error(`The browser exited early:\n${log}`)));
    });

    const send = await devtools(endpoint);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page("Page.enable");
    await page("Emulation.setDeviceMetricsOverride", {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await page("Page.addScriptToEvaluateOnNewDocument", {
        source: `localStorage.setItem("ghosts:settings", ${JSON.stringify(JSON.stringify(SETTINGS))});`,
    });
    const url = `${origin}${route}?shot=${shot}${time ? `&time=${time}` : ""}${weather ? `&weather=${weather}` : ""}${profiling ? "&profile" : ""}${args.includes("--plain") ? "&plain" : ""}${option("query") ? `&${option("query")}` : ""}`;
    await page("Page.navigate", { url });

    const evaluate = async (expression) =>
        (await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))
            .result.value;
    await until(
        "the held frame",
        async () => {
            const state = await evaluate(
                `document.querySelector("#loading p")?.textContent === "3D renderer unavailable"
                    ? "failed" : document.querySelector("#viewport")?.dataset.shot ?? ""`,
            );
            if (state === "failed") throw new Error("The page could not start its 3D renderer");
            return state === "ready";
        },
        180,
    );
    // Fonts in, the HUD laid out, and the held frame on screen.
    await evaluate(
        `document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))`,
    );
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(data, "base64"));
    console.log(`${out}\n${url.replace(origin, "")}`);
    if (profiling) {
        console.log(
            await evaluate(
                `(({ renderMode, renderCalls, renderTriangles, profile }) => JSON.stringify({ renderMode, renderCalls, renderTriangles, ...JSON.parse(profile ?? "{}") }))(document.querySelector("#viewport").dataset)`,
            ),
        );
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error.message);
        process.exit(1);
    },
);
