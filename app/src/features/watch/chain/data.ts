// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The viewer's reads, in the app: the archive (gRPC, then GraphQL), the
 * players of a game (their `Account`s and assigned names), the live games
 * list and the signed-in player's finished games, and opening one game as a
 * record source the viewer plays. No wallet is needed for any of it.
 */

import {
    blackRain,
    recordedSource,
    replayEncounter,
    type IntelSource,
    type RecordSource,
    type WatchSide,
} from "@ghosts/engine";
import type { Recruit as LocalRecruit } from "@ghosts/squad/types";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { ObjectError } from "@mysten/sui/client";
import { fromBase64 } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";

import {
    archive,
    grpcArchive,
    graphArchive,
    type GameArchive,
    type LedgerReader,
} from "../../../chain/archive";
import { Account, Game, type ChainGame } from "../../../chain/bcs";
import { endingOf } from "../../../chain/ending";
import { fetchGameRecruits } from "../../../chain/game";
import { graphql, sharedOfType } from "../../../chain/graphql";
import { chainUnitIntel } from "../../../chain/intel";
import { deployUntil, unitsOnMap } from "../../../chain/match-rules";
import type { UnitLook } from "../../../chain/match-scene";
import { assignedName } from "../../../chain/names";
import { GAME_TYPE } from "../../../chain/watch-layout";
import { defaultName } from "../../../player/name";
import { toLocalRecruits } from "../../headquarters/mapping";
import {
    isGameId,
    listedBy,
    liveRow,
    modeText,
    needsCreationCheck,
    offTheList,
    resultFor,
    type LiveRow,
    type PlayerLine,
} from "./list";
import { liveSource } from "./live";
import { EventFeed, readStory, storyOutcome, watchStart, type GameRecruit } from "./record";

type Client = ReturnType<typeof useCurrentClient>;

/** The game's past through the fullnode, GraphQL when the fullnode no longer has it. */
export function archiveOf(client: Client): GameArchive {
    return archive(
        grpcArchive(client as unknown as LedgerReader, GAME_TYPE),
        graphArchive(graphql(), GAME_TYPE),
    );
}

/** A player of a game: their `Account`, the address that owns it and the name it assigned itself. */
export interface Player extends PlayerLine {
    accountId: string;
    owner: string | null;
}

const names = new Map<string, Promise<string | null>>();

/** An address's assigned name, read once per session. */
function nameOf(client: Client, owner: string): Promise<string | null> {
    let name = names.get(owner);
    if (!name) {
        name = assignedName(client, owner).catch(() => null);
        names.set(owner, name);
    }
    return name;
}

/** The players behind `Account` ids, in order: names and ratings as the match screen shows them. */
export async function fetchPlayers(
    client: Client,
    accountIds: readonly string[],
): Promise<Player[]> {
    if (!accountIds.length) return [];
    const { objects } = await client.core.getObjects({
        objectIds: [...accountIds],
        include: { content: true },
    });
    return Promise.all(
        accountIds.map(async (accountId, i) => {
            const object = objects[i];
            if (!object || object instanceof Error)
                return { accountId, owner: null, name: "A player", rating: null };
            const account = Account.parse(object.content);
            const name = (await nameOf(client, account.owner)) ?? defaultName(account.owner);
            return { accountId, owner: account.owner, name, rating: Number(account.rating.rating) };
        }),
    );
}

/** The game now; null once it is deleted. Throws when the read fails. */
export async function readGameNow(client: Client, gameId: string): Promise<ChainGame | null> {
    try {
        const { object } = await client.core.getObject({
            objectId: gameId,
            include: { content: true },
        });
        return Game.parse(object.content);
    } catch (error) {
        if (error instanceof ObjectError && error.reason !== "unknown") return null;
        throw error;
    }
}

// === The live list ===

/** How often the live list is read again while it is open. */
const LIST_REFRESH_MS = 15_000;

/** Whether a friendly game came from a listed lobby: its creating transaction, read once. */
const listedCache = new Map<string, Promise<boolean>>();

