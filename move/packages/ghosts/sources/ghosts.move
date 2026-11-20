// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// The frontend module for the game: the map presets, matchmaking, lobbies and
/// the `Game`.
///
/// A game is played for what its `Mode` says. Ranked: matched in a queue of the
/// size, `Matchmaker<Ranked>`, within the tier of the rating, with squads built
/// for the game from a loadout priced by the `Rules`, no recruit in it; it moves
/// both ratings and goes on both scores. For stakes: matched in the queue of
/// `Matchmaker<Ghosts>`, with the players' own recruits, who earn experience
/// coming home and are gone for good falling; unrated. Friendly: from a lobby,
/// see `ghosts::lobby`, with the players' own recruits, for nothing at all.
///
/// Players find each other in a queue, and whoever finds a match starts the
/// `Game` in the same call and is in it right away. The `Account` of the player
/// who waited can't be in that call, as nobody knows it beforehand, so they are
/// sent a `Seat` in the game instead, to their `Account`, which is on its search
/// until the seat is taken: before anything else. A seat for stakes anyone can
/// take with `accept_seat`. A ranked seat comes with a squad to reveal: the one
/// the waiting player committed to when they queued, so that nobody could build
/// against it, which the owner reveals with `reveal_squad`; whoever finds them
/// shows theirs in the clear and is on the map at once. A search the queue drops,
/// after `TICKET_TTL_MS` or from a full bucket, is sent a `Seat` in no game: a
/// notice, which `dismiss_seat` clears. No search is ever left on a ticket that
/// is gone. Who moves first, and so from which side, is drawn for every game.
///
/// A player is their `Account` ID throughout; every call takes the `Account`, and
/// all but taking a seat for someone check the sender controls it. Turns last
/// `TURN_LIMIT_MS`, the first one `FIRST_TURN_MS` as the scene is still loading,
/// and first both get `DEPLOY_LIMIT_MS` to pick their squads, or the ranked
/// waiter the reveal limit of the `Rules` to reveal theirs, then they take turns.
/// A player who runs out of time cannot act anymore, and any player can move the
/// game on.
///
/// The goal is to eliminate the other side. The proof is the `Game` itself: a
/// unit only leaves a squad by falling, which the `Map` decides, and a fallen
/// recruit's `DogTag` is sent to their `Account` there and then. A side with
/// nobody on the map after deployment has lost. `complete_game` then sends
/// everyone home and deletes the `Game`, and is anyone's to call.
///
/// Every state has a way out, and in a game from a queue whoever made it
/// necessary pays for it with `SUSPENSION_MS` without playing: not deploying or
/// revealing, abandoning the game, or missing `MAX_MISSED_TURNS` turns in a row.
/// A game that goes nowhere ends in a draw at `MAX_TURNS`, without blame.
///
/// Two events are emitted, for whoever follows games without a player in them:
/// `GameStarted` as a game is created, and `GameEnded` as it is wrapped up.
module ghosts::ghosts;

use ghosts::{
    account::Account,
    history::{Self, History, Record},
    lobby::{Self, Lobbies},
    map::{Self, Map},
    recruit::Recruit,
    rules::{Self, Rules, RulesCap},
    unit
};
use matchmaker::matchmaker::{Self, Matchmaker};
use std::string::String;
use sui::{
    address,
    clock::Clock,
    event,
    hash,
    random::{Random, RandomGenerator},
    table::{Self, Table},
    transfer::Receiving
};

const ENotPlayer: u64 = 1;
const ENoPositions: u64 = 4;
const EAlreadySearching: u64 = 6;
const ENotSearching: u64 = 7;
const ESearchNotTimedOut: u64 = 8;
/// The `Account` is suspended for misbehaving.
const ESuspended: u64 = 9;
/// The game is over: no more turns or actions.
const EGameOver: u64 = 10;
/// It is another player's turn.
const ENotYourTurn: u64 = 11;
/// The turn ran out of time: no more actions, only `next_turn`.
const ETurnExpired: u64 = 12;
/// The other player's turn is still running.
const ETurnNotExpired: u64 = 13;
/// The tile holds no unit of the player.
const ENotYourUnit: u64 = 14;
/// The time to deploy is over.
const EDeploymentOver: u64 = 15;
/// The players are still picking their squads.
const EStillDeploying: u64 = 16;
/// This side picked its squad already.
const EAlreadyDeployed: u64 = 21;
/// The game is still running.
const EGameNotOver: u64 = 17;
/// The `Account` has no recruits to play with.
const ENoSquad: u64 = 22;
/// The search is not in this queue: a match found it, and its `Seat` waits on the
/// `Account`, to take first; or the queue dropped it, and its notice waits, to
/// dismiss; or it is in another queue, or in a lobby, to leave or close instead.
const ESeatWaiting: u64 = 25;
/// The `Account` has yet to accept its `Seat` in the game.
const ESeatNotAccepted: u64 = 27;
/// More recruits than the size of the friendly game.
const ESquadTooLarge: u64 = 28;
/// The `Seat` is not for this: a notice, which has no game, or a seat in
/// another game, or a seat in a game where a notice was expected.
const EWrongSeat: u64 = 29;
/// The call is not for a game of this mode.
const EWrongMode: u64 = 30;
/// The squad and salt revealed are not what the search committed to.
const ERevealMismatch: u64 = 31;
/// A ranked search found nobody, so its squad would wait in the clear: queue
/// with the commitment alone, and show the squad only to a waiting player.
const ESquadShown: u64 = 32;
/// The seat is in a ranked game: it is taken with `reveal_squad`, or, without a
/// squad, with `take_seat`.
const ERevealFirst: u64 = 33;
/// The preset is not the level of the size.
const EWrongLevel: u64 = 34;
/// The level has no room for the size, or a spawn position no unit can stand on.
const EBadLevel: u64 = 35;

