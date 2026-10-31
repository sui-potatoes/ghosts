// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    assetByUid,
    assetCatalog,
    canPlace,
    demoLevels,
    EditorScene,
    exportLevel,
    fitsBounds,
    floorByUid,
    floorCatalog,
    importLevel,
    inLevel,
    newLevel,
    officeFinishes,
    placementsAt,
    replacementsFor,
    swapAsset,
    interiorPreset,
    timePresets,
    type AssetSpec,
    type Level,
    type LevelLighting,
    type OfficeFinish,
    type Placement,
    type TimeOfDay,
    type Turn,
} from "@ghosts/engine/editor";
import { useBack } from "../hooks/useBack";
import { onKeys } from "../input";
import "../editor.css";

type Cell = [number, number];
type Tool = "place" | "select" | "erase" | "spawn" | "objective" | "void" | "light";

const SLOT_KEY = "ghosts:editor-slot";
const TIMES: readonly (TimeOfDay | "interior")[] = [
    "morning",
    "day",
    "evening",
    "night",
    "interior",
];
const BASES = [
    { id: "scratch", name: "Scratch" },
    ...demoLevels.map((d) => ({ id: d.id, name: d.name })),
];

const draftKey = (slot: string) =>
    slot === "scratch" ? "ghosts:editor-level" : `ghosts:editor-level:${slot}`;

function loadDraft(key: string): Level | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? importLevel(JSON.parse(raw)).level : null;
    } catch {
        return null;
    }
}

function buildBase(slot: string): { level: Level; dropped: number } {
    const demo = demoLevels.find((d) => d.id === slot);
    return demo ? demo.build() : { level: newLevel(), dropped: 0 };
}

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

/** Swatch tones for the office color schemes (the fabric tint of each). */
const FINISH_TONES: Record<OfficeFinish, string> = {
    sage: "#627d75",
    slate: "#647487",
    sand: "#9b846a",
};

/** CVR / SOL / OBS / ENT, with the seat: ·E edge, ·S surface, ·W wall mount. */
function tagOf(a: AssetSpec): string {
    const base = { cover: "CVR", solid: "SOL", obstacle: "OBS", none: "ENT" }[a.footprint];
    const seat =
        a.mount === "wall" ? "W" : a.mount === "surface" ? "S" : a.place === "edge" ? "E" : "";
    return seat ? `${base}·${seat}` : base;
}

/**
 * The level editor: paint catalog assets (walls and doors snap to cell edges,
 * clutter mounts on surfaces), redress stand-ins via Select, paint flooring
 * and unwalkable tiles, mark deployment and the objective, light the scene,
 * and export the twofold level file — the Move `Map` tile grid plus the
 * render placements, assets referenced by uid. The shipped demos load as
 * editable bases; every base keeps its own local draft on this device.
 * Left mouse paints, right orbits, R turns, E toggles erase, ⌘Z undoes,
 * ⇧⌘Z redoes, / finds assets. Point lights place per cell with their own
 * color, intensity and height.
 */
