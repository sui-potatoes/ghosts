// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The world board's geometry, pure (tested in `tests/missions-world.test.ts`):
 * the projection of the shipped base map, the sites missions group into, the
 * view that frames them and where the continent names sit. The base is
 * `public/world/world-base.svg` (a copy of `docs/design/world-base.svg`):
 * equirectangular, 5 px per degree, cropped from 84° N to 60° S.
 */

import { MAP_NORTH, MAP_SOUTH, project, type Mission, type MissionPosition } from "./model.ts";

/** The base map's frame in its own units (its viewBox) and its latitude crop. */
export const WORLD = { width: 1800, height: 720, north: MAP_NORTH, south: MAP_SOUTH } as const;

/** The base map's file, served from `public/`. */
export const WORLD_BASE = "/world/world-base.svg";

/** The landmass and island-group ids in the base, each one `<path>`. */
export const WORLD_LAND = [
    "afro-eurasia",
    "americas",
    "australia",
    "greenland",
    "new-zealand",
    "islands-pacific",
    "islands-malay-archipelago",
    "islands-caribbean",
    "islands-indian-ocean",
    "islands-arctic",
    "islands-west-pacific",
    "islands-north-atlantic",
    "islands-mediterranean",
    "islands-south-america-coast",
    "islands-north-america-coast",
    "islands-africa-coast",
    "islands-other",
] as const;

/** A place on the board: one pin, every mission at it in board order. */
export type WorldSite = {
    key: string;
    city: string;
    lat: number;
    lon: number;
    missions: Mission[];
};

/**
 * The distinct places among `missions`, one per city, in the order the board
 * first lists them; the pin sits at the city's first mission. Missions with no
 * position are on no site.
 */
export function sitesOf(missions: readonly Mission[]): WorldSite[] {
    const sites = new Map<string, WorldSite>();
    for (const mission of missions) {
        const at: MissionPosition | undefined = mission.position;
        if (!at) continue;
        const key = at.city.trim().toLowerCase();
        const site = sites.get(key);
        if (site) site.missions.push(mission);
        else sites.set(key, { key, city: at.city, lat: at.lat, lon: at.lon, missions: [mission] });
    }
    return [...sites.values()];
}

/** The site a mission is on, if any. */
export const siteOf = (sites: readonly WorldSite[], mission: Mission | null) =>
    mission ? (sites.find((s) => s.missions.some((m) => m.id === mission.id)) ?? null) : null;

/** How far the board leans in on a place: close enough to read its coast, with its continent still around it. */
export const WORLD_ZOOM = 4;

/** The zoom steps the player can pick, whole world first; the default is `WORLD_ZOOM`. */
export const ZOOM_LEVELS = [1, 2, 4, 8] as const;

/** A zoom level snapped onto the steps: the nearest one. */
export function zoomLevel(zoom: number): number {
    return ZOOM_LEVELS.reduce((best, z) =>
        Math.abs(Math.log(z / zoom)) < Math.abs(Math.log(best / zoom)) ? z : best,
    );
}

/** The level `by` steps from `zoom` (−1 out, +1 in), held at the ends. */
export function stepZoom(zoom: number, by: number): number {
    const at = ZOOM_LEVELS.indexOf(zoomLevel(zoom) as (typeof ZOOM_LEVELS)[number]);
    return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, at + by))];
}

/** The base map placed in a box: `screen = (x + scale · mapX, y + scale · mapY)`. */
export type WorldView = { scale: number; x: number; y: number };

/** A rectangle in the box's own pixels. */
export type BoxRect = { x: number; y: number; width: number; height: number };

/** One turn of the planet at a scale: the map's width, after which it repeats. */
export const turnOf = (scale: number) => WORLD.width * scale;

/** `x` moved by whole turns to the copy nearest `to`: the shorter way round. */
export const nearestTurn = (x: number, to: number, period: number) =>
    period > 0 ? x + period * Math.round((to - x) / period) : x;

