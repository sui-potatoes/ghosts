// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// The frontend module for the game: the map preset, matchmaking and the `Game`.
///
/// Players find each other in the queue, and whoever finds a match starts the
/// `Game` in the same call and is in it right away. The `Account` of the player
/// who waited can't be in that call, as nobody knows it beforehand, so they are
/// sent a `Seat` in the game instead, to their `Account`, which is on its search
/// until `accept_seat` puts it into the game: before anything else, by anyone. A
/// player is their `Account` ID throughout; every call takes the `Account`, and
/// all but accepting a seat check the sender controls it. Turns last
/// `TURN_LIMIT_MS`, the first one `FIRST_TURN_MS` as the scene is still loading,
/// and first both get `DEPLOY_LIMIT_MS` to pick their squads, then
/// they take turns. A player who runs out of time cannot act anymore, and any
/// player can move the game on.
///
/// The goal is to eliminate the other side. The proof is the `Game` itself: a
/// recruit only leaves a squad by falling, which the `Map` decides, and their
/// `DogTag` is sent to their `Account` there and then. A side with nobody on the
/// map after deployment has lost.
/// `complete_game` then sends everyone home and deletes the `Game`, and is anyone's
/// to call.
///
/// Every state has a way out, and whoever made it necessary pays for it with
/// `SUSPENSION_MS` without searching: not deploying, abandoning the game, or
/// missing `MAX_MISSED_TURNS` turns in a row. A game that
/// goes nowhere ends in a draw at `MAX_TURNS`, without blame.
///
/// A game is what the rest of the game runs on. It moves both ratings, and gives the
/// recruits who come home experience by how it ended. The fallen are gone for good,
/// with their gear.
module ghosts::ghosts;

use ghosts::{
    account::Account,
    history::{Self, History, Record},
    map::{Self, Map},
    recruit::Recruit
};
use matchmaker::matchmaker::{Self, Matchmaker};
use std::string::String;
use sui::{clock::Clock, random::Random, table::{Self, Table}, transfer::Receiving};

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
/// A match found the search: its `Seat` waits on the `Account`, to accept first.
const ESeatWaiting: u64 = 25;
/// The `Account` has yet to accept its `Seat` in the game.
const ESeatNotAccepted: u64 = 27;

/// How long a search waits before anyone can cancel it; the queue keeps it until then.
const SEARCH_TIMEOUT_MS: u64 = 120_000;
/// No bucket capacity and no ticket lifetime: the queue never drops a search itself.
const NO_LIMIT: u64 = 18_446_744_073_709_551_615;
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

/// Identifies this game's matchmaking queue, `Matchmaker<Ghosts>`.
public struct Ghosts()

/// The map games are played on, created once on publish. Frozen, so that games
/// starting at the same time never wait on each other.
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
/// It exists from the match until `accept_seat`, which puts the `Account` into the
/// game: the first thing either player does about the match.
public struct Seat has key {
    id: UID,
    /// The game the seat is in.
    game: ID,
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
    /// its unit says. The fallen are taken out and killed by `bury_fallen`.
    recruits: Table<ID, Recruit>,
}

/// Where a game stands. It only moves forward: `Deploying`, `Playing`, `Over`.
public enum State has copy, drop, store {
    /// The players pick their squads, until `until_ms`.
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
    /// The deployment ended with the player having picked nobody.
    NoShow(ID),
    /// The deployment ended with neither player having picked anyone.
    NobodyShowed,
}

// === Matchmaking ===

