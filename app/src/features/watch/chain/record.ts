// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A game on chain as the viewer reads it, live or finished: the version it
 * started play at (every deployed unit, the ones that fall later too), the
 * newest one (its whole history), the recruits deployed (names and looks), and
 * how it ended. From those, the viewer's start (`watchStart`), its events
 * (`EventFeed`, the history past the start turned into engine events) and the
 * ending in plain words (`watchOutcome`). Only types come from the engine; the
 * rules to mirror the field with are passed in, so this runs in node
 * (`tests/watch-chain.test.ts`).
 */

import type { EncounterRules, GameEvent, Scenario, WatchOutcome, WatchSide } from "@ghosts/engine";

import type { GameArchive, GameTx } from "../../../chain/archive.ts";
import { Game, type ChainGame, type Recruit } from "../../../chain/bcs.ts";
import { endingOf, type GameEnding } from "../../../chain/ending.ts";
import {
    activeSide,
    gameEvents,
    isDeploying,
    isOver,
    terrainAt,
    toTile,
    type Bounds,
    type Cell,
    type FieldView,
} from "../../../chain/match-rules.ts";
import {
    restoreBlasts,
    scenarioFor,
    syncUnits,
    type UnitLook,
} from "../../../chain/match-scene.ts";
import { CALLS, RecruitField } from "../../../chain/watch-layout.ts";

/** A recruit deployed in a game, as its table entry held it. */
export type GameRecruit = typeof Recruit.$inferType & { objectId: string };

/** A game's story, as far as the chain still tells it. */
export type GameStory =
    /** Played: from the version play started at to the newest (`finished`: nothing follows). */
    | {
          kind: "played";
          first: ChainGame;
          last: ChainGame;
          /** The game is over or deleted. */
          finished: boolean;
          /** The transaction that deleted it, for a deleted game. */
          endTx: GameTx | null;
          recruits: GameRecruit[];
          /** The start was read from its history: a live game can be rewound to its first turn. */
          fromStart: boolean;
      }
    /** It ended before play started: a side never deployed. */
    | { kind: "unplayed"; last: ChainGame; endTx: GameTx | null }
    /** Still picking squads. */
    | { kind: "deploying"; last: ChainGame }
    /** Nothing to read: the versions are gone (or never were). */
    | { kind: "unavailable" };

const decode = (bytes: Uint8Array | null): ChainGame | null => {
    if (!bytes) return null;
    try {
        return Game.parse(bytes);
    } catch {
        return null;
    }
};

/** How many versions are tried for the one play started at. */
const START_READS = 4;

/** The recruits a game's squad deployments wrote, read at the version written. */
export async function deployedRecruits(
    archive: GameArchive,
    txs: readonly GameTx[],
): Promise<GameRecruit[]> {
    const entries = txs
        .filter((tx) => tx.calls.includes(CALLS.deploy))
        .flatMap((tx) => tx.recruits);
    const read = await Promise.all(
        entries.map(async ({ id, version }) => {
            try {
                const bytes = await archive.objectAt(id, version);
                if (!bytes) return null;
                const { value } = RecruitField.parse(bytes);
                return { ...value, objectId: value.id };
            } catch {
                return null;
            }
        }),
    );
    const byId = new Map<string, GameRecruit>();
    for (const recruit of read) if (recruit) byId.set(recruit.objectId, recruit);
    return [...byId.values()];
}

/**
 * Read a game's story from its versions. `current` is the game as it stands
 * when it still exists, null for a deleted one.
 */
export async function readStory(
    archive: GameArchive,
    gameId: string,
    current: ChainGame | null,
): Promise<GameStory> {
    if (current && isDeploying(current)) return { kind: "deploying", last: current };
    const txs = await archive.transactions(gameId).catch(() => null);
    if (!txs?.length) {
        // The past is out of reach: a live game is watched from where it stands.
        return current
            ? {
                  kind: "played",
                  first: current,
                  last: current,
                  finished: isOver(current),
                  endTx: null,
                  recruits: [],
                  fromStart: false,
              }
            : { kind: "unavailable" };
    }
    const endTx = current ? null : deletion(txs);
    const last =
        current ??
        decode(await readAt(archive, gameId, endTx?.before ?? txs[txs.length - 1].after));
    if (!last) return { kind: "unavailable" };

    // Play starts with the second squad deployed: the version that deployment left.
    let deployed = -1;
    txs.forEach((tx, i) => {
        if (tx.calls.includes(CALLS.deploy)) deployed = i;
    });
    let first: ChainGame | null = null;
    for (const tx of txs.slice(Math.max(0, deployed), Math.max(0, deployed) + START_READS)) {
        if (!tx.after) break;
        const game = decode(await readAt(archive, gameId, tx.after));
        if (!game || isOver(game)) break;
        if (game.state.$kind === "Playing") {
            first = game;
            break;
        }
    }
    const recruits = await deployedRecruits(archive, txs);
    if (!first) {
        if (current && !isOver(current))
            return {
                kind: "played",
                first: current,
                last: current,
                finished: false,
                endTx: null,
                recruits,
                fromStart: false,
            };
        return { kind: "unplayed", last, endTx };
    }
    return {
        kind: "played",
        first,
        last,
        finished: !current || isOver(last),
        endTx,
        recruits,
        fromStart: true,
    };
}

/** The transaction that deleted the game, the last one to touch it. */
function deletion(txs: readonly GameTx[]): GameTx | null {
    const last = txs[txs.length - 1];
    return last && last.after === undefined && last.before !== undefined ? last : null;
}

