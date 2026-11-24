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
    between,
    foldX,
    nearestTurn,
    panView,
    stepZoom,
    turnOf,
    WORLD,
    WORLD_ZOOM,
    ZOOM_LEVELS,
    zoomLevel,
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

const TOKYO = { lat: 35 + 41 / 60, lon: 139 + 42 / 60 };
const DUBAI = { lat: 25.2, lon: 55 + 16 / 60 };

test("zoom steps from the whole world to a close view, held at the ends", () => {
    assert.deepEqual([...ZOOM_LEVELS], [1, 2, 4, 8]);
    assert.ok(ZOOM_LEVELS.includes(WORLD_ZOOM as 4));
    assert.equal(stepZoom(4, 1), 8);
    assert.equal(stepZoom(8, 1), 8);
    assert.equal(stepZoom(4, -1), 2);
    assert.equal(stepZoom(1, -1), 1);
    assert.equal(stepZoom(3, 1), 8, "an off-step zoom snaps to the nearest step first");
    assert.equal(zoomLevel(5.5), 4);
    assert.equal(zoomLevel(0.2), 1);
});

test("with no place the map idles at the whole world, one turn across the box", () => {
    const box = { width: 1440, height: 900 };
    const view = panView({ box, point: null, zoom: 8 });
    near(view.scale, 1440 / 1800);
    near(turnOf(view.scale), 1440);
    near(view.x, 0);
    near(view.y, (900 - 720 * view.scale) / 2);
});

test("a place is brought to the middle of the open area at the zoom asked", () => {
    const box = { width: 1440, height: 900 };
    const open = { x: 330, y: 150, width: 700, height: 600 };
    for (const zoom of ZOOM_LEVELS) {
        const view = panView({ box, open, point: TOKYO, zoom });
        near(view.scale, (1440 / 1800) * zoom);
        const p = onScreen(view, TOKYO.lat, TOKYO.lon);
        near(p.x, open.x + open.width / 2, 1e-6);
        // Never past the map's top or bottom edge; in the open middle whenever that allows.
        const h = 720 * view.scale;
        if (h > box.height) {
            assert.ok(view.y <= 0 && view.y >= box.height - h, `zoom ${zoom}`);
            const clamped = view.y === 0 || view.y === box.height - h;
            if (!clamped) near(p.y, open.y + open.height / 2, 1e-6);
        } else near(view.y, (box.height - h) / 2);
    }
    // Close in, Tokyo sits in the open middle both ways.
    {
        const view = panView({ box, open, point: TOKYO, zoom: 8 });
        const p = onScreen(view, TOKYO.lat, TOKYO.lon);
        near(p.y, open.y + open.height / 2, 1e-6);
    }
});

test("a pan takes the shorter way round the planet", () => {
    const box = { width: 1440, height: 900 };
    const open = { x: 330, y: 150, width: 700, height: 600 };
    const tokyo = panView({ box, open, point: TOKYO, zoom: 4 });
    const dubai = panView({ box, open, point: DUBAI, zoom: 4, from: tokyo });
    // Tokyo to Dubai is 84° west: the map moves east by that much, not round the other way.
    near(dubai.x - tokyo.x, (139.7 - 55.267) * 5 * tokyo.scale, 0.5);
    // Coming back the long way is folded too.
    const far = { ...tokyo, x: tokyo.x - turnOf(tokyo.scale) * 3 };
    const back = panView({ box, open, point: TOKYO, zoom: 4, from: far });
    near(back.x, far.x, 1e-6);
    // Zooming keeps the longitude under the open middle.
    const out = panView({ box, open, point: TOKYO, zoom: 1, from: far });
    near(onScreen(out, TOKYO.lat, TOKYO.lon, 680).x, open.x + open.width / 2, 1e-6);
    assert.ok(Math.abs(out.x - far.x / 4) < turnOf(out.scale));
});

test("wrapping: a copy nearest any point, two copies cover the box", () => {
    near(nearestTurn(100, 1050, 1000), 1100);
    near(nearestTurn(100, -380, 1000), 100);
    near(nearestTurn(100, -420, 1000), -900);
    for (const x of [-2500, -1000, -1, 0, 1, 999, 1001, 4321]) {
        const folded = foldX({ scale: 1000 / 1800, x, y: 0 });
        assert.ok(folded <= 0 && folded > -1000, `${x} → ${folded}`);
        near(((x - folded) / 1000) % 1, 0, 1e-9);
    }
    const view = { scale: 3.2, x: -4200, y: -100 };
    const p = onScreen(view, TOKYO.lat, TOKYO.lon, 700);
    assert.ok(Math.abs(p.x - 700) <= turnOf(view.scale) / 2);
});

test("a move part way: every map point on a straight line between", () => {
    const a = { scale: 1, x: 0, y: 0 };
    const b = { scale: 3, x: -200, y: -100 };
    const mid = between(a, b, 0.5);
    assert.deepEqual(mid, { scale: 2, x: -100, y: -50 });
    const pa = onScreen(a, TOKYO.lat, TOKYO.lon);
    const pb = onScreen(b, TOKYO.lat, TOKYO.lon);
    const pm = onScreen(mid, TOKYO.lat, TOKYO.lon);
    near(pm.x, (pa.x + pb.x) / 2, 1e-9);
    near(pm.y, (pa.y + pb.y) / 2, 1e-9);
});

test("every continent name sits on the base map", () => {
    assert.equal(CONTINENTS.length, 6);
    for (const c of CONTINENTS) {
        const p = project(c.lat, c.lon);
        assert.ok(p.x > 0 && p.x < WORLD.width && p.y > 0 && p.y < WORLD.height, c.name);
    }
});