function listed(arch: GameArchive, gameId: string): Promise<boolean> {
    let known = listedCache.get(gameId);
    if (!known) {
        known = arch
            .transactions(gameId, 1)
            .then((txs) => (txs?.length ? listedBy(txs[0].calls) : false))
            .catch(() => false);
        listedCache.set(gameId, known);
    }
    return known;
}

/** The games being played now that anyone may watch, newest turn first. */
export function useLiveGames() {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["watch", "live"],
        refetchInterval: LIST_REFRESH_MS,
        refetchOnWindowFocus: true,
        queryFn: async (): Promise<LiveRow[]> => {
            const now = Date.now();
            const arch = archiveOf(client);
            const shared = await sharedOfType(graphql(), GAME_TYPE);
            const games = shared.flatMap(({ address, bcs }) => {
                try {
                    const game = Game.parse(fromBase64(bcs));
                    return offTheList(game, now) ? [] : [{ id: address, game }];
                } catch {
                    return [];
                }
            });
            const shown = (
                await Promise.all(
                    games.map(async (g) =>
                        !needsCreationCheck(g.game) || (await listed(arch, g.id)) ? g : null,
                    ),
                )
            ).filter((g) => g !== null);
            const players = await fetchPlayers(client, [
                ...new Set(shown.flatMap((g) => g.game.players)),
            ]);
            const byId = new Map(players.map((p) => [p.accountId, p]));
            const line = (id: string): PlayerLine =>
                byId.get(id) ?? { name: "A player", rating: null };
            return shown
                .sort((a, b) => b.game.turn - a.game.turn)
                .map(({ id, game }) =>
                    liveRow(id, game, [line(game.players[0]), line(game.players[1])]),
                );
        },
    });
}

// === The player's finished games ===

export interface FinishedRow {
    gameId: string;
    name: string;
    kind: string;
    tag: string;
    won: boolean;
}

const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

/** How many finished games the watch screen lists. */
const RECENT = 8;

/** The signed-in player's finished games, newest first: each one's opponent and how it ended for them. */
export function useRecentGames(accountId: string | null | undefined, owner: string | undefined) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["watch", "recent", accountId],
        enabled: !!accountId,
        staleTime: 30_000,
        queryFn: async (): Promise<FinishedRow[]> => {
            const arch = archiveOf(client);
            const finished = (await arch.finished(accountId!, RECENT)) ?? [];
            const games = await Promise.all(
                finished.map(async (f) => {
                    const bytes = await arch.objectAt(f.gameId, f.version).catch(() => null);
                    try {
                        return bytes ? { f, game: Game.parse(bytes) } : null;
                    } catch {
                        return null;
                    }
                }),
            );
            const known = games.filter((g) => g !== null);
            const opponents = await fetchPlayers(client, [
                ...new Set(
                    known.flatMap(({ game }) => game.players.filter((p) => p !== accountId)),
                ),
            ]);
            const nameOfAccount = new Map(opponents.map((p) => [p.accountId, p.name]));
            return known.map(({ f, game }) => {
                const side = game.players.indexOf(accountId!);
                const sender =
                    owner && f.sender.toLowerCase() === owner.toLowerCase() ? side : 1 - side;
                const result = resultFor(endingOf(game, f, sender), game.players, side);
                const opponent = nameOfAccount.get(game.players[1 - side]) ?? "A player";
                return {
                    gameId: f.gameId,
                    name: `vs ${opponent}`,
                    kind: `${when(f.timestampMs)} · ${modeText(game)}`,
                    tag: result,
                    won: result === "Won",
                };
            });
        },
    });
}

// === One game in the viewer ===

/** A game opened for the viewer. */
export type ChainOpened =
    | {
          kind: "watch";
          gameId: string;
          source: RecordSource;
          live: boolean;
          /** The live game can be rewound to its first turn. */
          fromStart: boolean;
          sides: readonly [WatchSide, WatchSide];
          /** Side 0's recruits, dressed for the field; side 1's looks are in the scenario. */
          squad: LocalRecruit[];
          intel: IntelSource;
      }
    | { kind: "deploying"; gameId: string; until: number; sides: readonly [WatchSide, WatchSide] }
    | { kind: "unplayed"; gameId: string; title: string; line: string }
    | { kind: "unavailable"; gameId: string }
    | { kind: "missing" };

