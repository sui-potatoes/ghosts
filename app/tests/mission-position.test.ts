// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import { parseCoordinate, project } from "../src/features/missions/model.ts";

const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("a briefing coordinate reads as decimal degrees, north and east positive", () => {
    close(parseCoordinate("35° 41′ N")!, 35 + 41 / 60);
    close(parseCoordinate("139° 42′ E")!, 139.7);
    close(parseCoordinate("33° 52′ S")!, -(33 + 52 / 60));
    close(parseCoordinate("000° 00′ W")!, 0);
    close(parseCoordinate("51° 30' 26\" N")!, 51 + 30 / 60 + 26 / 3600);
    close(parseCoordinate("12°W")!, -12);
});

test("a coordinate that does not read is null", () => {
    assert.equal(parseCoordinate(""), null);
    assert.equal(parseCoordinate("35 41 N"), null);
    assert.equal(parseCoordinate("35° 41′"), null);
    assert.equal(parseCoordinate("TOKYO"), null);
});

test("project places a position on the world map, cropped 84° N to 60° S", () => {
    assert.deepEqual(project(84, -180), { x: 0, y: 0 });
    assert.deepEqual(project(-60, 180), { x: 1800, y: 720 });
    assert.deepEqual(project(0, 0, 360, 144), { x: 180, y: 84 });
    const tokyo = project(35 + 41 / 60, 139.7, 2000, 1000);
    close(tokyo.x, ((139.7 + 180) / 360) * 2000);
    close(tokyo.y, ((84 - (35 + 41 / 60)) / 144) * 1000);
    assert.ok(tokyo.x > 1500 && tokyo.y < 500, "Tokyo is east and north of the middle");
});
