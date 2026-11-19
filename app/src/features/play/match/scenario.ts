// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A mock match as the engine plays it: the Black Rain base from the level
 * editor (`demoLevels`), without its relay objective, run as a playtest is
 * (`playtestScenario`: the level's own scenery, movement, cover and sight by
 * the chain's tile rules). Side A is the player's squad, side B the opponent's
 * AI squad of the same size, each unit named by its callsign; 4x4 tops side B
 * up to four cells (`spawnsFor`). The engine's deployment briefing is skipped:
 * the screen's versus card introduced the match.
 */

import type { Scenario, UnitSpec } from "@ghosts/engine";
import { demoLevels, playtestScenario, type Level } from "@ghosts/engine/editor";

import { squadSize } from "../economy";
import {
    LEVEL_NAME,
    matchTitle,
    opponentLooks,
    spawnsFor,
    type MatchPlan,
    type MockMatch,
} from "./model";

/** The level a match of `mode` plays on: Black Rain, no objective, the mode's spawns. */
export function matchLevel(mode: MockMatch["mode"]): Level {
    const base = demoLevels.find((d) => d.id === "black-rain")!.build().level;
    const level: Level = {
        ...base,
        name: "black-rain-match",
        spawns: spawnsFor(base.spawns, mode),
    };
    delete level.objective;
    return level;
}

export function matchScenario(match: MockMatch, plan: MatchPlan): Scenario {
    const base = playtestScenario(matchLevel(match.mode));
    const size = squadSize(match.mode);
    const allies = base.units.filter((u) => !u.enemy).slice(0, size);
    const hostiles = base.units.filter((u) => u.enemy).slice(0, size);
    const { player, opponent } = plan;
    const looks = opponentLooks(plan);
    const units: UnitSpec[] = [
        ...allies.map((u, i): UnitSpec => ({
            ...u,
            id: player.ids[i],
            name: player.callsigns[i],
            full: player.names[i],
            role: player.roles[i],
        })),
        ...hostiles.map((u, i): UnitSpec => ({
            ...u,
            id: opponent.ids[i],
            name: opponent.callsigns[i],
            full: opponent.names[i],
            role: opponent.roles[i],
            kit: opponent.kits[i],
            look: looks[i],
        })),
    ];
    const title = matchTitle(match);
    return {
        ...base,
        id: "mock-match",
        units,
        noObjective: true,
        skipBriefing: true,
        briefing: {
            issuer: `${title.toUpperCase()} / PREVIEW`,
            title,
            setting: `${LEVEL_NAME} / ${match.mode} against ${match.opponent.name}.`,
            contract: [`Defeat every unit of ${match.opponent.name}'s squad.`],
            rules: "Two action points per unit. Movement, cover and sight follow the match rules: walls cannot be entered, high cover blocks a step and a shot across its edge, low cover protects but never blocks a step. A grenade clears every cover tile within two.",
            facts: [
                ["OPPONENT", match.opponent.name.toUpperCase()],
                ["RATING", String(match.opponent.rating)],
                ["SIZE", match.mode],
                ["LEVEL", LEVEL_NAME.toUpperCase()],
            ],
        },
        location: { ...base.location, sector: LEVEL_NAME, code: "PL–00.000" },
        contract: {
            employer: match.kind === "ranked" ? "RANKED" : "FRIENDLY",
            division: "PREVIEW",
            value: "—",
            threat: match.mode,
            threatLevel: 3,
        },
        objectives: {
            ...base.objectives,
            eliminate: { title: `Defeat ${match.opponent.name}`, order: "Opposing squad" },
        },
        lines: {
            ...base.lines,
            opening: `${title} against ${match.opponent.name}.`,
        },
    };
}
