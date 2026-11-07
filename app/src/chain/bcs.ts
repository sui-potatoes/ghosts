// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * BCS schemas mirroring the on-chain types of the ghosts Move package
 * (`move/packages/ghosts`), with fields in Move struct order;
 * the names here are local to the app.
 */

import { bcs } from "@mysten/sui/bcs";

/** `sui::table::Table` / `sui::object_table::ObjectTable`: its id and size. */
export const Table = bcs.struct("Table", {
    id: bcs.Address,
    size: bcs.u64(),
});

/** `sui::table_vec::TableVec`. */
export const TableVec = bcs.struct("TableVec", { contents: Table });

/** `ghosts::stats::Stats`: 15 `u8` parameters packed into one `u128`. */
export const Stats = bcs.struct("Stats", { value: bcs.u128() });

/**
 * `ghosts::visuals::Visuals`: five areas of 32 packed `u8` slots, laid out by
 * the appearance codec (`@ghosts/squad/appearance/codec`).
 */
export const Visuals = bcs.struct("Visuals", {
    head: bcs.u256(),
    face: bcs.u256(),
    eyes: bcs.u256(),
    body: bcs.u256(),
    outfit: bcs.u256(),
});

/** `ghosts::recruit::Metadata`. */
export const Metadata = bcs.struct("Metadata", {
    name: bcs.string(),
    visuals: Visuals,
    voice: bcs.u8(),
});

/** `ghosts::rank::Rank`; the decoded `$kind` is the rank's name. */
export const Rank = bcs.enum("Rank", {
    Rookie: null,
    Squaddie: null,
    Corporal: null,
    Sergeant: null,
    Lieutenant: null,
    Captain: null,
    Major: null,
    Colonel: null,
});

/** `ghosts::weapon_upgrade::WeaponUpgrade`. */
export const WeaponUpgrade = bcs.struct("WeaponUpgrade", {
    name: bcs.string(),
    kind: bcs.u8(),
    tier: bcs.u8(),
    modifier: Stats,
});

/** `ghosts::weapon::Weapon`. */
export const Weapon = bcs.struct("Weapon", {
    id: bcs.Address,
    name: bcs.string(),
    stats: Stats,
    upgrades: bcs.vector(WeaponUpgrade),
    requiredRank: Rank,
});

/** `ghosts::armor::Armor`. */
export const Armor = bcs.struct("Armor", {
    id: bcs.Address,
    name: bcs.string(),
    stats: Stats,
    requiredRank: Rank,
});

/** `ghosts::recruit::Recruit`. */
export const Recruit = bcs.struct("Recruit", {
    id: bcs.Address,
    metadata: Metadata,
    rank: Rank,
    xp: bcs.u16(),
    stats: Stats,
    weapon: bcs.option(Weapon),
    armor: bcs.option(Armor),
    leader: bcs.Address,
});

/** `ghosts::account::Registry`. */
export const Registry = bcs.struct("Registry", {
    id: bcs.Address,
    accounts: Table,
    visualPresets: bcs.vector(bcs.vector(bcs.u256())),
});

/** `glicko::glicko::Rating`. */
export const Rating = bcs.struct("Rating", {
    rating: bcs.u64(),
    deviation: bcs.u64(),
    games: bcs.u64(),
    lastPlayedMs: bcs.u64(),
});

/** `ghosts::account::Search`: an `Account`'s place in matchmaking. */
export const Search = bcs.enum("Search", {
    Idle: null,
    Searching: bcs.struct("Searching", { order: bcs.Address, sinceMs: bcs.u64() }),
    Matched: bcs.struct("Matched", { matchId: bcs.Address, opponent: bcs.Address }),
    Playing: bcs.Address,
});

/** `ghosts::account::Score`: how a player's games ended. */
export const Score = bcs.struct("Score", {
    wins: bcs.u64(),
    losses: bcs.u64(),
    draws: bcs.u64(),
});

