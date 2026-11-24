// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Play screen's pure rules, tested in `tests/play-screen.test.ts`: the mode
 * cards (ranked, friendly, contract, demo, faction wars) and Spectate,
 * what each opens, which are open, what a search or a game in progress does to
 * them, and the ranked card's facts read from the player's standing. Nothing about
 * tiers or budgets is written here.
 */

import { sizeOpen, type Mode } from "./economy/index.ts";
import type { Standing } from "./rating.ts";

export type ModeId = "ranked" | "friendly" | "contract" | "demo" | "factions" | "watch";

/** The modes a player can be busy in: searching, in a lobby, or in a game. */
export type PlayMode = "ranked" | "friendly" | "contract";

export type ModeCard = {
    id: ModeId;
    name: string;
    /** The route the card opens; null while the mode is unavailable. */
    route: string | null;
    /** Two or three short lines on what the mode is. */
    lines: string[];
    /** The state on the card. */
    tag: string;
    /** The command bar's line while the card has the cursor. */
    hint: string;
    /** The confirm command's label. */
    verb: string;
    /** Shown, focusable, refused: the reason the bar gives. */
    locked?: string;
    /** Signed out: the confirm opens the sign-in dialog instead of the route. */
    signIn?: true;
};

export const MODE_ORDER: ModeId[] = ["ranked", "friendly", "contract", "demo", "factions", "watch"];

/** The name the owned-recruits mode goes by, everywhere it is shown. */
export const CONTRACT_NAME = "Contract";

const CARDS: Record<ModeId, ModeCard> = {
    ranked: {
        id: "ranked",
        name: "Ranked match",
        route: "/play/ranked",
        lines: [
            "Build a squad for each match within your rank's credit budget",
            "Wins raise your rating, losses lower it",
        ],
        tag: "Open",
        hint: "A squad built for the match, your rating at stake",
        verb: "Open",
    },
    friendly: {
        id: "friendly",
        name: "Friendly match",
        route: "/play/friendly",
        lines: [
            "Invite a friend with a code, or open a match to anyone",
            "Your rating does not move",
        ],
        tag: "Open",
        hint: "Invite a friend with a code, or open a match to anyone",
        verb: "Open",
    },
    contract: {
        id: "contract",
        name: CONTRACT_NAME,
        route: "/play/contract",
        lines: [
            "Your own recruits. They earn experience and can be lost",
            "Rating does not change",
        ],
        tag: "Open",
        hint: "Your own squad against another player's",
        verb: "Open",
    },
    demo: {
        id: "demo",
        name: "Training",
        route: "/play/training",
        lines: ["Basics, then three single-player operations against the AI"],
        tag: "Open",
        hint: "Basics, Black Rain, Night Shift and Paper Trail",
        verb: "Open",
    },
    factions: {
        id: "factions",
        name: "Faction wars",
        route: null,
        lines: [
            "Three corporations post missions. A squad works for any of them, for a set reward or a random one",
            "Each corporation has public influence that moves with the missions fought, and you keep your own standing with each",
        ],
        tag: "Soon",
        hint: "Missions for three corporations, with influence and standing",
        verb: "Open",
        locked: "Not open",
    },
    watch: {
        id: "watch",
        name: "Spectate",
        route: "/watch",
        lines: ["Live matches and replays"],
        tag: "Open",
        hint: "Live matches and replays",
        verb: "Open",
    },
};

/** What the player is busy with right now, if anything. */
export type Busy =
    | { kind: "searching"; mode: "ranked" | "contract" }
    | { kind: "lobby" }
    /** In a game; `mode` once the game is read. */
    | { kind: "playing"; mode: PlayMode | null }
    | null;

const MODE_NAMES: Record<PlayMode, string> = {
    ranked: "ranked",
    friendly: "friendly",
    contract: "contract",
};

/** Why the other play modes wait while the player is busy, in plain words. */
function busyReason(busy: NonNullable<Busy>): string {
    if (busy.kind === "lobby") return "Leave your friendly match first";
    if (busy.kind === "playing") return "Finish your match first";
    return `Cancel your ${MODE_NAMES[busy.mode]} search first`;
}

const PLAY_MODES: PlayMode[] = ["ranked", "friendly", "contract"];

/**
 * The cards, top to bottom. While the player searches, waits in a lobby or plays,
 * the card of that mode leads back to it and the other play modes say why they wait.
 */
export function modeCards(busy: Busy = null, signedIn = true): ModeCard[] {
    return MODE_ORDER.map((id) => {
        const card = CARDS[id];
        if (!signedIn && PLAY_MODES.includes(id as PlayMode))
            return {
                ...card,
                tag: "Sign in",
                hint: "Sign in to play",
                verb: "Sign in",
                signIn: true,
            };
        if (!busy || !PLAY_MODES.includes(id as PlayMode)) return card;
        const mine =
            (busy.kind === "lobby" && id === "friendly") ||
            (busy.kind === "searching" && busy.mode === id) ||
            (busy.kind === "playing" && busy.mode === id);
        if (busy.kind === "playing" && mine)
            return {
                ...card,
                route: "/match",
                tag: "In match",
                hint: "Back to the field",
                verb: "Resume",
            };
        if (busy.kind === "playing" && busy.mode === null)
            return { ...card, locked: busyReason(busy) };
        if (mine && busy.kind === "lobby")
            return { ...card, tag: "In lobby", hint: "Back to your friendly match" };
        if (mine) return { ...card, tag: "Searching", hint: "Back to your search" };
        return { ...card, locked: busyReason(busy) };
    });
}

export const cardOf = (id: ModeId): ModeCard => CARDS[id];

/** The route a card opens, or null when it is unavailable. */
export const routeOf = (id: ModeId): string | null => (CARDS[id].locked ? null : CARDS[id].route);

const SIZES: Mode[] = ["3x3", "4x4"];

export type RankedFacts = {
    tier: string;
    rating: number;
    /** The sizes with a level, and what each builds to. */
    budgets: { mode: Mode; budget: number }[];
    /** Ranked games left before the placement floor lifts; 0 once placed. */
    placementLeft: number;
};

/** What the ranked card shows of the player: their standing on chain, on the live rules. */
export function rankedFacts(standing: Standing): RankedFacts {
    return {
        tier: standing.tier.name,
        rating: standing.rating,
        budgets: SIZES.filter(sizeOpen).map((mode) => ({ mode, budget: standing.budgets[mode] })),
        placementLeft: standing.placementLeft,
    };
}

/** A single-player operation the Demo card lists, with the route it deploys to. */
export type DemoScenario = { id: string; name: string; place: string; route: string };

/** The demo's operations: what the title menu offered before, under Play. */
export const DEMO_SCENARIOS: DemoScenario[] = [
    { id: "basics", name: "Basics", place: "Kōra / Training yard", route: "/demo-basics" },
    { id: "black-rain", name: "Black Rain", place: "Tokyo / Shinjuku", route: "/demo" },
    {
        id: "night-shift",
        name: "Night Shift",
        place: "Tokyo / Nakano",
        route: "/demo-night-shift",
    },
    { id: "paper-trail", name: "Paper Trail", place: "Kōra HQ / Floor 07", route: "/demo-2" },
];
