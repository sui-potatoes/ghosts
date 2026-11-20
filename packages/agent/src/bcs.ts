// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * BCS schemas of the ghosts Move package, fields in Move struct order, plus
 * the decoders into the plain `types.ts` view. They mirror the package source:
 * `Game` is `ghosts::ghosts::Game` and `Account` is `ghosts::account::Account`.
 */

import { bcs } from "@mysten/sui/bcs";

import { turnLimitMs } from "./rules.ts";
import type { RankedRules } from "./ranked.ts";
import type {
    AccountView,
    Ending,
    GameEndedEvent,
    GameMode,
    GameStartedEvent,
    GameRecord,
    GameState,
    GameStatus,
    QueueView,
    Search,
    EffectKind,
    Stats,
    Tile,
    Unit,
    UnitAction,
    UnitEffect,
} from "./types.ts";

const Table = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
const Param = bcs.struct("Param", { value: bcs.u16(), maxValue: bcs.u16() });
const StatsBcs = bcs.u128();

/** `ghosts::action::ActionKind`: variant order is the tag, new variants are appended. */
const ActionKindBcs = bcs.enum("ActionKind", {
    Move: null,
    Attack: null,
    Reload: null,
    Grenade: null,
    Flashbang: null,
    SmokeGrenade: null,
});

/** `ghosts::action::Action`: how many uses are left (`null`: unlimited), then the kind. */
const ActionBcs = bcs.struct("Action", { uses: bcs.option(bcs.u8()), kind: ActionKindBcs });

/**
 * `ghosts::effect::Effect`: one byte, `kind << 4 | turns`. The kinds are appended only:
 * `DAZE` is 0 and `SMOKE` is 1.
 */
const EffectBcs = bcs.u8();

/**
 * `ghosts::unit::Unit`: a recruit as the map holds them, with the `Account` it belongs to. A ranked
 * unit has no recruit behind it: `recruit` is a fresh ID with nothing there.
 */
