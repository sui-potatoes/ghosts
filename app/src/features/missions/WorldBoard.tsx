// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    memo,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react";

import { uiTick } from "../../audio";
import { useFocusable, useFocusState } from "../../ui";
import { reducedMotion } from "../../ui/motion";
import type { Mission } from "./model";
import { queueId } from "./OpsQueue";
import {
    between,
    CONTINENTS,
    glideMs,
    graticule,
    onScreen,
    panView,
    siteOf,
    sitesOf,
    stepZoom,
    WORLD,
    WORLD_BASE,
    ZOOM_LEVELS,
    type WorldSite,
    type WorldView,
} from "./world";

type WorldBoardProps = {
    /** Every mission on the board: one pin per distinct place among them. */
    missions: Mission[];
    /** The mission the board shows: the map brings its place to the middle and locks on. */
    mission: Mission | null;
    /** Pins and the lock-on are up (the World view is on screen). */
    active?: boolean;
    /** The zoom step (`ZOOM_LEVELS`) and its change (the control, the wheel). */
    zoom: number;
    onZoom: (zoom: number) => void;
};

/**
 * The planet in the board's display: white coasts on black, a faint
 * graticule, the continents' names, an amber pin for each city that holds a
 * mission and, on the shown mission's city, the lock-on with a readout of the
 * city, the operation and its coordinates against it. The map wraps east–west
 * (as many copies of the one parsed drawing as the frame needs), so a pan
 * takes the shorter way round and never shows an edge. Every change of view
 * is one eased glide of one view (`usePan`), and every mark is placed from
 * that same view in the same frame, so pins and reticle never lag the coasts.
 * A mission with no place leaves the map where it was.
 */
export function WorldBoard({ missions, mission, active = true, zoom, onZoom }: WorldBoardProps) {
    const [ref, box] = useBox<HTMLDivElement>();
    const [still] = useState(reducedMotion);
    const land = useLand();
    const landRef = useRef<SVGGElement>(null);
    const sites = useMemo(() => sitesOf(missions), [missions]);
    const site = siteOf(sites, mission);
    const store = useFocusState();
    const { view, target, fade } = usePan(box, site, zoom, still);
    const marks = active && site !== null;

    // The cursor re-measures the pins once a move settles.
    useEffect(() => {
        if (!marks) return;
        const timer = window.setTimeout(() => store.relayout(), still ? 0 : 960);
        return () => window.clearTimeout(timer);
    }, [store, marks, still, target]);

    useWheelZoom(ref, marks, zoom, onZoom);

    // Where the readout goes: decided once per destination, toward open sea and inside the frame.
    const side = useMemo(
        () => (target && site ? readoutSide(target, site, box, landRef.current) : "e"),
        // The coastlines arrive once; the side is decided again when they do.
        [target, site, box, land],
    );

    const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
    const landId = `world-land-${ids}`;
    const centre = box.width / 2;
    const at = view && site ? onScreen(view, site.lat, site.lon, centre) : null;
    const pinId = site ? `world-site-${site.key}` : null;
    return (
        <div
            ref={ref}
            className="gui-ops-world"
            data-still={still || undefined}
            data-fade={still ? fade % 2 : undefined}
        >
            {box.width > 0 && view && (
                <>
                    <svg
                        className="gui-ops-world-map"
                        width={box.width}
                        height={box.height}
                        role="img"
                        aria-label={site ? `World, ${site.city} marked` : "World"}
                    >
                        <defs>
                            <Land id={landId} paths={land} landRef={landRef} />
                        </defs>
                        <g
                            className="gui-ops-world-plane"
                            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
                        >
                            {copiesOf(view, box.width).map((k) => (
                                <g key={k} transform={`translate(${k * WORLD.width} 0)`}>
                                    <rect
                                        className="gui-ops-world-sea"
                                        width={WORLD.width}
                                        height={WORLD.height}
                                    />
                                    <Graticule />
                                    <use href={`#${landId}`} />
                                </g>
                            ))}
                        </g>
                    </svg>
                    {CONTINENTS.map((c) => {
                        const p = onScreen(view, c.lat, c.lon, centre);
                        // A name cut by the frame, or over coasts it cannot fit between, steps out.
                        const out =
                            view.scale < NAME_SCALE ||
                            p.x < NAME_ROOM ||
                            p.x > box.width - NAME_ROOM ||
                            p.y < 12 ||
                            p.y > box.height - 12;
                        return (
                            <Placed key={c.name} at={p}>
                                <span className="gui-ops-world-name" data-out={out || undefined}>
                                    {c.name}
                                </span>
                            </Placed>
                        );
                    })}
                    {marks &&
                        sites.map((s) => {
                            const p = onScreen(view, s.lat, s.lon, centre);
                            return (
                                <Pin
                                    key={s.key}
                                    site={s}
                                    at={p}
                                    locked={s === site}
                                    locate={mission}
                                    flip={p.x > box.width - 120}
                                />
                            );
                        })}
                    {marks && at && mission && site && (
                        <Mark
                            site={site}
                            mission={mission}
                            at={at}
                            side={side}
                            cursorOn={store.focused === pinId}
                        />
                    )}
                </>
            )}
        </div>
    );
}

