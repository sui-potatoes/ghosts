// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { URL } from "node:url";
import { log } from "node:console";

// Keep the title patrol's idle identical to the shared capture without making
// the menu download and parse every combat and smoking animation.
for (const sex of ["female", "male"]) {
    const source = new URL(`../public/squad/motions/${sex}.bin`, import.meta.url);
    const clips = JSON.parse(gunzipSync(readFileSync(source)));
    const idle = clips.find((clip) => clip.name === "rifle_idle");
    if (!idle) throw new Error(`Missing ${sex} rifle idle`);
    const bytes = gzipSync(JSON.stringify(idle), { level: 9 });
    writeFileSync(new URL(`../src/assets/title-idle-${sex}.bin`, import.meta.url), bytes);
    log(`${sex} title idle: ${bytes.length} bytes`);
}
