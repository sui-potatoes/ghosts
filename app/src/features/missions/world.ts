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

/** How far the board leans in on a place: never so far the continent around it is lost. */
export const WORLD_ZOOM = 2;

/** The base map placed in a box: `screen = (x + scale · mapX, y + scale · mapY)`. */
export type WorldView = { scale: number; x: number; y: number };

/**
 * The view of the base map in a `width` × `height` box. With no focus the
 * whole world fits, centred. With a focus the map leans in (up to `zoom`, and
 * no further than the box's height asks for) and slides toward the point,
 * never past the map's own edges, so the frame is always full of planet.
 */
export function worldView(
    box: { width: number; height: number },
    focus?: { lat: number; lon: number } | null,
    zoom: number = WORLD_ZOOM,
): WorldView {
    const fit = Math.min(box.width / WORLD.width, box.height / WORLD.height);
    if (!(fit > 0)) return { scale: 1, x: 0, y: 0 };
    const lean = focus ? Math.max(1, Math.min(zoom, box.height / (WORLD.height * fit))) : 1;
    const scale = fit * lean;
    const w = WORLD.width * scale;
    const h = WORLD.height * scale;
    const at = focus ? project(focus.lat, focus.lon) : null;
    const place = (room: number, size: number, point?: number) => {
        if (size <= room || point === undefined) return (room - size) / 2;
        return Math.min(0, Math.max(room - size, room / 2 - point * scale));
    };
    return { scale, x: place(box.width, w, at?.x), y: place(box.height, h, at?.y) };
}

/** A map point in the box under a view. */
export const onScreen = (view: WorldView, lat: number, lon: number) => {
    const p = project(lat, lon);
    return { x: view.x + p.x * view.scale, y: view.y + p.y * view.scale };
};

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