/** Which whole turns of the map the frame needs under a view: one, two at most. */
function copiesOf(view: WorldView, width: number): number[] {
    const period = WORLD.width * view.scale;
    if (!(period > 0)) return [0];
    const out: number[] = [];
    for (let k = Math.floor(-view.x / period); k <= Math.floor((width - view.x) / period); k++)
        out.push(k);
    return out;
}

/** Below this map scale the names cover the coasts they name: the outline alone reads better. */
const NAME_SCALE = 0.3;
/** Half a continent name's width, about: closer to the frame's edge than this, it is cut. */
const NAME_ROOM = 56;

/** The key under the world view and the zoom control, in the legend's row so the board never changes height. */
export function WorldLegend({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
    return (
        <div className="gui-ops-legend gui-ops-world-legend">
            <span className="gui-ops-key">
                <i data-key="site" aria-hidden />
                Operations
            </span>
            <ZoomControl zoom={zoom} onZoom={onZoom} />
        </div>
    );
}

/**
 * The map's zoom as an instrument control: label, −, level, +. Each sign is a
 * cursor target of its own (confirm or a press steps it), so left and right
 * pass through the control like any other row. 1× is the whole world.
 */
export function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
    return (
        <div className="gui-ops-zoom">
            <span className="gui-ops-zoom-label">Zoom</span>
            <ZoomStep by={-1} zoom={zoom} onZoom={onZoom} />
            <span className="gui-ops-zoom-value">{zoom}×</span>
            <ZoomStep by={1} zoom={zoom} onZoom={onZoom} />
        </div>
    );
}

/** One sign of the zoom control: steps the zoom out (−1) or in (+1), held at the ends. */
function ZoomStep({
    by,
    zoom,
    onZoom,
}: {
    by: 1 | -1;
    zoom: number;
    onZoom: (zoom: number) => void;
}) {
    const next = stepZoom(zoom, by);
    const end = next === zoom;
    const label = by < 0 ? "Zoom out" : "Zoom in";
    const { props } = useFocusable<HTMLButtonElement>({
        id: by < 0 ? "world-zoom-out" : "world-zoom-in",
        group: "ops-world-zoom",
        title: label,
        hint: zoom === ZOOM_LEVELS[0] ? "Whole world" : `${zoom}×`,
        instant: true,
        commands: end
            ? []
            : [
                  {
                      action: "confirm",
                      label,
                      run: () => {
                          uiTick(null);
                          onZoom(next);
                      },
                  },
              ],
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="gui-ops-zoom-step"
            data-end={end || undefined}
            aria-label={label}
            {...props}
        >
            <i data-sign={by < 0 ? "minus" : "plus"} aria-hidden />
        </button>
    );
}

/** An element placed on a screen point. */
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
 * A city with missions: an amber pin (the cursor target, a square the size of
 * the reticle centred on the city) and, beside it, the city and how many
 * operations it holds (not part of the target). Confirming it puts the
 * queue's cursor on its mission: the shown one when it is here, else its first.
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
    /** Near the frame's right edge: the name goes on the pin's left. */
    flip: boolean;
}) {
    const store = useFocusState();
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
                aria-label={`${site.city}, ${site.missions.length} operations`}
                {...props}
            >
                <i className="gui-ops-world-pin-mark" aria-hidden />
            </button>
            <span
                className="gui-ops-world-pin-name"
                data-flip={flip || undefined}
                data-locked={locked || undefined}
                aria-hidden
            >
                {site.city}
                <span className="gui-ops-world-pin-count">
                    {String(site.missions.length).padStart(2, "0")}
                </span>
            </span>
        </Placed>
    );
}

