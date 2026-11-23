// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The engine's seam to a game on chain. What the rules can work out for themselves
 * plays at once and settles behind the scene: moves, reloads, the end of a turn.
 * What takes dice goes out at once too, and comes back with the answer. Should the
 * chain refuse something already played, the field walks back to what is true.
 * The opponent's turn is `Game.history`, polled. Imported by the match screen only:
 * it brings the engine along.
 */

import {
    correctEncounter,
    type Command,
    type DriverFactory,
    type EncounterRules,
    type GameEvent,
    type Scenario,
} from "@ghosts/engine";
import { unpack } from "@ghosts/squad/stats";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { ObjectError } from "@mysten/sui/client";

import { Game, type ChainGame } from "./bcs";
import { matchBase } from "./levels";
import type { Order } from "./fast-lane";
import {
    fetchGame,
    fetchGameRefs,
    moveUnitOrder,
    nextTurnOrder,
    effectThrowOrder,
    reloadOrder,
    strikeOrder,
    type GameRefs,
} from "./game";
import {
    activeSide,
    turnLimitMs,
    turnStartedAt,
    canDo,
    effectBytes,
    effectiveStats,
    encodePath,
    gameEvents,
    hitChance,
    isOver,
    lineOfSight,
    lineOfThrow,
    stepAllowed,
    terrainAt,
    throwValid,
    toCell,
    toTile,
    coverBonus,
    unitsOnMap,
    type Bounds,
    type Cell,
    type FieldView,
} from "./match-rules";
import {
    restoreBlasts as restoreSceneBlasts,
    scenarioFor,
    syncUnits as syncSceneUnits,
    type UnitLook,
} from "./match-scene";
import { prepareOrders, sendOrder } from "./sender";

type Client = ReturnType<typeof useCurrentClient>;

/** How often the opponent's turn is re-read. */
const POLL_MS = 400;

/** Where the cells of the scene a game is shown in sit on the chain's grid: its level's. */
export const matchBounds = (game: ChainGame): Bounds => matchBase(game.map.id).map.bounds;

/**
 * The encounter a game starts as for `side`: its level's scene (`matchBase`)
 * with the units the map holds right now, so it also picks a game up after a
 * reload. `looks` dress the opponent's units (a ranked squad has no recruits to
 * read them from).
 */
