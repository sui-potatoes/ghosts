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
    Flashbang: null,
    SmokeGrenade: null,
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Unknown${i + 6}`, null])),
} as {
    Move: null;
    Attack: null;
    Reload: null;
    Grenade: null;
    Flashbang: null;
    SmokeGrenade: null;
} & Record<`Unknown${number}`, null>);

/** `ghosts::action::Action`: a kind and how many uses are left of it, `null` for unlimited. */
const Action = bcs.struct("Action", { uses: bcs.option(bcs.u8()), kind: ActionKind });

/** `ghosts::utility::Utility`: what a recruit carries for the actions it grants (a grenade). */
export const Utility = bcs.struct("Utility", {
    id: bcs.Address,
    name: bcs.string(),
    /** A modifier added to the carrier's stats, like an armor's: zero for the grenades. */
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
    /** In slot order, at most `MAX_UTILITIES` (1). */
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

/**
 * `ghosts::account::State`: where an `Account` stands. A search names its `queue`: the
 * `Matchmaker` it waits in (stakes, or the ranked queue of a size) or `Lobbies`; a ranked
 * search holds the `commitment` to its squad.
 */
export const AccountState = bcs.enum("State", {
    Idle: null,
    Searching: bcs.struct("Searching", {
        order: bcs.Address,
        sinceMs: bcs.u64(),
        queue: bcs.Address,
        commitment: bcs.option(bcs.Address),
    }),
    Playing: bcs.Address,
});

/**
 * `ghosts::ghosts::Seat`: a place in `game`, sent to the `Account` a match found waiting;
 * no game is a notice that the queue dropped the search.
 */
export const Seat = bcs.struct("Seat", { id: bcs.Address, game: bcs.option(bcs.Address) });

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
    /** Ranked games only. */
    score: Score,
    /** Until when the player cannot search; 0 when never suspended. */
    suspendedUntil: bcs.u64(),
    /** How many times the rating was reset. */
    resets: bcs.u16(),
    /** When the rating was last reset; 0 when never. */
    lastResetMs: bcs.u64(),
});

/**
 * `ghosts::effect::Effect`: one byte, `kind << 4 | turns`. Kinds are `EFFECT_KINDS`;
 * `effectKind` and `effectTurns` take it apart.
 */
const Effect = bcs.u8();

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
    /** The status effects on the unit (daze, smoke), at most one per kind, in the order they landed. */
    effects: bcs.vector(Effect),
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

/** `ghosts::map::Map` up to its `units`; `Grid<Tile>` is its rows of tiles, then `rows` and `cols`. */
const mapFields = {
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
};

/**
 * `ghosts::map::Map` as a map preset has it: `Map.units` left out, which the contract then
 * rebuilds from the grid (`Map.from_bytes`).
 */
export const PresetMap = bcs.struct("Map", mapFields);

/** `ghosts::map::Map`. */
export const GameMap = bcs.struct("Map", {
    ...mapFields,
    /** The tiles holding a unit, as `row * cols + col` in ascending order: the order effect records name units in. */
    units: bcs.vector(bcs.u16()),
});

/** `ghosts::history::Record`, variants in declaration order. */
export const GameRecord = bcs.enum("Record", {
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
    Flashbang: bcs.struct("Flashbang", {
        origin: bcs.vector(bcs.u16()),
        target: bcs.vector(bcs.u16()),
    }),
    SmokeGrenade: bcs.struct("SmokeGrenade", {
        origin: bcs.vector(bcs.u16()),
        target: bcs.vector(bcs.u16()),
    }),
    /** `(x, y, effect)`: the unit on the tile has the effect, with its turns left (a refresh is a start too). */
    EffectStart: bcs.tuple([bcs.u16(), bcs.u16(), Effect]),
    /** `(x, y, kind)`: the effect of that kind ran out on the unit on the tile. */
    EffectEnd: bcs.tuple([bcs.u16(), bcs.u16(), bcs.u8()]),
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

/**
 * `ghosts::ghosts::Mode`: what a game is played for. `Stakes` (tag 0) came from the queue for
 * owned recruits, unrated; `Friendly` (tag 1) from a lobby, each side deploying up to `size`
 * recruits; `Ranked` (tag 2) from the ranked queue of `size`, between players of `tier`, with
 * squads built for the game.
 */
export const GameMode = bcs.enum("Mode", {
    Stakes: null,
    Friendly: bcs.struct("Friendly", { size: bcs.u8() }),
    Ranked: bcs.struct("Ranked", { size: bcs.u8(), tier: bcs.u8() }),
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
    mode: GameMode,
});

/** `ghosts::ghosts::Preset`: the frozen map games start on; `positions` holds both sides' spawns, half each. */
export const Preset = bcs.struct("Preset", {
    id: bcs.Address,
    map: GameMap,
    name: bcs.string(),
    positions: bcs.vector(bcs.vector(bcs.u8())),
});

/**
 * `ghosts::lobby::Lobby`: a lobby, under either key. A protected lobby only ever has
 * its size; an open one has the guest in its slot and whoever the host kicked out.
 */
export const Lobby = bcs.struct("Lobby", {
    size: bcs.u8(),
    guest: bcs.option(bcs.Address),
    kicked: bcs.vector(bcs.Address),
});

/**
 * `sui::dynamic_field::Field<K, Lobby>` on `Lobbies`, for either key: `Open(ID)` (the
 * host's `Account` ID) and `Protected(address)` (the code hashed twice) are both 32 bytes.
 */
export const LobbyField = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: Lobby,
});

export type ChainGame = typeof Game.$inferType;
export type ChainMode = ChainGame["mode"];

/** `ghosts::rules::Item`: an item's price and the lowest tier it is unlocked at. */
export const RulesItem = bcs.struct("Item", { price: bcs.u16(), minTier: bcs.u8() });

/** `ghosts::rules::Tier`: its lowest rating and the budget of each size, in `Rules.sizes` order. */
export const RulesTier = bcs.struct("Tier", {
    minRating: bcs.u64(),
    budgets: bcs.vector(bcs.u16()),
});

/** `ghosts::rules::Size`: units a side, the ranked queue, the level; none and it is closed. */
export const RulesSize = bcs.struct("Size", {
    units: bcs.u8(),
    queue: bcs.Address,
    level: bcs.option(bcs.Address),
});

/** `ghosts::rules::Rules`: the shared rules of ranked games. */
export const Rules = bcs.struct("Rules", {
    id: bcs.Address,
    version: bcs.u32(),
    /** Index `i` is the rifle of tier `i + 1`. */
    weapons: bcs.vector(RulesItem),
    /** Index `i` is the armor of tier `i + 1`. */
    armor: bcs.vector(RulesItem),
    /** Index `i` is the utility of kind `i`: frag, flashbang, smoke. */
    utilities: bcs.vector(RulesItem),
    tiers: bcs.vector(RulesTier),
    sizes: bcs.vector(RulesSize),
    placementGames: bcs.u8(),
    placementTier: bcs.u8(),
    revealLimitMs: bcs.u64(),
    resetCooldownMs: bcs.u64(),
});

export type ChainRules = typeof Rules.$inferType;

/** `ghosts::ghosts::GameStarted`: emitted once, as a game is created. */
export const GameStarted = bcs.struct("GameStarted", {
    game: bcs.Address,
    players: bcs.vector(bcs.Address),
    mode: GameMode,
    /** False only for a game from an invite code. */
    listed: bcs.bool(),
});

/** `ghosts::ghosts::GameEnded`: emitted once, as a game is wrapped up and deleted. */
export const GameEnded = bcs.struct("GameEnded", { game: bcs.Address, ending: Ending });
export type ChainRecord = ChainGame["history"][number];

/** `sui::clock::Clock`: the time the contract goes by. */
export const Clock = bcs.struct("Clock", { id: bcs.Address, timestampMs: bcs.u64() });

/** `sui::dynamic_field::Field<address, ID>` — one `Registry.accounts` record. */
export const AccountRecord = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: bcs.Address,
});