/**
 * The planet behind a `box`, wrapping east–west: one turn spans the box's
 * width at 1× (the whole world across), `zoom` leans in. A `point` is brought
 * to the middle of `open` (the part of the box no panel covers); vertically
 * the map never leaves its own top and bottom edges, horizontally it has no
 * edge, and `from` (the view on screen now) picks the shorter way round. With
 * no point the map idles at 1×, centred.
 */
export function panView({
    box,
    open = { x: 0, y: 0, width: box.width, height: box.height },
    point,
    zoom = WORLD_ZOOM,
    from,
}: {
    box: { width: number; height: number };
    open?: BoxRect;
    point?: { lat: number; lon: number } | null;
    zoom?: number;
    from?: WorldView | null;
}): WorldView {
    const fit = box.width / WORLD.width;
    if (!(fit > 0)) return { scale: 1, x: 0, y: 0 };
    const scale = fit * (point ? Math.max(1, zoom) : 1);
    const h = WORLD.height * scale;
    const cx = open.x + open.width / 2;
    const cy = open.y + open.height / 2;
    const at = point ? project(point.lat, point.lon) : null;
    let x = at ? cx - at.x * scale : (box.width - turnOf(scale)) / 2;
    let y = at ? cy - at.y * scale : (box.height - h) / 2;
    y = h <= box.height ? (box.height - h) / 2 : Math.min(0, Math.max(box.height - h, y));
    if (from) {
        // The longitude now under the open middle, at the new scale: go the shorter way from there.
        const now = cx - ((cx - from.x) / from.scale) * scale;
        x = nearestTurn(x, now, turnOf(scale));
    }
    return { scale, x, y };
}

/** A map point in the box under a view, on the copy nearest `near` (an x in the box). */
export const onScreen = (view: WorldView, lat: number, lon: number, near?: number) => {
    const p = project(lat, lon);
    const x = view.x + p.x * view.scale;
    return {
        x: near === undefined ? x : nearestTurn(x, near, turnOf(view.scale)),
        y: view.y + p.y * view.scale,
    };
};

/** A view's x folded into one turn left of the box's edge, so two copies always cover the box. */
export const foldX = (view: WorldView) => {
    const period = turnOf(view.scale);
    return period > 0 ? view.x - period * Math.ceil(view.x / period) : view.x;
};

/**
 * How long a glide from one view to another takes, in ms: a hop or a zoom
 * step stays quick, a third of the world takes most of a second, never more.
 */
export function glideMs(a: WorldView, b: WorldView): number {
    const degrees = Math.abs(b.x / b.scale - a.x / a.scale) / 5;
    const steps = Math.abs(Math.log2(b.scale / a.scale));
    return Math.min(900, 220 + degrees * 6 + steps * 110);
}

/** A view part way to another: scale and offset together, so every map point moves in a straight line. */
export const between = (a: WorldView, b: WorldView, t: number): WorldView => ({
    scale: a.scale + (b.scale - a.scale) * t,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});

/** The continents' names, each over its own land (no countries, no borders). */
export const CONTINENTS: readonly { name: string; lat: number; lon: number }[] = [
    { name: "North America", lat: 50, lon: -103 },
    { name: "South America", lat: -14, lon: -59 },
    { name: "Europe", lat: 53, lon: 22 },
    { name: "Africa", lat: 6, lon: 20 },
    { name: "Asia", lat: 52, lon: 92 },
    { name: "Oceania", lat: -25, lon: 133 },
];

/** The graticule every `step` degrees, as one path in map units. */
export function graticule(step = 30): string {
    const parts: string[] = [];
    for (let lon = -180 + step; lon < 180; lon += step) {
        const { x } = project(0, lon);
        parts.push(`M${x} 0V${WORLD.height}`);
    }
    for (let lat = Math.ceil(WORLD.south / step) * step; lat <= WORLD.north; lat += step) {
        if (lat === WORLD.south) continue;
        const { y } = project(lat, 0);
        parts.push(`M0 ${y}H${WORLD.width}`);
    }
    return parts.join("");
}