const readAt = (archive: GameArchive, id: string, version: string | undefined) =>
    version ? archive.objectAt(id, version).catch(() => null) : Promise.resolve(null);

/** Where the viewer starts: the scene with every unit the game started play with, and the rules as they stood. */
export interface WatchStart {
    scenario: Scenario;
    bounds: Bounds;
    /** Bring fresh rules to the start: stats, health, gear, blasts, whose turn and its number. */
    prepare(rules: EncounterRules): void;
}

/**
 * The start of a game for the viewer, side 0 (the first player) as the units
 * with `enemy` false: `first` is the version play started at (or, with its past
 * out of reach, the game as it stands). `looks` dress side 1's units; side 0's
 * are dressed by the squad the field is given.
 */
export function watchStart(
    base: Scenario,
    first: ChainGame,
    names: ReadonlyMap<string, string>,
    looks?: ReadonlyMap<string, UnitLook>,
): WatchStart {
    const bounds = base.map.bounds;
    return {
        scenario: scenarioFor(base, first, 0, names, looks),
        bounds,
        prepare(rules) {
            syncUnits(rules, first, bounds);
            restoreBlasts(rules, first, bounds);
            rules.phase = activeSide(first) === 0 ? "player" : "enemy";
            // The turn number the players see: both sides' goes in a round share it.
            rules.turn = Math.floor(first.turn / 2);
        },
    };
}

/**
 * A game's history past its start, as engine events. Records name tiles, so
 * they are read against a mirror of the field that takes each event as it is
 * made, the way a player's client reads the opponent's turn (`driver.ts`).
 * `take` only ever appends: the history is append-only on chain.
 */
export class EventFeed {
    readonly events: GameEvent[] = [];
    private readonly mirror: EncounterRules;
    private readonly bounds: Bounds;
    private seen: number;

    constructor(
        start: WatchStart,
        first: ChainGame,
        blank: (scenario: Scenario) => EncounterRules,
    ) {
        this.mirror = blank(start.scenario);
        start.prepare(this.mirror);
        this.bounds = start.bounds;
        this.seen = first.history.length;
    }

    /** The records `game` has past the last look, as events; returns how many were added. */
    take(game: ChainGame): number {
        if (game.history.length <= this.seen) return 0;
        const { mirror, bounds } = this;
        const tile = (cell: Cell) => toTile(cell, bounds);
        const field: FieldView = {
            bounds,
            side: 0,
            unitAt: ([x, z]) =>
                mirror.units.find((u) => u.hp > 0 && u.pos[0] === x && u.pos[1] === z)?.id,
            isCover: (cell) => terrainAt(game, tile(cell)) === "cover",
            coverAt: (cell) => mirror.coverAt(cell),
            blast: (cell) => mirror.map.blastProps(cell),
        };
        const before = this.events.length;
        for (const event of gameEvents(game.history.slice(this.seen), field)) {
            mirror.ingest(event);
            this.events.push(event);
        }
        this.seen = game.history.length;
        return this.events.length - before;
    }
}

/** Which player sent a transaction: the side whose `Account` owner it is, null for neither. */
export function senderSide(
    sender: string,
    owners: readonly (string | null | undefined)[],
): number | null {
    const at = owners.findIndex((owner) => !!owner && owner.toLowerCase() === sender.toLowerCase());
    return at < 0 ? null : at;
}

/** How a game ended, for anyone watching it: who won and, when not on the field, why. */
export function watchOutcome(
    ending: GameEnding | null,
    players: readonly string[],
    sides: readonly [WatchSide, WatchSide],
): WatchOutcome | null {
    if (!ending) return null;
    const sideOf = (account: string) => {
        const at = players.indexOf(account);
        return at === 0 || at === 1 ? at : null;
    };
    const other = (side: 0 | 1 | null) => (side === null ? null : ((1 - side) as 0 | 1));
    const name = (side: 0 | 1 | null) => (side === null ? "A player" : sides[side].name);
    switch (ending.$kind) {
        case "Won":
            return { winner: sideOf(ending.Won) };
        case "Draw":
            return { winner: null, reason: "Draw" };
        case "Stalemate":
            return { winner: null, reason: "No winner by the turn limit" };
        case "Abandoned": {
            const side = sideOf(ending.Abandoned);
            return { winner: other(side), reason: `${name(side)} left the game` };
        }
        case "Forfeited": {
            const side = sideOf(ending.Forfeited);
            return { winner: other(side), reason: `${name(side)} missed 3 turns in a row` };
        }
        case "NoShow": {
            const side = sideOf(ending.NoShow);
            return { winner: other(side), reason: `${name(side)} did not deploy a squad` };
        }
        case "NobodyShowed":
            return { winner: null, reason: "Neither side deployed a squad" };
    }
}

/**
 * How a game ended, from its last version and, for one deleted before it was
 * seen `Over`, the transaction that deleted it (`owners`: the players' `Account`
 * owners, to tell whose it was).
 */
export function storyOutcome(
    last: ChainGame,
    endTx: Pick<GameTx, "sender" | "calls"> | null,
    owners: readonly (string | null | undefined)[],
    sides: readonly [WatchSide, WatchSide],
): WatchOutcome | null {
    const ending = endingOf(last, endTx, endTx ? senderSide(endTx.sender, owners) : null);
    return watchOutcome(ending, last.players, sides);
}
