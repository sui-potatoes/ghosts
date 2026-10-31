// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { URL } from "node:url";

const read = (path) => JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))));
for (const sex of ["female", "male"]) {
    test(`${sex} title idle matches the shared motion capture`, () => {
        const library = read(`../public/squad/motions/${sex}.bin`);
        const idle = read(`../src/assets/title-idle-${sex}.bin`);
        assert.equal(idle.name, "rifle_idle");
        assert.deepEqual(
            idle,
            library.find((clip) => clip.name === "rifle_idle"),
            "Motion capture changed; run pnpm build:title-motion",
        );
    });
}
