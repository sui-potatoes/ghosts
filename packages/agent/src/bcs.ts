// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * BCS schemas of the ghosts Move package, fields in Move struct order, plus
 * the decoders into the plain `types.ts` view. They mirror the package source:
 * `Game` is `ghosts::ghosts::Game` and `Account` is `ghosts::account::Account`.
 */

import { bcs } from "@mysten/sui/bcs";

import { MAX_TURNS, TURN_LIMIT_MS } from "./rules.ts";
import type {
    AccountView,
    GameRecord,
    GameState,
    GameStatus,
    Search,
    Stats,
    Tile,
    Unit,
} from "./types.ts";

const Table = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
const TableVec = bcs.struct("TableVec", { contents: Table });
const Param = bcs.struct("Param", { value: bcs.u16(), maxValue: bcs.u16() });
const StatsBcs = bcs.u128();

const UnitBcs = bcs.struct("Unit", {
    recruit: bcs.Address,
    ap: Param,
    hp: Param,
    ammo: Param,
    grenadeUsed: bcs.bool(),
    stats: StatsBcs,
    lastTurn: bcs.u16(),
});

const TileType = bcs.enum("TileType", {
    Empty: null,
    Cover: bcs.struct("Cover", {
        left: bcs.u8(),
        top: bcs.u8(),
        right: bcs.u8(),
        bottom: bcs.u8(),
    }),
    Unwalkable: null,
    Wall: null,
});

const TileBcs = bcs.struct("Tile", { tileType: TileType, unit: bcs.option(UnitBcs) });

/** `ghosts::map::Map`; `Grid<Tile>` is its rows of tiles, then `rows` and `cols`. */
export const MapBcs = bcs.struct("Map", {
    id: bcs.Address,
    grid: bcs.struct("Grid", {
        grid: bcs.vector(bcs.vector(TileBcs)),
        rows: bcs.u16(),
        cols: bcs.u16(),
    }),
    turn: bcs.u16(),
});

/** `ghosts::history::Record`, variants in declaration order. */
const RecordBcs = bcs.enum("Record", {
    Reload: bcs.vector(bcs.u16()),
    NextTurn: bcs.u16(),
    Move: bcs.vector(bcs.u8()),
    Attack: bcs.struct("Attack", { origin: bcs.vector(bcs.u16()), target: bcs.vector(bcs.u16()) }),
    RecruitPlaced: bcs.tuple([bcs.u16(), bcs.u16()]),
    Damage: bcs.u8(),
    Miss: null,
    Explosion: bcs.tuple([bcs.u16(), bcs.u16(), bcs.u16()]),
    CriticalHit: bcs.u8(),
    Grenade: bcs.struct("Grenade", {
        origin: bcs.vector(bcs.u16()),
        target: bcs.vector(bcs.u16()),
    }),
    UnitKIA: bcs.Address,
    Dodged: null,
});

const Rank = bcs.enum("Rank", {
    Rookie: null,
    Squaddie: null,
    Corporal: null,
    Sergeant: null,
    Lieutenant: null,
    Captain: null,
    Major: null,
    Colonel: null,
});

const Metadata = bcs.struct("Metadata", {
    name: bcs.string(),
    visuals: bcs.struct("Visuals", {
        head: bcs.u256(),
        face: bcs.u256(),
        eyes: bcs.u256(),
        body: bcs.u256(),
        outfit: bcs.u256(),
    }),
    voice: bcs.u8(),
});

/** `ghosts::recruit::DogTag`. Only decoded to step over it: `fallen` sits inside `Game`. */
const DogTag = bcs.struct("DogTag", { id: bcs.Address, rank: Rank, metadata: Metadata });

/** `ghosts::ghosts::Game`. */
export const GameBcs = bcs.struct("Game", {
    id: bcs.Address,
    map: MapBcs,
    players: bcs.vector(bcs.Address),
    squads: bcs.vector(bcs.vector(bcs.Address)),
    fallen: bcs.vector(bcs.vector(DogTag)),
    positions: bcs.vector(bcs.vector(bcs.vector(bcs.u8()))),
    history: bcs.vector(RecordBcs),
    recruits: Table,
    deploying: bcs.bool(),
    deployUntilMs: bcs.u64(),
    turnStartedMs: bcs.u64(),
    missed: bcs.vector(bcs.u8()),
    abandonedBy: bcs.option(bcs.Address),
});

