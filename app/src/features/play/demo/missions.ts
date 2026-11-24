// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The trainings as missions for the console (`features/missions`). Everything
 * shown comes from the engine's own scenarios and levels: the briefing words,
 * the file code and coordinates, the threat, both sides' numbers and the
 * ground as the rules read it (`toMoveMap`). The engine is loaded on demand,
 * so the menu bundle stays small; if it cannot be loaded the board still lists
 * every training by name and place. Payment lines are left out: a training
 * pays nothing.
 */

import type { Scenario } from "@ghosts/engine";
import type { Level } from "@ghosts/engine/editor";

import { completedChapters } from "../../../screens/basics-progress";
import {
    parseCoordinate,
    plotOf,
    withNext,
    type Mission,
    type MissionFact,
    type MissionPosition,
} from "../../missions";
import { DEMO_SCENARIOS, type DemoScenario } from "../model";
import { completedTrainings } from "./progress";

type Engine = typeof import("@ghosts/engine");
type Editor = typeof import("@ghosts/engine/editor");

/** The words the board says around a briefing, sentence case. */
const sentence = (text: string) =>
    text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text;

/** A briefing fact by its label, as the scenario writes it. */
const factOf = (scenario: Scenario, label: string) =>
    scenario.briefing.facts.find(([l]) => l === label)?.[1];

/** Where the briefing opens: the scene's place, else the setting's first two parts. */
function placeOf(scenario: Scenario): string {
    if (scenario.briefing.scene) return scenario.briefing.scene.place;
    return scenario.briefing.setting.split(" / ").slice(0, 2).join(" / ");
}

/** The city each operation is fought in; its coordinates come from the scenario. */
const CITIES: Record<string, Pick<MissionPosition, "city">> = {
    "black-rain": { city: "Tokyo" },
    "night-shift": { city: "Tokyo" },
    "paper-trail": { city: "Tokyo" },
};

/** Where an operation is on the planet: its briefing's coordinates in its city; none when they do not read. */
function positionOf(id: string, scenario: Scenario): MissionPosition | undefined {
    const city = CITIES[id];
    const [lat, lon] = scenario.location.coordinates.map(parseCoordinate);
    return city && lat !== null && lon !== null ? { lat, lon, ...city } : undefined;
}

/** What each training's picture shows. */
const SCENES: Record<string, string> = {
    "night-shift":
        "An all-night convenience store lit up behind its car park on a wet main road at night, a taxi in the foreground",
    "black-rain":
        "A rain-soaked crossroads at night: roadworks crates in the foreground, the relay at the junction, a lit corner shop beyond",
    "paper-trail":
        "An office floor at night: desks either side of a carpeted aisle leading to the records room",
    basics: "A dark simulation room outlined in glowing lines: crates, a barrier, barrels and a vending machine marked as cover, a red target ring on the floor",
};

/** Every training's picture, rendered from its scene (`scripts/locations/capture.mjs`). */
const previewOf = (id: string) => ({
    full: `/locations/${id}.webp`,
    thumb: `/locations/${id}-thumb.webp`,
    alt: SCENES[id],
});

