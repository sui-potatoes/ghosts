// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Friendly matches, the pure part: the invite code (alphabet, generation from a
 * lobby id, formatting, tolerant parsing, check character), the share link, ages,
 * and the squad a friendly match brings. No React, no storage, no clock; tested in
 * `tests/play-friendly.test.ts`.
 *
 * The code is shaped for a future on-chain id: 8 characters, grouped `XXXX-XXXX`,
 * from an alphabet without 0, O, 1, I or L, so it can be read aloud and typed
 * without a second guess. The first 7 characters are the payload (about 34.7 bits),
 * the 8th is a check character so a typo is caught on the device before any lookup.
 * An on-chain version would store the payload as the key of a registry on the
 * lobby (game) object, `code payload -> lobby object id`; the check character
 * stays client-side. The share link carries the formatted code.
 */

import type { Loadout, Mode } from "../economy/index.ts";
import { defaultSquad, presetsFor, squadSize } from "../economy/index.ts";

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;
const PAYLOAD = CODE_LENGTH - 1;

/** FNV-1a, 32 bits: the deterministic seed for everything the mock derives. */
export function hash32(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** A small seeded generator: the same seed gives the same stream. */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The check character of a 7-character payload (a weighted sum, so swaps are caught). */
export function checkChar(payload: string): string {
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
        sum += (CODE_ALPHABET.indexOf(payload[i]) + 1) * (i + 1);
    }
    return CODE_ALPHABET[sum % CODE_ALPHABET.length];
}

/** A canonical code (8 characters, no dash) from a 7-character payload. */
export const withCheck = (payload: string): string => payload + checkChar(payload);

/** The code of a lobby id: deterministic, so the same lobby always shows the same code. */
export function codeFromId(id: string): string {
    const next = rng(hash32(`lobby:${id}`));
    let payload = "";
    for (let i = 0; i < PAYLOAD; i++) {
        payload += CODE_ALPHABET[Math.floor(next() * CODE_ALPHABET.length)];
    }
    return withCheck(payload);
}

/** `ABCD-EFGH`, also for a partial code while it is typed. */
export function formatCode(code: string): string {
    const raw = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export type CodeProblem = "empty" | "chars" | "short" | "long" | "check";
export type ParsedCode =
    { ok: true; code: string } | { ok: false; problem: CodeProblem; message: string };

const MESSAGES: Record<CodeProblem, string> = {
    empty: "Enter the code",
    chars: "Codes use letters and digits, never 0, O, 1, I or L",
    short: `A code has ${CODE_LENGTH} characters`,
    long: `A code has ${CODE_LENGTH} characters`,
    check: "That code has a typo",
};

const refuse = (problem: CodeProblem): ParsedCode => ({
    ok: false,
    problem,
    message: MESSAGES[problem],
});

/** The code inside a pasted share link, or the text itself. */
function stripLink(input: string): string {
    const found = /[?&#]code=([^&#\s]+)/i.exec(input);
    if (!found) return input;
    try {
        return decodeURIComponent(found[1]);
    } catch {
        return found[1];
    }
}

/** Tolerant of case, spaces, dashes, dots and a whole pasted link; strict on the rest. */
export function parseCode(input: string): ParsedCode {
    const raw = stripLink(input)
        .toUpperCase()
        .replace(/[\s\-_.·]/g, "");
    if (!raw) return refuse("empty");
    for (const ch of raw) if (!CODE_ALPHABET.includes(ch)) return refuse("chars");
    if (raw.length < CODE_LENGTH) return refuse("short");
    if (raw.length > CODE_LENGTH) return refuse("long");
    if (checkChar(raw.slice(0, PAYLOAD)) !== raw[PAYLOAD]) return refuse("check");
    return { ok: true, code: raw };
}

export const isValidCode = (input: string): boolean => parseCode(input).ok;

/** What the field says while the player types: nothing until there is something to refuse. */
export function typingProblem(input: string): string | null {
    const parsed = parseCode(input);
    if (parsed.ok || parsed.problem === "empty") return null;
    // Still typing: a short code is not a mistake yet.
    return parsed.problem === "short" ? null : parsed.message;
}

export const FRIENDLY_ROUTE = "/play/friendly";

/** The link that opens the join flow with the code filled in. */
export function shareLink(code: string, origin: string): string {
    return `${origin}${FRIENDLY_ROUTE}?code=${formatCode(code)}`;
}

/** The code in a location's query string, or null. */
export function linkCode(search: string): string | null {
    const value = new URLSearchParams(search).get("code");
    return value === null || value === "" ? null : value;
}

/** How long a lobby has been open, in the words of the list. */
export function ageLabel(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 10) return "just now";
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
}

/** Which recruit role takes which preset, by what the preset is called. */
const ROLE_PRESET: Record<string, string> = {
    Assault: "assault",
    Recon: "runner",
    Support: "heavy",
    Marksman: "sniper",
};

/**
 * A saved squad on the device as loadouts: each recruit takes the preset that
 * fits their role (by name, from the economy's own list; the next preset in
 * turn when none fits), and a squad shorter than the size is filled from the
 * default squad. Friendly matches carry no budget in the mock, so nothing is
 * priced or validated here.
 */
export function squadFromRecruits(
    recruits: { role: string }[],
    mode: Mode,
    rating: number,
): Loadout[] {
    const presets = presetsFor(rating);
    const fill = defaultSquad(rating, mode);
    if (presets.length === 0) return fill;
    return Array.from({ length: squadSize(mode) }, (_, i) => {
        const recruit = recruits[i];
        if (!recruit) return fill[i];
        const key = ROLE_PRESET[recruit.role] ?? "";
        const preset =
            presets.find(
                (p) => key !== "" && (p.id.includes(key) || p.name.toLowerCase().includes(key)),
            ) ?? presets[i % presets.length];
        return { ...preset.loadout };
    });
}

export type SquadKind = "saved" | "default";

export type Bring = { squad: Loadout[]; names: string[]; kind: SquadKind };

/** The squad a friendly match brings: the saved one when there is one, else the default. */
export function bringSquad(
    kind: SquadKind,
    saved: { role: string; callsign: string }[] | null,
    mode: Mode,
    rating: number,
): Bring {
    const size = squadSize(mode);
    if (kind === "saved" && saved && saved.length > 0) {
        return {
            kind: "saved",
            squad: squadFromRecruits(saved, mode, rating),
            names: Array.from({ length: size }, (_, i) => saved[i]?.callsign ?? `Unit ${i + 1}`),
        };
    }
    return {
        kind: "default",
        squad: defaultSquad(rating, mode),
        names: Array.from({ length: size }, (_, i) => `Unit ${i + 1}`),
    };
}