/// How long a search waits before anyone can cancel it.
const SEARCH_TIMEOUT_MS: u64 = 120_000;
/// How long a ticket stays in the queue: an older one is dropped, and its player
/// sent a notice, when its bucket is next visited.
const TICKET_TTL_MS: u64 = 300_000;
/// No bucket capacity: the queue never evicts a search for room.
const NO_LIMIT: u64 = 18_446_744_073_709_551_615;
/// What a ranked ticket's rating is raised by for each tier: more than twice the
/// largest window, so that tickets of different tiers are never compatible.
const TIER_GAP: u64 = 5_000;
/// How long the players have to pick their squads once matched.
const DEPLOY_LIMIT_MS: u64 = 120_000;
/// How long a player has for their turn.
const TURN_LIMIT_MS: u64 = 90_000;
/// How long the first turn lasts: longer, as the models and the scene are still
/// loading when it starts.
const FIRST_TURN_MS: u64 = 120_000;
/// How long a player cannot search for a game after misbehaving. Kept short while
/// the game is in testing.
const SUSPENSION_MS: u64 = 60_000;
/// How many turns in a row a player can miss before the game counts as abandoned.
const MAX_MISSED_TURNS: u8 = 3;
/// How long a game can go on before it ends in a draw: 30 rounds.
const MAX_TURNS: u16 = 60;

/// What a recruit earns, in experience, for coming home.
const SURVIVAL_XP: u16 = 1;
/// What a recruit earns, in experience, for coming home from a win. A win handed
/// over by an opponent who left earns no more than a loss, so that two accounts have
/// nothing to farm from each other.
const WIN_XP: u16 = 1;
/// A game left before this many turns earns nobody anything.
const MIN_TURNS_TO_EARN: u16 = 2;

/// Identifies the queue of games for stakes, `Matchmaker<Ghosts>`.
public struct Ghosts()

/// Identifies the ranked queues, one `Matchmaker<Ranked>` for each size of the
/// `Rules`.
public struct Ranked()

/// A map games are played on: Black Rain, created on publish, and those the
/// holder of the `RulesCap` adds. Frozen, so that games starting at the same time
/// never wait on each other.
public struct Preset has key {
    id: UID,
    /// The map copied when a game starts from this preset.
    map: Map,
    /// The name of the preset, purely for display purposes.
    name: String,
    /// Stores the spawn positions of recruits, which is what sets the size of a
    /// squad on this map. The first half goes to the first player, the second
    /// half to the second.
    positions: vector<vector<u8>>,
}

/// A place in a game, sent to the `Account` of the player a match found waiting.
/// It exists from the match until it is taken, which puts the `Account` into the
/// game: the first thing either player does about the match. A seat in no game is
/// a notice that the queue dropped the search, until `dismiss_seat`.
public struct Seat has key {
    id: UID,
    /// The game the seat is in; none for a notice.
    game: Option<ID>,
}

/// A game between `Account`s, shared between them.
public struct Game has key {
    id: UID,
    map: Map,
    /// `Account` IDs of the players, in turn order. An index is a player's side.
    players: vector<ID>,
    /// Where the game stands.
    state: State,
    /// How many turns have passed since the deployment ended.
    turn: u16,
    /// The spawn positions each side has left, used from the back.
    positions: vector<vector<vector<u8>>>,
    /// History of the game.
    history: History,
    /// The recruits on the map, for the duration of the game; whose each one is,
    /// its unit says. The fallen are taken out and killed by `bury_fallen`, or in a
    /// friendly game sent home by `raise_fallen`.
    recruits: Table<ID, Recruit>,
    /// What the game is played for.
    mode: Mode,
}

/// What a game is played for. Only how the squads get on the map and what
/// completing the game settles differ by mode: the turns are the same.
public enum Mode has copy, drop, store {
    /// Matched in the queue for stakes, with the players' own recruits: those who
    /// come home earn experience, and the fallen are gone for good. Unrated.
    Stakes,
    /// Started from a lobby, for nothing: no rating, score, experience or
    /// suspension comes out of it, and the fallen get up and go home with the
    /// survivors. Each side deploys up to `size` recruits.
    Friendly { size: u8 },
    /// Matched in the ranked queue of `size`, between players of `tier`, each
    /// with a squad of `size` units built from a loadout (see `rules`), none of
    /// them a recruit: it moves both ratings and goes on both scores.
    Ranked { size: u8, tier: u8 },
}

/// A game was created: emitted once, by the call that creates it. Listed unless
/// it is played from an invite-only lobby.
public struct GameStarted has copy, drop {
    game: ID,
    players: vector<ID>,
    mode: Mode,
    listed: bool,
}

/// A game was wrapped up and deleted, how it ended, and when: `ended_ms` is the
/// time it was wrapped up. The only place the ending is kept once the `Game` is
/// gone.
public struct GameEnded has copy, drop {
    game: ID,
    ending: Ending,
    ended_ms: u64,
}

/// Where a game stands. It only moves forward: `Deploying`, `Playing`, `Over`.
public enum State has copy, drop, store {
    /// The players pick their squads, or in a ranked game the waiter reveals
    /// theirs, until `until_ms`.
    Deploying { until_ms: u64 },
    /// The sides take turns. The current one started at `started_ms`; `missed` is
    /// how many turns in a row each side let run out.
    Playing { started_ms: u64, missed: vector<u8> },
    /// The game is over, the way `Ending` says, until `complete_game` wraps it up.
    Over(Ending),
}

/// How a game ended. A player in it is their `Account` ID.
public enum Ending has copy, drop, store {
    /// The other side has nobody left on the map.
    Won(ID),
    /// Both sides went down at once.
    Draw,
    /// `MAX_TURNS` passed without an end: a draw, without blame.
    Stalemate,
    /// The player walked out of the game.
    Abandoned(ID),
    /// The player let `MAX_MISSED_TURNS` turns in a row run out.
    Forfeited(ID),
    /// The deployment ended with the player having picked nobody, or, in a
    /// ranked game, revealed nothing.
    NoShow(ID),
    /// The deployment ended with neither player having picked anyone.
    NobodyShowed,
}

// === Stakes ===

