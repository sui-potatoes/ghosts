// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A mock match for the Play modes: a virtual squad against the AI, nothing on
 * chain. A screen stages one with `stageMockMatch` and navigates to the route
 * it returns; `MockMatchScreen` plays it. The screen and the engine load with
 * the route, so staging a match from another screen costs nothing.
 */

import { lazy, Suspense } from "react";

import {
    MATCH_KEY,
    newMatchId,
    parseMatch,
    RESULT_KEY,
    sessionSlot,
    type MockMatch,
} from "./model";

export type { MockMatch } from "./model";

export const MOCK_MATCH_ROUTE = "/play/match";

/** Store the match to play and return the route that plays it. */
export function stageMockMatch(match: MockMatch): string {
    const staged: MockMatch = { ...match, id: newMatchId() };
    sessionSlot(RESULT_KEY).set(null);
    sessionSlot(MATCH_KEY).set(JSON.stringify(staged));
    return MOCK_MATCH_ROUTE;
}

export function stagedMockMatch(): MockMatch | null {
    return parseMatch(sessionSlot(MATCH_KEY).get());
}

/** Forget the staged match and its result: the player left it. */
export function clearMockMatch(): void {
    sessionSlot(MATCH_KEY).set(null);
    sessionSlot(RESULT_KEY).set(null);
}

const Screen = lazy(() => import("./MockMatchScreen"));

export function MockMatchScreen() {
    return (
        <Suspense fallback={null}>
            <Screen />
        </Suspense>
    );
}
