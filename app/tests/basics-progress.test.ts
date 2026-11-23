// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import { parseChapters, serializeChapters } from "../src/screens/basics-progress.ts";

test("completed chapters round-trip; a record that does not read is nothing done", () => {
    assert.deepEqual(parseChapters(serializeChapters(["A", "C"])), ["A", "C"]);
    for (const raw of [null, "", "{", "[]", '{"done":1}', '{"done":[2,null]}'])
        assert.deepEqual(parseChapters(raw), [], String(raw));
});
