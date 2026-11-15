// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { test } from "node:test";

import { issueUrl, MAX_ISSUE_URL, SOURCE_URL, type IssueInput } from "../src/reportIssue.ts";

const ID = "0x" + "ab12".repeat(16);

function input(over: Partial<IssueInput> = {}): IssueInput {
    return {
        error: {
            name: "TypeError",
            message: "boom",
            stack: "TypeError: boom\n    at a (x.js:1:1)",
        },
        componentStack: "\n    at Match\n    at App",
        pathname: "/match",
        commit: "0123456789abcdef",
        userAgent: "UA/1.0 (Test)",
        viewport: "1280x720",
        ...over,
    };
}

function parts(href: string) {
    const url = new URL(href);
    return { url, title: url.searchParams.get("title")!, body: url.searchParams.get("body")! };
}

test("points at the repository new-issue page", () => {
    const { url } = parts(issueUrl(input()));
    assert.equal(url.origin + url.pathname, `${SOURCE_URL}/issues/new`);
    assert.equal(url.searchParams.get("labels"), null);
});

test("contains error, build, route, browser, viewport and the headings", () => {
    const { title, body } = parts(issueUrl(input()));
    assert.match(title, /TypeError: boom/);
    for (const s of [
        "## What happened",
        "## What I was doing",
        "TypeError: boom",
        "0123456",
        "/match",
        "UA/1.0 (Test)",
        "1280x720",
        "at Match",
    ]) {
        assert.ok(body.includes(s), s);
    }
});

test("redacts 64-hex ids in message, stack and path", () => {
    const href = issueUrl(
        input({
            error: { name: "Error", message: `bad ${ID}`, stack: `Error: ${ID}\n at ${ID}` },
            pathname: `/account/${ID}`,
        }),
    );
    const { title, body } = parts(href);
    assert.ok(!href.includes(ID) && !body.includes(ID) && !title.includes(ID));
    assert.ok(body.includes("0x<redacted>"));
});

test("drops query and hash", () => {
    const { body } = parts(issueUrl(input({ pathname: "/match?player=Zed&x=1#frag" })));
    assert.ok(body.includes("Route: /match\n"));
    assert.ok(!body.includes("Zed") && !body.includes("frag"));
});

test("stays under the cap with a huge stack and message", () => {
    const stack = Array.from({ length: 5000 }, (_, i) => `    at f${i} (file.js:${i}:1)`).join(
        "\n",
    );
    const href = issueUrl(
        input({
            error: { name: "Error", message: "m".repeat(20000), stack },
            componentStack: stack,
        }),
    );
    assert.ok(href.length <= MAX_ISSUE_URL, String(href.length));
    const big = issueUrl(input({ error: { name: "Error", message: "ok", stack } }));
    assert.ok(big.length <= MAX_ISSUE_URL);
});

test("encodes round-trip with unusual characters", () => {
    const msg = "a&b=c#d?e ü 日本 `x`";
    const { body } = parts(issueUrl(input({ error: { name: "Error", message: msg } })));
    assert.ok(body.includes(msg));
});

test("missing commit reads unknown", () => {
    assert.ok(parts(issueUrl(input({ commit: null }))).body.includes("Build: unknown"));
});
