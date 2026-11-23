// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import { parseProgress, withCompleted } from "../src/features/play/demo/progress.ts";

test("a training completed is remembered once, beside the others", () => {
    const once = withCompleted(null, "basics");
    assert.deepEqual(parseProgress(once), ["basics"]);
    assert.deepEqual(parseProgress(withCompleted(once, "basics")), ["basics"]);
    assert.deepEqual(parseProgress(withCompleted(once, "black-rain")), ["basics", "black-rain"]);
});

test("a record that does not read counts as nothing done", () => {
    for (const raw of [null, "", "{", "[]", '{"done":3}', '{"done":[1,null]}'])
        assert.deepEqual(parseProgress(raw), [], String(raw));
    assert.deepEqual(parseProgress(withCompleted("not json", "basics")), ["basics"]);
});