/** An operation: a scenario fought on a level's ground. */
function operation(base: DemoScenario, scenario: Scenario, level: Level, editor: Editor): Mission {
    const squad = scenario.units.filter((u) => !u.enemy).length;
    const hostiles = scenario.units.filter((u) => u.enemy).length;
    const opposition = factOf(scenario, "OPPOSITION");
    const facts: MissionFact[] = [
        { label: "Squad", value: `${squad} operators` },
        {
            label: "Opposition",
            value: opposition ? `${hostiles} · ${opposition}` : `${hostiles} hostiles`,
        },
        { label: "Ground", value: `${level.width} × ${level.depth} tiles` },
    ];
    const objective = !scenario.noObjective && !scenario.versus;
    const objectives = [
        ...(objective
            ? [
                  {
                      title: scenario.objectives.secure.title,
                      detail: scenario.objectives.secure.detail,
                  },
              ]
            : []),
        { title: scenario.objectives.eliminate.title },
    ];
    const { tiles } = editor.toMoveMap(level);
    return {
        id: base.id,
        code: scenario.location.code,
        name: base.name,
        location: base.place,
        place: placeOf(scenario),
        coordinates: scenario.location.coordinates,
        position: positionOf(base.id, scenario),
        issuer: scenario.briefing.issuer,
        brief: scenario.briefing.contract,
        objectives,
        facts,
        threat: scenario.contract.threatLevel
            ? {
                  label: sentence(scenario.contract.threat),
                  level: scenario.contract.threatLevel,
                  max: 5,
              }
            : undefined,
        plot: plotOf(
            tiles,
            { squad: level.spawns.a, hostiles: level.spawns.b },
            objective ? level.objective : undefined,
        ),
        state: "open",
        verb: "Deploy",
    };
}

/** Basics: lessons in a simulation room, drawn as its lessons rather than a ground. */
function basics(base: DemoScenario, engine: Engine | null): Mission {
    const done = completedChapters();
    return {
        id: base.id,
        // The simulation's file code and issuer, as its own briefing gives them.
        code: "SIM–00.001",
        name: base.name,
        location: base.place,
        place: "Tactical simulation",
        issuer: "GHOSTS / TRAINING",
        brief: [
            "One room, rebuilt for every lesson. Orders arrive one at a time on the card, and each one waits until it is carried out",
        ],
        objectives: [{ title: "Clear the room" }],
        facts: engine ? [{ label: "Lessons", value: String(engine.BASICS_CHAPTERS.length) }] : [],
        stages: engine?.BASICS_CHAPTERS.map((c) => ({
            id: c.id,
            title: c.title,
            done: done.includes(c.id),
        })),
        state: "open",
        verb: "Start",
    };
}

/** A training the engine could not describe: its name and place. */
const plain = (base: DemoScenario): Mission => ({
    id: base.id,
    name: base.name,
    location: base.place,
    brief: [],
    objectives: [],
    facts: [],
    state: "open",
    verb: "Deploy",
});

/** A training as a mission, with its picture (a simulation has no place on the planet). */
function describe(base: DemoScenario, engine: Engine | null, editor: Editor | null): Mission {
    return { ...described(base, engine, editor), preview: previewOf(base.id) };
}

function described(base: DemoScenario, engine: Engine | null, editor: Editor | null): Mission {
    if (base.id === "basics") return basics(base, engine);
    if (!engine || !editor) return plain(base);
    if (base.id === "night-shift")
        return operation(base, engine.nightShiftScenario(), engine.nightShiftLevel(), editor);
    const scenario =
        base.id === "paper-trail"
            ? engine.paperTrail
            : base.id === "black-rain"
              ? engine.blackRain
              : null;
    return scenario
        ? operation(base, scenario, editor.levelFromScenario(scenario).level, editor)
        : plain(base);
}

/** Every training as a mission, with this device's progress and the next one marked. */
export function trainingMissions(engine: Engine | null, editor: Editor | null): Mission[] {
    const done = completedTrainings();
    return withNext(
        DEMO_SCENARIOS.map((base) => {
            const mission = describe(base, engine, editor);
            return done.includes(base.id) ? { ...mission, state: "done" as const } : mission;
        }),
    );
}

export type TrainingSource = { engine: Engine | null; editor: Editor | null };

let loading: Promise<TrainingSource> | null = null;

/**
 * The engine's scenarios and level tools, loaded once per page; nothing when
 * they cannot be loaded (the board then lists the trainings by name).
 */
export function loadTrainingSource(): Promise<TrainingSource> {
    loading ??= Promise.all([import("@ghosts/engine"), import("@ghosts/engine/editor")]).then(
        ([engine, editor]) => ({ engine, editor }),
        () => ({ engine: null, editor: null }),
    );
    return loading;
}
