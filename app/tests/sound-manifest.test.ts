// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { ENGINE_GENERATORS } from "../../packages/engine/src/audio/generators.ts";
import {
    GENERATORS,
    SLOT_IDS,
    SLOTS,
    validateManifest,
} from "../../packages/engine/src/audio/manifest.ts";
import { RECORDED, voiceKey } from "../../packages/engine/src/voice.ts";
import { APP_GENERATORS } from "../src/audio/app-generators.ts";

const SOUNDS = new URL("../public/sounds/", import.meta.url);

test("every manifest slot resolves to a shipped file or an implemented generator", () => {
    const implemented = new Set([
        ...Object.keys(ENGINE_GENERATORS),
        ...Object.keys(APP_GENERATORS),
    ]);
    const problems = validateManifest(
        (file) => existsSync(new URL(file, SOUNDS)),
        RECORDED.map(voiceKey),
        implemented,
    );
    assert.deepEqual(problems, []);
});

test("the shell implements exactly the shell's generators", () => {
    const app = Object.entries(GENERATORS)
        .filter(([, owner]) => owner === "app")
        .map(([name]) => name);
    assert.deepEqual(Object.keys(APP_GENERATORS).sort(), app.sort());
});

test("every sound file shipped is in the manifest", () => {
    const named = new Set<string>();
    for (const id of SLOT_IDS) {
        const { source } = SLOTS[id];
        if (!("file" in source)) continue;
        for (const f of [...source.file, ...("fallback" in source ? [source.fallback] : [])])
            for (const v of f.includes("{voice}") ? RECORDED.map(voiceKey) : [""])
                named.add(f.replace("{voice}", v));
    }
    const shipped = readdirSync(SOUNDS).filter((f) => !f.endsWith(".md"));
    assert.deepEqual(
        shipped.filter((f) => !named.has(f)),
        [],
    );
});