/// Search for an opponent with the rating stored in the `Account`, accepting
/// those within its current deviation. When a compatible player is waiting, the
/// game starts on the preset right away: the `Account` is `Playing` it, and the
/// player who waited is sent a `Seat` in it. They go first. Otherwise the
/// `Account` is `Searching` until a match answers it or `cancel_search` clears
/// it. A suspended `Account` cannot search.
entry fun find_game(
    mm: &mut Matchmaker<Ghosts>,
    acc: &mut Account,
    preset: &Preset,
    rng: &Random,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    acc.authorize(ctx);
    assert!(acc.is_idle(), EAlreadySearching);

    let rating = acc.rating();
    let now = clock.timestamp_ms();
    assert!(now >= acc.suspended_until(), ESuspended);
    assert!(acc.num_recruits() > 0, ENoSquad);

    let window = rating.current_deviation(now);
    let mut rng = rng.new_generator(ctx);
    let permit = internal::permit<Ghosts>();
    let (order, found) = matchmaker::find_game(
        permit,
        mm,
        object::id(acc),
        &mut rng,
        clock,
        rating.rating(),
        window,
        ctx,
    );

    if (found.is_none()) return acc.start_search(order, now);

    // the player who waited is sent their seat: their `Account` isn't in this call
    let m = found.destroy_some();
    let waiting = m.players()[0];
    let game = new_game(preset, waiting, object::id(acc), now, ctx);
    let seat = Seat { id: object::new(ctx), game: object::id(&game) };
    acc.set_playing(object::id(&game));
    transfer::transfer(seat, waiting.to_address());
    transfer::share_object(game);
}

/// Accept the `Seat` a match sent to an `Account`: it is `Playing` the game from
/// now on, and can act in it, or leave it with `abandon_game`. Anyone can do this:
/// the player, as soon as they see the seat, or the other player when they don't,
/// who then gets back the storage the seat took and can wrap up the game.
public fun accept_seat(acc: &mut Account, seat: Receiving<Seat>) {
    let Seat { id, game } = transfer::receive(acc.uid_mut(), seat);
    id.delete();

    assert!(acc.search_order().is_some(), ENotSearching);
    acc.set_playing(game);
}

/// Leave the queue. The owner can do this at any time, anyone else once the search
/// has run past `SEARCH_TIMEOUT_MS`. The queue never lets go of a search on its
/// own, so one no longer in it was found by a match: its `Seat` comes first, and
/// the game ends through `abandon_game` or `complete_game` instead.
public fun cancel_search(
    mm: &mut Matchmaker<Ghosts>,
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

    matchmaker::remove_ticket(internal::permit<Ghosts>(), mm, id);
    acc.clear_search();
}

/// A game on the preset between the player who `waiting` was, going first, and
/// the one who found them, still deploying.
fun new_game(preset: &Preset, waiting: ID, finder: ID, now: u64, ctx: &mut TxContext): Game {
    let half = preset.positions.length() / 2;
    let mut positions = vector[vector[], vector[]];
    preset
        .positions
        .length()
        .do!(|i| positions[if (i < half) 0 else 1].push_back(preset.positions[i]));

    Game {
        id: object::new(ctx),
        map: preset.map.clone(),
        players: vector[waiting, finder],
        state: State::Deploying { until_ms: now + DEPLOY_LIMIT_MS },
        turn: 0,
        positions,
        history: history::empty(),
        recruits: table::new(ctx),
    }
}

// === Ending the Game ===

/// Give up a running game: it is over for both players and the other one wins.
/// `complete_game` then sends everyone home, as after any other ending, and
/// suspends the `Account` for `SUSPENSION_MS`.
public fun abandon_game(game: &mut Game, acc: &Account, ctx: &mut TxContext) {
    game.side(acc, ctx);
    assert!(!game.is_over(), EGameOver);

    game.state = State::Over(Ending::Abandoned(object::id(acc)));
}

/// Wrap up a game that is over and delete it. Anyone can call this, so neither
/// player can keep the other in: the survivors go back to their `Account`s, the
/// result onto their scores, the `Account`s playing
/// it are `Idle` again, and whoever abandoned the game or never deployed is
/// suspended for `SUSPENSION_MS`. Both `Account`s must be in the game: a `Seat` not
/// yet accepted is accepted first, by whoever wraps up.
public fun complete_game(
    mut game: Game,
    first: &mut Account,
    second: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(game.is_over(), EGameNotOver);
    assert!(
        object::id(first) == game.players[0] && object::id(second) == game.players[1],
        ENotPlayer,
    );
    let id = option::some(object::id(&game));
    assert!(first.playing() == id && second.playing() == id, ESeatNotAccepted);

    let now = clock.timestamp_ms();

    // nobody showing up isn't a game: it goes on no score and moves no rating
    let winner = game.winner();
    if (!game.nobody_showed()) {
        first.add_result(winner);
        second.add_result(winner);
        first.rate_game(second, winner, now);
    };

    game.bury_fallen(ctx);
    let (xp_first, xp_second) = (game.experience(0, winner), game.experience(1, winner));
    let (squad_first, squad_second) = game.squads();
    game.send_home(first, squad_first, xp_first);
    game.send_home(second, squad_second, xp_second);
    game.release(first);
    game.release(second);
    if (game.misbehaved(0)) first.suspend(now + SUSPENSION_MS);
    if (game.misbehaved(1)) second.suspend(now + SUSPENSION_MS);

    let Game { id, map, recruits, .. } = game;
    map.destroy();
    recruits.destroy_empty();
    id.delete();
}