/// Search for an opponent for stakes with the rating stored in the `Account`,
/// accepting those within its current deviation. When a compatible player is
/// waiting, the game starts on the preset right away: the `Account` is `Playing`
/// it, and the player who waited is sent a `Seat` in it. Who goes first is drawn.
/// Otherwise the `Account` is `Searching` until a match answers it, the queue
/// drops it, or `cancel_search` clears it. A suspended `Account` cannot search,
/// nor one without recruits.
entry fun find_game(
    mm: &mut Matchmaker<Ghosts>,
    acc: &mut Account,
    preset: &Preset,
    rng: &Random,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    check_free_with_recruits(acc, now, ctx);

    let rating = acc.rating();
    let window = rating.current_deviation(now);
    let mut rng = rng.new_generator(ctx);
    let permit = internal::permit<Ghosts>();
    let found = search(
        permit,
        mm,
        acc,
        rating.rating(),
        window,
        option::none(),
        &mut rng,
        clock,
        ctx,
    );
    if (found.is_none()) return;

    let waiting = found.destroy_some();
    let players = in_order(rng.generate_bool(), object::id(acc), waiting);
    let game = new_game(preset, players, Mode::Stakes, now + DEPLOY_LIMIT_MS, true, ctx);
    game.send_seat(waiting, acc, ctx);
}

/// Accept the `Seat` a match sent to an `Account`: it is `Playing` the game from
/// now on, and can act in it, or leave it with `abandon_game`. Anyone can do this:
/// the player, as soon as they see the seat, or the other player when they don't,
/// who then gets back the storage the seat took and can wrap up the game. Not a
/// ranked seat: see `reveal_squad` and `take_seat`.
public fun accept_seat(acc: &mut Account, seat: Receiving<Seat>) {
    let game = receive_seat(acc, seat).destroy_or!(abort EWrongSeat);
    assert!(acc.search_order().is_some(), ENotSearching);
    assert!(acc.commitment().is_none(), ERevealFirst);
    acc.set_playing(game);
}

/// Leave the queue for stakes. The owner can do this at any time, anyone else once
/// the search has run past `SEARCH_TIMEOUT_MS`. A search no longer in the queue
/// was found by a match, whose `Seat` comes first, or dropped by it, whose notice
/// `dismiss_seat` clears. A search in a lobby is not in the queue either:
/// `leave_lobby` or `close_lobby` ends it.
public fun cancel_search(
    mm: &mut Matchmaker<Ghosts>,
    acc: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    cancel(internal::permit<Ghosts>(), mm, acc, clock, ctx)
}

// === Ranked ===

/// Search for a ranked game in the queue of a size, which the `Rules` name, on the
/// level of the size: with the rating stored in the `Account`, accepting those
/// within its current deviation, and only players of the same tier (see
/// `rules::tier_of`), who build to the same budget.
///
/// The search waits with the `commitment` to its squad alone: the blake2b256
/// hash of the squad's bytes followed by a salt, which the client keeps for
/// `reveal_squad`. A search that finds a waiting player starts the game right
/// away: its `squad`, in the clear, is held to the `Rules` and put on the map,
/// the `Account` is `Playing` the game, and the waiting player is sent a `Seat`
/// in it, to reveal theirs within the reveal limit. Who goes first, and so from
/// which side, is drawn. The squad is shown only to a waiting player: a search
/// that finds nobody with one aborts, and one that finds somebody without one
/// aborts with `rules::ESquadSize`, to send again with it.
///
/// Aborts, in order: the checks of `find_game` but the recruits;
/// `rules::EWrongQueue`, `rules::ENoLevel`, `EWrongLevel`; on a match, the checks
/// of `rules::check_squad`; on none, `ESquadShown`.
entry fun find_ranked(
    mm: &mut Matchmaker<Ranked>,
    acc: &mut Account,
    rules: &Rules,
    preset: &Preset,
    rng: &Random,
    clock: &Clock,
    squad: vector<u8>,
    commitment: address,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    check_free(acc, now, ctx);
    let size = rules.size_of(object::id(mm));
    assert!(rules.level_of(size) == object::id(preset), EWrongLevel);

    // the tier raises the rating far enough that no other tier is in reach
    let rating = acc.rating();
    let tier = rules.tier_of(rating.rating(), acc.games_played());
    let queued = rating.rating() + (tier as u64) * TIER_GAP;
    let window = rating.current_deviation(now);
    let mut rng = rng.new_generator(ctx);
    let permit = internal::permit<Ranked>();
    let found = search(
        permit,
        mm,
        acc,
        queued,
        window,
        option::some(commitment),
        &mut rng,
        clock,
        ctx,
    );
    if (found.is_none()) {
        assert!(squad.is_empty(), ESquadShown);
        return
    };

    rules.check_squad(size, tier, &squad);
    let until_ms = now + rules.reveal_limit_ms();
    let mode = Mode::Ranked { size, tier };
    start_ranked(
        preset,
        found.destroy_some(),
        acc,
        mode,
        squad,
        rng.generate_bool(),
        until_ms,
        ctx,
    );
}

/// Reveal the squad a ranked search committed to and take the `Seat` the match
/// sent: the squad and the salt are what the commitment hashes, the squad holds
/// to the `Rules` at the tier of the game, and it goes on the map. The `Account`
/// is `Playing` the game, which begins. Only the owner can, before the reveal
/// limit; past it, or with no squad to reveal, the seat is taken with `take_seat`,
/// and the game is a no-show.
///
/// Aborts, in order: `account::ENotOwner`, `EWrongSeat`, `ENotSearching`,
/// `EWrongMode`, `EDeploymentOver` or `EGameOver`, `ERevealMismatch`, and the
/// checks of `rules::check_squad`.
public fun reveal_squad(
    game: &mut Game,
    acc: &mut Account,
    rules: &Rules,
    seat: Receiving<Seat>,
    clock: &Clock,
    squad: vector<u8>,
    salt: vector<u8>,
    ctx: &mut TxContext,
) {
    acc.authorize(ctx);
    let id = object::id(game);
    assert!(receive_seat(acc, seat) == option::some(id), EWrongSeat);
    let commitment = acc.commitment().destroy_or!(abort ENotSearching);
    let (size, tier) = match (game.mode) {
        Mode::Ranked { size, tier } => (size, tier),
        _ => abort EWrongMode,
    };
    let now = clock.timestamp_ms();
    game.check_deploying(now);

    let mut preimage = squad;
    preimage.append(salt);
    assert!(address::from_bytes(hash::blake2b256(&preimage)) == commitment, ERevealMismatch);
    rules.check_squad(size, tier, &squad);

    let (_, side) = game.players.index_of(&object::id(acc));
    acc.set_playing(id);
    game.place_squad(side, &squad, ctx);
    game.begin_match(now, true, true);
}

