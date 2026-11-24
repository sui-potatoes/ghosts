// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The mission board's view-model, pure (tested in `tests/missions-model.test.ts`).
 * A screen that offers missions (training today, a faction board later) maps
 * its own data onto `Mission` and hands the list to the console pieces in this
 * folder; nothing here knows where a mission came from. Fields a source has no
 * data for are left out, and the pieces draw nothing for them.
 */

/** A tile as the rules read it: the Move map's tile kinds. */
export type PlotTile =
    | { t: "empty" }
    | { t: "cover"; sides: readonly [left: number, top: number, right: number, bottom: number] }
    | { t: "unwalkable" }
    | { t: "wall" }
    | { t: "obstacle" };

/** A cell on the plot: `[x, y]`, 0-based from the north-west corner, y growing south. */
export type PlotCell = readonly [x: number, y: number];

/** Cover on one edge of a tile: 1 low, 2 high (the Move map's side values). */
export type PlotEdge = { x: number; y: number; side: "n" | "e" | "s" | "w"; level: 1 | 2 };

/** The level's layout as the situation display draws it. */
export interface MissionPlot {
    cols: number;
    rows: number;
    /** Solid tiles: walls (stop everything) and obstacles (props a unit can't stand in). */
    walls: PlotCell[];
    obstacles: PlotCell[];
    /** Tiles nothing walks on (pits, voids, the inside of a closed building). */
    voids: PlotCell[];
    /** Each cover edge once. */
    edges: PlotEdge[];
    /** The squad's deployment and the opposition's. */
    squad: PlotCell[];
    hostiles: PlotCell[];
    objective?: PlotCell;
}

/** Where the mission stands for this player. */
export type MissionState = "open" | "done" | "locked";

/** A stage of a mission that is taught or fought in parts (Basics' lessons). */
export type MissionStage = { id: string; title: string; done: boolean };

/** One line of the briefing's facts: `Squad 4`, `Ground 18 × 14`. */
export type MissionFact = { label: string; value: string };

export interface Mission {
    id: string;
    /** The operation's file code, `BL–09.007`. */
    code?: string;
    name: string;
    /** Where, in one short line: `Tokyo / Sector 09`. */
    location: string;
    /** The full place name the briefing opens on. */
    place?: string;
    coordinates?: readonly [lat: string, lon: string];
    /** Who issued it: `Helios Strategic Industries / Eyes only`. */
    issuer?: string;
    /** The contract, a line per paragraph; `*word*` marks an order name. */
    brief: string[];
    objectives: { title: string; detail?: string }[];
    facts: MissionFact[];
    /** Threat as pips: `level` of `max`, with its word. */
    threat?: { label: string; level: number; max: number };
    plot?: MissionPlot;
    stages?: MissionStage[];
    state: MissionState;
    /** Locked: why, as the bar says it. */
    locked?: string;
    /** The one the player should take next. */
    next?: boolean;
    /** The commit command's label (`Deploy`). */
    verb: string;
    /** Faction wars, not used by training yet: who posts it and what it pays. */
    faction?: { id: string; name: string };
    district?: { code: string; name: string };
    reward?: { label: string; value: string };
    standing?: { label: string; value: number; max: number };
}

type Grid = readonly (readonly PlotTile[])[];

const SIDE_OF = ["w", "n", "e", "s"] as const;
/** The neighbour across each side, and the side it sees from there. */
const ACROSS: Record<PlotEdge["side"], [dx: number, dy: number, back: PlotEdge["side"]]> = {
    n: [0, -1, "s"],
    s: [0, 1, "n"],
    w: [-1, 0, "e"],
    e: [1, 0, "w"],
};

/**
 * The plot of a tile grid (`tiles[y][x]`, as the Move map export has it) with
 * both sides' deployment and the objective. A cover edge carried by both tiles
 * it separates is drawn once, at its higher level; deployment cells off the
 * grid are dropped.
 */