export default function Editor() {
    const host = useRef<HTMLDivElement>(null);
    const scene = useRef<EditorScene | null>(null);
    const file = useRef<HTMLInputElement>(null);
    const searchBox = useRef<HTMLInputElement>(null);
    const [slot, setSlot] = useState(() => {
        try {
            return localStorage.getItem(SLOT_KEY) ?? "scratch";
        } catch {
            return "scratch";
        }
    });
    const [level, setLevelState] = useState<Level>(
        () => loadDraft(draftKey(slot)) ?? buildBase(slot).level,
    );
    const levelRef = useRef(level);
    const slotRef = useRef(slot);
    slotRef.current = slot;
    // Undo and redo are snapshot stacks of the whole board; a fresh edit
    // after an undo discards the redo branch, as editors do.
    const history = useRef<Level[]>([]);
    const future = useRef<Level[]>([]);
    const [tool, setTool] = useState<Tool>("place");
    const [brush, setBrush] = useState("b01");
    const [turn, setTurn] = useState<Turn>(0);
    // The office color scheme new placements carry; placed ones keep their own.
    const [finish, setFinish] = useState<OfficeFinish>("sage");
    const finishRef = useRef(finish);
    finishRef.current = finish;
    const [selection, setSelection] = useState<Placement | null>(null);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const [hover, setHover] = useState<{ cell: Cell; side: Turn } | null>(null);
    const hoverRef = useRef(hover);
    hoverRef.current = hover;
    const [search, setSearch] = useState("");
    const [notice, setNotice] = useState("");
    // What the Light tool places next; placed lights keep their own values.
    const [lamp, setLamp] = useState({ color: 0xffe4ad, intensity: 6, height: 2.6 });
    const lampRef = useRef(lamp);
    lampRef.current = lamp;

    const commit = (next: Level) => {
        history.current.push(levelRef.current);
        if (history.current.length > 64) history.current.shift();
        future.current = [];
        levelRef.current = next;
        setLevelState(next);
    };
    const undoRef = useRef(() => {});
    undoRef.current = () => {
        const prev = history.current.pop();
        if (!prev) return;
        future.current.push(levelRef.current);
        levelRef.current = prev;
        setLevelState(prev);
    };
    const redoRef = useRef(() => {});
    redoRef.current = () => {
        const next = future.current.pop();
        if (!next) return;
        history.current.push(levelRef.current);
        levelRef.current = next;
        setLevelState(next);
    };

    const rotateRef = useRef(() => {});
    rotateRef.current = () => {
        const sel = selectionRef.current;
        const lv = levelRef.current;
        if (tool !== "select" || !sel) {
            setTurn((t) => ((t + 1) % 4) as Turn);
            return;
        }
        const without = { ...lv, placements: lv.placements.filter((p) => p !== sel) };
        for (let step = 1; step < 4; step++) {
            const next = { ...sel, turn: ((sel.turn + step) % 4) as Turn };
            if (!canPlace(without, next)) continue;
            const placements = [...lv.placements];
            placements[lv.placements.indexOf(sel)] = next;
            commit({ ...lv, placements });
            setSelection(next);
            return;
        }
    };
    const deleteRef = useRef(() => {});
    deleteRef.current = () => {
        const sel = selectionRef.current;
        if (!sel) return;
        commit({
            ...levelRef.current,
            placements: levelRef.current.placements.filter((p) => p !== sel),
        });
        setSelection(null);
    };

    // Toggling tools decide add-or-remove on the stroke's FIRST cell, so a
    // drag never flips the markers it passes over.
    const strokeMode = useRef<"add" | "remove" | null>(null);
    useEffect(() => {
        const up = () => (strokeMode.current = null);
        window.addEventListener("pointerup", up);
        return () => window.removeEventListener("pointerup", up);
    }, []);

    const paintRef = useRef<(cell: Cell, side: Turn) => void>(() => {});
    paintRef.current = (cell, side) => {
        const lv = levelRef.current;
        const key = cell.join();
        const stroke = (has: boolean) => {
            strokeMode.current ??= has ? "remove" : "add";
            return (strokeMode.current === "add") !== has;
        };
        if (tool === "place") {
            if (floorByUid(brush)) {
                if (lv.floors.find((f) => f.at.join() === key)?.floor === brush) return;
                const floors = [
                    ...lv.floors.filter((f) => f.at.join() !== key),
                    { floor: brush, at: cell },
                ];
                commit({ ...lv, floors });
                return;
            }
            const spec = assetByUid(brush);
            if (!spec) return;
            const p: Placement = {
                asset: brush,
                at: cell,
                turn: spec.place === "edge" ? side : turn,
                ...(spec.kind.startsWith("office-") ? { finish: finishRef.current } : {}),
            };
            if (canPlace(lv, p)) commit({ ...lv, placements: [...lv.placements, p] });
        } else if (tool === "select") {
            const hits = placementsAt(lv, cell);
            setSelection(hits[hits.length - 1] ?? null);
        } else if (tool === "erase") {
            const hits = placementsAt(lv, cell);
            if (hits.length) {
                const last = hits[hits.length - 1];
                commit({ ...lv, placements: lv.placements.filter((p) => p !== last) });
            } else if (lv.lights.some((l) => l.at.join() === key)) {
                commit({ ...lv, lights: lv.lights.filter((l) => l.at.join() !== key) });
            } else if (lv.unwalkable.some((u) => u.join() === key)) {
                commit({ ...lv, unwalkable: lv.unwalkable.filter((u) => u.join() !== key) });
            } else if (lv.objective?.join() === key) {
                commit({ ...lv, objective: undefined });
            } else if (lv.spawns.some((s) => s.join() === key)) {
                commit({ ...lv, spawns: lv.spawns.filter((s) => s.join() !== key) });
            } else if (lv.floors.some((f) => f.at.join() === key)) {
                commit({ ...lv, floors: lv.floors.filter((f) => f.at.join() !== key) });
            }
        } else if (tool === "light") {
            const has = lv.lights.some((l) => l.at.join() === key);
            if (!stroke(has)) return;
            const lights = has
                ? lv.lights.filter((l) => l.at.join() !== key)
                : [...lv.lights, { at: cell, ...lampRef.current }];
            commit({ ...lv, lights });
        } else if (tool === "spawn") {
            const has = lv.spawns.some((s) => s.join() === key);
            if (!stroke(has)) return;
            // Four deployment pads, the squad's size; the oldest gives way.
            const spawns = has
                ? lv.spawns.filter((s) => s.join() !== key)
                : [...lv.spawns.slice(-3), cell];
            commit({ ...lv, spawns });
        } else if (tool === "objective") {
            commit({ ...lv, objective: lv.objective?.join() === key ? undefined : cell });
        } else {
            const has = lv.unwalkable.some((u) => u.join() === key);
            if (!stroke(has)) return;
            const unwalkable = has
                ? lv.unwalkable.filter((u) => u.join() !== key)
                : [...lv.unwalkable, cell];
            commit({ ...lv, unwalkable });
        }
    };

    // The picker: copy whatever stands at `cell` into the brush, facing kept.
    const pickRef = useRef<(cell: Cell) => void>(() => {});
    pickRef.current = (cell) => {
        const lv = levelRef.current;
        const hit = placementsAt(lv, cell).at(-1);
        const uid = hit?.asset ?? lv.floors.find((f) => f.at.join() === cell.join())?.floor;
        if (!uid) return;
        if (hit) {
            setTurn(hit.turn);
            if (hit.finish) setFinish(hit.finish);
        }
        setBrush(uid);
        setTool("place");
        setSearch("");
        setNotice(`Picked ${(assetByUid(uid) ?? floorByUid(uid))?.name ?? uid}`);
        requestAnimationFrame(() =>
            document.getElementById(`ed-asset-${uid}`)?.scrollIntoView({ block: "nearest" }),
        );
    };

    const navigate = useNavigate();
    const [leaving, setLeaving] = useState(false);
    // Escape asks before leaving; a second Escape (or the backdrop) stays.
    useBack(() => setLeaving((open) => !open));

    useEffect(() => {
        if (!host.current) return;
        const s = new EditorScene(host.current);
        s.onPaint = (cell, side) => paintRef.current([cell[0], cell[1]], side);
        s.onHover = (cell, side) => setHover(cell ? { cell: [cell[0], cell[1]], side } : null);
        s.onPick = (cell) => pickRef.current([cell[0], cell[1]]);
        scene.current = s;
        s.setLevel(levelRef.current);
        return () => {
            s.dispose();
            scene.current = null;
        };
    }, []);

    useEffect(() => {
        scene.current?.setLevel(level);
        try {
            localStorage.setItem(draftKey(slotRef.current), JSON.stringify(exportLevel(level)));
        } catch {
            // Private windows may refuse storage; the editor still works.
        }
    }, [level]);

    useEffect(() => {
        const placing = tool === "place" && !floorByUid(brush);
        scene.current?.setPreview(placing ? brush : null, turn);
        scene.current?.setTone(
            tool === "place"
                ? "place"
                : tool === "erase"
                  ? "erase"
                  : tool === "select"
                    ? "select"
                    : "mark",
        );
    }, [tool, brush, turn]);

    useEffect(() => {
        if (selection && !level.placements.includes(selection)) setSelection(null);
    }, [level, selection]);

    // What a click would hit: the selection stays cyan, the erase target dims red.
    useEffect(() => {
        const s = scene.current;
        if (!s) return;
        if (tool === "select") s.mark(selection, "select");
        else if (tool === "erase" && hover) {
            const hits = placementsAt(level, hover.cell);
            s.mark(hits[hits.length - 1] ?? null, "erase");
        } else s.mark(null);
    }, [tool, selection, hover, level]);

    // Tool keys ride the input bus's shortcut lane: typing is skipped there,
    // unbound chords (⌘R, ⌘S) stay the browser's, and the whole map sleeps
    // while the leave prompt is up, so nothing edits the level under it.
    useEffect(() => {
        if (leaving) return;
        return onKeys({
            "Mod+z": () => undoRef.current(),
            "Mod+Shift+z": () => redoRef.current(),
            "Mod+y": () => redoRef.current(),
            r: () => rotateRef.current(),
            e: () => setTool((t) => (t === "erase" ? "place" : "erase")),
            s: () => setTool("select"),
            p: () => setTool("place"),
            i: () => {
                if (hoverRef.current) pickRef.current(hoverRef.current.cell);
            },
            "/": () => searchBox.current?.focus(),
            Delete: () => deleteRef.current(),
            Backspace: () => deleteRef.current(),
        });
    }, [leaving]);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(""), 4000);
        return () => clearTimeout(timer);
    }, [notice]);

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase();
        const match = (name: string, uid: string, extra = "") =>
            !q || `${name} ${uid} ${extra}`.toLowerCase().includes(q);
        const byCategory = new Map<string, { uid: string; name: string; tag: string }[]>();
        for (const a of assetCatalog) {
            if (!match(a.name, a.uid, `${a.kind} ${a.category}`)) continue;
            const list = byCategory.get(a.category) ?? [];
            list.push({ uid: a.uid, name: a.name, tag: tagOf(a) });
            byCategory.set(a.category, list);
        }
        const floors = floorCatalog
            .filter((f) => match(f.name, f.uid, "floor flooring"))
            .map((f) => ({ uid: f.uid, name: f.name, tag: f.raise ? "RAISED" : "FLOOR" }));
        if (floors.length) byCategory.set("Flooring", floors);
        return [...byCategory];
    }, [search]);

    const switchSlot = (next: string) => {
        if (next === slot) return;
        const loaded = loadDraft(draftKey(next)) ?? buildBase(next).level;
        history.current = [];
        future.current = [];
        setSelection(null);
        levelRef.current = loaded;
        setLevelState(loaded);
        setSlot(next);
        try {
            localStorage.setItem(SLOT_KEY, next);
        } catch {
            // Kept for this session only.
        }
    };

    const rebuild = () => {
        const { level: fresh, dropped } = buildBase(slot);
        setSelection(null);
        commit(fresh);
        setNotice(dropped ? `Rebuilt · ${dropped} piece(s) had no seat` : "Rebuilt from the demo");
    };

    const resize = (width: number, depth: number) => {
        const lv = levelRef.current;
        const next: Level = {
            ...lv,
            width: Math.max(6, Math.min(48, width || lv.width)),
            depth: Math.max(6, Math.min(48, depth || lv.depth)),
        };
        next.placements = lv.placements.filter((p) => fitsBounds(next, p));
        next.floors = lv.floors.filter((f) => inLevel(next, f.at));
        next.unwalkable = lv.unwalkable.filter((c) => inLevel(next, c));
        next.spawns = lv.spawns.filter((c) => inLevel(next, c));
        if (next.objective && !inLevel(next, next.objective)) next.objective = undefined;
        commit(next);
    };

    const replaceSelection = (uid: string) => {
        const sel = selectionRef.current;
        if (!sel) return;
        const index = levelRef.current.placements.indexOf(sel);
        const swapped = swapAsset(levelRef.current, sel, uid);
        if (!swapped) {
            setNotice("No room for that stand-in here");
            return;
        }
        commit(swapped);
        setSelection(swapped.placements[index]);
    };

    const recolorSelection = (next: OfficeFinish) => {
        const sel = selectionRef.current;
        const lv = levelRef.current;
        if (!sel) return;
        const index = lv.placements.indexOf(sel);
        if (index < 0) return;
        const recolored: Placement = { ...sel, finish: next };
        const placements = [...lv.placements];
        placements[index] = recolored;
        commit({ ...lv, placements });
        setSelection(recolored);
    };

    const setLight = (patch: Partial<LevelLighting>) =>
        commit({ ...levelRef.current, lighting: { ...levelRef.current.lighting, ...patch } });

    const doExport = () => {
        const data = JSON.stringify(exportLevel(levelRef.current), null, 2);
        const name =
            levelRef.current.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "level";
        const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}.ghosts-level.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const doImport = (picked: File | undefined) => {
        if (!picked) return;
        void picked.text().then((text) => {
            try {
                const { level: loaded, dropped } = importLevel(JSON.parse(text));
                history.current = [];
                future.current = [];
                setSelection(null);
                levelRef.current = loaded;
                setLevelState(loaded);
                setNotice(
                    dropped ? `Loaded · ${dropped} unknown piece(s) dropped` : "Level loaded",
                );
            } catch {
                setNotice("Not a ghosts level file");
            }
        });
    };

    const lighting = level.lighting;
    const preset = lighting.time === "interior" ? interiorPreset : timePresets[lighting.time];
    const brushSpec = assetByUid(brush) ?? floorByUid(brush);
    const selectionSpec = selection ? assetByUid(selection.asset) : undefined;
    const eraseTarget =
        tool === "erase" && hover
            ? assetByUid(placementsAt(level, hover.cell).at(-1)?.asset ?? "")
            : undefined;
    const slider = (
        label: string,
        value: number,
        min: number,
        max: number,
        step: number,
        apply: (v: number) => void,
    ) => (
        <label className="flex flex-col gap-0.5">
            <span className="ed-chip flex justify-between">
                {label}
                <span>{value.toFixed(step < 0.01 ? 3 : 2)}</span>
            </span>
            <input
                className="ed-range"
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => apply(Number(e.target.value))}
            />
        </label>
    );
    const color = (label: string, value: number, apply: (v: number) => void) => (
        <label className="flex items-center justify-between gap-2">
            <span className="ed-chip">{label}</span>
            <input
                className="ed-color"
                type="color"
                value={hex(value)}
                onChange={(e) => apply(parseInt(e.target.value.slice(1), 16))}
            />
        </label>
    );
    const finishes = (value: OfficeFinish | undefined, apply: (f: OfficeFinish) => void) => (
        <div className="flex items-center justify-between gap-2">
            <span className="ed-chip">Finish</span>
            <div className="flex gap-1.5">
                {officeFinishes.map((f) => (
                    <button
                        key={f}
                        className="ed-btn flex items-center gap-1.5"
                        data-on={(value ?? "sage") === f}
                        onClick={() => apply(f)}
                    >
                        <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: FINISH_TONES[f] }}
                        />
                        {f}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <main className="flex h-screen select-none flex-col bg-surface text-foreground">
            <header className="flex items-center gap-3 border-b border-line px-3 py-2">
                <Link to="/" className="ed-chip hover:text-foreground">
                    ← Menu
                </Link>
                <h1 className="ed-chip text-secondary">Level editor</h1>
                <select
                    className="ed-select"
                    aria-label="Base level"
                    value={slot}
                    onChange={(e) => switchSlot(e.target.value)}
                >
                    {BASES.map((b) => (
                        <option key={b.id} value={b.id}>
                            {b.name}
                        </option>
                    ))}
                </select>
                {slot !== "scratch" && (
                    <button className="ed-btn" onClick={rebuild} title="Discard the local override">
                        Rebuild
                    </button>
                )}
                <input
                    aria-label="Level name"
                    className="ed-input w-36"
                    value={level.name}
                    onChange={(e) => commit({ ...levelRef.current, name: e.target.value })}
                />
                {(["width", "depth"] as const).map((axis) => (
                    <label key={axis} className="ed-chip flex items-center gap-1.5">
                        {axis === "width" ? "W" : "D"}
                        <input
                            type="number"
                            min={6}
                            max={48}
                            className="ed-input ed-num w-12"
                            value={level[axis]}
                            onChange={(e) =>
                                resize(
                                    axis === "width" ? Number(e.target.value) : level.width,
                                    axis === "depth" ? Number(e.target.value) : level.depth,
                                )
                            }
                        />
                    </label>
                ))}
                <div className="ml-auto flex gap-1.5">
                    <button className="ed-btn" onClick={() => undoRef.current()}>
                        Undo
                    </button>
                    <button className="ed-btn" onClick={() => redoRef.current()}>
                        Redo
                    </button>
                    <button className="ed-btn" onClick={() => file.current?.click()}>
                        Import
                    </button>
                    <button className="ed-btn" data-on="true" onClick={doExport}>
                        Export
                    </button>
                    <input
                        ref={file}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => {
                            doImport(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                    />
                </div>
            </header>
            <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
                {(
                    [
                        ["place", "Place · P"],
                        ["select", "Select · S"],
                        ["erase", "Erase · E"],
                        ["spawn", "Deploy"],
                        ["objective", "Objective"],
                        ["void", "Unwalkable"],
                        ["light", "Light"],
                    ] as const
                ).map(([t, label]) => (
                    <button
                        key={t}
                        className="ed-btn"
                        data-on={tool === t}
                        onClick={() => setTool(t)}
                    >
                        {label}
                    </button>
                ))}
                <button className="ed-btn" onClick={() => rotateRef.current()}>
                    Turn {turn * 90}° · R
                </button>
                <span className="ed-chip ml-auto hidden md:block">
                    I / ⌥-click pick · ⌘Z undo · ⇧⌘Z redo · / search
                </span>
            </div>

            <div className="flex min-h-0 flex-1">
                <aside className="flex w-56 shrink-0 flex-col border-r border-line">
                    <div className="border-b border-line p-2">
                        <input
                            ref={searchBox}
                            className="ed-input w-full"
                            placeholder="Search assets · /"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                        {groups.length === 0 && (
                            <p className="ed-chip px-3 py-3">No assets match</p>
                        )}
                        {groups.map(([category, assets]) => (
                            <section key={category}>
                                <h2 className="ed-chip sticky top-0 border-b border-line bg-surface px-3 py-1.5">
                                    {category}
                                </h2>
                                {assets.map((a) => (
                                    <button
                                        key={a.uid}
                                        id={`ed-asset-${a.uid}`}
                                        className={`flex w-full items-baseline gap-2 px-3 py-[5px] text-left text-[11px] leading-tight ${
                                            brush === a.uid && tool === "place"
                                                ? "bg-raised text-accent"
                                                : "text-secondary hover:bg-raised hover:text-foreground"
                                        }`}
                                        onClick={() => {
                                            setBrush(a.uid);
                                            setTool("place");
                                        }}
                                    >
                                        <span className="flex-1 truncate">{a.name}</span>
                                        <span className="ed-chip">{a.tag}</span>
                                    </button>
                                ))}
                            </section>
                        ))}
                    </div>
                </aside>

                <div
                    ref={host}
                    className="ed-viewport relative min-w-0 flex-1 overflow-hidden"
                    data-tool={tool}
                >
                    <div className="ed-status ed-chip pointer-events-none absolute bottom-3 left-3 flex flex-col gap-0.5">
                        {notice && <span className="text-warn">{notice}</span>}
                        <span className="text-secondary">
                            {level.placements.length} placed · {level.floors.length} floor ·{" "}
                            {level.unwalkable.length} void · {level.lights.length} light ·{" "}
                            {level.spawns.length} deploy ·{" "}
                            {level.objective ? "objective" : "no objective"}
                        </span>
                        <span>
                            {hover ? `cell ${hover.cell[0]}, ${hover.cell[1]}` : "—"}
                            {tool === "place" && brushSpec ? ` · ${brushSpec.name}` : ""}
                            {eraseTarget ? ` · erase ${eraseTarget.name}` : ""}
                        </span>
                    </div>
                </div>

                <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line p-3">
                    {tool === "select" && (
                        <section className="flex flex-col gap-2 border-b border-line pb-3">
                            <h2 className="ed-chip">Selection</h2>
                            {!selection || !selectionSpec ? (
                                <p className="ed-chip">Click a placed asset to redress it.</p>
                            ) : (
                                <>
                                    <p className="text-[11px] text-secondary">
                                        {selectionSpec.name}{" "}
                                        <span className="ed-chip">
                                            {selectionSpec.uid} · {tagOf(selectionSpec)}
                                        </span>
                                    </p>
                                    <label className="flex flex-col gap-1">
                                        <span className="ed-chip">Replace with</span>
                                        <select
                                            className="ed-select"
                                            value=""
                                            onChange={(e) =>
                                                e.target.value && replaceSelection(e.target.value)
                                            }
                                        >
                                            <option value="">same-seat assets…</option>
                                            {replacementsFor(selection.asset).map((a) => (
                                                <option key={a.uid} value={a.uid}>
                                                    {a.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {selectionSpec.kind.startsWith("office-") &&
                                        finishes(selection.finish, recolorSelection)}
                                    <div className="flex gap-1.5">
                                        <button
                                            className="ed-btn"
                                            onClick={() => rotateRef.current()}
                                        >
                                            Rotate · R
                                        </button>
                                        <button
                                            className="ed-btn"
                                            onClick={() => deleteRef.current()}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </>
                            )}
                        </section>
                    )}
                    {tool === "place" &&
                        brushSpec &&
                        "kind" in brushSpec &&
                        brushSpec.kind.startsWith("office-") && (
                            <section className="flex flex-col gap-2 border-b border-line pb-3">
                                <h2 className="ed-chip">Office scheme</h2>
                                {finishes(finish, setFinish)}
                            </section>
                        )}
                    {tool === "light" && (
                        <section className="flex flex-col gap-2 border-b border-line pb-3">
                            <h2 className="ed-chip">Light source</h2>
                            <p className="ed-chip">
                                Click places a lamp with these dials; click a lit cell to remove it.
                            </p>
                            {color("Color", lamp.color, (v) =>
                                setLamp((l) => ({ ...l, color: v })),
                            )}
                            {slider("Intensity", lamp.intensity, 0.5, 40, 0.5, (v) =>
                                setLamp((l) => ({ ...l, intensity: v })),
                            )}
                            {slider("Height", lamp.height, 0.2, 6, 0.1, (v) =>
                                setLamp((l) => ({ ...l, height: v })),
                            )}
                        </section>
                    )}
                    <h2 className="ed-chip">Lighting</h2>
                    <label className="flex items-center justify-between gap-2">
                        <span className="ed-chip">Base time</span>
                        <select
                            className="ed-select"
                            value={lighting.time}
                            onChange={(e) =>
                                commit({
                                    ...levelRef.current,
                                    lighting: { time: e.target.value as TimeOfDay | "interior" },
                                })
                            }
                        >
                            {TIMES.map((time) => (
                                <option key={time} value={time}>
                                    {time}
                                </option>
                            ))}
                        </select>
                    </label>
                    {slider("Sun", lighting.strength ?? preset.strength, 0, 8, 0.1, (v) =>
                        setLight({ strength: v }),
                    )}
                    {slider("Ambient", lighting.ambient ?? preset.ambient, 0, 3, 0.05, (v) =>
                        setLight({ ambient: v }),
                    )}
                    {slider(
                        "Fog density",
                        lighting.density ?? preset.density,
                        0,
                        0.06,
                        0.001,
                        (v) => setLight({ density: v }),
                    )}
                    {slider("Exposure", lighting.exposure ?? preset.exposure, 0.4, 2, 0.02, (v) =>
                        setLight({ exposure: v }),
                    )}
                    {color("Sun color", lighting.sun ?? preset.sun, (v) => setLight({ sun: v }))}
                    {color("Sky", lighting.sky ?? preset.sky, (v) => setLight({ sky: v }))}
                    {color("Fog", lighting.fog ?? preset.fog, (v) => setLight({ fog: v }))}
                    <button
                        className="ed-btn"
                        onClick={() =>
                            commit({ ...levelRef.current, lighting: { time: lighting.time } })
                        }
                    >
                        Reset to preset
                    </button>
                    <p className="ed-chip leading-relaxed normal-case">
                        Dials deviate from the chosen preset and travel with the level. Exports
                        carry the Move map grid and the render placements, assets by uid.
                    </p>
                </aside>
            </div>

            {leaving && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm"
                    onClick={() => setLeaving(false)}
                >
                    <div
                        className="flex w-full max-w-xs flex-col gap-4 border border-line bg-surface px-6 py-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="label">Leave the editor?</h2>
                        <p className="text-xs leading-relaxed text-secondary">
                            The draft is saved on this device and will be here when you come back.
                        </p>
                        <div className="flex gap-1.5">
                            <button
                                className="ed-btn"
                                data-on="true"
                                autoFocus
                                onClick={() => setLeaving(false)}
                            >
                                Stay
                            </button>
                            <button className="ed-btn" onClick={() => navigate("/")}>
                                Leave
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
