// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The demo encounter's end as the debrief shows it: plain TypeScript, tested
 * in `tests/debrief.test.ts`. The engine hands the host an `EncounterDebrief`
 * (its after-action report); this puts it on the same plates a match uses,
 * with the demo's own record (role, kills, level, field XP) on each.
 */

import type { EncounterDebrief } from "@ghosts/engine";

import type { Debrief, FieldRecord, Plate } from "./result.ts";

/** `XP_PER_LEVEL` in the engine's report: a level is this much experience. */
const LEVEL_XP = 100;

const levelName = (level: number) => `Level ${level}`;

const two = (n: number) => String(n).padStart(2, "0");

export function demoDebriefOf(
    { report, operation, sector }: EncounterDebrief,
    podiums = Math.max(3, report.recruits.length),
): Debrief {
    const plates: Plate[] = Array.from({ length: podiums }, (_, i) => {
        const r = report.recruits[i];
        if (!r) return { kind: "vacant" };
        const field: FieldRecord = {
            role: r.role,
            full: r.full,
            kills: r.kills,
            level: r.level,
            progress: r.progress,
            levelXp: LEVEL_XP,
        };
        // The demo has no fall turn: the report keeps who fell, not when.
        if (r.kia)
            return { kind: "kia", id: r.id, name: r.name, rank: levelName(1), turn: null, field };
        const start = (r.level - 1) * LEVEL_XP;
        return {
            kind: "home",
            id: r.id,
            name: r.name,
            rankBefore: levelName(1),
            rankAfter: levelName(r.level),
            promoted: r.level > 1,
            xpBefore: 0,
            xpAfter: r.xp,
            gained: r.xp,
            // The bar ends where the old card's did: the progress inside the level reached.
            band: { start, end: start + LEVEL_XP, from: 0, to: r.progress / LEVEL_XP },
            field,
        };
    });
    const lost = report.recruits.length - report.survivors;
    return {
        title: report.victory ? "Contract fulfilled" : "Contract failed",
        tone: report.victory ? "win" : "loss",
        note: null,
        lines: [
            `${operation} · ${sector}`,
            `${two(report.turns)} turns · ${report.survivors} / ${report.recruits.length} returned${lost ? ` · ${lost} lost` : ""}`,
        ],
        opponent: null,
        rating: null,
        plates,
        replacement: null,
    };
}