/// Take the `Seat` of a ranked game without revealing a squad: the `Account` is
/// `Playing` the game, with nobody on the map. The owner can do this at any time,
/// giving up on the reveal; anyone else once the game no longer waits for it, to
/// wrap the game up.
public fun take_seat(
    game: &Game,
    acc: &mut Account,
    seat: Receiving<Seat>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let id = object::id(game);
    assert!(receive_seat(acc, seat) == option::some(id), EWrongSeat);
    assert!(acc.search_order().is_some(), ENotSearching);
    if (ctx.sender() != acc.owner()) {
        let waiting = match (&game.state) {
            State::Deploying { until_ms } => clock.timestamp_ms() <= *until_ms,
            _ => false,
        };
        assert!(!waiting, EStillDeploying);
    };
    acc.set_playing(id);
}

/// Leave the ranked queue, as `cancel_search` leaves the queue for stakes.
public fun cancel_ranked(
    mm: &mut Matchmaker<Ranked>,
    acc: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    cancel(internal::permit<Ranked>(), mm, acc, clock, ctx)
}

// === Queues ===

/// Clear the search of an `Account` the queue dropped, with the notice it sent:
/// the `Account` is idle again. Anyone can do this.
public fun dismiss_seat(acc: &mut Account, seat: Receiving<Seat>) {
    assert!(receive_seat(acc, seat).is_none(), EWrongSeat);
    assert!(acc.search_order().is_some(), ENotSearching);
    acc.clear_search();
}

/// Search the queue `mm` for the `Account`, at `rating` within `window`. Returns
/// the player found waiting, if any; otherwise the `Account` is `Searching` the
/// queue, holding `commitment`. Either way every player the queue dropped is sent
/// a notice.
fun search<T>(
    permit: internal::Permit<T>,
    mm: &mut Matchmaker<T>,
    acc: &mut Account,
    rating: u64,
    window: u64,
    commitment: Option<address>,
    rng: &mut RandomGenerator,
    clock: &Clock,
    ctx: &mut TxContext,
): Option<ID> {
    let player = object::id(acc);
    let (order, found, dropped) = matchmaker::find_game(
        permit,
        mm,
        player,
        rng,
        clock,
        rating,
        window,
        ctx,
    );
    dropped.do!(|player| {
        let notice = Seat { id: object::new(ctx), game: option::none() };
        transfer::transfer(notice, player.to_address());
    });

    if (found.is_some()) return found.map!(|m| m.players()[0]);
    acc.start_search(order, clock.timestamp_ms(), object::id(mm), commitment);
    option::none()
}

/// Take the `Account`'s ticket out of the queue `mm`: by the owner at any time,
/// by anyone once the search has run past `SEARCH_TIMEOUT_MS`.
fun cancel<T>(
    permit: internal::Permit<T>,
    mm: &mut Matchmaker<T>,
    acc: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(acc.search_order().is_some(), ENotSearching);

    let id = object::id(acc);
    if (ctx.sender() != acc.owner()) {
        let now = clock.timestamp_ms();
        assert!(acc.search_timed_out(now, SEARCH_TIMEOUT_MS), ESearchNotTimedOut);
    };
    assert!(mm.is_queued(id), ESeatWaiting);

    matchmaker::remove_ticket(permit, mm, id);
    acc.clear_search();
}

/// Take the `Seat` sent to the `Account` and delete it. Returns its game.
fun receive_seat(acc: &mut Account, seat: Receiving<Seat>): Option<ID> {
    let Seat { id, game } = transfer::receive(acc.uid_mut(), seat);
    id.delete();
    game
}

/// The players `a` and `b` in the order they take turns, as drawn: `a` first if
/// `a_first`. Both orders are the same bytes, so that the gas of a call with
/// `Random` does not tell moving first from moving second.
fun in_order(a_first: bool, a: ID, b: ID): vector<ID> {
    if (a_first) vector[a, b] else vector[b, a]
}

/// A ranked game on the preset between the player who `waiting` was and the
/// `finder`, whose `squad` is on the map from the start; the first to move as
/// `finder_first` says. The waiter reveals until `until_ms`.
fun start_ranked(
    preset: &Preset,
    waiting: ID,
    finder: &mut Account,
    mode: Mode,
    squad: vector<u8>,
    finder_first: bool,
    until_ms: u64,
    ctx: &mut TxContext,
) {
    let players = in_order(finder_first, object::id(finder), waiting);
    let mut game = new_game(preset, players, mode, until_ms, true, ctx);
    game.place_squad(if (finder_first) 0 else 1, &squad, ctx);
    game.send_seat(waiting, finder, ctx);
}

/// Seat the players of a game from the queue and share it: the `finder` is
/// `Playing` it, and the player who was `waiting` is sent a `Seat` in it.
fun send_seat(game: Game, waiting: ID, finder: &mut Account, ctx: &mut TxContext) {
    let id = object::id(&game);
    transfer::transfer(Seat { id: object::new(ctx), game: option::some(id) }, waiting.to_address());
    finder.set_playing(id);
    transfer::share_object(game);
}

/// A game on the preset between the `players`, in turn order, still deploying
/// until `until_ms`, played for what `mode` says. It is announced, `listed` or not.
fun new_game(
    preset: &Preset,
    players: vector<ID>,
    mode: Mode,
    until_ms: u64,
    listed: bool,
    ctx: &mut TxContext,
): Game {
    let half = preset.positions.length() / 2;
    let mut positions = vector[vector[], vector[]];
    preset
        .positions
        .length()
        .do!(|i| positions[if (i < half) 0 else 1].push_back(preset.positions[i]));

    let game = Game {
        id: object::new(ctx),
        map: preset.map.clone(),
        players,
        state: State::Deploying { until_ms },
        turn: 0,
        positions,
        history: history::empty(),
        recruits: table::new(ctx),
        mode,
    };
    event::emit(GameStarted { game: object::id(&game), players, mode, listed });
    game
}

