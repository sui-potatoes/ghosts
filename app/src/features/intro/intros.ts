// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every first-visit intro's text, in one place. Each has its own `version`:
 * bump it to show that intro again to everyone who accepted an older text.
 * Names and lines follow what the screen really offers (the Play cards in
 * `features/play/model.ts`, the Headquarters tabs and Armory).
 */

export type IntroId = "welcome" | "play" | "headquarters";

export type Intro = {
    id: IntroId;
    version: number;
    title: string;
    lead: string;
    /** A definition list: a label and one line each. */
    list: readonly (readonly [label: string, line: string])[];
    /** The one command, on the confirm slot. */
    command: string;
};

export const INTROS: Record<IntroId, Intro> = {
    welcome: {
        id: "welcome",
        version: 1,
        title: "Ghosts",
        lead: "Turn-based squad tactics, played online against other players. You lead a mercenary squad: move from cover to cover, shoot, throw grenades, and be the last squad standing",
        list: [
            ["Ranked match", "Rated matches, squads built to your rank's budget"],
            ["Friendly match", "Invite a friend by code, or open a match to anyone"],
            ["Contract", "Your own recruits, who earn experience and can be lost"],
            ["Training", "Solo operations against the AI"],
            ["Spectate", "Live matches and replays"],
        ],
        command: "Enter",
    },
    play: {
        id: "play",
        version: 1,
        title: "Play",
        lead: "Every mode is a match between two squads. Pick how you want to fight",
        list: [
            [
                "Ranked match",
                "Squads are built to your rank's credit budget. Wins raise your rating, losses lower it",
            ],
            [
                "Friendly match",
                "No rating at stake. Invite a friend by code, or open a match to anyone",
            ],
            ["Contract", "Your own recruits go in. They earn experience and can be lost"],
            ["Training", "Single-player operations against the AI"],
            ["Spectate", "Watch matches as they happen, or replay finished ones"],
        ],
        command: "Continue",
    },
    headquarters: {
        id: "headquarters",
        version: 1,
        title: "Headquarters",
        lead: "Your squad lives here between matches",
        list: [
            ["Loadout", "Rifle, armor and utility for each recruit"],
            ["Stats", "Operative and weapon stats, and what the gear adds"],
            ["Appearance", "Body, face, hair, skin and colors"],
            ["Dossier", "Name, rank and voice, or dismiss a recruit"],
            ["Armory", "Requisition gear and fit mods on the bench"],
        ],
        command: "Continue",
    },
};

/** The order they are asked in: the site welcome, then the screen's own. */
export const INTRO_ORDER: readonly IntroId[] = ["welcome", "play", "headquarters"];