export const UnitBcs = bcs.struct("Unit", {
    recruit: bcs.Address,
    owner: bcs.Address,
    ap: Param,
    hp: Param,
    ammo: Param,
    stats: StatsBcs,
    actions: bcs.vector(ActionBcs),
    /** The status effects on the unit, at most one of each kind, in the order it got them. */
    effects: bcs.vector(EffectBcs),
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

const MapFields = {
    id: bcs.Address,
    grid: bcs.struct("Grid", {
        grid: bcs.vector(bcs.vector(TileBcs)),
        rows: bcs.u16(),
        cols: bcs.u16(),
    }),
    /** Units killed since the last turn change, off their tiles and not yet buried. */
    fallen: bcs.vector(UnitBcs),
};

/**
 * `ghosts::map::Map`; `Grid<Tile>` is its rows of tiles, then `rows` and `cols`.
 * `units` is the unit index: the tile of every unit on the map, as `x * cols + y`, in
 * ascending order. Effects land on units in this order.
 */
export const MapBcs = bcs.struct("Map", { ...MapFields, units: bcs.vector(bcs.u16()) });

/**
 * A `Map` as the presets are written: without the unit index, which `map::from_bytes` rebuilds
 * from the grid. A preset holds no units, so the index would be empty.
 */
export const MapPresetBcs = bcs.struct("MapPreset", MapFields);

/** `ghosts::history::Record`, variants in declaration order. */
export const RecordBcs = bcs.enum("Record", {
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
    /** The recruit and the tile it fell on. */
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
    /** The tile of the unit and the effect as it now has it, with its turns left. */
    EffectStart: bcs.tuple([bcs.u16(), bcs.u16(), EffectBcs]),
    /** The tile of the unit and the kind that ran out. */
    EffectEnd: bcs.tuple([bcs.u16(), bcs.u16(), bcs.u8()]),
});

/** `ghosts::ghosts::Ending`: how a game ended; a player is their `Account` ID. */
export const EndingBcs = bcs.enum("Ending", {
    Won: bcs.Address,
    Draw: null,
    Stalemate: null,
    Abandoned: bcs.Address,
    Forfeited: bcs.Address,
    NoShow: bcs.Address,
    NobodyShowed: null,
});

/** `ghosts::ghosts::State`: where a game stands. It only moves forward. */
export const GameStateBcs = bcs.enum("State", {
    Deploying: bcs.struct("Deploying", { untilMs: bcs.u64() }),
    Playing: bcs.struct("Playing", { startedMs: bcs.u64(), missed: bcs.vector(bcs.u8()) }),
    Over: EndingBcs,
});

/**
 * `ghosts::ghosts::Mode`: what a game is played for. `Stakes` (tag 0, once `Rated`) is a match of
 * the stakes queue over owned recruits, unrated; `Friendly` a lobby game of `size`, the most
 * recruits each side deploys; `Ranked` a match of the ranked queue of `size`, between players of
 * `tier`, with squads built from loadouts. New variants are appended.
 */
export const ModeBcs = bcs.enum("Mode", {
    Stakes: null,
    Friendly: bcs.struct("Friendly", { size: bcs.u8() }),
    Ranked: bcs.struct("Ranked", { size: bcs.u8(), tier: bcs.u8() }),
});

/** `ghosts::ghosts::Game`. Squads and the fallen are not fields: the units say whose they are. */
export const GameBcs = bcs.struct("Game", {
    id: bcs.Address,
    map: MapBcs,
    players: bcs.vector(bcs.Address),
    state: GameStateBcs,
    turn: bcs.u16(),
    positions: bcs.vector(bcs.vector(bcs.vector(bcs.u8()))),
    history: bcs.vector(RecordBcs),
    /** `Table<ID, Recruit>`: the recruits on the map. */
    recruits: Table,
    /** Last field: how the game is played. */
    mode: ModeBcs,
});

/**
 * `ghosts::ghosts::Seat`: a place in `game`, sent to the `Account` a match found waiting; with no
 * game, a notice that the queue dropped the search (`dismiss_seat` clears it).
 */
export const SeatBcs = bcs.struct("Seat", { id: bcs.Address, game: bcs.option(bcs.Address) });

/**
 * `ghosts::lobby::Lobby`: a lobby's size, its guest (listed lobbies only) and the `Account`s the
 * host kicked out of it. An invite-only lobby is always `[size, 0, 0]`.
 */
export const LobbyBcs = bcs.struct("Lobby", {
    size: bcs.u8(),
    guest: bcs.option(bcs.Address),
    kicked: bcs.vector(bcs.Address),
});

/**
 * `0x2::dynamic_field::Field<ghosts::lobby::Open, Lobby>` and `Field<Protected, Lobby>`: the key
 * of both is 32 bytes, `Open(ID)` the host's `Account` ID and `Protected(address)` the hash of the
 * hash of the invite code.
 */
export const LobbyField = bcs.struct("Field", { id: bcs.Address, name: bcs.Address, value: LobbyBcs });

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

const WeaponUpgrade = bcs.struct("WeaponUpgrade", {
    id: bcs.Address,
    name: bcs.string(),
    kind: bcs.u8(),
    tier: bcs.u8(),
    modifier: StatsBcs,
});

const Weapon = bcs.struct("Weapon", {
    id: bcs.Address,
    name: bcs.string(),
    stats: StatsBcs,
    upgrades: bcs.vector(WeaponUpgrade),
});

const Armor = bcs.struct("Armor", {
    id: bcs.Address,
    name: bcs.string(),
    stats: StatsBcs,
});

/** `ghosts::utility::Utility`: a stats modifier for its carrier and the actions it grants. */
const Utility = bcs.struct("Utility", {
    id: bcs.Address,
    name: bcs.string(),
    stats: StatsBcs,
    actions: bcs.vector(ActionBcs),
});

/** `ghosts::recruit::Recruit`: an object the `Account` owns while the recruit is at home. */
export const RecruitBcs = bcs.struct("Recruit", {
    id: bcs.Address,
    metadata: Metadata,
    rank: Rank,
    xp: bcs.u16(),
    stats: StatsBcs,
    weapon: bcs.option(Weapon),
    armor: bcs.option(Armor),
    /** In slot order, at most the recruit's utility slots (one for now). */
    utilities: bcs.vector(Utility),
    leader: bcs.Address,
});

/**
 * `ghosts::account::State`: where an `Account` stands. A search names its `queue`: a `Matchmaker`,
 * or the `Lobbies`; a ranked one holds the `commitment` to its squad.
 */
export const AccountStateBcs = bcs.enum("State", {
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
 * `ghosts::account::Account`. Recruits, gear and dog tags are objects it owns, not
 * fields: `recruits` only counts the ones at home.
 */
export const AccountBcs = bcs.struct("Account", {
    id: bcs.Address,
    owner: bcs.Address,
    state: AccountStateBcs,
    recruits: bcs.u64(),
    rating: bcs.struct("Rating", {
        rating: bcs.u64(),
        deviation: bcs.u64(),
        games: bcs.u64(),
        lastPlayedMs: bcs.u64(),
    }),
    /** Ranked games only. */
    score: bcs.struct("Score", { wins: bcs.u64(), losses: bcs.u64(), draws: bcs.u64() }),
    /** Until when the account cannot start a game; 0 if never suspended. */
    suspendedUntil: bcs.u64(),
    /** How many times the rating was reset, and when it last was (0: never). */
    resets: bcs.u16(),
    lastResetMs: bcs.u64(),
});

/** `sui::dynamic_field::Field<address, ID>`: one `Registry.accounts` record. */
export const AccountRecord = bcs.struct("Field", {
    id: bcs.Address,
    name: bcs.Address,
    value: bcs.Address,
});

/** `Registry`, as far as its accounts table: later fields are not read. */
export const RegistryHead = bcs.struct("Registry", { id: bcs.Address, accounts: Table });

// === Ranked ===

/** `ghosts::rules::Item`: the price of an item and the lowest tier it is unlocked at. */
export const RankedItemBcs = bcs.struct("Item", { price: bcs.u16(), minTier: bcs.u8() });

/** `ghosts::rules::Tier`: the lowest rating of a tier and its budget per size, in `sizes` order. */
export const RankedTierBcs = bcs.struct("Tier", {
    minRating: bcs.u64(),
    budgets: bcs.vector(bcs.u16()),
});

/** `ghosts::rules::Size`: units a side, its `Matchmaker<Ranked>` and its level (none: closed). */
export const RankedSizeBcs = bcs.struct("Size", {
    units: bcs.u8(),
    queue: bcs.Address,
    level: bcs.option(bcs.Address),
});

/**
 * `ghosts::rules::Rules`, shared: index `i` of `weapons` and `armor` is the item of tier `i + 1`,
 * of `utilities` the utility of kind `i`; a tier is its index in `tiers`.
 */
export const RulesBcs = bcs.struct("Rules", {
    id: bcs.Address,
    version: bcs.u32(),
    weapons: bcs.vector(RankedItemBcs),
    armor: bcs.vector(RankedItemBcs),
    utilities: bcs.vector(RankedItemBcs),
    tiers: bcs.vector(RankedTierBcs),
    sizes: bcs.vector(RankedSizeBcs),
    placementGames: bcs.u8(),
    placementTier: bcs.u8(),
    revealLimitMs: bcs.u64(),
    resetCooldownMs: bcs.u64(),
});

/** `matchmaker::matchmaker::Config`. */
export const MatchmakerConfigBcs = bcs.struct("Config", {
    bucketSize: bcs.u64(),
    bucketCapacity: bcs.u64(),
    windowStep: bcs.u64(),
    windowStepMs: bcs.u64(),
    maxWindow: bcs.u64(),
    ticketTtlMs: bcs.u64(),
});

/** `matchmaker::matchmaker::Matchmaker<T>`: tickets are dynamic fields, `size` counts them. */
export const MatchmakerBcs = bcs.struct("Matchmaker", {
    id: bcs.Address,
    config: MatchmakerConfigBcs,
    occupied: bcs.u256(),
    players: Table,
    size: bcs.u64(),
});

/** `matchmaker::matchmaker::Ticket`, a bucket holds a vector of them. */
export const TicketBcs = bcs.struct("Ticket", {
    id: bcs.Address,
    player: bcs.Address,
    rating: bcs.u64(),
    window: bcs.u64(),
    sinceMs: bcs.u64(),
});

/** `matchmaker::matchmaker::Match`: the order of the player who waited, and both players. */
export const MatchBcs = bcs.struct("Match", { id: bcs.Address, players: bcs.vector(bcs.Address) });

/** `ghosts::ghosts::GameStarted`: emitted once by the call that creates a game. */
export const GameStartedBcs = bcs.struct("GameStarted", {
    game: bcs.Address,
    players: bcs.vector(bcs.Address),
    mode: ModeBcs,
    listed: bcs.bool(),
});

/** `ghosts::ghosts::GameEnded`: emitted once, by `complete_game`. */
export const GameEndedBcs = bcs.struct("GameEnded", { game: bcs.Address, ending: EndingBcs });

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

/** What `gridSize` and `decodeTiles` read: a decoded `Map`, or a preset without its index. */
type DecodedMap = ReturnType<typeof MapPresetBcs.parse>;
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

/** `effect::kind`: the tag in the high nibble of an `Effect`, in the order Move numbers them. */
export const EFFECT_KINDS: readonly EffectKind[] = ["daze", "smoke"];

/** An `Effect` byte (`kind << 4 | turns`) as the plain view. */
export function decodeEffect(byte: number): UnitEffect {
    return { kind: EFFECT_KINDS[byte >> 4], turns: byte & 0x0f };
}

/** The inverse of `decodeEffect`: the byte `effect::new(kind, turns)` makes. */
export function encodeEffect({ kind, turns }: UnitEffect): number {
    return (EFFECT_KINDS.indexOf(kind) << 4) | turns;
}

/** `ActionKind`, as the plain view: the variant name in snake case. */
const ACTION_NAMES: Record<string, UnitAction> = {
    Move: "move",
    Attack: "attack",
    Reload: "reload",
    Grenade: "grenade",
    Flashbang: "flashbang",
    SmokeGrenade: "smoke_grenade",
};

type DecodedEnding = ReturnType<typeof EndingBcs.parse>;

/** `Ending`, as the plain view. */
export function decodeEnding(ending: DecodedEnding): Ending {
    switch (ending.$kind) {
        case "Won":
            return { kind: "won", by: ending.Won };
        case "Abandoned":
            return { kind: "abandoned", by: ending.Abandoned };
        case "Forfeited":
            return { kind: "forfeited", by: ending.Forfeited };
        case "NoShow":
            return { kind: "no_show", by: ending.NoShow };
        case "Stalemate":
            return { kind: "stalemate", by: null };
        case "NobodyShowed":
            return { kind: "nobody_showed", by: null };
        default:
            return { kind: "draw", by: null };
    }
}

/**
 * `winner` from `ghosts::ghosts`: the side with someone left, or whoever did not
 * abandon, forfeit or miss the game. None for a draw.
 */
export function winnerOf(ending: Ending, players: string[]): string | null {
    switch (ending.kind) {
        case "won":
            return ending.by;
        case "abandoned":
        case "forfeited":
        case "no_show":
            return players.find((player) => player !== ending.by) ?? null;
        default:
            return null;
    }
}

/** `Mode`, as the plain view. */
export function decodeMode(mode: ReturnType<typeof ModeBcs.parse>): GameMode {
    if (mode.$kind === "Friendly") return { kind: "friendly", size: mode.Friendly.size };
    if (mode.$kind === "Ranked") {
        return { kind: "ranked", size: mode.Ranked.size, tier: mode.Ranked.tier };
    }
    return { kind: "stakes" };
}

/** The inverse of `decodeMode`, for `ModeBcs.serialize`. */
export function encodeMode(mode: GameMode): Parameters<typeof ModeBcs.serialize>[0] {
    if (mode.kind === "friendly") return { Friendly: { size: mode.size } };
    if (mode.kind === "ranked") return { Ranked: { size: mode.size, tier: mode.tier } };
    return { Stakes: null };
}

/** The live `Rules`, as the plain view. */
export function decodeRules(bytes: Uint8Array): RankedRules {
    const rules = RulesBcs.parse(bytes);
    return {
        id: rules.id,
        version: rules.version,
        weapons: rules.weapons,
        armor: rules.armor,
        utilities: rules.utilities,
        tiers: rules.tiers.map((tier) => ({
            minRating: Number(tier.minRating),
            budgets: tier.budgets,
        })),
        sizes: rules.sizes.map((size) => ({
            units: size.units,
            queue: size.queue,
            level: size.level ?? null,
        })),
        placementGames: rules.placementGames,
        placementTier: rules.placementTier,
        revealLimitMs: Number(rules.revealLimitMs),
        resetCooldownMs: Number(rules.resetCooldownMs),
    };
}

/** A `Matchmaker`'s shared object: its config and how many tickets wait, expired ones included. */
export function decodeMatchmaker(bytes: Uint8Array): QueueView {
    const mm = MatchmakerBcs.parse(bytes);
    return {
        id: mm.id,
        waiting: Number(mm.size),
        ticketTtlMs: Number(mm.config.ticketTtlMs),
        bucketSize: Number(mm.config.bucketSize),
        maxWindow: Number(mm.config.maxWindow),
    };
}

/** `GameStarted`, as the plain view. */
export function decodeGameStarted(bytes: Uint8Array): GameStartedEvent {
    const event = GameStartedBcs.parse(bytes);
    return {
        game: event.game,
        players: event.players,
        mode: decodeMode(event.mode),
        listed: event.listed,
    };
}

/** `GameEnded`, as the plain view. */
export function decodeGameEnded(bytes: Uint8Array): GameEndedEvent {
    const event = GameEndedBcs.parse(bytes);
    return { game: event.game, ending: decodeEnding(event.ending) };
}

function decodeStatus(game: DecodedGame): GameStatus {
    const { state } = game;
    if (state.$kind === "Deploying") return { kind: "deploying" };
    if (state.$kind === "Playing") return { kind: "active" };
    const ending = decodeEnding(state.Over);
    return { kind: "finished", winner: winnerOf(ending, game.players), ending };
}

/** Decode a `Game` object's content into the plain state. */
export function decodeGame(bytes: Uint8Array, version: string): GameState {
    const game = GameBcs.parse(bytes);
    const { state } = game;
    const status = decodeStatus(game);
    // whose a unit is: its `owner` is an `Account` ID, and `players` are in turn order
    const sideOf = (owner: string) => game.players.indexOf(owner);

    const units: Unit[] = [];
    game.map.grid.grid.forEach((row, x) =>
        row.forEach(({ unit }, y) => {
            if (!unit) return;
            units.push({
                recruit: unit.recruit,
                owner: unit.owner,
                side: sideOf(unit.owner),
                x,
                y,
                ap: unit.ap.value,
                apMax: unit.ap.maxValue,
                hp: unit.hp.value,
                hpMax: unit.hp.maxValue,
                ammo: unit.ammo.value,
                ammoMax: unit.ammo.maxValue,
                stats: decodeStats(unit.stats),
                actions: unit.actions.map(({ kind, uses }) => ({
                    kind: ACTION_NAMES[kind.$kind],
                    uses,
                })),
                effects: unit.effects.map(decodeEffect),
            });
        }),
    );

    // `squad`: a side's recruits are its units on the map, the fallen aside
    const squads = game.players.map(() => [] as string[]);
    for (const unit of units) squads[unit.side]?.push(unit.recruit);

    const blamed =
        status.kind === "finished" &&
        ["abandoned", "forfeited", "no_show"].includes(status.ending.kind)
            ? status.ending.by
            : null;

    return {
        id: game.id,
        version,
        ...gridSize(game.map),
        turn: game.turn,
        active: game.turn % game.players.length,
        players: game.players,
        squads,
        fallen: game.map.fallen.map((unit) => unit.recruit),
        positions: game.positions,
        history: game.history.map(decodeRecord),
        missed: state.$kind === "Playing" ? state.Playing.missed : game.players.map(() => 0),
        abandonedBy: blamed,
        deadlineMs:
            state.$kind === "Deploying"
                ? Number(state.Deploying.untilMs)
                : state.$kind === "Playing"
                  ? Number(state.Playing.startedMs) + turnLimitMs(game.turn)
                  : 0,
        status,
        mode: decodeMode(game.mode),
        tiles: decodeTiles(game.map),
        units,
    };
}

export function decodeSearch(state: ReturnType<typeof AccountStateBcs.parse>): Search {
    switch (state.$kind) {
        case "Searching":
            return {
                kind: "searching",
                order: state.Searching.order,
                sinceMs: Number(state.Searching.sinceMs),
                queue: state.Searching.queue,
                commitment: state.Searching.commitment ?? null,
            };
        case "Playing":
            return { kind: "playing", game: state.Playing };
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
        ratedGames: Number(account.rating.games),
        lastPlayedMs: Number(account.rating.lastPlayedMs),
        recruits: Number(account.recruits),
        search: decodeSearch(account.state),
        suspendedUntilMs: Number(account.suspendedUntil),
        resets: account.resets,
        lastResetMs: Number(account.lastResetMs),
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
            return {
                kind: "kia",
                recruit: record.UnitKIA[0],
                x: record.UnitKIA[1],
                y: record.UnitKIA[2],
            };
        case "Flashbang":
            return {
                kind: "flashbang",
                from: record.Flashbang.origin,
                to: record.Flashbang.target,
            };
        case "SmokeGrenade":
            return {
                kind: "smoke_grenade",
                from: record.SmokeGrenade.origin,
                to: record.SmokeGrenade.target,
            };
        case "EffectStart": {
            const { kind, turns } = decodeEffect(record.EffectStart[2]);
            return {
                kind: "effect_start",
                x: record.EffectStart[0],
                y: record.EffectStart[1],
                effect: kind,
                turns,
            };
        }
        case "EffectEnd":
            return {
                kind: "effect_end",
                x: record.EffectEnd[0],
                y: record.EffectEnd[1],
                effect: EFFECT_KINDS[record.EffectEnd[2]],
            };
        default:
            return { kind: "dodged" };
    }
}
