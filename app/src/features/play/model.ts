// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Play screen's pure rules, tested in `tests/play-screen.test.ts`: the three
 * mode cards and the way to watch games, what each opens, which are open, and the ranked card's facts read
 * from the economy. Nothing about tiers or budgets is written here.
 */

import { budgetOf, tierOf, type Mode } from "./economy/index.ts";

export type ModeId = "ranked" | "friendly" | "factions" | "watch";

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
};

export const MODE_ORDER: ModeId[] = ["ranked", "friendly", "factions", "watch"];

const CARDS: Record<ModeId, ModeCard> = {
    ranked: {
        id: "ranked",
        name: "Ranked match",
        route: "/play/ranked",
        lines: [
            "Build a squad within your rank's credit budget and fight another squad.",
            "Wins raise your rating, losses lower it.",
        ],
        tag: "Open",
        hint: "3x3 or 4x4, a squad built to your rank's budget",
        verb: "Open",
    },
    friendly: {
        id: "friendly",
        name: "Friendly match",
        route: "/play/friendly",
        lines: [
            "Invite a friend with a code, or open a game to anyone.",
            "Your rating does not move.",
        ],
        tag: "Open",
        hint: "Invite a friend with a code, or open a game to anyone",
        verb: "Open",
    },
    factions: {
        id: "factions",
        name: "Faction wars",
        route: null,
        lines: [
            "Three corporations post missions. A squad works for any of them, for a set reward or a random one.",
            "Each corporation has public influence that moves with the missions fought, and you keep your own standing with each.",
        ],
        tag: "Soon",
        hint: "Missions for three corporations, with influence and standing",
        verb: "Open",
        locked: "Not open",
    },
    watch: {
        id: "watch",
        name: "Watch",
        route: "/watch",
        lines: [
            "Follow a game being played, turn by turn, or replay a finished one.",
            "Pause, rewind and change the speed at any time.",
        ],
        tag: "Open",
        hint: "Live games and replays",
        verb: "Open",
    },
};

/**
 * The cards, top to bottom. `lobby`: the player hosts or waits in a friendly
 * game, and the friendly card leads back to it.
 */
export const modeCards = (lobby = false): ModeCard[] =>
    MODE_ORDER.map((id) =>
        id === "friendly" && lobby
            ? { ...CARDS[id], tag: "In lobby", hint: "Back to your friendly game" }
            : CARDS[id],
    );

export const cardOf = (id: ModeId): ModeCard => CARDS[id];

/** The route a card opens, or null when it is unavailable. */
export const routeOf = (id: ModeId): string | null => (CARDS[id].locked ? null : CARDS[id].route);

const SIZES: Mode[] = ["3x3", "4x4"];

export type RankedFacts = {
    tier: string;
    rating: number;
    budgets: { mode: Mode; budget: number }[];
};

/** What the ranked card shows of the player: whatever the economy returns. */
export function rankedFacts(rating: number): RankedFacts {
    return {
        tier: tierOf(rating).name,
        rating,
        budgets: SIZES.map((mode) => ({ mode, budget: budgetOf(rating, mode) })),
    };
}
