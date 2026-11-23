// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The sound audition screen at `/sounds`: every manifest slot with its bus,
 * source and placeholder mark, played on its own (left, centre, right for the
 * positioned ones), and the soundscape switch for A/B in the field. Dev
 * server only, or builds made with `VITE_SOUNDS_QA=1`; no menu leads here.
 */

import {
    GENERATORS,
    setSoundscapeEnabled,
    SLOT_IDS,
    SLOTS,
    Soundscape,
    soundscapeEnabled,
    subscribeSoundscape,
    type AppGeneratorName,
    type Bus,
    type Slot,
    type SlotId,
} from "@ghosts/engine/audition";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { APP_GENERATORS } from "../app-generators";
import { channelLevel } from "../levels";
import { measureAll, type LevelRow } from "./measure";

/** The level each bus is auditioned at: its own slider under the master. */
const BUS_LEVEL: Record<Bus, () => number> = {
    combat: () => channelLevel("sfx"),
    ambience: () => channelLevel("ambience"),
    voice: () => channelLevel("voice"),
    interface: () => channelLevel("ui"),
    music: () => channelLevel("music"),
};

const BUSES: Bus[] = ["ambience", "combat", "voice", "interface", "music"];

function sourceOf(s: Slot): string {
    return "file" in s.source
        ? s.source.file.join(", ") + (s.source.fallback ? ` (${s.source.fallback})` : "")
        : `${s.source.generator} (generated)`;
}

export default function SoundsQa() {
    const scape = useMemo(
        () =>
            new Soundscape(() => ({
                combat: channelLevel("sfx"),
                ambience: channelLevel("ambience"),
            })),
        [],
    );
    useEffect(() => () => scape.close(), [scape]);
    const [playing, setPlaying] = useState<Map<SlotId, () => void>>(new Map());
    const on = useSyncExternalStore(subscribeSoundscape, soundscapeEnabled);

    const stop = (id: SlotId) => {
        playing.get(id)?.();
        const next = new Map(playing);
        next.delete(id);
        setPlaying(next);
    };

    const play = (id: SlotId, side = 0) => {
        const s = SLOTS[id] as Slot;
        if ("generator" in s.source && GENERATORS[s.source.generator] === "app") {
            void APP_GENERATORS[s.source.generator as AppGeneratorName]();
            return;
        }
        playing.get(id)?.();
        // The engine levels its own buses; the others are scaled to their slider here.
        const own = s.bus === "combat" || s.bus === "ambience";
        const stopIt = scape.audition(id, { side, gain: own ? 1 : BUS_LEVEL[s.bus]() });
        if (!stopIt) return;
        if (s.loop) setPlaying(new Map(playing).set(id, stopIt));
    };

    const stopAll = () => {
        for (const s of playing.values()) s();
        setPlaying(new Map());
    };

    const placeholders = SLOT_IDS.filter((id) => SLOTS[id].placeholder).length;

    const [levels, setLevels] = useState<Map<string, LevelRow>>(new Map());
    const [measuring, setMeasuring] = useState(false);
    const measureNow = () => {
        if (measuring) return;
        setMeasuring(true);
        const found = new Map<string, LevelRow>();
        void measureAll((row) => {
            found.set(row.id, row);
            setLevels(new Map(found));
        })
            .then((rows) => {
                // For QA scripts reading the table.
                (window as { __soundLevels?: LevelRow[] }).__soundLevels = rows;
            })
            .finally(() => setMeasuring(false));
    };
    const lufs = (v: number | undefined) =>
        v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(1);
    const tick = levels.get("ui.tick (gesture chain)");

    return (
        <main className="fixed inset-0 overflow-y-auto bg-surface p-8 text-foreground">
            <header className="mb-6 flex flex-wrap items-center gap-4">
                <h1 className="label">Sounds</h1>
                <span className="text-muted">
                    {SLOT_IDS.length} slots · {placeholders} placeholders
                </span>
                <button
                    type="button"
                    className="btn"
                    data-soundscape={on ? "on" : "off"}
                    onClick={() => setSoundscapeEnabled(!on)}
                >
                    Soundscape: {on ? "On" : "Off"}
                </button>
                <button type="button" className="btn" onClick={stopAll}>
                    Stop all
                </button>
                <button type="button" className="btn" data-measure onClick={measureNow}>
                    {measuring ? "Measuring" : "Measure"}
                </button>
                {tick && (
                    <span className="text-muted">Tick {lufs(tick.heard?.momentary)} LUFS</span>
                )}
            </header>
            {BUSES.map((bus) => (
                <section key={bus} className="mb-8">
                    <h2 className="label mb-2 text-secondary">{bus}</h2>
                    <table className="w-full text-sm">
                        <tbody>
                            {SLOT_IDS.filter((id) => SLOTS[id].bus === bus).map((id) => {
                                const s = SLOTS[id] as Slot;
                                return (
                                    <tr key={id} className="border-t border-line" data-slot={id}>
                                        <td className="py-1 pr-4 font-mono">{id}</td>
                                        <td className="py-1 pr-4">
                                            {s.placeholder ? (
                                                <span className="text-warn">Placeholder</span>
                                            ) : (
                                                <span className="text-muted">Final</span>
                                            )}
                                        </td>
                                        <td className="py-1 pr-4 text-secondary">{s.note}</td>
                                        <td className="py-1 pr-4 text-muted">{sourceOf(s)}</td>
                                        <td
                                            className="whitespace-nowrap py-1 pr-4 font-mono text-muted"
                                            title="Momentary max LUFS at default settings: here / in the field / in the field on laptop speakers"
                                        >
                                            {levels.has(id) &&
                                                `${lufs(levels.get(id)!.heard?.momentary)} / ${lufs(levels.get(id)!.game?.momentary)} / ${lufs(levels.get(id)!.game?.laptop)}`}
                                        </td>
                                        <td className="whitespace-nowrap py-1">
                                            {s.spatial && (
                                                <button
                                                    type="button"
                                                    className="btn mr-1"
                                                    onClick={() => play(id, -1)}
                                                >
                                                    Left
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="btn mr-1"
                                                data-play={id}
                                                onClick={() => play(id)}
                                            >
                                                Play
                                            </button>
                                            {s.spatial && (
                                                <button
                                                    type="button"
                                                    className="btn mr-1"
                                                    onClick={() => play(id, 1)}
                                                >
                                                    Right
                                                </button>
                                            )}
                                            {playing.has(id) && (
                                                <button
                                                    type="button"
                                                    className="btn"
                                                    onClick={() => stop(id)}
                                                >
                                                    Stop
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>
            ))}
        </main>
    );
}
