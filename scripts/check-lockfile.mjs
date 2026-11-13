// Supply-chain sanity check for pnpm-lock.yaml (lockfileVersion 9).
//
// Every package in the lockfile must be a registry package pinned by an integrity hash:
//   resolution: {integrity: sha512-...}
// Tarball URLs, git/hosted-git, file: and http(s) sources are rejected, so a dependency
// cannot silently be redirected to another host. Only workspace `link:` versions are allowed.
// Registry package tarballs are then fetched from the registry configured for the install;
// this script also checks that no .npmrc in the repo points somewhere other than npmjs.
//
// Usage: node scripts/check-lockfile.mjs [path/to/pnpm-lock.yaml]
import { existsSync, readFileSync } from "node:fs";

const lockPath = process.argv[2] ?? "pnpm-lock.yaml";
const lines = readFileSync(lockPath, "utf8").split("\n");
const problems = [];

if (!/^lockfileVersion: '9\./.test(lines[0])) {
    problems.push(`line 1: unexpected lockfile format "${lines[0]}" (script expects v9)`);
}

const INTEGRITY = /^\s+resolution: \{integrity: sha(256|384|512)-[A-Za-z0-9+/]+=*\}$/;
let resolutions = 0;

lines.forEach((line, i) => {
    const at = `line ${i + 1}`;
    if (/^\s+resolution:/.test(line)) {
        resolutions++;
        if (!INTEGRITY.test(line)) problems.push(`${at}: resolution is not a plain integrity hash: ${line.trim()}`);
    }
    // Hosted/direct sources show up as extra resolution keys or as version/specifier values.
    if (/^\s+(tarball|repo|commit|path):/.test(line)) problems.push(`${at}: non-registry source: ${line.trim()}`);
    const spec = line.match(/^\s+(?:version|specifier): (.+)$/);
    if (spec) {
        const v = spec[1].replace(/^['"]|['"]$/g, "");
        const isLink = v.startsWith("link:");
        if (!isLink && /^(git|github|gitlab|bitbucket|file|http|https|ssh):|git\+|:\/\/|\.tgz$/.test(v)) {
            problems.push(`${at}: non-registry dependency: ${line.trim()}`);
        }
    }
});

if (resolutions === 0) problems.push("no resolutions found; is this the right file?");

for (const rc of [".npmrc", "app/.npmrc", "packages/engine/.npmrc", "packages/squad/.npmrc", "packages/agent/.npmrc", "packages/catalog/.npmrc"]) {
    if (!existsSync(rc)) continue;
    for (const l of readFileSync(rc, "utf8").split("\n")) {
        if (/registry\s*=/.test(l) && !/registry\s*=\s*https:\/\/registry\.npmjs\.org\/?\s*$/.test(l)) {
            problems.push(`${rc}: registry override: ${l.trim()}`);
        }
    }
}

if (problems.length > 0) {
    console.error(`${lockPath}: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`${lockPath}: ${resolutions} packages, all registry + integrity, no git/http/file sources`);