// === Game Actions ===

/// Pick the squad: recruits received from the `Account`, placed on the side's
/// spawn positions, as many as the map has for a side. Once per side, in any
/// order, within `DEPLOY_LIMIT_MS` of the match. The first turn starts as soon as
/// both sides have deployed.
public fun deploy_squad(
    game: &mut Game,
    acc: &mut Account,
    clock: &Clock,
    recruits: vector<Receiving<Recruit>>,
    ctx: &mut TxContext,
) {
    let side = game.side(acc, ctx);
    let now = clock.timestamp_ms();

    match (&game.state) {
        State::Deploying { until_ms } => assert!(now <= *until_ms, EDeploymentOver),
        State::Playing { .. } => abort EDeploymentOver,
        State::Over(_) => abort EGameOver,
    };
    assert!(game.squad(side).is_empty(), EAlreadyDeployed);
    assert!(!recruits.is_empty(), ENoPositions);
    assert!(recruits.length() <= game.positions[side].length(), ENoPositions);

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
/// the game is over.
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
    game.map.reset_ap(next);
}

// === Getters ===

/// Get how many turns have passed since the deployment ended.
public fun turn(self: &Game): u16 { self.turn }

/// Get where the game stands.
public fun state(self: &Game): State { self.state }

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

/// The recruits a side has in the game: its units on the map, the fallen aside.
fun squad(game: &Game, side: u64): vector<ID> {
    game.map.units_of(game.players[side]).filter!(|id| game.recruits.contains(*id))
}

/// The `squad` of each side, in a single walk of the map.
fun squads(game: &Game): (vector<ID>, vector<ID>) {
    let (first, second) = game.map.units_of_both(game.players[0], game.players[1]);
    (
        first.filter!(|id| game.recruits.contains(*id)),
        second.filter!(|id| game.recruits.contains(*id)),
    )
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
/// forfeited it, or had nobody to show when the deployment ended.
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
/// showed, or for one left behind before the game got anywhere.
fun experience(game: &Game, side: u64, winner: Option<ID>): u16 {
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
/// `Random` is used: see `Map.fallen`.
fun bury_fallen(game: &mut Game, ctx: &mut TxContext) {
    game.map.bury().do!(|id| {
        // a unit the preset placed has no recruit behind it
        if (id.to_address() == @0 || !game.recruits.contains(id)) return;

        let recruit = game.recruits.remove(id);
        let home = recruit.leader();
        transfer::public_transfer(recruit.kill(ctx), home);
    });
}

// === Init ===

/// On publish, share the matchmaking queue and freeze the map preset, which is
/// generated from a scene: see `pnpm --dir app build:map-preset`.
fun init(ctx: &mut TxContext) {
    let id = object::new(ctx);
    transfer::freeze_object(Preset {
        map: map::black_rain(id.to_inner()),
        name: "Black Rain",
        positions: map::black_rain_positions(),
        id,
    });

    // the default buckets and windows, with no ticket ever let go of by the queue:
    // a search leaves it only by its player's cancel or by a match, which sends
    // a `Seat`, so the `Account` always knows where it stands
    let config = matchmaker::new_config(100, NO_LIMIT, 50, 30_000, 1_000, NO_LIMIT);
    matchmaker::new(internal::permit<Ghosts>(), config, ctx).share();
}

/// `init` for the tests: a module's own extensions cannot call it.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