/**
 * Open a game for the viewer: live while it exists, else its replay
 * (`replay`: as a replay even while it still exists, once it is over).
 */
export async function openChainGame(
    client: Client,
    gameId: string,
    replay = false,
): Promise<ChainOpened> {
    if (!isGameId(gameId)) return { kind: "missing" };
    const arch = archiveOf(client);
    const current = replay ? null : await readGameNow(client, gameId);
    const story = await readStory(arch, gameId, current);
    if (story.kind === "unavailable") return { kind: "unavailable", gameId };

    const game = story.last;
    const players = await fetchPlayers(client, game.players);
    const sides = [0, 1].map((i) => ({
        name: players[i]?.name ?? "A player",
    })) as unknown as readonly [WatchSide, WatchSide];
    const owners = players.map((p) => p.owner);

    if (story.kind === "deploying")
        return { kind: "deploying", gameId, until: deployUntil(game), sides };
    if (story.kind === "unplayed") {
        const outcome = storyOutcome(game, story.endTx, owners, sides);
        return {
            kind: "unplayed",
            gameId,
            title:
                outcome?.winner != null
                    ? `${sides[outcome.winner].name} won`
                    : "No game was played",
            line: outcome?.reason ?? "The game ended before play started",
        };
    }

    let recruits: GameRecruit[] = story.recruits;
    if (!recruits.length && current)
        recruits = await fetchGameRecruits(
            client,
            current.recruits.id,
            Number(current.recruits.size),
        ).catch(() => []);
    const recruitById = new Map(recruits.map((r) => [r.objectId, r]));
    const leaderOf = (side: number) => recruits.filter((r) => r.leader === game.players[side]);
    const squad = toLocalRecruits(leaderOf(0));
    const looks = new Map<string, UnitLook>(
        toLocalRecruits(leaderOf(1)).map((r) => [
            r.id,
            { appearance: r.appearance, armor: r.equipment.armor },
        ]),
    );
    const start = watchStart(
        blackRain,
        story.first,
        new Map(recruits.map((r) => [r.objectId, r.metadata.name])),
        looks,
    );
    const feed = new EventFeed(start, story.first, (scenario) => replayEncounter(scenario, []));
    const startUnits = new Map(unitsOnMap(story.first).map(({ unit }) => [unit.recruit, unit]));
    const intel: IntelSource = (unit, base) =>
        chainUnitIntel(base, recruitById.get(unit.id), startUnits.get(unit.id));
    const outcome = (last: ChainGame, tx: Parameters<typeof storyOutcome>[1]) =>
        storyOutcome(last, tx, owners, sides);

    if (!story.finished && current) {
        const source = liveSource(
            { start, sides, feed, current },
            {
                read: () => readGameNow(client, gameId),
                async vanished() {
                    // The node may index the deleting transaction a moment after the game is gone.
                    for (let attempt = 0; attempt < 4; attempt++) {
                        const gone = await readStory(arch, gameId, null);
                        const done = gone.kind === "played" || gone.kind === "unplayed";
                        if (done && (gone.endTx || attempt === 3))
                            return { last: gone.last, tx: gone.endTx };
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    return null;
                },
                outcome,
                wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            },
        );
        return {
            kind: "watch",
            gameId,
            source,
            live: true,
            fromStart: story.fromStart,
            sides,
            squad,
            intel,
        };
    }

    feed.take(story.last);
    const end = outcome(story.last, story.endTx);
    const source = recordedSource({
        scenario: start.scenario,
        sides,
        prepare: start.prepare,
        outcome: () => end,
        events: feed.events,
    });
    return { kind: "watch", gameId, source, live: false, fromStart: true, sides, squad, intel };
}
