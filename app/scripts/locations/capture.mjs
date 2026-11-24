// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Renders the location pictures the mission console shows: each playable
 * place from its real scene, at its authored camera, with no HUD, no grid and
 * no cutaway (`?shot=…&capture`, `packages/engine/src/scene/capture.ts`).
 * A fresh build is served by `vite preview` on a free port and opened in a
 * headless Chromium at 1600x900 and device pixel ratio 2; the 3200x1800 frame
 * is scaled down to `app/public/locations/<id>.webp` (1600x900) and
 * `<id>-thumb.webp` (640x360).
 *
 *   node app/scripts/locations/capture.mjs                    every location
 *   node app/scripts/locations/capture.mjs night-shift basics  only these
 *
 * Options: `--no-build` reuses the last build this script made,
 * `--origin=http://127.0.0.1:4491` shoots from a server already running (no
 * build, no server), `--candidates=shots.json --out=dir` renders a list of
 * trial framings (`[{ location, name, shot, query? }]`) into `dir` with one
 * contact sheet per location instead of the finals. `BROWSER=/path` picks the
 * browser (any Chromium). Everything started here is stopped on the way out.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * The locations and their cameras: position, target, vertical field of view
 * and seconds of scene time before the frame is held; `query` adds capture
 * flags (`look=time:weather`, `units`, `cut`).
 */
const LOCATIONS = {
    // From across the main road: the taxi rank, the lit store front and its car park, the block behind.
    "night-shift": {
        route: "/demo-night-shift",
        shot: "-18.3,4.5,25.7,2.7,3.3,4.7,28,3",
        query: "look=night:light-rain",
    },
    // Low over the roadworks crate: the crossroads, the relay at its centre, the corner shop lit.
    "black-rain": {
        route: "/demo",
        shot: "-8.5,2.4,8.5,0,2.1,-3.5,32,3",
        query: "look=night:heavy-rain",
    },
    // Inside, over the south desks: the central aisle to the records room, tilted down past the open ceiling.
    "paper-trail": {
        route: "/demo-2",
        shot: "0,4.4,9.5,0,-0.6,-4,32,3",
        query: "",
    },
    // The first lesson's room from its south-west corner, its glowing edges framing it.
    basics: {
        route: "/demo-basics",
        shot: "-8.2,6.2,9.6,0.2,0.3,-1,32,3",
        query: "lesson=contact",
    },
};

const WIDTH = 1600;
const HEIGHT = 900;
const SCALE = 2;
const THUMB = [640, 360];
/** Sound off, full render tier. */
const SETTINGS = { audio: { muted: true }, display: { batterySaver: false } };

const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const dist = join(app, "node_modules", ".cache", "capture-locations");
const finals = join(app, "public", "locations");

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
const profile = mkdtempSync(join(tmpdir(), "ghosts-locations-"));
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

/** Serve a build: the given origin, or a fresh (or the last) build on a free port. */
async function serve() {
    const given = option("origin");
    if (given) return given;
    if (!args.includes("--no-build") || !existsSync(join(dist, "index.html")))
        await done(run("pnpm", ["exec", "vite", "build", "--outDir", dist, "--emptyOutDir"]));
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    run(
        "pnpm",
        // prettier-ignore
        ["exec", "vite", "preview", "--outDir", dist, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        { stdio: "ignore" },
    );
    await until("vite preview", async () => (await fetch(origin)).ok, 30);
    return origin;
}

/** A headless browser with one page; `shoot(url)` resolves with the held frame as PNG bytes. */
async function browser() {
    const binary = BROWSERS.find((path) => path && existsSync(path));
    if (!binary) throw new Error("No Chromium browser found; set BROWSER=/path/to/binary");
    const chrome = run(
        binary,
        [
            "--headless=new",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            `--window-size=${WIDTH},${HEIGHT}`,
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
        deviceScaleFactor: SCALE,
        mobile: false,
    });
    await page("Page.addScriptToEvaluateOnNewDocument", {
        source: `localStorage.setItem("ghosts:settings", ${JSON.stringify(JSON.stringify(SETTINGS))});`,
    });
    const evaluate = async (expression) =>
        (await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))
            .result.value;
    return async (url) => {
        await page("Page.navigate", { url });
        await new Promise((r) => setTimeout(r, 500));
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
            240,
        );
        await evaluate(
            `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
        );
        const { data } = await page("Page.captureScreenshot", { format: "png" });
        return Buffer.from(data, "base64");
    };
}

const urlOf = (origin, location, shot, query) =>
    `${origin}${LOCATIONS[location].route}?shot=${shot}&capture&scale=${SCALE}${query ? `&${query}` : ""}`;

/** The supersampled frame at a size, as WebP. */
const webp = (png, [width, height], quality) =>
    sharp(png)
        .resize(width, height, { kernel: "lanczos3" })
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer();

/** One sheet per location: every candidate as a labelled thumbnail, three to a row. */
async function sheet(tiles, out) {
    const [w, h] = THUMB;
    const label = 28;
    const columns = Math.min(3, tiles.length);
    const rows = Math.ceil(tiles.length / columns);
    const composite = [];
    for (const [i, { name, png }] of tiles.entries()) {
        const left = (i % columns) * w;
        const top = Math.floor(i / columns) * (h + label);
        composite.push({ input: await sharp(png).resize(w, h).png().toBuffer(), left, top });
        const text = Buffer.from(
            `<svg width="${w}" height="${label}"><rect width="100%" height="100%" fill="#0b0f14"/><text x="10" y="19" font-family="Menlo, monospace" font-size="15" fill="#cfe3ea">${name}</text></svg>`,
        );
        composite.push({ input: text, left, top: top + h });
    }
    await sharp({
        create: {
            width: columns * w,
            height: rows * (h + label),
            channels: 3,
            background: "#0b0f14",
        },
    })
        .composite(composite)
        .webp({ quality: 85 })
        .toFile(out);
}

async function main() {
    const origin = await serve();
    const shoot = await browser();
    const list = option("candidates");
    if (list) {
        const out = resolve(option("out") ?? "shots");
        mkdirSync(out, { recursive: true });
        const tiles = new Map();
        for (const { location, name, shot, query } of JSON.parse(readFileSync(list, "utf8"))) {
            const png = await shoot(
                urlOf(origin, location, shot, query ?? LOCATIONS[location].query),
            );
            writeFileSync(
                join(out, `${location}-${name}.webp`),
                await webp(png, [WIDTH, HEIGHT], 88),
            );
            if (!tiles.has(location)) tiles.set(location, []);
            tiles.get(location).push({ name, png });
            console.log(`${location}-${name}`);
        }
        for (const [location, shots] of tiles)
            await sheet(shots, join(out, `${location}-sheet.webp`));
        return;
    }
    const only = args.filter((a) => !a.startsWith("--"));
    mkdirSync(finals, { recursive: true });
    for (const [id, { shot, query }] of Object.entries(LOCATIONS)) {
        if (only.length && !only.includes(id)) continue;
        const png = await shoot(urlOf(origin, id, shot, query));
        // The best quality that keeps the picture under 350 KB.
        let quality = 90;
        let full = await webp(png, [WIDTH, HEIGHT], quality);
        while (full.length > 350_000 && quality > 60)
            full = await webp(png, [WIDTH, HEIGHT], (quality -= 4));
        writeFileSync(join(finals, `${id}.webp`), full);
        writeFileSync(join(finals, `${id}-thumb.webp`), await webp(png, THUMB, 82));
        console.log(`${id}.webp ${Math.round(full.length / 1024)} KB (q${quality})`);
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(error.message);
        process.exit(1);
    },
);
