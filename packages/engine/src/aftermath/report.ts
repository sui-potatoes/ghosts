import type { Encounter } from "../game.ts";

export const XP_PER_LEVEL = 100;
export const KILL_XP = 100;
export const RETURN_XP = 40;
export interface RecruitReport {
    id: string;
    name: string;
    full: string;
    role: string;
    kia: boolean;
    kills: number;
    xp: number;
    level: number;
    progress: number;
}
export interface EncounterReport {
    victory: boolean;
    turns: number;
    survivors: number;
    recruits: RecruitReport[];
}

/** Presentation progression for this local encounter; never mutates saved recruits. */
export function encounterReport(
    game: Pick<Encounter, "units" | "kills" | "turn" | "result">,
): EncounterReport {
    const recruits = game.units
        .filter((u) => !u.enemy)
        .map((u) => {
            const kia = u.hp <= 0;
            const kills = game.kills[u.id] ?? 0;
            const xp = kia ? 0 : kills * KILL_XP + RETURN_XP;
            return {
                id: u.id,
                name: u.name,
                full: u.full,
                role: u.role,
                kia,
                kills,
                xp,
                level: 1 + Math.floor(xp / XP_PER_LEVEL),
                progress: xp % XP_PER_LEVEL,
            };
        });
    return {
        victory: game.result === "victory",
        turns: game.turn,
        survivors: recruits.filter((u) => !u.kia).length,
        recruits,
    };
}
