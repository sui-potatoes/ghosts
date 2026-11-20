// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The title screen's pure rules, tested in `tests/main-menu.test.ts`: which
 * rows the menu shows in each state (signed out, signed in, searching, in a
 * lobby, in a match, installable), what each row's command is called and
 * why a refused one is refused, where the cursor starts, and what the header's
 * status chips read. No React, no chain: the screen passes the state in.
 */

export type RowId =
    | "play"
    | "sign-in"
    | "watch"
    | "headquarters"
    | "editor"
    | "leaderboard"
    | "install"
    | "settings";

/** What the menu needs to know of the player, the search and the device. */
export type MenuState = {
    signedIn: boolean;
    match: {
        /** A game the player has a seat in. */
        playing: boolean;
        /** In a queue: ranked, or the contract queue for owned recruits. */
        searching: boolean;
        /** Which queue, while searching. */
        searchKind?: "ranked" | "contract";
        /** The last search ran out of time without a match, and the player has not been told. */
        expired?: boolean;
        /** Hosting or waiting in a friendly game's lobby (never the queue as well). */
        lobby?: boolean;
        /** Free recruits being hired on the way into the queue. */
        hiring: boolean;
        /** Whole minutes left of a matchmaking suspension; 0 when none. */
        suspendedMin: number;
        /** Another write is in flight: a cancel sent now would be dropped. */
        busy?: boolean;
    };
    /** The install entry: the browser's prompt, the iOS share-sheet hint, or nothing. */
    install: "none" | "prompt" | "ios";
};

export type MenuRow = {
    id: RowId;
    /** The row's name. */
    label: string;
    /** A short state on the row's right edge. */
    tag?: string;
    tagTone?: "default" | "accent" | "warn" | "dim";
    /** The command bar's line while the row has the cursor. */
    hint?: string;
    /** The confirm command's label. */
    verb: string;
    /** Shown, selectable, refused: the reason the bar gives. */
    locked?: string;
    /** The primary weighs heaviest in the bar. */
    primary?: boolean;
    /**
     * A click runs it at once: opening a screen or a dialog. Off for a row that
     * is refused (the cursor follows the pointer onto it, and the bar says why).
     */
    instant: boolean;
};

/**
 * The Play row: the one way into every mode (ranked, friendly, contract, demo,
 * faction wars). While the player searches, waits in a lobby or plays, it reads
 * so and leads back there.
 */
export function playRow(state: MenuState): MenuRow {
    const { match } = state;
    if (match.playing)
        return {
            id: "play",
            label: "Resume Match",
            tag: "Live",
            tagTone: "accent",
            hint: "Back to the field",
            verb: "Resume",
            primary: true,
            instant: true,
        };
    if (match.lobby)
        return {
            id: "play",
            label: "Play",
            tag: "Lobby",
            tagTone: "accent",
            hint: "Back to your friendly game",
            verb: "Open",
            primary: true,
            instant: true,
        };
    if (match.searching)
        return {
            id: "play",
            label: "Play",
            tag: "Searching",
            tagTone: "accent",
            hint: "Back to your search",
            verb: "Open",
            primary: true,
            instant: true,
        };
    if (match.expired)
        return {
            id: "play",
            label: "Play",
            tag: "No match",
            tagTone: "warn",
            hint: "Your last search ran out of time",
            verb: "Play",
            primary: true,
            instant: true,
        };
    return {
        id: "play",
        label: "Play",
        hint: "Ranked, friendly, contract, demo",
        verb: "Play",
        primary: true,
        instant: true,
    };
}

/** Every row, top to bottom. Disabled entries stay in place, refused with their reason. */
export function menuRows(state: MenuState): MenuRow[] {
    const rows: MenuRow[] = [playRow(state)];
    if (!state.signedIn)
        rows.push({
            id: "sign-in",
            label: "Sign In",
            hint: "Passkey or Google",
            verb: "Sign in",
            primary: true,
            instant: true,
        });
    rows.push(
        {
            id: "watch",
            label: "Spectate",
            hint: "Live matches and replays",
            verb: "Open",
            instant: true,
        },
        {
            id: "headquarters",
            label: "Headquarters",
            hint: "Squad, loadouts, armory",
            verb: "Open",
            instant: true,
        },
        {
            id: "editor",
            label: "Level Editor",
            tag: "Tool",
            tagTone: "dim",
            hint: "Paint, light and export a level",
            verb: "Open",
            instant: true,
        },
        {
            id: "leaderboard",
            label: "Leaderboard",
            hint: "Ranked players and tiers",
            verb: "Open",
            instant: true,
        },
    );
    if (state.install === "prompt")
        rows.push({
            id: "install",
            label: "Install App",
            hint: "Play from the home screen",
            verb: "Install",
            instant: true,
        });
    else if (state.install === "ios")
        rows.push({
            id: "install",
            label: "Install App",
            tag: "iOS",
            tagTone: "dim",
            verb: "Install",
            locked: "Share → Add to Home Screen",
            instant: false,
        });
    rows.push({
        id: "settings",
        label: "Settings",
        hint: "Player, audio, display, controls",
        verb: "Open",
        instant: true,
    });
    return rows;
}

/**
 * Where the cursor starts: on the row the player left the menu from (back
 * from Headquarters lands on Headquarters), else at the top. A row that left
 * with the state (Sign In once signed in) hands over to the one now in its
 * place, so the cursor does not jump to the top.
 */
export function startRow(rows: MenuRow[], last: { id: RowId; index: number } | null): RowId {
    if (!rows.length) return "settings";
    if (!last) return rows[0].id;
    if (rows.some((r) => r.id === last.id)) return last.id;
    return rows[Math.min(last.index, rows.length - 1)].id;
}

/** Back on the title has nowhere to go up to: it returns the cursor to the top row. */
export function backTarget(rows: MenuRow[]): RowId | null {
    return rows[0]?.id ?? null;
}

/** The match chip in the header, or null while there is no search and no game. */
export type MatchChipState = { value: string; state?: "live"; tone?: "warn" } | null;

export function matchChip(
    match: { playing: boolean; searchingSinceMs: number | null; lobby?: boolean },
    nowMs: number,
    timeoutMs: number,
): MatchChipState {
    if (match.playing) return { value: "In progress", state: "live" };
    if (match.lobby) return { value: "Friendly lobby", state: "live" };
    if (match.searchingSinceMs === null) return null;
    const elapsed = Math.max(0, nowMs - match.searchingSinceMs);
    if (elapsed > timeoutMs) return { value: "None found", tone: "warn" };
    const seconds = Math.floor(elapsed / 1000);
    return {
        value: `Searching ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
        state: "live",
    };
}

/** The player chip: the callsign once signed in (or a plain "On file" before it loads). */
export function playerChip(signedIn: boolean, name: string): { value: string; idle: boolean } {
    if (!signedIn) return { value: "Signed out", idle: true };
    return { value: name || "On file", idle: false };
}
