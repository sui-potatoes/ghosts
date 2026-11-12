// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { validateRpcUrl } from "../src/rpcUrl.ts";

test("empty means default", () => {
    assert.deepEqual(validateRpcUrl("  "), { ok: true, url: "" });
});

test("accepts https and trims trailing slashes", () => {
    assert.deepEqual(validateRpcUrl(" https://rpc.example.com:443/ "), {
        ok: true,
        url: "https://rpc.example.com",
    });
    assert.deepEqual(validateRpcUrl("https://rpc.example.com/v1/"), {
        ok: true,
        url: "https://rpc.example.com/v1",
    });
});

test("http only on localhost", () => {
    assert.equal(validateRpcUrl("http://localhost:9000").ok, true);
    assert.equal(validateRpcUrl("http://127.0.0.1:9000").ok, true);
    assert.equal(validateRpcUrl("http://[::1]:9000").ok, true);
    assert.equal(validateRpcUrl("http://rpc.example.com").ok, false);
});

test("rejects junk, other schemes, credentials and fragments", () => {
    for (const bad of [
        "rpc.example.com",
        "ftp://rpc.example.com",
        "javascript:alert(1)",
        "https://user:pw@rpc.example.com",
        "https://rpc.example.com/#x",
    ]) {
        assert.equal(validateRpcUrl(bad).ok, false, bad);
    }
});