export function plotOf(
    tiles: Grid,
    spawns: { squad: readonly PlotCell[]; hostiles: readonly PlotCell[] },
    objective?: PlotCell,
): MissionPlot {
    const rows = tiles.length;
    const cols = rows ? Math.max(...tiles.map((r) => r.length)) : 0;
    const on = ([x, y]: PlotCell) => x >= 0 && y >= 0 && x < cols && y < rows;
    const plot: MissionPlot = {
        cols,
        rows,
        walls: [],
        obstacles: [],
        voids: [],
        edges: [],
        squad: spawns.squad.filter(on).map(([x, y]) => [x, y]),
        hostiles: spawns.hostiles.filter(on).map(([x, y]) => [x, y]),
    };
    if (objective && on(objective)) plot.objective = [objective[0], objective[1]];
    const seen = new Map<string, PlotEdge>();
    tiles.forEach((row, y) => {
        row.forEach((tile, x) => {
            if (tile.t === "wall") plot.walls.push([x, y]);
            else if (tile.t === "obstacle") plot.obstacles.push([x, y]);
            else if (tile.t === "unwalkable") plot.voids.push([x, y]);
            if (tile.t !== "cover") return;
            tile.sides.forEach((value, i) => {
                if (value !== 1 && value !== 2) return;
                const side = SIDE_OF[i];
                const [dx, dy, back] = ACROSS[side];
                // Key an edge by its north or west tile, so both tiles' copies meet.
                const key =
                    side === "s" || side === "e"
                        ? `${x},${y},${side}`
                        : `${x + dx},${y + dy},${back}`;
                const was = seen.get(key);
                if (!was || was.level < value) seen.set(key, { x, y, side, level: value });
            });
        });
    });
    plot.edges = [...seen.values()];
    return plot;
}

/** A column's letter on the board's rule: A…Z, then AA, AB… */
export function columnLabel(index: number): string {
    let n = index;
    let out = "";
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
}

/** Which rule marks to print on an axis of `count` cells: every `step`th and the last. */
export function ruleMarks(count: number, step: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i += step) out.push(i);
    if (count > 0 && out[out.length - 1] !== count - 1) {
        // Keep the last mark clear of the one before it.
        if (count - 1 - out[out.length - 1] < step / 2) out.pop();
        out.push(count - 1);
    }
    return out;
}

/** The cell size in whole pixels that fits the plot into a box, never below `min`. */
export function cellSize(
    plot: Pick<MissionPlot, "cols" | "rows">,
    box: { width: number; height: number },
    min = 6,
): number {
    if (!plot.cols || !plot.rows) return min;
    return Math.max(min, Math.floor(Math.min(box.width / plot.cols, box.height / plot.rows)));
}

/** A briefing line in parts: plain text and `*order*` words. */
export function briefParts(line: string): { text: string; order: boolean }[] {
    return line
        .split(/(\*[^*]+\*)/)
        .filter(Boolean)
        .map((part) =>
            part.length > 2 && part.startsWith("*") && part.endsWith("*")
                ? { text: part.slice(1, -1), order: true }
                : { text: part, order: false },
        );
}

/** The mission the board opens on: the asked one if it is on the board, else the next, else the first. */
export function openingMission(missions: readonly Mission[], asked?: string | null): string | null {
    if (asked && missions.some((m) => m.id === asked)) return asked;
    return (missions.find((m) => m.next) ?? missions[0])?.id ?? null;
}

/**
 * Marks the next mission to take: the first open one not yet done, in board
 * order. Nothing is marked once every open mission is done.
 */
export function withNext(missions: readonly Mission[]): Mission[] {
    const next = missions.find((m) => m.state === "open");
    return missions.map((m) => ({ ...m, next: m === next ? true : undefined }));
}

/** `done` of `total` as the console says it: `2 / 4`. */
export const tally = (missions: readonly Mission[]) =>
    `${missions.filter((m) => m.state === "done").length} / ${missions.length}`;

/** The UTC clock the status strip shows: `14:02:09`. */
export function clockOf(date: Date): string {
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`;
}