/// Check the sender controls the `Account`, free to play: neither searching nor in
/// a game, and past any suspension.
fun check_free(acc: &Account, now: u64, ctx: &mut TxContext) {
    acc.authorize(ctx);
    assert!(acc.is_idle(), EAlreadySearching);
    assert!(now >= acc.suspended_until(), ESuspended);
}

/// `check_free`, and with recruits to deploy.
fun check_free_with_recruits(acc: &Account, now: u64, ctx: &mut TxContext) {
    check_free(acc, now, ctx);
    assert!(acc.num_recruits() > 0, ENoSquad);
}

// === Friendly ===

/// Open a lobby for a friendly game of `size`, the most recruits each side
/// deploys: listed, for anyone to join with `join_open`, or with a `code_hash`,
/// the blake2b256 hash of the invite code, for whoever brings the code to
/// `join_lobby`. The `Account` is `Searching` in the lobby until it starts or
/// closes. It must be free to play, as for `find_game`.
public fun open_lobby(
    lobbies: &mut Lobbies,
    acc: &mut Account,
    clock: &Clock,
    size: u8,
    code_hash: Option<address>,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    check_free_with_recruits(acc, now, ctx);
    lobbies.open(acc, size, code_hash, now);
}

/// Join the invite-only lobby of `host` with its invite `code`: the friendly game
/// starts on the preset there and then, unlisted, who goes first drawn, and both
/// `Account`s are `Playing` it. The joining `Account` must be free to play.
entry fun join_lobby(
    lobbies: &mut Lobbies,
    preset: &Preset,
    host: &mut Account,
    acc: &mut Account,
    rng: &Random,
    clock: &Clock,
    code: vector<u8>,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    check_free_with_recruits(acc, now, ctx);
    let size = lobbies.join_protected(host, code, now);
    start_friendly_game(preset, host, acc, size, rng, false, now, ctx);
}

/// Take the guest slot of the listed lobby of `host`: the `Account` is `Searching`
/// in it until the host starts the game, or kicks it, or it leaves. It must be
/// free to play, and not kicked out of the lobby before.
public fun join_open(
    lobbies: &mut Lobbies,
    host: &Account,
    acc: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    check_free_with_recruits(acc, now, ctx);
    lobbies.join_open(host, acc, now);
}

/// Leave the guest slot of a listed lobby: the `Account` is idle again.
public fun leave_lobby(lobbies: &mut Lobbies, acc: &mut Account, ctx: &mut TxContext) {
    acc.authorize(ctx);
    lobbies.leave(acc);
}

/// Kick the guest out of the listed lobby of `host`, idle again: the host can do
/// this at any time, and the guest cannot come back; anyone else once the lobby's
/// lifetime is out, to close it, and the guest can.
public fun kick_guest(
    lobbies: &mut Lobbies,
    host: &Account,
    guest: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    lobbies.kick(host, guest, clock.timestamp_ms(), ctx);
}

/// Start the friendly game of a listed lobby with the guest in it, on the preset:
/// who goes first is drawn, and both `Account`s are `Playing` it. Only the host
/// can.
entry fun start_friendly(
    lobbies: &mut Lobbies,
    preset: &Preset,
    host: &mut Account,
    guest: &mut Account,
    rng: &Random,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    host.authorize(ctx);
    let now = clock.timestamp_ms();
    let size = lobbies.start(host, guest, now);
    start_friendly_game(preset, host, guest, size, rng, true, now, ctx);
}

/// Close the lobby the `Account` hosts, of either kind, with nobody in its guest
/// slot: the `Account` is idle again. The host can do this at any time, anyone
/// else once the lobby's lifetime is out; a guest waiting in it is kicked first,
/// with `kick_guest`, in the same transaction.
public fun close_lobby(
    lobbies: &mut Lobbies,
    host: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    lobbies.close(host, clock.timestamp_ms(), ctx);
}

/// A friendly game of `size` on the preset between the `host` and the `guest`,
/// still deploying, who goes first drawn; both are `Playing` it.
fun start_friendly_game(
    preset: &Preset,
    host: &mut Account,
    guest: &mut Account,
    size: u8,
    rng: &Random,
    listed: bool,
    now: u64,
    ctx: &mut TxContext,
) {
    let mut rng = rng.new_generator(ctx);
    let players = in_order(rng.generate_bool(), object::id(host), object::id(guest));
    let mode = Mode::Friendly { size };
    let game = new_game(preset, players, mode, now + DEPLOY_LIMIT_MS, listed, ctx);
    host.set_playing(object::id(&game));
    guest.set_playing(object::id(&game));
    transfer::share_object(game);
}

// === Ending the Game ===

/// Give up a running game: it is over for both players and the other one wins.
/// `complete_game` then sends everyone home, as after any other ending, and in a
/// game from a queue suspends the `Account` for `SUSPENSION_MS`.
public fun abandon_game(game: &mut Game, acc: &Account, ctx: &mut TxContext) {
    game.side(acc, ctx);
    assert!(!game.is_over(), EGameOver);

    game.state = State::Over(Ending::Abandoned(object::id(acc)));
}

/// Wrap up a game that is over and delete it. Anyone can call this, so neither
/// player can keep the other in: the `Account`s playing it are `Idle` again, and
/// in a game from a queue whoever abandoned the game, or never deployed or
/// revealed, is suspended for `SUSPENSION_MS`. A ranked game goes on both scores
/// and moves both ratings; a game for stakes sends the survivors home with the
/// experience they earned; a friendly one sends everyone home, the fallen too.
/// Both `Account`s must be in the game: a `Seat` not yet taken is taken first, by
/// whoever wraps up.
public fun complete_game(
    mut game: Game,
    first: &mut Account,
    second: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let ending = match (game.state) {
        State::Over(ending) => ending,
        _ => abort EGameNotOver,
    };
    assert!(
        object::id(first) == game.players[0] && object::id(second) == game.players[1],
        ENotPlayer,
    );
    let id = object::id(&game);
    assert!(
        first.playing() == option::some(id) && second.playing() == option::some(id),
        ESeatNotAccepted,
    );

    let now = clock.timestamp_ms();
    let winner = game.winner();
    let (ranked, friendly) = match (game.mode) {
        Mode::Ranked { .. } => (true, false),
        Mode::Friendly { .. } => (false, true),
        Mode::Stakes => (false, false),
    };

    // nobody showing up isn't a game: it goes on no score and moves no rating
    if (ranked && !game.nobody_showed()) {
        first.add_result(winner);
        second.add_result(winner);
        first.rate_game(second, winner, now);
    };

    // a ranked squad has no recruits to send home: its units go with the map
    if (friendly) game.raise_fallen(first, second) else game.bury_fallen(ctx);
    if (!ranked) {
        let (xp_first, xp_second) = (game.experience(0, winner), game.experience(1, winner));
        let (squad_first, squad_second) = game.squads();
        game.send_home(first, squad_first, xp_first);
        game.send_home(second, squad_second, xp_second);
    };
    game.release(first);
    game.release(second);
    if (!friendly && game.misbehaved(0)) first.suspend(now + SUSPENSION_MS);
    if (!friendly && game.misbehaved(1)) second.suspend(now + SUSPENSION_MS);

    event::emit(GameEnded { game: id, ending, ended_ms: now });
    let Game { id, map, recruits, .. } = game;
    map.destroy();
    recruits.destroy_empty();
    id.delete();
}