/** `ghosts::account::Account`. */
export const Account = bcs.struct("Account", {
    id: bcs.Address,
    owner: bcs.Address,
    recruits: Table,
    weapons: Table,
    armors: Table,
    upgrades: bcs.vector(WeaponUpgrade),
    dogTags: TableVec,
    rating: Rating,
    search: Search,
    suspendedUntilMs: bcs.u64(),
    score: Score,
    credits: bcs.u64(),
});

/** `ghosts::param::Param`. */
const Param = bcs.struct("Param", { value: bcs.u16(), maxValue: bcs.u16() });

/** `ghosts::unit::Unit`: a recruit as the map holds them. */
export const MapUnit = bcs.struct("Unit", {
    recruit: bcs.Address,
    ap: Param,
    hp: Param,
    ammo: Param,
    grenadeUsed: bcs.bool(),
    stats: Stats,
    lastTurn: bcs.u16(),
});

/** `ghosts::map::TileType`. */
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

/** `ghosts::map::Map`; `Grid<Tile>` is its rows of tiles, then `rows` and `cols`. */
export const GameMap = bcs.struct("Map", {
    id: bcs.Address,
    grid: bcs.struct("Grid", {
        grid: bcs.vector(
            bcs.vector(bcs.struct("Tile", { tileType: TileType, unit: bcs.option(MapUnit) })),
        ),
        rows: bcs.u16(),
        cols: bcs.u16(),
    }),
    turn: bcs.u16(),
});

/** `ghosts::history::Record`, variants in declaration order. */
const GameRecord = bcs.enum("Record", {
    Reload: bcs.vector(bcs.u16()),
    NextTurn: bcs.u16(),
    Move: bcs.vector(bcs.u8()),
    Attack: bcs.struct("Attack", {
        origin: bcs.vector(bcs.u16()),
        target: bcs.vector(bcs.u16()),
    }),
    RecruitPlaced: bcs.tuple([bcs.u16(), bcs.u16()]),
    Damage: bcs.u8(),
    Miss: null,
    Explosion: bcs.tuple([bcs.u16(), bcs.u16(), bcs.u16()]),
    CriticalHit: bcs.u8(),
    Grenade: bcs.struct("Grenade", {
        origin: bcs.vector(bcs.u16()),
        target: bcs.vector(bcs.u16()),
    }),
    UnitKIA: bcs.tuple([bcs.Address, bcs.u16(), bcs.u16()]),
    Dodged: null,
    PickUp: bcs.tuple([bcs.u16(), bcs.u16()]),
});

/** `ghosts::recruit::DogTag`. */
const DogTag = bcs.struct("DogTag", { id: bcs.Address, rank: Rank, metadata: Metadata });

/** `ghosts::ghosts::Game`. */
export const Game = bcs.struct("Game", {
    id: bcs.Address,
    map: GameMap,
    players: bcs.vector(bcs.Address),
    squads: bcs.vector(bcs.vector(bcs.Address)),
    fallen: bcs.vector(bcs.vector(DogTag)),
    positions: bcs.vector(bcs.vector(bcs.vector(bcs.u8()))),
    history: bcs.vector(GameRecord),
    recruits: Table,
    deploying: bcs.bool(),
    deployUntilMs: bcs.u64(),
    turnStartedMs: bcs.u64(),
    missed: bcs.vector(bcs.u8()),
    abandonedBy: bcs.option(bcs.Address),
    kills: bcs.vector(
        bcs.struct("VecMap", {
            contents: bcs.vector(bcs.struct("Entry", { key: bcs.Address, value: bcs.u8() })),
        }),
    ),
    dropped: bcs.vector(bcs.struct("Dropped", { x: bcs.u16(), y: bcs.u16(), weapon: Weapon })),
});

export type ChainGame = typeof Game.$inferType;
export type ChainRecord = ChainGame["history"][number];

/** `sui::clock::Clock`: the time the contract goes by. */
export const Clock = bcs.struct("Clock", { id: bcs.Address, timestampMs: bcs.u64() });

/** `sui::dynamic_field::Field<address, ID>` — one `Registry.accounts` record. */
export const AccountRecord = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: bcs.Address,
});
