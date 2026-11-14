// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { actionOf, DEFAULT_BINDINGS } from "../src/settings/keys.ts";
import { wireframeKeyFree } from "../src/features/squad/wireframe-key.ts";

const z = { key: "z", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const combat = { fire: ["x"], move: ["m"] };

test("Z is free with the default bindings", () => {
    assert.equal(wireframeKeyFree(actionOf(z, DEFAULT_BINDINGS), combat), true);
});

test("Z yields to a menu action or a combat action the player bound to it", () => {
    assert.equal(
        wireframeKeyFree(actionOf(z, { ...DEFAULT_BINDINGS, reset: ["z"] }), combat),
        false,
    );
    assert.equal(
        wireframeKeyFree(actionOf(z, DEFAULT_BINDINGS), { ...combat, fire: ["z"] }),
        false,
    );
});

test("no command list or source offers Wireframe as a command", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    assert.doesNotMatch(read("../src/features/headquarters/squad/CharacterCanvas.tsx"), /Shaded/);
    assert.doesNotMatch(read("../src/ui/stage.tsx"), /label: "Wireframe"/);
    assert.match(read("../src/ui/stage.tsx"), /useWireframeShortcut\(\)/);
});