// === Game Actions ===

/// Pick the squad of a game for stakes or a friendly one: recruits received from
/// the `Account`, placed on the side's spawn positions, as many as the map has
/// for a side, and in a friendly game no more than its size. Once per side, in
/// any order, within `DEPLOY_LIMIT_MS` of the match. The first turn starts as
/// soon as both sides have deployed. A ranked squad is revealed instead, see
/// `reveal_squad`.
public fun deploy_squad(
    game: &mut Game,
    acc: &mut Account,
    clock: &Clock,
    recruits: vector<Receiving<Recruit>>,
    ctx: &mut TxContext,
) {
    let side = game.side(acc, ctx);
    let now = clock.timestamp_ms();

    game.check_deploying(now);
    assert!(game.squad(side).is_empty(), EAlreadyDeployed);
    assert!(!recruits.is_empty(), ENoPositions);
    assert!(recruits.length() <= game.positions[side].length(), ENoPositions);
    match (game.mode) {
        Mode::Friendly { size } => assert!(recruits.length() <= size as u64, ESquadTooLarge),
        Mode::Stakes => (),
        Mode::Ranked { .. } => abort EWrongMode,
    };

    recruits.do!(|recruit| {
        let recruit = acc.remove_recruit(recruit, ctx);
        let position = game.positions[side].pop_back();
        let record = game.map.place_recruit(&recruit, position[0] as u16, position[1] as u16);

        game.recruits.add(object::id(&recruit), recruit);
        game.history.add(record);
    });

    let (first, second) = game.squads();
    if (!first.is_empty() && !second.is_empty()) game.begin_match(now, true, true);
}

/// Move a unit along the path, the first point is the current position of the unit.
entry fun move_unit(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    path: vector<u8>,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, path[0] as u16, path[1] as u16, ctx);
    game.history.add(game.map.move_unit(path))
}

/// Perform a reload action, replenishing ammo.
entry fun perform_reload(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    x: u16,
    y: u16,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, x, y, ctx);
    game.history.add(game.map.perform_reload(x, y))
}

/// Perform a grenade throw action.
entry fun perform_grenade(
    game: &mut Game,
    acc: &Account,
    rng: &Random,
    clock: &Clock,
    x0: u16,
    y0: u16,
    x1: u16,
    y1: u16,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, x0, y0, ctx);

    let mut rng = rng.new_generator(ctx);
    let history = game.map.perform_grenade(&mut rng, x0, y0, x1, y1);

    game.count_losses(&history);
    game.history.append(history)
}

/// Throw a flashbang: every unit in the area is dazed. Nothing rolls.
entry fun perform_flashbang(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    x0: u16,
    y0: u16,
    x1: u16,
    y1: u16,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, x0, y0, ctx);
    game.history.append(game.map.perform_flashbang(x0, y0, x1, y1))
}

/// Throw a smoke grenade: every unit in the area is in smoke. Nothing rolls.
entry fun perform_smoke_grenade(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    x0: u16,
    y0: u16,
    x1: u16,
    y1: u16,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, x0, y0, ctx);
    game.history.append(game.map.perform_smoke_grenade(x0, y0, x1, y1))
}

/// Perform an attack action.
entry fun perform_attack(
    game: &mut Game,
    acc: &Account,
    rng: &Random,
    clock: &Clock,
    x0: u16,
    y0: u16,
    x1: u16,
    y1: u16,
    ctx: &mut TxContext,
) {
    game.begin_unit_action(acc, clock, x0, y0, ctx);

    let mut rng = rng.new_generator(ctx);
    let history = game.map.perform_attack(&mut rng, x0, y0, x1, y1);

    game.count_losses(&history);
    game.history.append(history)
}

/// Switch to the next turn: the current player at any time, the other one once
/// the turn is out of time, which goes against the player who let it run out:
/// `MAX_MISSED_TURNS` in a row abandon the game. Past the time to deploy, it also
/// ends the deployment of a side that did not make it: the first turn starts, or
/// the game is over. A new turn takes one turn off every effect on the map,
/// see `Map.next_turn`.
entry fun next_turn(game: &mut Game, acc: &Account, clock: &Clock, ctx: &mut TxContext) {
    let side = game.side(acc, ctx);
    let now = clock.timestamp_ms();
    let active = game.active_side();
    game.bury_fallen(ctx);

    let missed = match (&mut game.state) {
        State::Deploying { until_ms } => {
            assert!(now > *until_ms, EStillDeploying);
            let (first, second) = game.squads();
            return game.begin_match(now, !first.is_empty(), !second.is_empty())
        },
        State::Playing { started_ms, missed } => {
            if (side == active) {
                *&mut missed[active] = 0;
            } else {
                assert!(now - *started_ms > turn_limit(game.turn), ETurnNotExpired);
                *&mut missed[active] = missed[active] + 1;
            };
            *missed
        },
        State::Over(_) => abort EGameOver,
    };

    if (missed[active] == MAX_MISSED_TURNS) {
        game.state = State::Over(Ending::Forfeited(game.players[active]));
        return
    };

    game.turn = game.turn + 1;
    game.history.add(history::new_next_turn(game.turn));
    if (game.turn >= MAX_TURNS) {
        game.state = State::Over(Ending::Stalemate);
        return
    };

    game.state = State::Playing { started_ms: now, missed };
    let next = game.players[game.active_side()];
    let expired = game.map.next_turn(next);
    if (!expired.is_empty()) game.history.append(expired);
}