const WeaponUpgrade = bcs.struct("WeaponUpgrade", {
    name: bcs.string(),
    kind: bcs.u8(),
    tier: bcs.u8(),
    modifier: StatsBcs,
});

const SearchBcs = bcs.enum("Search", {
    Idle: null,
    Searching: bcs.struct("Searching", { order: bcs.Address, sinceMs: bcs.u64() }),
    Matched: bcs.struct("Matched", { matchId: bcs.Address, opponent: bcs.Address }),
    Playing: bcs.Address,
});

/** `ghosts::account::Account`. */
export const AccountBcs = bcs.struct("Account", {
    id: bcs.Address,
    owner: bcs.Address,
    recruits: Table,
    weapons: Table,
    armors: Table,
    upgrades: bcs.vector(WeaponUpgrade),
    dogTags: TableVec,
    rating: bcs.struct("Rating", {
        rating: bcs.u64(),
        deviation: bcs.u64(),
        games: bcs.u64(),
        lastPlayedMs: bcs.u64(),
    }),
    search: SearchBcs,
    suspendedUntilMs: bcs.u64(),
    score: bcs.struct("Score", { wins: bcs.u64(), losses: bcs.u64(), draws: bcs.u64() }),
});

/** `sui::dynamic_field::Field<address, ID>`: one `Registry.accounts` record. */
export const AccountRecord = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: bcs.Address,
});

/** `Registry`, as far as its accounts table: later fields are not read. */
export const RegistryHead = bcs.struct("Registry", { id: bcs.Address, accounts: Table });

// === Decoding ===

const STAT_NAMES = [
    "mobility",
    "aim",
    "health",
    "armor",
    "dodge",
    "defense",
    "damage",
    "spread",
    "plusOne",
    "critChance",
    "canBeDodged",
    "areaSize",
    "envDamage",
    "range",
    "ammo",
] as const;

/** `ghosts::stats::Stats`: one `u8` per parameter, little-endian in a `u128`. */
export function decodeStats(value: string | bigint): Stats {
    const packed = BigInt(value);
    const stats = {} as Stats;
    STAT_NAMES.forEach((name, i) => {
        stats[name] = Number((packed >> BigInt(8 * i)) & 0xffn);
    });
    return stats;
}

/** The inverse of `decodeStats`. */
export function encodeStats(stats: Stats): bigint {
    return STAT_NAMES.reduce((packed, name, i) => {
        return packed | (BigInt(stats[name]) << BigInt(8 * i));
    }, 0n);
}

type DecodedMap = ReturnType<typeof MapBcs.parse>;
type DecodedGame = ReturnType<typeof GameBcs.parse>;

/**
 * The size of a decoded `Map`, counted like `grid::from_bcs!` counts it. Move
 * ignores the serialized `rows` and `cols` when it loads a map, and the demo
 * presets carry junk there, so the tiles are the only reliable answer.
 */
export function gridSize(map: DecodedMap): { rows: number; cols: number } {
    return { rows: map.grid.grid.length, cols: map.grid.grid[0]?.length ?? 0 };
}

/** Tiles of a decoded `Map`, without the units standing on them. */
export function decodeTiles(map: DecodedMap): Tile[][] {
    return map.grid.grid.map((row) =>
        row.map(({ tileType }): Tile => {
            if (tileType.$kind === "Cover") return { kind: "cover", ...tileType.Cover };
            if (tileType.$kind === "Unwalkable") return { kind: "unwalkable" };
            if (tileType.$kind === "Wall") return { kind: "wall" };
            return { kind: "empty" };
        }),
    );
}

/** `is_over` and `winner` from `ghosts::ghosts`. Whoever did not abandon wins, or the side left. */
function decodeStatus(game: DecodedGame): GameStatus {
    const [first, second] = game.players;
    if (game.abandonedBy !== null) {
        return { kind: "finished", winner: game.abandonedBy === first ? second : first };
    }
    if (game.deploying) return { kind: "deploying" };

    const [firstOut, secondOut] = game.squads.map((squad) => squad.length === 0);
    if (!firstOut && !secondOut && game.map.turn < MAX_TURNS) return { kind: "active" };
    if (firstOut === secondOut) return { kind: "finished", winner: null };
    return { kind: "finished", winner: secondOut ? first : second };
}