/** Which side of the pin the readout sits on. */
type Side = "e" | "w" | "n" | "s";

/** The readout's box beside the pin for each side, in px from the pin: it meets the reticle's edge. */
const READOUT_W = 196;
const READOUT_H = 58;
const READOUT_GAP = 23;
const SIDE_BOX: Record<Side, [x0: number, y0: number]> = {
    e: [READOUT_GAP, -READOUT_H / 2],
    w: [-READOUT_GAP - READOUT_W, -READOUT_H / 2],
    s: [-READOUT_W / 2, READOUT_GAP],
    n: [-READOUT_W / 2, -READOUT_GAP - READOUT_H],
};

/**
 * The side whose box stays inside the frame and covers the least land
 * (sampled on the coastlines themselves) at the destination view; east first on a tie.
 */
function readoutSide(
    view: WorldView,
    site: WorldSite,
    box: { width: number; height: number },
    land: SVGGElement | null,
): Side {
    const p = onScreen(view, site.lat, site.lon, box.width / 2);
    const paths = land ? [...land.querySelectorAll("path")] : [];
    const onLand = (sx: number, sy: number) => {
        const mx = ((((sx - view.x) / view.scale) % WORLD.width) + WORLD.width) % WORLD.width;
        const my = (sy - view.y) / view.scale;
        const point = new DOMPoint(mx, my);
        return paths.some((path) => path.isPointInFill(point));
    };
    let best: Side = "e";
    let score = Infinity;
    for (const side of ["e", "w", "s", "n"] as const) {
        const [x0, y0] = SIDE_BOX[side];
        const left = p.x + x0;
        const top = p.y + y0;
        const outside =
            left < 4 ||
            top < 4 ||
            left + READOUT_W > box.width - 4 ||
            top + READOUT_H > box.height - 4;
        let hits = outside ? 100 : 0;
        for (let i = 0; i < 5; i++)
            for (let j = 0; j < 3; j++)
                if (onLand(left + (READOUT_W * (i + 0.5)) / 5, top + (READOUT_H * (j + 0.5)) / 3))
                    hits += 1;
        if (hits < score) {
            score = hits;
            best = side;
        }
    }
    return best;
}

/**
 * The lock-on on the shown mission's city: four cyan brackets that close in
 * once per retarget (hidden while the white cursor is on the pin, which then
 * stands in their place) and, against the reticle, the readout: the city, the
 * operation and its coordinates as its file gives them. A new side fades in.
 */
