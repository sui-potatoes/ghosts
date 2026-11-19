// Guard: app/public/_headers (Cloudflare serves it) must keep an enforced, strict Content-Security-Policy
// and the companion security headers in its catch-all `/*` block.
//
// Fails when: the CSP is missing, report-only, or `default-src` is not 'none'; any directive carries
// 'unsafe-eval' or a bare/subdomain wildcard `*`; script-src has 'unsafe-inline' or a scheme source;
// 'unsafe-inline' appears anywhere but style-src-attr; the chain hosts in connect-src do not match NETWORK
// in app/src/constants.ts; a companion header is missing; or app/index.html has an inline script or
// style element (which the policy would block).
//
// A port wildcard on a loopback host (http://localhost:*) is allowed: it serves a local custom RPC.
//
// Usage: node scripts/check-csp.mjs [path/to/_headers]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const file = process.argv[2] ?? join(root, "app/public/_headers");
const problems = [];

if (!existsSync(file)) {
  console.error(`headers file not found: ${file}`);
  process.exit(2);
}

// Parse the `/*` block: header name -> value (the first rule line is the path, indented lines are headers).
const block = {};
let inBlock = false;
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    inBlock = line.trim() === "/*";
    continue;
  }
  if (!inBlock) continue;
  const i = line.indexOf(":");
  block[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
}

const csp = block["content-security-policy"];
if (block["content-security-policy-report-only"] !== undefined && !csp) {
  problems.push(
    "the CSP is report-only; it must be enforced (Content-Security-Policy)",
  );
}
if (!csp) {
  problems.push("the `/*` block of _headers has no Content-Security-Policy");
} else {
  const directives = new Map();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  const has = (name, token) => directives.get(name)?.includes(token);

  if (!has("default-src", "'none'"))
    problems.push("default-src must be 'none'");
  if (!has("object-src", "'none'")) problems.push("object-src must be 'none'");
  if (!has("frame-ancestors", "'none'"))
    problems.push("frame-ancestors must be 'none'");
  if (!directives.has("base-uri")) problems.push("base-uri is missing");
  if (!directives.has("upgrade-insecure-requests"))
    problems.push("upgrade-insecure-requests is missing");

  for (const [name, sources] of directives) {
    if (sources.includes("'unsafe-eval'"))
      problems.push(`${name} contains 'unsafe-eval'`);
    if (sources.includes("'unsafe-inline'") && name !== "style-src-attr")
      problems.push(
        `${name} contains 'unsafe-inline' (only style-src-attr may)`,
      );
    for (const s of sources) {
      const loopbackPort = /^https?:\/\/(localhost|127\.0\.0\.1):\*$/.test(s);
      if (s.includes("*") && !loopbackPort)
        problems.push(`${name} contains a wildcard: ${s}`);
    }
  }
  const script = directives.get("script-src") ?? [];
  if (!directives.has("script-src")) problems.push("script-src is missing");
  for (const s of script)
    if (/^(https?|data|blob|filesystem):$/.test(s))
      problems.push(`script-src allows a whole scheme: ${s}`);

  // Chain hosts must follow NETWORK, so a mainnet switch cannot leave the CSP behind.
  const constants = readFileSync(join(root, "app/src/constants.ts"), "utf8");
  const network = constants.match(/export const NETWORK\s*=\s*"([a-z]+)"/)?.[1];
  if (!network)
    problems.push("could not read NETWORK from app/src/constants.ts");
  else {
    const connect = directives.get("connect-src") ?? [];
    for (const host of [
      `https://fullnode.${network}.sui.io`,
      `https://graphql.${network}.sui.io`,
      "https://api.enoki.mystenlabs.com",
      `https://${network}.mvr.mystenlabs.com`,
      `https://faucet.${network}.sui.io`,
    ])
      if (!connect.includes(host))
        problems.push(`connect-src lacks ${host} (NETWORK is ${network})`);
  }
}

for (const [name, expected] of [
  ["x-content-type-options", /^nosniff$/i],
  ["x-frame-options", /^deny$/i],
  ["referrer-policy", /./],
  ["strict-transport-security", /max-age=\d{6,}/i],
  ["cross-origin-opener-policy", /^same-origin(-allow-popups)?$/i],
  ["cross-origin-resource-policy", /^same-origin$/i],
  ["permissions-policy", /camera=\(\)/],
])
  if (!expected.test(block[name] ?? ""))
    problems.push(`companion header missing or weak: ${name}`);

// index.html: nothing inline, since script-src and style-src-elem are 'self'.
const html = readFileSync(join(root, "app/index.html"), "utf8").replace(
  /<!--[\s\S]*?-->/g,
  "",
);
for (const m of html.matchAll(/<script\b([^>]*)>/gi))
  if (!/\ssrc\s*=/.test(m[1]))
    problems.push("app/index.html has an inline <script>");
if (/<style\b/i.test(html))
  problems.push("app/index.html has an inline <style> element");
if (/\son[a-z]+\s*=/i.test(html))
  problems.push("app/index.html has an inline event handler");

if (problems.length) {
  console.error(`Security headers problems (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`ok: ${file} has an enforced strict CSP and the companion headers`);
