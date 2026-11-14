// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * BCS schemas mirroring the on-chain types of the ghosts Move package
 * (`move/packages/ghosts`), with fields in Move struct order;
 * the names here are local to the app.
 */

import { bcs } from "@mysten/sui/bcs";

/** `sui::table::Table`: its id and size. */
export const Table = bcs.struct("Table", {
    id: bcs.Address,
    size: bcs.u64(),
});

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

/** `ghosts::weapon_upgrade::WeaponUpgrade`: an object, in the stock or fitted to a weapon. */
export const WeaponUpgrade = bcs.struct("WeaponUpgrade", {
    id: bcs.Address,
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
});

/** `ghosts::armor::Armor`. */
export const Armor = bcs.struct("Armor", {
    id: bcs.Address,
    name: bcs.string(),
    stats: Stats,
});

/** `ghosts::param::Param`. */
const Param = bcs.struct("Param", { value: bcs.u16(), maxValue: bcs.u16() });

/**
 * `ghosts::action::ActionKind`: variant order is the tag; new variants are appended.
 * Tags past the known ones read as `Unknown<tag>` instead of failing the whole
 * game: a unit with a newer contract's action still loads, and the HUD shows
 * that action as not supported (`unitActions`).
 */
const ActionKind = bcs.enum("ActionKind", {
    Move: null,
    Attack: null,
    Reload: null,
    Grenade: null,
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Unknown${i + 4}`, null])),
} as { Move: null; Attack: null; Reload: null; Grenade: null } & Record<`Unknown${number}`, null>);

/** `ghosts::action::Action`: a kind and how many uses are left of it, `null` for unlimited. */
const Action = bcs.struct("Action", { uses: bcs.option(bcs.u8()), kind: ActionKind });

/** `ghosts::utility::Utility`: what a recruit carries for the actions it grants (the frag grenade). */
export const Utility = bcs.struct("Utility", {
    id: bcs.Address,
    name: bcs.string(),
    /** A modifier added to the carrier's stats, like an armor's: zero for the frag grenade. */
    stats: Stats,
    /** The actions the item adds to its carrier, with the uses they come with. */
    actions: bcs.vector(Action),
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
    /** In slot order, at most `MAX_UTILITIES` (1 for now). */
    utilities: bcs.vector(Utility),
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

/** `ghosts::account::State`: where an `Account` stands. */
export const AccountState = bcs.enum("State", {
    Idle: null,
    Searching: bcs.struct("Searching", { order: bcs.Address, sinceMs: bcs.u64() }),
    Playing: bcs.Address,
    Suspended: bcs.struct("Suspended", { untilMs: bcs.u64() }),
});

/** `ghosts::ghosts::Seat`: a place in `game`, sent to the `Account` a match found waiting. */
export const Seat = bcs.struct("Seat", { id: bcs.Address, game: bcs.Address });

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
    state: AccountState,
    /** How many recruits are at home; they, the armory, the stock and dog tags are owned by the `Account`. */
    recruits: bcs.u64(),
    rating: Rating,
    score: Score,
});

/** `ghosts::unit::Unit`: a recruit as the map holds them, with the `Account` it belongs to. */
export const MapUnit = bcs.struct("Unit", {
    recruit: bcs.Address,
    owner: bcs.Address,
    ap: Param,
    hp: Param,
    ammo: Param,
    stats: Stats,
    /**
     * What the unit may be ordered to do: `Move`, the weapon's `Attack` and `Reload`, then the
     * actions of its utilities, each with its uses left; no weapon, no `Attack` or `Reload`.
     */
    actions: bcs.vector(Action),
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
    /** Units killed since the last turn change, off their tiles and not yet buried. */
    fallen: bcs.vector(MapUnit),
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
});

/** `ghosts::ghosts::Ending`: how a game ended; a player is their `Account` ID. */
export const Ending = bcs.enum("Ending", {
    Won: bcs.Address,
    Draw: null,
    Stalemate: null,
    Abandoned: bcs.Address,
    Forfeited: bcs.Address,
    NoShow: bcs.Address,
    NobodyShowed: null,
});

/** `ghosts::ghosts::State`: where a game stands. */
export const GameState = bcs.enum("State", {
    Deploying: bcs.struct("Deploying", { untilMs: bcs.u64() }),
    Playing: bcs.struct("Playing", { startedMs: bcs.u64(), missed: bcs.vector(bcs.u8()) }),
    Over: Ending,
});

/** `ghosts::ghosts::Game`. */
export const Game = bcs.struct("Game", {
    id: bcs.Address,
    map: GameMap,
    players: bcs.vector(bcs.Address),
    state: GameState,
    turn: bcs.u16(),
    positions: bcs.vector(bcs.vector(bcs.vector(bcs.u8()))),
    history: bcs.vector(GameRecord),
    /** `Table<ID, Recruit>`: the recruits on the map, whose each is, its unit says. */
    recruits: Table,
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
