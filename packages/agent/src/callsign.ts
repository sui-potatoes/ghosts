// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Callsigns for seats that need a player name: two short words, or a word and a number, from a
 * small built-in list of plain, neutral words (no people, no brands, nothing rude), within the
 * registry's label rules (`names.ts`). Seeded, so a seat proposes the same names on every run, and
 * `ensureName` registers the first one free, trying the next on "taken".
 */

import type { GhostsAgent } from "./agent.ts";
import { seededRandom } from "./ranked.ts";
import { nameProblem } from "./names.ts";
import { ActionError } from "./types.ts";

// prettier-ignore
const FIRST = [
    "amber", "ash", "brisk", "calm", "cinder", "cobalt", "copper", "crisp", "dusk", "ember",
    "faint", "frost", "gray", "hollow", "iron", "ivory", "jade", "keen", "lone", "lunar",
    "mist", "night", "north", "onyx", "pale", "quiet", "rapid", "rust", "sable", "silent",
    "slate", "solar", "steady", "still", "storm", "swift", "tidal", "umber", "violet", "wild",
];

// prettier-ignore
const SECOND = [
    "badger", "comet", "crane", "drift", "falcon", "fern", "finch", "fox", "gale", "harbor",
    "hawk", "heron", "lantern", "lark", "lynx", "marten", "meadow", "moth", "orbit", "otter",
    "owl", "pike", "pine", "quill", "raven", "reed", "ridge", "river", "rook", "sparrow",
    "spruce", "stone", "thistle", "tide", "vale", "warden", "willow", "wolf", "wren", "zephyr",
];

/**
 * The `attempt`-th callsign of a seat with `seed`: `slate-heron`, or `heron-42`. The same seed and
 * attempt always give the same name; every one passes `nameProblem`.
 */
export function callsign(seed: number, attempt = 0): string {
    const random = seededRandom((seed * 7919 + attempt * 104_729) >>> 0);
    const pick = (list: string[]) => list[Math.floor(random() * list.length)];
    const name =
        random() < 0.7
            ? `${pick(FIRST)}-${pick(SECOND)}`
            : `${pick(SECOND)}-${10 + Math.floor(random() * 90)}`;
    if (nameProblem(name)) throw new Error(`A callsign broke the label rules: ${name}`);
    return name;
}

/** What `ensureName` did. */
export type NameOutcome =
    | { kind: "kept"; name: string }
    | { kind: "taken_now"; name: string; tries: number }
    /** No name service here (a local network): players go by names made of their address. */
    | { kind: "no_registry"; name: string | null; message: string };

/** How many callsigns `ensureName` tries before giving up. */
export const NAME_ATTEMPTS = 8;

/**
 * Make sure the agent has a player name, as a human's is: a leaf under the game's domain, its
 * default name. One it already has is kept; otherwise the seat's callsigns are tried in order,
 * the next on `name_taken`. A network without the names registry is reported, not thrown.
 */
export async function ensureName(agent: GhostsAgent, seed: number): Promise<NameOutcome> {
    if (agent.backend.nameService === false) {
        return {
            kind: "no_registry",
            name: await agent.backend.name(),
            message: "This network has no name service: the seat plays under a name made of its address.",
        };
    }
    const current = await agent.backend.name();
    if (current) return { kind: "kept", name: current };
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        const name = callsign(seed, attempt);
        try {
            await agent.setName(name);
            return { kind: "taken_now", name, tries: attempt + 1 };
        } catch (error) {
            if (error instanceof ActionError && error.code === "name_taken") continue;
            throw error;
        }
    }
    throw new ActionError("name_taken", `${NAME_ATTEMPTS} callsigns were all taken: pick a name by hand.`);
}