function Mark({
    site,
    mission,
    at,
    side,
    cursorOn,
}: {
    site: WorldSite;
    mission: Mission;
    at: { x: number; y: number };
    side: Side;
    cursorOn: boolean;
}) {
    const coords = mission.coordinates?.join(" ") ?? degrees(site.lat, site.lon);
    const [x0, y0] = SIDE_BOX[side];
    return (
        <Placed at={at} className="gui-ops-world-at gui-ops-world-mark">
            <div
                className="gui-ops-world-lock"
                key={mission.id}
                data-hidden={cursorOn || undefined}
            >
                <i data-at="tl" />
                <i data-at="tr" />
                <i data-at="bl" />
                <i data-at="br" />
            </div>
            <div
                key={side}
                className="gui-ops-world-readout"
                data-side={side}
                style={{ left: x0, top: y0, width: READOUT_W, height: READOUT_H }}
            >
                <span className="gui-ops-world-readout-city">{site.city}</span>
                <span className="gui-ops-world-readout-op">{mission.name}</span>
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
const EQUATOR = `M0 ${(WORLD.height * WORLD.north) / (WORLD.north - WORLD.south)}H${WORLD.width}`;

const Graticule = memo(function Graticule() {
    return (
        <>
            <path className="gui-ops-world-grid" d={GRATICULE} />
            <path className="gui-ops-world-equator" d={EQUATOR} />
        </>
    );
});

type LandPath = { id: string; d: string };

/**
 * The coastlines, drawn once per load into `<defs>`; the map shows them by
 * `<use>` (same document), once per copy. Their look rides on presentation
 * attributes so the copies carry it: `currentColor`, a hairline that keeps
 * its width at any zoom.
 */
const Land = memo(function Land({
    id,
    paths,
    landRef,
}: {
    id: string;
    paths: LandPath[];
    landRef: RefObject<SVGGElement | null>;
}) {
    return (
        <g
            ref={landRef}
            id={id}
            fill="currentColor"
            fillOpacity={0.06}
            stroke="currentColor"
            strokeOpacity={0.85}
            strokeWidth={0.9}
            strokeLinejoin="round"
        >
            {paths.map((p) => (
                <path key={p.id} d={p.d} vectorEffect="non-scaling-stroke" />
            ))}
        </g>
    );
});

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The view on screen: one rAF glide of one view toward the target whenever
 * the place or the zoom changes (`glideMs`: quick hops, longer travel). The
 * view is never folded, so no frame moves by a world's width; a retarget
 * mid-glide carries on from where the map is (easing out, no restart). First
 * paint and a resize place it at once; with no place (a simulation) it holds
 * where it was. Under reduced motion the view jumps and `fade` changes, for a
 * short crossfade instead of travel.
 */
function usePan(
    box: { width: number; height: number },
    site: WorldSite | null,
    zoom: number,
    still: boolean,
): { view: WorldView | null; target: WorldView | null; fade: number } {
    const [view, setView] = useState<WorldView | null>(null);
    const [target, setTarget] = useState<WorldView | null>(null);
    const [fade, setFade] = useState(0);
    const shown = useRef<WorldView | null>(null);
    const goal = useRef<WorldView | null>(null);
    const moving = useRef(false);
    const sized = useRef("");
    useLayoutEffect(() => {
        if (!box.width) return;
        const size = `${box.width}x${box.height}`;
        const resized = sized.current !== size;
        sized.current = size;
        const a = shown.current;
        // A simulation has no place: the map finishes the glide it was on and holds there.
        const hold = !site && a && !resized;
        const b = hold ? goal.current : panView({ box, point: site, zoom, from: a });
        if (!b) return;
        goal.current = b;
        setTarget(b);
        if (!a || resized || still) {
            if (a && still) setFade((f) => f + 1);
            moving.current = false;
            shown.current = b;
            setView(b);
            return;
        }
        if (a.x === b.x && a.y === b.y && a.scale === b.scale) {
            moving.current = false;
            return;
        }
        const ease = moving.current ? easeOut : easeInOut;
        const duration = glideMs(a, b);
        let frame = 0;
        const start = performance.now();
        moving.current = true;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const v = between(a, b, ease(t));
            shown.current = v;
            setView(v);
            if (t < 1) frame = requestAnimationFrame(tick);
            else moving.current = false;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [box, site, zoom, still]);
    return { view, target, fade };
}

/**
 * The wheel and a trackpad pinch over the map step the zoom (only over the
 * map: the listener is on its own element). Its default is held there, so
 * the page neither scrolls nor zooms under it.
 */
function useWheelZoom(
    ref: RefObject<HTMLElement | null>,
    enabled: boolean,
    zoom: number,
    onZoom: (zoom: number) => void,
) {
    const state = useRef({ zoom, onZoom, enabled, sum: 0, last: 0 });
    useEffect(() => {
        state.current.zoom = zoom;
        state.current.onZoom = onZoom;
        state.current.enabled = enabled;
    }, [zoom, onZoom, enabled]);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const wheel = (e: WheelEvent) => {
            const s = state.current;
            if (!s.enabled) return;
            e.preventDefault();
            const now = performance.now();
            if (now - s.last > 400) s.sum = 0;
            // A pinch arrives as small ctrl-wheel deltas: it needs less travel per step.
            s.sum += e.deltaY * (e.ctrlKey ? 6 : 1) * (e.deltaMode === 1 ? 32 : 1);
            if (Math.abs(s.sum) < 80 || now - s.last < 140) return;
            const next = stepZoom(s.zoom, s.sum < 0 ? 1 : -1);
            s.sum = 0;
            s.last = now;
            if (next !== s.zoom) {
                s.zoom = next;
                s.onZoom(next);
            }
        };
        el.addEventListener("wheel", wheel, { passive: false });
        return () => el.removeEventListener("wheel", wheel);
    }, [ref]);
}

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
            // Hidden: keep the last size, so the map stays drawn.
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
