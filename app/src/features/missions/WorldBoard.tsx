// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useFocusable, useFocusStore } from "../../ui";
import { reducedMotion } from "../../ui/motion";
import type { Mission } from "./model";
import { queueId } from "./OpsQueue";
import {
    CONTINENTS,
    graticule,
    onScreen,
    siteOf,
    sitesOf,
    WORLD,
    WORLD_BASE,
    worldView,
    type WorldSite,
} from "./world";

type WorldBoardProps = {
    /** Every mission on the board: one pin per distinct place among them. */
    missions: Mission[];
    /** The mission the board shows: the reticle sits on its place. */
    mission: Mission | null;
    /** The board is on screen: pins are cursor targets only then. */
    active?: boolean;
};

/**
 * The planet as the situation display draws it: white coasts on black, a
 * faint graticule, the continents' names, an amber pin for each place that
 * holds a mission and, on the shown mission's place, the lock-on reticle with
 * a leader line to its coordinates. The view leans gently toward that place;
 * a mission with no place on the planet (a simulation) dims the map and says
 * so. The base map is fetched once per visit and drawn as its own paths; a
 * retarget moves one transform, never the coastlines.
 */
export function WorldBoard({ missions, mission, active = true }: WorldBoardProps) {
    const [ref, box] = useBox<HTMLDivElement>();
    const [still] = useState(reducedMotion);
    const land = useLand();
    const sites = useMemo(() => sitesOf(missions), [missions]);
    const site = siteOf(sites, mission);
    const off = mission !== null && !site;
    const view = worldView(box, site);
    const store = useFocusStore();
    // The pins slide with the map: the cursor re-measures once they settle.
    useEffect(() => {
        if (!active) return;
        const timer = window.setTimeout(() => store.relayout(), still ? 0 : 240);
        return () => window.clearTimeout(timer);
    }, [store, active, still, view.scale, view.x, view.y]);
    const ready = box.width > 0;
    return (
        <div
            ref={ref}
            className="gui-ops-world"
            data-off={off || undefined}
            data-still={still || undefined}
        >
            {ready && (
                <>
                    <svg
                        className="gui-ops-world-map"
                        width={box.width}
                        height={box.height}
                        role="img"
                        aria-label={site ? `World, ${site.city} marked` : "World"}
                    >
                        <g
                            className="gui-ops-world-plane"
                            style={{
                                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                            }}
                        >
                            <rect
                                className="gui-ops-world-sea"
                                width={WORLD.width}
                                height={WORLD.height}
                            />
                            <Graticule />
                            <Land paths={land} />
                            <rect
                                className="gui-ops-world-edge"
                                width={WORLD.width}
                                height={WORLD.height}
                            />
                        </g>
                    </svg>
                    {CONTINENTS.map((c) => {
                        const at = onScreen(view, c.lat, c.lon);
                        // A name cut by the frame's edge reads as a mistake: it steps out.
                        const out =
                            view.scale < NAME_SCALE ||
                            at.x < NAME_ROOM ||
                            at.x > box.width - NAME_ROOM ||
                            at.y < 12 ||
                            at.y > box.height - 12;
                        return (
                            <Placed key={c.name} at={at}>
                                <span className="gui-ops-world-name" data-out={out || undefined}>
                                    {c.name}
                                </span>
                            </Placed>
                        );
                    })}
                    {active &&
                        sites.map((s) => (
                            <Pin
                                key={s.key}
                                site={s}
                                at={onScreen(view, s.lat, s.lon)}
                                locked={s === site}
                                locate={mission}
                                flip={onScreen(view, s.lat, s.lon).x > box.width - 120}
                            />
                        ))}
                    {sites.length > 0 && (
                        // Always mounted, so it slides with the map even when it comes back on.
                        <Mark
                            site={site ?? sites[0]}
                            mission={site ? mission : null}
                            at={onScreen(view, (site ?? sites[0]).lat, (site ?? sites[0]).lon)}
                            box={box}
                        />
                    )}
                    {off && mission && (
                        <div
                            className="gui-ops-world-off"
                            role="status"
                            style={{ top: offLine(view, box.height) }}
                        >
                            <span className="gui-ops-world-off-head">Off the map</span>
                            <span className="gui-ops-world-off-line">
                                {mission.place ?? mission.location}
                            </span>
                            <span className="gui-ops-world-off-line">
                                No location on the planet
                            </span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/** Where the off-map notice sits: in the band under the planet when there is room, else over it. */
function offLine(view: { y: number; scale: number }, height: number): number {
    const bottom = view.y + WORLD.height * view.scale;
    return height - bottom >= 76 ? (bottom + height) / 2 : height / 2;
}

/** Below this map scale the names cover the coasts they name: the outline alone reads better. */
const NAME_SCALE = 0.3;

/** Half a continent name's width, about: closer to the frame's edge than this, it is cut. */
const NAME_ROOM = 56;

/** The key under the world view, in the plot legend's row so the board never changes height. */
export function WorldLegend() {
    return (
        <div className="gui-ops-legend">
            <span className="gui-ops-key">
                <i data-key="site" aria-hidden />
                Operations
            </span>
            <span className="gui-ops-key">
                <i data-key="locked" aria-hidden />
                Locked
            </span>
        </div>
    );
}

/** An element placed on a screen point, sliding with the map. */
function Placed({
    at,
    className = "gui-ops-world-at",
    children,
}: {
    at: { x: number; y: number };
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={className} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
            {children}
        </div>
    );
}

/**
 * A place with missions: an amber pin, the city and how many operations it
 * holds. Confirming it puts the queue's cursor on its mission (the shown one
 * when it is here, else its first).
 */
function Pin({
    site,
    at,
    locked,
    locate,
    flip,
}: {
    site: WorldSite;
    at: { x: number; y: number };
    locked: boolean;
    locate: Mission | null;
    /** Near the right edge: the name goes on the pin's left. */
    flip: boolean;
}) {
    const store = useFocusStore();
    const here = site.missions.find((m) => m.id === locate?.id) ?? site.missions[0];
    const { props } = useFocusable<HTMLButtonElement>({
        id: `world-site-${site.key}`,
        group: "ops-world",
        title: site.city,
        hint: site.missions.map((m) => m.name).join(" · "),
        instant: true,
        commands: [
            {
                action: "confirm",
                label: site.missions.length > 1 ? "Operations" : here.verb,
                run: () => store.focus(queueId(here)),
            },
        ],
    });
    return (
        <Placed at={at}>
            <button
                type="button"
                tabIndex={-1}
                className="gui-ops-world-pin"
                data-locked={locked || undefined}
                data-flip={flip || undefined}
                aria-label={`${site.city}, ${site.missions.length} operations`}
                {...props}
            >
                <i className="gui-ops-world-pin-mark" aria-hidden />
                <span className="gui-ops-world-pin-name">
                    {site.city}
                    <span className="gui-ops-world-pin-count">
                        {String(site.missions.length).padStart(2, "0")}
                    </span>
                </span>
            </button>
        </Placed>
    );
}

/**
 * The lock-on on the shown mission's place: four brackets that close in (once
 * per retarget), a leader line toward the middle of the board and the
 * readout: the city, the operation and its coordinates as its file gives them.
 */
function Mark({
    site,
    mission,
    at,
    box,
}: {
    site: WorldSite;
    /** Null: nothing locked here, the mark stands hidden. */
    mission: Mission | null;
    at: { x: number; y: number };
    box: { width: number; height: number };
}) {
    const side = at.x > box.width / 2 ? "w" : "e";
    const rise = at.y > box.height * 0.62 ? "n" : "s";
    if (!mission)
        return (
            <Placed at={at} className="gui-ops-world-at gui-ops-world-mark">
                {null}
            </Placed>
        );
    const coords = mission.coordinates?.join(" ") ?? degrees(site.lat, site.lon);
    return (
        <Placed at={at} className="gui-ops-world-at gui-ops-world-mark">
            <div className="gui-ops-world-lock" key={mission.id}>
                <i data-at="tl" />
                <i data-at="tr" />
                <i data-at="bl" />
                <i data-at="br" />
            </div>
            <svg className="gui-ops-world-leader" data-side={side} data-rise={rise} aria-hidden>
                <path d="M0 0L18 18H44" />
            </svg>
            <div className="gui-ops-world-readout" data-side={side} data-rise={rise}>
                <span className="gui-ops-world-readout-city">{site.city}</span>
                <span className="gui-ops-world-readout-op" key={mission.id}>
                    {mission.name}
                </span>
                <span className="gui-ops-world-readout-coords">{coords}</span>
            </div>
        </Placed>
    );
}

/** `35° 41′ N 139° 42′ E` from decimal degrees, for a source with no written coordinates. */
function degrees(lat: number, lon: number): string {
    const part = (v: number, pos: string, neg: string) => {
        const minutes = Math.round(Math.abs(v) * 60);
        const d = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${d}° ${String(m).padStart(2, "0")}′ ${v < 0 ? neg : pos}`;
    };
    return `${part(lat, "N", "S")} ${part(lon, "E", "W")}`;
}

const GRATICULE = graticule(30);
const EQUATOR = `M0 ${(WORLD.height * 84) / 144}H${WORLD.width}`;

const Graticule = memo(function Graticule() {
    return (
        <>
            <path className="gui-ops-world-grid" d={GRATICULE} />
            <path className="gui-ops-world-equator" d={EQUATOR} />
        </>
    );
});

type LandPath = { id: string; d: string };

/** The coastlines, drawn once per load: their props never change with the selection. */
const Land = memo(function Land({ paths }: { paths: LandPath[] }) {
    return (
        <g className="gui-ops-world-land">
            {paths.map((p) => (
                <path key={p.id} id={`world-${p.id}`} d={p.d} />
            ))}
        </g>
    );
});

let landLoad: Promise<LandPath[]> | null = null;
let landCache: LandPath[] | null = null;

/** The base map's landmasses, fetched and read once per visit. */
function loadLand(): Promise<LandPath[]> {
    landLoad ??= fetch(WORLD_BASE)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => {
            const doc = new DOMParser().parseFromString(text, "image/svg+xml");
            const paths = [...doc.querySelectorAll("path[id]")].map((p) => ({
                id: p.id,
                d: p.getAttribute("d") ?? "",
            }));
            landCache = paths;
            return paths;
        })
        .catch((error: unknown) => {
            // Try again on the next visit; the board stands without its coasts meanwhile.
            landLoad = null;
            throw error;
        });
    return landLoad;
}

const NO_LAND: LandPath[] = [];

function useLand(): LandPath[] {
    const [paths, setPaths] = useState<LandPath[]>(() => landCache ?? NO_LAND);
    useEffect(() => {
        if (landCache) return;
        let live = true;
        loadLand().then(
            (p) => live && setPaths(p),
            () => undefined,
        );
        return () => {
            live = false;
        };
    }, []);
    return paths;
}

/** The element's content box, followed as it resizes. */
function useBox<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const read = () => {
            const width = el.clientWidth;
            const height = el.clientHeight;
            // Hidden (the other view is up): keep the last size, so the map stays drawn.
            if (!width || !height) return;
            setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
        };
        read();
        const observer = new ResizeObserver(read);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, box] as const;
}
