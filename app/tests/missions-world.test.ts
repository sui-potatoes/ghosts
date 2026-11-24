// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { project, type Mission } from "../src/features/missions/model.ts";
import {
    CONTINENTS,
    onScreen,
    siteOf,
    sitesOf,
    WORLD,
    WORLD_ZOOM,
    worldView,
} from "../src/features/missions/world.ts";

const mission = (id: string, position?: Mission["position"]): Mission => ({
    id,
    name: id,
    location: "",
    brief: [],
    objectives: [],
    facts: [],
    state: "open",
    verb: "Deploy",
    position,
});

const near = (a: number, b: number, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test("the projection is the base map's own formula", () => {
    const base = readFileSync(new URL("../public/world/world-base.svg", import.meta.url), "utf8");
    assert.match(base, /viewBox="0 0 1800 720"/);
    assert.match(base, /x = \(lon \+ 180\) \* 5/);
    assert.match(base, /y = \(84 - lat\) \* 5/);
    for (const [lat, lon] of [
        [84, -180],
        [-60, 180],
        [0, 0],
        [35.68, 139.69],
        [-33.87, 151.21],
    ]) {
        const p = project(lat, lon);
        near(p.x, (lon + 180) * 5);
        near(p.y, (84 - lat) * 5);
    }
});

test("the projection scales with the box, at any aspect", () => {
    for (const [w, h] of [
        [900, 360],
        [390, 156],
        [1234, 777],
    ]) {
        const p = project(35.68, 139.69, w, h);
        near(p.x, ((139.69 + 180) * 5 * w) / WORLD.width);
        near(p.y, ((84 - 35.68) * 5 * h) / WORLD.height);
    }
});

test("Tokyo lands on Honshu's east coast in the base map's frame", () => {
    const p = project(35 + 41 / 60, 139 + 42 / 60);
    near(p.x, 1598.5, 0.01);
    near(p.y, 241.58, 0.01);
});

test("missions group into one site per city, in board order", () => {
    const tokyo = { lat: 35.68, lon: 139.7, city: "Tokyo" };
    const missions = [
        mission("basics"),
        mission("night-shift", tokyo),
        mission("black-rain", { ...tokyo, lon: 139.68 }),
        mission("antwerp", { lat: 51.22, lon: 4.4, city: "Antwerp" }),
        mission("paper-trail", { ...tokyo, city: "tokyo " }),
    ];
    const sites = sitesOf(missions);
    assert.deepEqual(
        sites.map((s) => [s.city, s.missions.map((m) => m.id)]),
        [
            ["Tokyo", ["night-shift", "black-rain", "paper-trail"]],
            ["Antwerp", ["antwerp"]],
        ],
    );
    // The pin sits at the city's first mission.
    assert.equal(sites[0].lon, 139.7);
    assert.equal(siteOf(sites, missions[2])?.city, "Tokyo");
    assert.equal(siteOf(sites, missions[0]), null);
    assert.equal(siteOf(sites, null), null);
    assert.deepEqual(sitesOf([mission("basics")]), []);
});

test("with no focus the whole world fits, centred", () => {
    const view = worldView({ width: 1000, height: 1000 });
    near(view.scale, 1000 / 1800);
    near(view.x, 0);
    near(view.y, (1000 - 720 * view.scale) / 2);
    const wide = worldView({ width: 2000, height: 400 });
    near(wide.scale, 400 / 720);
    near(wide.y, 0);
});

test("a focus leans in gently and never leaves the map's edges", () => {
    const box = { width: 700, height: 600 };
    const fit = 700 / 1800;
    const tokyo = { lat: 35.68, lon: 139.69 };
    const view = worldView(box, tokyo);
    assert.ok(view.scale > fit && view.scale <= fit * WORLD_ZOOM + 1e-9);
    // Clamped to the map's right edge: no empty band beside the planet.
    near(view.x, box.width - 1800 * view.scale);
    const p = onScreen(view, tokyo.lat, tokyo.lon);
    assert.ok(p.x > 0 && p.x < box.width && p.y > 0 && p.y < box.height);
    // A short box asks for no lean at all.
    const strip = worldView({ width: 900, height: 360 }, tokyo);
    near(strip.scale, 0.5);
    // Never zooms past the cap, however tall the box.
    const tall = worldView({ width: 400, height: 2000 }, tokyo);
    near(tall.scale, (400 / 1800) * WORLD_ZOOM);
});

test("every continent name sits on the base map", () => {
    assert.equal(CONTINENTS.length, 6);
    for (const c of CONTINENTS) {
        const p = project(c.lat, c.lon);
        assert.ok(p.x > 0 && p.x < WORLD.width && p.y > 0 && p.y < WORLD.height, c.name);
    }
});
