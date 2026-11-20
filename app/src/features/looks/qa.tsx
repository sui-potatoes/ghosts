// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA harness for a game's look, in builds made with `VITE_LOOKS_QA=1` only
 * (the route is not registered otherwise, see `App.tsx`). `/qa/looks` lists
 * every look the rule gives; `/qa/looks?time=dusk&weather=fog` opens Black
 * Rain on the field in that look, without the briefing.
 */

import { blackRain, Encounter, lookName, type Scenario } from "@ghosts/engine";
import { allLooks, parseLook } from "@ghosts/engine/look";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { engineSettings } from "../../engineSettings";

export default function LooksQa() {
    const [params] = useSearchParams();
    const time = params.get("time"),
        weather = params.get("weather");
    const look = useMemo(() => parseLook(time, weather), [time, weather]);
    const scenario = useMemo<Scenario | null>(
        () => (look ? { ...blackRain, look, skipBriefing: true } : null),
        [look],
    );
    if (!scenario || !look)
        return (
            <main className="min-h-dvh bg-surface p-8 text-foreground">
                <h1 className="label mb-4">Looks</h1>
                <ul className="space-y-1">
                    {allLooks().map((l) => (
                        <li key={`${l.time}-${l.weather}`}>
                            <Link
                                className="menu-item"
                                to={`/qa/looks?time=${l.time}&weather=${l.weather}`}
                            >
                                {lookName(l)}
                            </Link>
                        </li>
                    ))}
                </ul>
            </main>
        );
    return (
        <div className="fixed inset-0 h-dvh w-full bg-surface">
            <Encounter
                key={`${look.time}-${look.weather}`}
                scenario={scenario}
                settings={engineSettings}
            />
        </div>
    );
}
