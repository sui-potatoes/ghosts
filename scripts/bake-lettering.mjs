// Bake the shop pack's lettering into one texture atlas.
//
// Input: every entry of packages/engine/src/shop/lettering.ts. Fonts: assets-src/fonts/ (Yuji
// Syuku for `brush`, Noto Sans JP for `sans`), read on this machine only and never shipped.
// Output, both committed:
//   app/public/demo-assets/textures/shop/lettering.png   white glyphs on clear, 1024 × 1024
//   packages/engine/src/shop/lettering-atlas.ts          id → UV rect and aspect
// Strings that share text, face and direction share one image. Vertical strings are set one
// glyph per row, centred, with the long vowel mark turned.
//
// Node has no canvas, so a real browser draws it. Two steps:
//   1. node scripts/bake-lettering.mjs        (prints the bake page URL and its own pid)
//   2. open that URL in a browser on this machine; the page loads the faces with FontFace,
//      draws the atlas, posts the PNG back, the script writes both files and exits.
// Re-run only when the lettering list changes. If the page never posts, stop the server by
// the printed pid.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "packages/engine/src/shop/lettering.ts"), "utf8");
const entries = [...source.matchAll(/\{ id: "([^"]+)", text: "([^"]+)", font: "(brush|sans)",(?: weight: (\d+),)? shape: "(h|v|s)"/g)]
  .map(([, id, text, font, weight, shape]) => ({ id, text, font, weight: Number(weight ?? (font === "sans" ? 700 : 400)), shape }));
const fonts = {
  brush: join(root, "assets-src/fonts/yujisyuku/YujiSyuku-Regular.ttf"),
  sans: join(root, "assets-src/fonts/notosansjp/NotoSansJP[wght].ttf"),
};
const png = join(root, "app/public/demo-assets/textures/shop/lettering.png");
const map = join(root, "packages/engine/src/shop/lettering-atlas.ts");

const page = `<!doctype html><meta charset="utf-8"><title>bake lettering</title>
<body style="background:#333;color:#ddd;font:14px monospace"><p id="state">baking…</p><canvas id="c" width="1024" height="1024" style="background:#000"></canvas>
<script type="module">
const entries = ${JSON.stringify(entries)};
const families = { brush: "BakeBrush", sans: "BakeSans" };
for (const [font, family] of Object.entries(families)) document.fonts.add(await new FontFace(family, "url(/font/" + font + ")").load());
const SIZE = 1024, EM = 66, PAD = 5;
const ctx = document.getElementById("c").getContext("2d");
const set = (e) => ctx.font = e.weight + " " + EM + "px " + families[e.font];
// One image per distinct text, face and direction; boxes measured first, then shelf-packed tallest first.
const images = new Map();
for (const e of entries) {
  const key = e.text + "|" + e.font + "|" + e.shape + "|" + e.weight;
  if (!images.has(key)) {
    set(e);
    const chars = [...e.text];
    const w = e.shape === "v" || e.shape === "s" ? EM : Math.ceil(ctx.measureText(e.text).width);
    const h = e.shape === "v" ? chars.length * EM : EM;
    images.set(key, { e, chars, w: w + PAD * 2, h: Math.round(h * 1.1) + PAD * 2, ids: [] });
  }
  images.get(key).ids.push(e.id);
}
const boxes = [...images.values()].sort((a, b) => b.h - a.h);
let x = 0, y = 0, shelf = 0;
for (const b of boxes) {
  if (x + b.w > SIZE) { x = 0; y += shelf; shelf = 0; }
  if (y + b.h > SIZE) throw new Error("atlas full");
  b.x = x; b.y = y; x += b.w; shelf = Math.max(shelf, b.h);
}
ctx.clearRect(0, 0, SIZE, SIZE);
ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
for (const b of boxes) {
  set(b.e);
  const cx = b.x + b.w / 2;
  if (b.e.shape !== "v") { ctx.fillText(b.e.text, cx, b.y + b.h / 2 + EM * 0.04); continue; }
  const step = (b.h - PAD * 2) / b.chars.length;
  b.chars.forEach((ch, i) => {
    const cy = b.y + PAD + step * (i + 0.5);
    if (ch === "ー" || ch === "〜") { ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore(); }
    else ctx.fillText(ch, cx, cy + EM * 0.04);
  });
}
const rects = {};
for (const b of boxes) for (const id of b.ids)
  rects[id] = [b.x / SIZE, 1 - (b.y + b.h) / SIZE, (b.x + b.w) / SIZE, 1 - b.y / SIZE, +(b.w / b.h).toFixed(4)];
const data = document.getElementById("c").toDataURL("image/png");
const r = await fetch("/atlas", { method: "POST", body: JSON.stringify({ data, rects, size: SIZE }) });
document.getElementById("state").textContent = r.ok ? "written: " + Object.keys(rects).length + " strings, " + boxes.length + " images" : "failed";
</script>`;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
  if (req.method === "GET" && req.url?.startsWith("/font/")) {
    const file = fonts[req.url.slice(6)];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "font/ttf" }); res.end(readFileSync(file)); return;
  }
  if (req.method === "POST" && req.url === "/atlas") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { data, rects, size } = JSON.parse(body);
      mkdirSync(dirname(png), { recursive: true });
      writeFileSync(png, Buffer.from(data.split(",")[1], "base64"));
      const rows = Object.entries(rects).map(([id, r]) => `  "${id}": [${r.join(", ")}],`).join("\n");
      writeFileSync(map, `// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

// Generated by scripts/bake-lettering.mjs from lettering.ts: do not edit by hand.
// Each string's rectangle in demo-assets/textures/shop/lettering.png, as
// [u0, v0, u1, v1, width / height]; white glyphs on clear, tinted by material.
export const letteringAtlas = {
  file: "textures/shop/lettering.png",
  size: ${size},
  rects: {
${rows}
  } as Record<string, readonly [number, number, number, number, number]>,
};
`);
      console.log(`wrote ${png} and ${map} (${Object.keys(rects).length} strings)`);
      // The page's keep-alive connection would hold the server open: answer, then exit.
      res.writeHead(200, { connection: "close" }); res.end("ok", () => process.exit(0));
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(0, "127.0.0.1", () => {
  console.log(`bake page: http://127.0.0.1:${server.address().port}/  (pid ${process.pid})`);
});