// === Getters ===

/// Get how many turns have passed since the deployment ended.
public fun turn(self: &Game): u16 { self.turn }

/// Get where the game stands.
public fun state(self: &Game): State { self.state }

/// Get what the game is played for.
public fun mode(self: &Game): Mode { self.mode }

/// Get the `Account` that won a game that is over: the side with someone left, or
/// whoever did not abandon, forfeit or miss the game. None for a draw, or while the
/// game is on.
public fun winner(self: &Game): Option<ID> {
    match (&self.state) {
        State::Over(Ending::Won(winner)) => option::some(*winner),
        State::Over(Ending::Abandoned(by)) |
        State::Over(Ending::Forfeited(by)) |
        State::Over(Ending::NoShow(by)) => option::some(self.other(*by)),
        _ => option::none(),
    }
}

// === Internal ===

/// The side of the `Account` in the game, after checking the sender controls it.
fun side(game: &Game, acc: &Account, ctx: &mut TxContext): u64 {
    acc.authorize(ctx);
    let (found, side) = game.players.index_of(&object::id(acc));
    assert!(found, ENotPlayer);
    assert!(acc.playing() == option::some(object::id(game)), ESeatNotAccepted);
    side
}

/// The units a side has in the game, by their recruit IDs: its units on the map,
/// the fallen aside.
fun squad(game: &Game, side: u64): vector<ID> { game.map.units_of(game.players[side]) }

/// The `squad` of each side, in a single walk of `Map.units`.
fun squads(game: &Game): (vector<ID>, vector<ID>) {
    game.map.units_of_both(game.players[0], game.players[1])
}

/// Put a ranked `squad`, a loadout per unit, on the side's spawn positions: units
/// with no recruit behind them, each with an ID of its own.
fun place_squad(game: &mut Game, side: u64, squad: &vector<u8>, ctx: &mut TxContext) {
    let owner = game.players[side];
    (squad.length() / 3).do!(|i| {
        let id = ctx.fresh_object_address().to_id();
        let unit = unit::from_loadout(id, owner, squad[3 * i], squad[3 * i + 1], squad[3 * i + 2]);
        let position = game.positions[side].pop_back();
        let record = game.map.place_unit(unit, position[0] as u16, position[1] as u16);
        game.history.add(record);
    });
}

/// Check the game takes squads at `now`: deploying, within its time.
fun check_deploying(game: &Game, now: u64) {
    match (&game.state) {
        State::Deploying { until_ms } => assert!(now <= *until_ms, EDeploymentOver),
        State::Playing { .. } => abort EDeploymentOver,
        State::Over(_) => abort EGameOver,
    };
}

/// The player who isn't `player`.
fun other(game: &Game, player: ID): ID {
    if (game.players[0] == player) game.players[1] else game.players[0]
}

/// Clear the search of an `Account` playing this game.
fun release(game: &Game, acc: &mut Account) {
    if (acc.playing() == option::some(object::id(game))) acc.clear_search();
}

/// How long turn number `turn` lasts: the first one is longer than the rest.
fun turn_limit(turn: u16): u64 {
    if (turn == 0) FIRST_TURN_MS else TURN_LIMIT_MS
}

/// The side whose turn it is.
fun active_side(game: &Game): u64 {
    (game.turn as u64) % game.players.length()
}

/// Whether the game is over, waiting for `complete_game`.
fun is_over(game: &Game): bool {
    match (&game.state) {
        State::Over(_) => true,
        _ => false,
    }
}

/// Whether a side is to blame for how the game ended: it abandoned the game,
/// forfeited it, or had nobody to show when the deployment ended, revealing
/// included.
fun misbehaved(game: &Game, side: u64): bool {
    let player = game.players[side];
    match (&game.state) {
        State::Over(Ending::Abandoned(by)) |
        State::Over(Ending::Forfeited(by)) |
        State::Over(Ending::NoShow(by)) => *by == player,
        State::Over(Ending::NobodyShowed) => true,
        _ => false,
    }
}

/// The deployment is over: the first turn begins, unless a side has nobody to
/// show, which ends the game there. Whether each side shows comes from `squads`.
fun begin_match(game: &mut Game, now: u64, first_shows: bool, second_shows: bool) {
    let (first, second) = (game.players[0], game.players[1]);
    game.state = if (!first_shows && !second_shows) State::Over(Ending::NobodyShowed)
    else if (!first_shows) State::Over(Ending::NoShow(first))
    else if (!second_shows) State::Over(Ending::NoShow(second))
    else State::Playing { started_ms: now, missed: vector[0, 0] };
}

/// Whether neither side deployed anyone.
fun nobody_showed(game: &Game): bool {
    match (&game.state) {
        State::Over(Ending::NobodyShowed) => true,
        _ => false,
    }
}

/// The experience each of a side's recruits coming home earns from how the game
/// ended. None for a side that left or never showed, for one whose opponent never
/// showed, or for one left behind before the game got anywhere; none at all in a
/// game not for stakes.
fun experience(game: &Game, side: u64, winner: Option<ID>): u16 {
    if (game.mode != Mode::Stakes) return 0;
    let other = game.players[1 - side];
    let walkover = match (&game.state) {
        State::Over(Ending::Abandoned(by)) | State::Over(Ending::Forfeited(by)) => *by == other,
        _ => false,
    };
    if (walkover) return if (game.turn < MIN_TURNS_TO_EARN) 0 else SURVIVAL_XP;
    if (game.misbehaved(side) || game.misbehaved(1 - side)) return 0;

    if (winner == option::some(game.players[side])) SURVIVAL_XP + WIN_XP else SURVIVAL_XP
}

/// Send a side's survivors, its `squad`, with the experience they earned, home to
/// its `Account`.
fun send_home(game: &mut Game, acc: &mut Account, survivors: vector<ID>, xp: u16) {
    if (xp > 0) survivors.do_ref!(|id| game.recruits[*id].add_xp(xp));
    survivors.do!(|id| acc.add_recruit(game.recruits.remove(id)));
}

