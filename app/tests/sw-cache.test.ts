// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

// The worker is a classic script in public/; run it against stubs and read its pure helpers.
const sandbox: Record<string, unknown> = {
    self: { addEventListener() {}, location: { origin: "https://x.test" } },
    caches: {
        open: async () => ({
            put: async () => {},
            match: async () => undefined,
            keys: async () => [],
        }),
    },
    fetch: async () => {
        throw new Error("offline");
    },
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), sandbox);
const { isCurrent, staleEntries, isManaged } = sandbox as unknown as {
    isCurrent(stored: string | null, path: string, files: Record<string, string>): boolean;
    staleEntries(entries: [string, string | null][], files: Record<string, string>): string[];
    isManaged(path: string, files: Record<string, string>): boolean;
};

const files = { "/squad/a.glb": "aaa", "/sounds/b.mp3": "bbb", "/assets/index-1.js": "ccc" };

test("entry is current only under the manifest's hash", () => {
    assert.equal(isCurrent("aaa", "/squad/a.glb", files), true);
    assert.equal(isCurrent("old", "/squad/a.glb", files), false);
    assert.equal(isCurrent(null, "/squad/a.glb", files), false);
    assert.equal(isCurrent("aaa", "/gone.glb", files), false);
});

test("stale entries: changed hash, removed file, missing stamp", () => {
    const entries = [
        ["/squad/a.glb", "aaa"],
        ["/sounds/b.mp3", "zzz"],
        ["/gone.png", "ddd"],
        ["/squad/a2.glb", null],
    ];
    assert.deepEqual(staleEntries(entries, files), ["/sounds/b.mp3", "/gone.png", "/squad/a2.glb"]);
});

test("managed paths: listed, not hashed bundles, not internal keys", () => {
    assert.equal(isManaged("/squad/a.glb", files), true);
    assert.equal(isManaged("/assets/index-1.js", files), false);
    assert.equal(isManaged("/unlisted.png", files), false);
    assert.equal(isManaged("/__ghosts/manifest", { "/__ghosts/manifest": "x" }), false);
});
