// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every slot's loudness at the default settings, rendered offline through
 * the soundscape's own buses: as the audition screen plays it, and as the
 * field plays it (a bed under its look's plan, a far one-shot past the field's
 * edge, a combat sound at the tactics camera's distance). The interface tick
 * is rendered through the same chain as `ui.ts` plays it, as the reference
 * for interface-level cues.
 */

import {
    ambiencePlan,
    GENERATORS,
    measure,
    measureSlot,
    SLOT_IDS,
    SLOTS,
    slotFiles,
    soundUrl,
    type AmbiencePlan,
    type Loudness,
    type Slot,
    type SlotId,
} from "@ghosts/engine/audition";

import { DEFAULTS } from "../../settings/store";
import { gain } from "../levels";

export interface LevelRow {
    id: SlotId | "ui.tick (gesture chain)";
    heard: Loudness | null;
    game: Loudness | null;
}

/** Bus amplitudes at the default sliders. */
export function defaultLevels() {
    const a = DEFAULTS.audio;
    const m = gain(a.master);
    return {
        combat: m * gain(a.sfx),
        ambience: m * gain(a.ambience),
        voice: m * gain(a.voice),
        interface: m * gain(a.ui),
        music: m * gain(a.music),
    };
}

/** The tactics camera's distance to the middle of the field. */
const FIELD = 44;
/** A far one-shot: past the field's edge, as the scheduler places it. */
const FAR = 100;

const STREET = ambiencePlan("street", { time: "night", weather: "heavy-rain" });
const OFFICE = ambiencePlan("office", null);

function planOf(id: SlotId): AmbiencePlan | undefined {
    if (SLOTS[id].bus !== "ambience") return undefined;
    return id.startsWith("ambience.office.") ? OFFICE : STREET;
}

function distanceOf(id: SlotId, plan?: AmbiencePlan): number {
    const rule = plan?.oneShots.find((r) => r.slot === id);
    return rule?.range === "far" ? FAR : FIELD;
}

/** The interface tick as `ui.ts` plays it: the knock, band-passed at 300 Hz, doubled, at the interface level. */
async function measureTick(level: number): Promise<Loudness> {
    const rate = 48000;
    const ctx = new OfflineAudioContext(2, rate, rate);
    const data = await fetch(soundUrl(slotFiles("ui.tick")[0])).then((r) => r.arrayBuffer());
    const buffer = await ctx.decodeAudioData(data);
    const source = new AudioBufferSourceNode(ctx, { buffer });
    source
        .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 300 }))
        .connect(new GainNode(ctx, { gain: level * 2 }))
        .connect(ctx.destination);
    source.start(0, 0.02, 0.08);
    const out = await ctx.startRendering();
    return measure([out.getChannelData(0), out.getChannelData(1)], rate);
}

export async function measureAll(onRow?: (row: LevelRow) => void): Promise<LevelRow[]> {
    const levels = defaultLevels();
    const rows: LevelRow[] = [];
    const tick = await measureTick(levels.interface);
    const first: LevelRow = { id: "ui.tick (gesture chain)", heard: tick, game: tick };
    rows.push(first);
    onRow?.(first);
    for (const id of SLOT_IDS) {
        const s = SLOTS[id] as Slot;
        if ("generator" in s.source && GENERATORS[s.source.generator] === "app") continue;
        const own = s.bus === "combat" || s.bus === "ambience";
        const extra = own ? 1 : levels[s.bus];
        const plan = planOf(id);
        const heard = await measureSlot(id, { levels, gain: extra, distance: 40 });
        const game = await measureSlot(id, {
            levels,
            gain: extra,
            plan,
            distance: distanceOf(id, plan),
        });
        const row = { id, heard, game };
        rows.push(row);
        onRow?.(row);
    }
    return rows;
}