/// Check the sender can act: their turn, in time, in a running game. Returns their side.
fun begin_turn_action(game: &mut Game, acc: &Account, clock: &Clock, ctx: &mut TxContext): u64 {
    let side = game.side(acc, ctx);
    let active = game.active_side();
    match (&mut game.state) {
        State::Playing { started_ms, missed } => {
            assert!(side == active, ENotYourTurn);
            assert!(clock.timestamp_ms() - *started_ms <= turn_limit(game.turn), ETurnExpired);
            *&mut missed[side] = 0;
        },
        State::Deploying { .. } => abort EStillDeploying,
        State::Over(_) => abort EGameOver,
    };
    side
}

/// Check the sender can give an order to the unit at `(x, y)`. Returns its recruit.
fun begin_unit_action(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    x: u16,
    y: u16,
    ctx: &mut TxContext,
): ID {
    game.begin_turn_action(acc, clock, ctx);
    let unit = game.map.unit(x, y);
    assert!(unit.is_some(), ENotYourUnit);
    assert!(unit.borrow().owner() == object::id(acc), ENotYourUnit);
    unit.borrow().recruit_id()
}

/// End the game if the kills among `records` left a side with nobody on the map:
/// that side loses; both at once, a draw. The fallen stay in the game until
/// `bury_fallen`: called from an attack, which rolls, this must not free storage.
fun count_losses(game: &mut Game, records: &vector<Record>) {
    if (history::list_kia(records).is_empty()) return;

    let (first, second) = game.squads();
    let (first_left, second_left) = (!first.is_empty(), !second.is_empty());
    if (!first_left && !second_left) game.state = State::Over(Ending::Draw)
    else if (!first_left) game.state = State::Over(Ending::Won(game.players[1]))
    else if (!second_left) game.state = State::Over(Ending::Won(game.players[0]));
}

/// Take the recruits killed since the last call out of the game, their gear going
/// down with them and their dog tags sent to their `Account`s. Never called where
/// `Random` is used: see `Map.fallen`. Nobody dies in a friendly game: its fallen
/// stay in `Map.fallen` until `raise_fallen`. A ranked unit has no recruit behind
/// it: it is taken out, and that is all.
fun bury_fallen(game: &mut Game, ctx: &mut TxContext) {
    match (game.mode) {
        Mode::Friendly { .. } => return,
        _ => (),
    };
    game.map.bury().do!(|id| {
        // a unit the preset placed has no recruit behind it
        if (id.to_address() == @0 || !game.recruits.contains(id)) return;

        let recruit = game.recruits.remove(id);
        let home = recruit.leader();
        transfer::public_transfer(recruit.kill(ctx), home);
    });
}

/// Send everyone who fell in a friendly game home, alive, to the `Account` they
/// came from: `first` or `second`.
fun raise_fallen(game: &mut Game, first: &mut Account, second: &mut Account) {
    game.map.bury().do!(|id| {
        // a unit the preset placed has no recruit behind it
        if (id.to_address() == @0 || !game.recruits.contains(id)) return;

        let recruit = game.recruits.remove(id);
        if (recruit.leader() == object::id(first).to_address()) first.add_recruit(recruit)
        else second.add_recruit(recruit);
    });
}

// === Admin ===

/// Freeze a new level, a `Preset`, for the holder of the `RulesCap`: the `map`, as
/// `map::from_bytes` decodes it, and the spawn positions, `[x, y]` each, the first
/// half for the side that moves first. Every position must be a tile a unit can
/// stand on, and free.
public fun new_level(
    _: &RulesCap,
    name: String,
    map: vector<u8>,
    positions: vector<vector<u8>>,
    ctx: &mut TxContext,
) {
    let id = object::new(ctx);
    let map = map::from_bytes_as(map, id.to_inner());
    assert!(positions.length() % 2 == 0, EBadLevel);
    positions.do_ref!(|p| {
        let (x, y) = (p[0] as u16, p[1] as u16);
        assert!(map.is_tile_walkable(x, y) && !map.tile_has_unit(x, y), EBadLevel);
    });
    transfer::freeze_object(Preset { id, map, name, positions });
}

/// Play ranked squads of `size` on the level `preset`, which must have room for
/// them on each side.
public fun set_level(rules: &mut Rules, cap: &RulesCap, preset: &Preset, size: u8) {
    assert!(preset.positions.length() >= 2 * (size as u64), EBadLevel);
    rules.set_level_id(cap, size, object::id(preset));
}

// === Init ===

/// On publish, freeze the map preset, Black Rain, generated from a scene (see
/// `pnpm --dir app build:map-preset`); share the queue for stakes, a ranked queue
/// for each size, the `Rules` and the lobbies; and give the `RulesCap` to the
/// publisher. Ranked squads of three play on Black Rain, which has room for no
/// more: four have no level until one is set.
fun init(ctx: &mut TxContext) {
    let id = object::new(ctx);
    let level = id.to_inner();
    transfer::freeze_object(Preset {
        map: map::black_rain(level),
        name: "Black Rain",
        positions: map::black_rain_positions(),
        id,
    });

    // the default buckets and windows; a ticket is let go of by the queue only
    // past `TICKET_TTL_MS`, with a notice, so the `Account` always knows where
    // it stands
    let config = matchmaker::new_config(100, NO_LIMIT, 50, 30_000, 1_000, TICKET_TTL_MS);
    matchmaker::new(internal::permit<Ghosts>(), config, ctx).share();
    let three = matchmaker::new(internal::permit<Ranked>(), config, ctx);
    let four = matchmaker::new(internal::permit<Ranked>(), config, ctx);
    let sizes = vector[
        rules::new_size(3, object::id(&three), option::some(level)),
        rules::new_size(4, object::id(&four), option::none()),
    ];
    three.share();
    four.share();

    let (rules, cap) = rules::new(sizes, ctx);
    rules.share();
    transfer::public_transfer(cap, ctx.sender());
    lobby::new(ctx).share();
}

/// `init` for the tests: a module's own extensions cannot call it.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