/** Decode a `Game` object's content into the plain state. */
export function decodeGame(bytes: Uint8Array, version: string): GameState {
    const game = GameBcs.parse(bytes);
    const turn = game.map.turn;
    const units: Unit[] = [];
    game.map.grid.grid.forEach((row, x) =>
        row.forEach(({ unit }, y) => {
            if (!unit) return;
            const stale = Number(unit.lastTurn) < turn;
            units.push({
                recruit: unit.recruit,
                side: game.squads.findIndex((squad) => squad.includes(unit.recruit)),
                x,
                y,
                ap: stale ? unit.ap.maxValue : unit.ap.value,
                apMax: unit.ap.maxValue,
                hp: unit.hp.value,
                hpMax: unit.hp.maxValue,
                ammo: unit.ammo.value,
                ammoMax: unit.ammo.maxValue,
                grenadeUsed: unit.grenadeUsed,
                stats: decodeStats(unit.stats),
            });
        }),
    );

    return {
        id: game.id,
        version,
        ...gridSize(game.map),
        turn,
        active: turn % game.players.length,
        players: game.players,
        squads: game.squads,
        fallen: game.fallen.map((tags) => tags.length),
        positions: game.positions,
        history: game.history.map(decodeRecord),
        missed: game.missed,
        abandonedBy: game.abandonedBy,
        deadlineMs: game.deploying
            ? Number(game.deployUntilMs)
            : Number(game.turnStartedMs) + TURN_LIMIT_MS,
        status: decodeStatus(game),
        tiles: decodeTiles(game.map),
        units,
    };
}

export function decodeSearch(search: ReturnType<typeof SearchBcs.parse>): Search {
    switch (search.$kind) {
        case "Searching":
            return {
                kind: "searching",
                order: search.Searching.order,
                sinceMs: Number(search.Searching.sinceMs),
            };
        case "Matched":
            return {
                kind: "found",
                order: search.Matched.matchId,
                opponent: search.Matched.opponent,
            };
        case "Playing":
            return { kind: "playing", game: search.Playing };
        default:
            return { kind: "idle" };
    }
}

export function decodeAccount(bytes: Uint8Array): AccountView {
    const account = AccountBcs.parse(bytes);
    return {
        id: account.id,
        owner: account.owner,
        rating: Number(account.rating.rating),
        deviation: Number(account.rating.deviation),
        score: {
            wins: Number(account.score.wins),
            losses: Number(account.score.losses),
            draws: Number(account.score.draws),
        },
        recruits: Number(account.recruits.size),
        search: decodeSearch(account.search),
        suspendedUntilMs: Number(account.suspendedUntilMs),
        // Not in the Move package yet: see "Still assumed" in the README.
        recovery: null,
    };
}

export function decodeRecord(record: ReturnType<typeof RecordBcs.parse>): GameRecord {
    switch (record.$kind) {
        case "Reload":
            return { kind: "reload", x: record.Reload[0], y: record.Reload[1] };
        case "NextTurn":
            return { kind: "next_turn", turn: record.NextTurn };
        case "Move":
            return { kind: "move", path: record.Move };
        case "Attack":
            return { kind: "attack", from: record.Attack.origin, to: record.Attack.target };
        case "RecruitPlaced":
            return { kind: "placed", x: record.RecruitPlaced[0], y: record.RecruitPlaced[1] };
        case "Damage":
            return { kind: "damage", amount: record.Damage };
        case "Miss":
            return { kind: "miss" };
        case "Explosion":
            return {
                kind: "explosion",
                x: record.Explosion[0],
                y: record.Explosion[1],
                radius: record.Explosion[2],
            };
        case "CriticalHit":
            return { kind: "critical_hit", amount: record.CriticalHit };
        case "Grenade":
            return { kind: "grenade", from: record.Grenade.origin, to: record.Grenade.target };
        case "UnitKIA":
            return { kind: "kia", recruit: record.UnitKIA };
        default:
            return { kind: "dodged" };
    }
}
