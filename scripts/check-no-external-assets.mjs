// Guard: the game must serve every static resource (fonts, scripts, styles, images, models,
// decoders, audio) from its own origin. Fails when an asset reference points at another origin.
//
// Checked: app/index.html and every source stylesheet (app/, packages/*/src), and, when a build
// directory is given, every emitted .html and .css file in it:
//   <link href>, <script src>, <img src>, <source src>, <video|audio|iframe|embed|object ...>,
//   @import, url(...) (this covers @font-face src), image-set(), srcset.
// Plain <a href> links are not assets and are ignored. Beyond those references, any mention of a
// well-known CDN / font host in source or build files (.ts .tsx .js .css .html) is rejected.
//
// ALLOWED_HOSTS is for origins an asset reference may legitimately use; keep it empty unless a
// real need appears. API hosts (RPC, GraphQL, Enoki, wallets) are fetched from code, not
// referenced by assets, so they do not belong here; they are listed in the CSP for the host.
//
// Usage: node scripts/check-no-external-assets.mjs [path/to/build-dir]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ALLOWED_HOSTS = [];
const CDN_HOSTS =
  /(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|kit\.fontawesome\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|esm\.run|skypack\.dev|ajax\.googleapis\.com|code\.jquery\.com|stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|raw\.githubusercontent\.com|cdn\.tailwindcss\.com)/i;

const root = new URL("..", import.meta.url).pathname;
const buildDir = process.argv[2];
const problems = [];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".wrangler",
  "coverage",
]);
function walk(dir, test, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, test, out);
    else if (test(entry.name)) out.push(path);
  }
  return out;
}

/** Is this URL fetched from an origin other than ours (and not allowlisted)? */
function isExternal(raw) {
  const url = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!/^(https?:)?\/\//i.test(url)) return false;
  let host;
  try {
    host = new URL(url.startsWith("//") ? `https:${url}` : url).hostname;
  } catch {
    return true;
  }
  return !ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function checkCss(file, text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  for (const m of css.matchAll(/url\(\s*([^)]*?)\s*\)/gi))
    if (isExternal(m[1]))
      problems.push(`${file}:${lineOf(css, m.index)}: external url(): ${m[1]}`);
  for (const m of css.matchAll(
    /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/gi,
  ))
    if (isExternal(m[2]))
      problems.push(
        `${file}:${lineOf(css, m.index)}: external @import: ${m[2]}`,
      );
}

function checkHtml(file, text) {
  const html = text.replace(/<!--[\s\S]*?-->/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  for (const tag of html.matchAll(
    /<(link|script|img|source|video|audio|track|iframe|embed|object|input|image|use)\b[^>]*>/gi,
  )) {
    // A canonical link names the page's own address; the browser never fetches it.
    if (/^<link\b[^>]*\srel\s*=\s*["']?canonical["']?[\s>]/i.test(tag[0])) continue;
    for (const attr of tag[0].matchAll(
      /\s(href|src|srcset|poster|data|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    )) {
      const urls =
        attr[1].toLowerCase() === "srcset"
          ? attr[2]
              .replace(/^['"]|['"]$/g, "")
              .split(",")
              .map((s) => s.trim().split(/\s+/)[0])
          : [attr[2]];
      for (const u of urls)
        if (isExternal(u))
          problems.push(
            `${file}:${lineOf(html, tag.index)}: <${tag[1]} ${attr[1]}> points at another origin: ${u}`,
          );
    }
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    checkCss(file, m[1]);
  for (const m of html.matchAll(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi))
    checkCss(file, m[1]);
}

function checkHosts(file, text) {
  const m = text.match(CDN_HOSTS);
  if (m)
    problems.push(
      `${file}:${lineOf(text, m.index)}: references a CDN / font host: ${m[0]}`,
    );
}

const rel = (p) => relative(root, p);
const sources = [
  ...walk(join(root, "app"), (n) => /\.(css|tsx?|html)$/.test(n)),
  ...walk(join(root, "packages"), (n) => /\.(css|tsx?)$/.test(n)),
];
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".css")) checkCss(rel(file), text);
  else if (file.endsWith(".html")) checkHtml(rel(file), text);
  checkHosts(rel(file), text);
}

if (buildDir) {
  if (!existsSync(buildDir)) {
    console.error(`build directory not found: ${buildDir}`);
    process.exit(2);
  }
  for (const file of walk(buildDir, (n) => /\.(html|css|js)$/.test(n))) {
    const text = readFileSync(file, "utf8");
    const name = `build:${relative(buildDir, file)}`;
    if (file.endsWith(".html")) checkHtml(name, text);
    else if (file.endsWith(".css")) checkCss(name, text);
    checkHosts(name, text);
  }
}

if (problems.length) {
  console.error(`External asset references found (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `ok: ${sources.length} source files${buildDir ? `, build ${buildDir}` : ""} load nothing from another origin`,
);