export function matchScenario(
    game: ChainGame,
    side: number,
    names: Map<string, string>,
    looks?: ReadonlyMap<string, UnitLook>,
): Scenario {
    return scenarioFor(matchBase(game.map.id), game, side, names, looks);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An order behind one the chain refused: nothing was sent. */
class Dropped extends Error {}

/** Orders go to the chain for `side` of the game; the engine plays what comes back. */
export function chainDriver({
    client,
    gameId,
    accountId,
    side,
    start,
    onGame,
}: {
    client: Client;
    gameId: string;
    accountId: string;
    side: number;
    start: ChainGame;
    /** The game as an order or a read left it. */
    onGame?(game: ChainGame): void;
}): DriverFactory {
    return (rules) => {
        let seen = start.history.length;
        /** Orders sent and not yet answered. */
        let inFlight = 0;
        /** The last order's whole round, to wait on before reading the game. */
        let settled: Promise<unknown> = Promise.resolve();
        /** Moves on when the chain refuses an order; what was queued behind it is dropped. */
        let generation = 0;
        /** The game as last seen: the ground and the stats the odds go by. */
        let latest = start;
        /** The game's level never changes: its scene's cells on the chain's grid. */
        const bounds = matchBounds(start);
        const restoreBlasts = (rules: EncounterRules, game: ChainGame) =>
            restoreSceneBlasts(rules, game, bounds);
        /** Bring the rules in line with the chain: it decides, the rules only show. */
        const syncUnits = (rules: EncounterRules, game: ChainGame) =>
            syncSceneUnits(rules, game, bounds);

        const refs = fetchGameRefs(client, gameId, accountId);
        // A failed lookup shows when an order needs it.
        refs.catch(() => {});
        prepareOrders();

        syncUnits(rules, start);
        restoreBlasts(rules, start);
        rules.phase = activeSide(start) === side ? "player" : "enemy";
        rules.turn = Math.floor(start.turn / 2);

        const tile = (cell: readonly number[]) => toTile(cell as Cell, bounds);
        /** The stats the contract keeps on a unit, which the rules have no place for. */
        const statsOf = (id: string) => {
            const entry = unitsOnMap(latest).find(({ unit }) => unit.recruit === id);
            return entry ? unpack(BigInt(entry.unit.stats.value)) : null;
        };
        rules.authority = {
            terrain: (cell) => terrainAt(latest, tile(cell)),
            // `trace_path`'s step: no high side across the edge, never two obstacles in a row
            step: (from, to) => stepAllowed(latest, tile(from), tile(to)),
            clearShot: (from, to) => lineOfSight(latest, tile(from), tile(to)),
            clearThrow: (from, to) => lineOfThrow(latest, tile(from), tile(to)),
            cover: (from, at) => coverBonus(latest, tile(from.pos), tile(at.pos)),
            chance: (a, b) => {
                const [from, to] = [tile(a.pos), tile(b.pos)];
                if (!lineOfSight(latest, from, to)) return 0;
                const distance = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
                // the shooter's effective aim, the target's effective defense
                const aim = effectiveStats({ aim: a.aim, defense: 0 }, effectBytes(a.effects)).aim;
                const defense = effectiveStats(
                    { aim: 0, defense: statsOf(b.id)?.defense ?? 0 },
                    effectBytes(b.effects),
                ).defense;
                return hitChance(
                    { aim, range: a.range, areaSize: statsOf(a.id)?.areaSize ?? 0 },
                    defense,
                    distance,
                    coverBonus(latest, from, to),
                );
            },
        };

        /** When the turn in play runs out, for the command bar's clock and its refusals. */
        const deadline = (game: ChainGame) => {
            const started = turnStartedAt(game);
            rules.turnDeadline = started ? started + turnLimitMs(game.turn) : undefined;
        };
        deadline(start);

        /** A fresher read of the game: for the odds here, and for the screen. */
        const note = (game: ChainGame) => {
            latest = game;
            deadline(game);
            onGame?.(game);
        };

        const field: FieldView = {
            bounds,
            side,
            unitAt: ([x, z]) =>
                rules.units.find((u) => u.hp > 0 && u.pos[0] === x && u.pos[1] === z)?.id,
            isObstacle: (cell) => terrainAt(latest, tile(cell)) === "obstacle",
            coverAt: (cell) => rules.coverAt(cell),
            blast: (cell) => rules.map.blastProps(cell),
        };

        /** Read the game, waiting out the network; nothing once it is deleted. */
        async function readGame(): Promise<ChainGame | null> {
            for (;;) {
                try {
                    return await fetchGame(client, gameId);
                } catch (error) {
                    if (error instanceof ObjectError && error.reason !== "unknown") return null;
                    await sleep(POLL_MS);
                }
            }
        }

        /** Send an order, in line; resolves with the game as it left it. */
        async function send(build: (refs: GameRefs) => Order): Promise<ChainGame> {
            const sentIn = generation;
            inFlight++;
            try {
                const resolved = await refs;
                const sent = sendOrder((tx) => {
                    if (sentIn !== generation) throw new Dropped();
                    build(resolved)(tx);
                });
                if (!sent) throw new Error("No wallet to sign with");
                const contents = (await sent).contents(gameId);
                return contents ? Game.parse(contents) : await fetchGame(client, gameId);
            } finally {
                inFlight--;
            }
        }

        /** The chain took an order already played: nothing to show, only to note. */
        function landed(game: ChainGame) {
            seen = game.history.length;
            note(game);
            // not while later orders are out: they are played here and not there yet
            if (!inFlight) syncUnits(rules, game);
        }

        /** Whatever was played and did not happen, walked back. */
        async function refused(error: unknown) {
            if (error instanceof Dropped) return;
            console.warn("Order refused:", error);
            generation++;
            const game = await readGame();
            if (!game) return;

            seen = game.history.length;
            const events: GameEvent[] = [];
            for (const { row, col, unit } of unitsOnMap(game)) {
                const u = rules.unit(unit.recruit);
                const cell = toCell([row, col], bounds);
                if (!u || (u.pos[0] === cell[0] && u.pos[1] === cell[1])) continue;
                events.push({
                    type: "move",
                    unit: u.id,
                    path: [u.pos as Cell, cell],
                    vault: false,
                    cover: rules.coverAt(cell),
                });
            }
            for (const event of events) rules.ingest(event);
            syncUnits(rules, game);
            rules.phase = activeSide(game) === side ? "player" : "enemy";
            rules.turn = Math.floor(game.turn / 2);
            note(game);
            // not waited on: it waits for whatever is playing, which may be waiting on this
            void correctEncounter(events, "ORDER REFUSED / FIELD RESYNCED");
        }

        /** Send an order the field has already played. */
        function behind(build: (refs: GameRefs) => Order) {
            settled = send(build).then(landed, refused);
        }

        /** The records since the last look, as events taken into the rules. */
        function* unseen(game: ChainGame): Generator<GameEvent> {
            const records = game.history.slice(seen);
            seen = game.history.length;
            for (const event of gameEvents(records, field)) {
                rules.ingest(event);
                yield event;
            }
            syncUnits(rules, game);
        }

        /** Send an order only the chain can answer, and read the answer. */
        async function strike(build: (refs: GameRefs) => Order): Promise<GameEvent[]> {
            const answer = send(build);
            settled = answer.catch(() => {});
            try {
                const game = await answer;
                // the ground first: a blast in these records took cover with it
                const events = [...unseen(game)];
                note(game);
                return events;
            } catch (error) {
                // not waited on: the field walks back once this order is done playing
                void refused(error);
                return [];
            }
        }

        function resolve(command: Command): Promise<GameEvent[]> {
            const unit = rules.unit(command.unit);
            if (!unit) return Promise.resolve([]);
            const from = toTile(unit.pos as Cell, bounds);
            // the chain refuses what the unit's actions do not list: not even sent
            const needs = {
                move: "Move",
                reload: "Reload",
                fire: "Attack",
                grenade: "Grenade",
                flashbang: "Flashbang",
                "smoke-grenade": "SmokeGrenade",
            } as const;
            const need = needs[command.type as keyof typeof needs];
            if (need && !canDo(latest, unit.id, need)) return Promise.resolve([]);
            switch (command.type) {
                case "move": {
                    const path = rules.paths(unit).get(`${command.to[0]},${command.to[1]}`);
                    if (!path || path.length < 2) return Promise.resolve([]);
                    const bytes = encodePath(path as Cell[], bounds);
                    const events = rules.apply(command);
                    if (events.length) behind((r) => moveUnitOrder(r, bytes));
                    return Promise.resolve(events);
                }
                case "reload": {
                    const events = rules.apply(command);
                    if (events.length) behind((r) => reloadOrder(r, from));
                    return Promise.resolve(events);
                }
                case "fire": {
                    const target = rules.unit(command.target);
                    if (!target) return Promise.resolve([]);
                    const to = toTile(target.pos as Cell, bounds);
                    return strike((r) => strikeOrder("perform_attack", r, from, to));
                }
                case "grenade": {
                    const to = toTile(command.at as Cell, bounds);
                    if (!throwValid(latest, from, to)) return Promise.resolve([]);
                    return strike((r) => strikeOrder("perform_grenade", r, from, to));
                }
                // nothing rolls for these: no `Random`, and the burst comes back as effect records
                case "flashbang":
                case "smoke-grenade": {
                    const to = toTile(command.at as Cell, bounds);
                    if (!throwValid(latest, from, to)) return Promise.resolve([]);
                    const action =
                        command.type === "flashbang"
                            ? "perform_flashbang"
                            : "perform_smoke_grenade";
                    return strike((r) => effectThrowOrder(action, r, from, to));
                }
                // overwatch, hunkering and the rest are the local rules' own
                default:
                    return Promise.resolve([]);
            }
        }

        /** The other side's turn, as it happens; ends when it is this player's. */
        async function* watch(): AsyncGenerator<GameEvent> {
            const watching = generation;
            await settled;
            if (watching !== generation) return;

            let game = await readGame();
            while (game) {
                for (const event of unseen(game)) {
                    yield event;
                    if (event.type === "turn") {
                        note(game);
                        return;
                    }
                }
                note(game);
                if (isOver(game)) return;
                if (activeSide(game) === side) {
                    rules.phase = "player";
                    return;
                }
                await sleep(POLL_MS);
                game = await readGame();
            }
        }

        return {
            remote: true,
            resolve,
            watch,
            async *hostilePhase() {
                const event: GameEvent = { type: "hostile-phase" };
                rules.ingest(event);
                behind((r) => nextTurnOrder(r));
                yield event;
                yield* watch();
            },
        };
    };
}
