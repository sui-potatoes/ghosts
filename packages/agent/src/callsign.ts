// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Names for the fleet's seats: always `ai-<word>`, one plain word or given name from a built-in
 * list (nature, weather, colours, tools, animals, call words, first names: nothing rude, no
 * brands, nobody in particular), within the registry's label rules (`names.ts`). Seeded, so a seat
 * proposes the same names in the same order on every run; on "taken" it moves to the next word of
 * its order, never appending bytes or numbers. Only when every word is taken does it combine two
 * as `ai-<word><word>`. `ensureFleetName` brings a seat to that form: a seat with no name gets
 * one, one with another form is renamed as a player renames (`setName`), one already `ai-<word>`
 * is left alone. The single-agent API keeps free-form names; only the fleet enforces this.
 */

import type { GhostsAgent } from "./agent.ts";
import { seededRandom } from "./ranked.ts";
import { nameProblem } from "./names.ts";
import { ActionError } from "./types.ts";

/** The prefix of every fleet name. */
export const FLEET_PREFIX = "ai-";

// prettier-ignore
export const WORDS = [
    // nature
    "acorn", "aspen", "birch", "bloom", "brook", "canyon", "cedar", "clover", "coral", "cove",
    "creek", "dune", "elm", "fern", "field", "fjord", "glade", "grove", "heath", "hill",
    "isle", "ivy", "lake", "leaf", "marsh", "meadow", "moss", "oak", "orchid", "pebble",
    "pine", "pond", "reef", "ridge", "river", "sand", "shore", "spring", "stone", "summit",
    "thorn", "tide", "trail", "vale", "willow",
    // weather
    "breeze", "cloud", "drizzle", "fog", "frost", "gale", "gust", "hail", "haze", "mist",
    "rain", "snow", "squall", "storm", "sunny", "thunder", "wind",
    // colours
    "amber", "azure", "beige", "black", "blue", "bronze", "brown", "crimson", "cyan", "gold",
    "gray", "green", "indigo", "ivory", "jade", "khaki", "lilac", "lime", "maroon", "navy",
    "olive", "orange", "peach", "pink", "plum", "purple", "red", "rose", "ruby", "rust",
    "sage", "scarlet", "silver", "tan", "teal", "violet", "white", "yellow",
    // tools
    "anvil", "axe", "bolt", "chisel", "clamp", "drill", "file", "hammer", "hook", "lever",
    "nail", "plane", "pliers", "pulley", "rake", "ruler", "saw", "screw", "shovel", "spade",
    "wedge", "wrench",
    // animals
    "badger", "bear", "beaver", "bison", "crane", "crow", "deer", "dove", "eagle", "falcon",
    "finch", "fox", "frog", "gecko", "goat", "hare", "hawk", "heron", "horse", "ibis",
    "jay", "koala", "lark", "lemur", "lion", "lynx", "mole", "moose", "moth", "newt",
    "otter", "owl", "panda", "parrot", "pelican", "pony", "quail", "rabbit", "raven", "robin",
    "seal", "shark", "sparrow", "squid", "stork", "swan", "tiger", "toad", "trout", "turtle",
    "viper", "wasp", "whale", "wolf", "wren", "yak", "zebra",
    // call words
    "alpha", "bravo", "echo", "hotel", "kilo", "lima", "sierra", "tango", "zulu",
    // given names
    "adam", "alice", "anna", "arthur", "ben", "bruno", "carl", "clara", "dana", "david",
    "edith", "elena", "eli", "emma", "felix", "fiona", "frank", "gina", "hana", "hugo",
    "iris", "ivan", "jack", "jana", "julia", "kai", "lena", "leo", "lucas", "lucy",
    "maria", "mark", "mia", "nina", "noah", "nora", "olga", "oscar", "otto", "paul",
    "pia", "rita", "rosa", "ruth", "sam", "sara", "theo", "tina", "uma", "vera",
    "walt", "wanda", "zoe",
];

/** The seat's words in its own order: a seeded shuffle of `WORDS`, the same on every run. */
export function wordOrder(seed: number): string[] {
    const random = seededRandom((seed * 7919) >>> 0);
    const order = [...WORDS];
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/**
 * The `attempt`-th name of a seat with `seed`: `ai-heron`, the next word of its order per attempt.
 * Past the last word, pairs: `ai-herontide`. The same seed and attempt always give the same name,
 * and every one passes `nameProblem`.
 */
export function fleetName(seed: number, attempt = 0): string {
    const order = wordOrder(seed);
    const n = order.length;
    let word: string;
    if (attempt < n) {
        word = order[attempt];
    } else {
        // the first word steps through the order, the second one is a growing offset ahead of it
        const k = attempt - n;
        const first = k % n;
        word = order[first] + order[(first + 1 + (Math.floor(k / n) % (n - 1))) % n];
    }
    const name = `${FLEET_PREFIX}${word}`;
    if (nameProblem(name)) throw new Error(`A fleet name broke the label rules: ${name}`);
    return name;
}

/** `ai-<word>`: the only form the fleet keeps. */
export function isFleetName(name: string | null): name is string {
    return name !== null && /^ai-[a-z]+$/.test(name);
}

/** What `ensureFleetName` did. */
export type NameOutcome =
    | { kind: "kept"; name: string }
    /** `from` is the name the seat had before, `null` for a seat with none; `combined` is a two-word name. */
    | { kind: "named"; name: string; from: string | null; tries: number; combined: boolean }
    /** No name service here (a local network): players go by names made of their address. */
    | { kind: "no_registry"; name: string | null; message: string };

/** Single words, then this many pairs, before `ensureFleetName` gives up. */
export const PAIR_ATTEMPTS = 20;

/**
 * Bring the agent to an `ai-<word>` name. One it has already is kept; otherwise the seat's names
 * are tried in order, the next on `name_taken`, each registered (or renamed from the old one) in
 * one transaction by `setName`. A network without the names registry is reported, not thrown.
 */
export async function ensureFleetName(agent: GhostsAgent, seed: number): Promise<NameOutcome> {
    if (agent.backend.nameService === false) {
        return {
            kind: "no_registry",
            name: await agent.backend.name(),
            message: "This network has no name service: the seat plays under a name made of its address.",
        };
    }
    const current = await agent.backend.name();
    if (isFleetName(current)) return { kind: "kept", name: current };
    const attempts = WORDS.length + PAIR_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const name = fleetName(seed, attempt);
        try {
            await agent.setName(name);
            return { kind: "named", name, from: current, tries: attempt + 1, combined: attempt >= WORDS.length };
        } catch (error) {
            if (error instanceof ActionError && error.code === "name_taken") continue;
            throw error;
        }
    }
    throw new ActionError("name_taken", `${attempts} fleet names were all taken: pick a name by hand.`);
}
