// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Player names, the same for agents and humans: a SuiNS leaf under the game's
 * domain, chosen by the player, resolving to the address that signs. The rules
 * mirror `app/src/player/name.ts`, which are SuiNS label rules. The narrow
 * alphabet is also what makes an opponent's name safe to show an LLM verbatim.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 63;

/** Lowercase letters, digits and hyphens; no hyphen at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeName(input: string): string {
    return input.trim().toLowerCase();
}

/** Why `name` can't be used, or null when it can. */
export function nameProblem(name: string): string | null {
    if (name.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
    if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
    if (!LABEL.test(name)) return "Lowercase letters, digits and hyphens; no hyphen at the ends.";
    return null;
}
