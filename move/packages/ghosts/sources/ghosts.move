// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// The frontend module for the game: the map preset, matchmaking and the `Game`.
///
/// Players find each other in the queue and whoever finds a match starts the
/// `Game` for both. Its `Account`s stand for the players: every call takes one
/// and checks the sender controls it. Turns last `TURN_LIMIT_MS`, and first
/// both get `DEPLOY_LIMIT_MS` to pick their squads, then they take turns. A player
/// who runs out of time cannot act anymore, and any player can move the game on.
///
/// The goal is to eliminate the other side. The proof is the `Game` itself: a
/// recruit only leaves a squad by falling, which the `Map` decides, leaving a
/// `DogTag` behind. A side with nobody on the map after deployment has lost.
/// `complete_game` then sends everyone home and deletes the `Game`, and is anyone's
/// to call.
///
/// Every state has a way out, and whoever made it necessary pays for it with
/// `SUSPENSION_MS` without searching: leaving a match unstarted, not deploying,
/// abandoning the game, or missing `MAX_MISSED_TURNS` turns in a row. A game that
/// goes nowhere ends in a draw at `MAX_TURNS`, without blame.
///
/// A game is what the rest of the game runs on. It moves both ratings, and pays both
/// sides credits by how it ended, with experience for the recruits who come home and
/// whatever kills they made. The fallen are gone for good, armor included, but their
/// weapons stay where they fell for anyone to take up, and whoever does keeps them.
module ghosts::ghosts;

use ghosts::{
    account::Account,
    history::{Self, History, Record},
    map::{Self, Map},
    recruit::{DogTag, Recruit},
    weapon::Weapon
};
use matchmaker::matchmaker::{Self, Matchmaker};
use std::string::String;
use sui::{clock::Clock, object_table::{Self, ObjectTable}, random::Random, vec_map::{Self, VecMap}};

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
/// The opponent is still waiting on the match: start the game, or take the
/// suspension with `cancel_search`.
const EOpponentWaiting: u64 = 23;
/// There is no weapon on the unit's tile.
const ENoWeaponHere: u64 = 24;

/// How long a search stays in the queue; past it, anyone can cancel it.
const SEARCH_TIMEOUT_MS: u64 = 120_000;
/// How long the players have to pick their squads once matched.
const DEPLOY_LIMIT_MS: u64 = 120_000;
/// How long a player has for their turn.
const TURN_LIMIT_MS: u64 = 90_000;
/// How long a player cannot search for a game after misbehaving. Kept short while
/// the game is in testing.
const SUSPENSION_MS: u64 = 60_000;
/// How many turns in a row a player can miss before the game counts as abandoned.
const MAX_MISSED_TURNS: u8 = 3;
/// How long a game can go on before it ends in a draw: 30 rounds.
const MAX_TURNS: u16 = 60;

/// What a game pays each side, in credits, by how it ended.
const WIN_CREDITS: u64 = 100;
const DRAW_CREDITS: u64 = 60;
const LOSS_CREDITS: u64 = 40;
/// A win handed over by an opponent who left pays no more than a loss, so that two
/// accounts have nothing to farm from each other.
const WALKOVER_CREDITS: u64 = 40;
/// What each kill pays on top, in credits.
const KILL_CREDITS: u64 = 20;
/// What a recruit earns, in experience, for coming home.
const SURVIVAL_XP: u16 = 1;
/// What a recruit earns, in experience, for each kill.
const KILL_XP: u16 = 2;
/// What a recruit earns, in experience, for coming home from a win.
const WIN_XP: u16 = 1;
/// A game left before this many turns pays nobody anything.
const MIN_TURNS_TO_PAY: u16 = 2;

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

/// A weapon lying on a tile, for any unit standing there to take up.
public struct Dropped has store {
    x: u16,
    y: u16,
    weapon: Weapon,
}

/// A game between `Account`s, shared between them.
public struct Game has key {
    id: UID,
    map: Map,
    /// `Account` IDs of the players, in turn order. An index is a player's side.
    players: vector<ID>,
    /// The recruits each side has on the map; the fallen are taken out.
    squads: vector<vector<ID>>,
    /// The dog tags of the recruits each side lost: the proof of elimination.
    fallen: vector<vector<DogTag>>,
    /// The spawn positions each side has left, used from the back.
    positions: vector<vector<vector<u8>>>,
    /// History of the game.
    history: History,
    /// Temporarily stores recruits for the duration of the game.
    /// If recruits are KIA, they're "killed" upon removal from this table.
    recruits: ObjectTable<ID, Recruit>,
    /// The players are picking their squads, until `deploy_until_ms`.
    deploying: bool,
    deploy_until_ms: u64,
    /// When the current turn started.
    turn_started_ms: u64,
    /// How many turns in a row each side let run out.
    missed: vector<u8>,
    /// The `Account` that abandoned the game, or missed too many turns.
    abandoned_by: Option<ID>,
    /// Each side's kills, by the recruit who made them. Fire on one's own side
    /// doesn't count.
    kills: vector<VecMap<ID, u8>>,
    /// The weapons the fallen left behind. Whatever is still here when the game
    /// ends goes with it.
    dropped: vector<Dropped>,
}

// === Matchmaking ===

/// Search for an opponent with the rating stored in the `Account`, accepting
/// those within its current deviation. The outcome lands on the `Account`:
/// `Matched` when a compatible player was waiting, and the sender follows up
/// with `start_game`; `Searching` otherwise. Either way another search aborts
/// until `cancel_search` clears it. A suspended `Account` cannot search.
entry fun find_game(
    mm: &mut Matchmaker<Ghosts>,
    acc: &mut Account,
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
        &mut rng,
        clock,
        rating.rating(),
        window,
        ctx,
    );

    if (found.is_some()) {
        let m = found.destroy_some();
        acc.set_matched(m.match_id(), m.players()[0]);
    } else acc.start_search(order, now);
}

/// Follow-up to a `find_game` that paired the sender: start the game on
/// the preset and put both `Account`s into it, which is how the player who was
/// waiting learns about the match. They go first. The `opponent` id comes from
/// `Registry.accounts`.
public fun start_game(
    acc: &mut Account,
    opponent: &mut Account,
    preset: &Preset,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    acc.authorize(ctx);

    let half = preset.positions.length() / 2;
    let id = object::new(ctx);
    let now = clock.timestamp_ms();
    acc.start_match(opponent, id.to_inner(), now, SEARCH_TIMEOUT_MS);

    let mut positions = vector[vector[], vector[]];
    preset
        .positions
        .length()
        .do!(|i| positions[if (i < half) 0 else 1].push_back(preset.positions[i]));

    transfer::share_object(Game {
        id,
        map: preset.map.clone(),
        players: vector[object::id(opponent), object::id(acc)],
        squads: vector[vector[], vector[]],
        fallen: vector[vector[], vector[]],
        positions,
        history: history::empty(),
        recruits: object_table::new(ctx),
        deploying: true,
        deploy_until_ms: now + DEPLOY_LIMIT_MS,
        turn_started_ms: now,
        missed: vector[0, 0],
        abandoned_by: option::none(),
        kills: vector[vec_map::empty(), vec_map::empty()],
        dropped: vector[],
    });
}

/// Leave the queue, taking the order out if it is still there. The owner can do
/// this at any time, anyone else once a search has run past `SEARCH_TIMEOUT_MS`.
///
/// The owner can also walk away from a match they hold, for `SUSPENSION_MS`: the
/// player they took out of the queue is left with nothing. `release_match` is the
/// free way out, once that player is gone. A game ends through `abandon_game` or
/// `complete_game` instead.
public fun cancel_search(
    mm: &mut Matchmaker<Ghosts>,
    acc: &mut Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!acc.is_idle() && acc.playing().is_none(), ENotSearching);

    let owner = acc.owner();
    let now = clock.timestamp_ms();
    if (ctx.sender() != owner) {
        assert!(acc.search_timed_out(now, SEARCH_TIMEOUT_MS), ESearchNotTimedOut);
    } else if (acc.is_matched()) {
        acc.suspend(now + SUSPENSION_MS);
    };

    if (mm.is_queued(owner)) {
        matchmaker::remove_ticket(internal::permit<Ghosts>(), mm, owner);
    };
    acc.clear_search();
}

/// Let go of a match the opponent is no longer waiting on, without blame: they
/// cancelled, or their search ran out.
public fun release_match(
    acc: &mut Account,
    opponent: &Account,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    acc.authorize(ctx);

    let now = clock.timestamp_ms();
    assert!(!acc.is_waited_on_by(opponent, now, SEARCH_TIMEOUT_MS), EOpponentWaiting);
    acc.clear_search();
}

// === Ending the Game ===

/// Give up a running game: it is over for both players and the other one wins.
/// `complete_game` then sends everyone home, as after any other ending, and
/// suspends the `Account` for `SUSPENSION_MS`.
public fun abandon_game(game: &mut Game, acc: &Account, ctx: &mut TxContext) {
    game.side(acc, ctx);
    assert!(!game.is_over(), EGameOver);

    game.abandoned_by.fill(object::id(acc));
}

/// Wrap up a game that is over and delete it. Anyone can call this, so neither
/// player can keep the other in: the survivors go back to their `Account`s, the
/// dog tags onto their walls, the result onto their scores, both `Account`s are
/// `Idle` again, and whoever abandoned the game or never deployed is suspended
/// for `SUSPENSION_MS`.
public fun complete_game(
    mut game: Game,
    first: &mut Account,
    second: &mut Account,
    clock: &Clock,
    _ctx: &mut TxContext,
) {
    assert!(game.is_over(), EGameNotOver);
    assert!(
        object::id(first) == game.players[0] && object::id(second) == game.players[1],
        ENotPlayer,
    );

    let now = clock.timestamp_ms();
    if (game.misbehaved(0)) first.suspend(now + SUSPENSION_MS);
    if (game.misbehaved(1)) second.suspend(now + SUSPENSION_MS);

    // nobody showing up isn't a game: it goes on no score and moves no rating
    let winner = game.winner();
    if (!game.nobody_showed()) {
        first.add_result(winner);
        second.add_result(winner);
        first.rate_game(second, winner, now);
    };

    // worked out up front: going home empties a squad, which reads as never showing
    let (credits_first, xp_first) = game.earnings(0, winner);
    let (credits_second, xp_second) = game.earnings(1, winner);
    game.send_home(first, 0, credits_first, xp_first);
    game.send_home(second, 1, credits_second, xp_second);
    first.clear_search();
    second.clear_search();

    let Game { id, map, recruits, fallen, dropped, .. } = game;
    map.destroy();
    recruits.destroy_empty();
    fallen.destroy!(|tags| tags.destroy_empty());
    dropped.destroy!(|Dropped { weapon, .. }| weapon.destroy());
    id.delete();
}

// === Game Actions ===

/// Pick the squad: recruits from the `Account`, placed on the side's spawn
/// positions, as many as the map has for a side. Once per side, in any order,
/// within `DEPLOY_LIMIT_MS` of the match. The first turn starts as soon as both
/// sides have deployed.
entry fun deploy_squad(
    game: &mut Game,
    acc: &mut Account,
    clock: &Clock,
    recruit_ids: vector<ID>,
    ctx: &mut TxContext,
) {
    let side = game.side(acc, ctx);
    let now = clock.timestamp_ms();

    assert!(!game.is_over(), EGameOver);
    assert!(game.deploying && now <= game.deploy_until_ms, EDeploymentOver);
    assert!(game.squads[side].is_empty(), EAlreadyDeployed);
    assert!(!recruit_ids.is_empty(), ENoPositions);
    assert!(recruit_ids.length() <= game.positions[side].length(), ENoPositions);

    recruit_ids.do!(|recruit_id| {
        let recruit = acc.remove_recruit(recruit_id, ctx);
        let position = game.positions[side].pop_back();
        let record = game.map.place_recruit(&recruit, position[0] as u16, position[1] as u16);

        game.squads[side].push_back(recruit_id);
        game.recruits.add(recruit_id, recruit);
        game.history.add(record);
    });

    if (game.squads.all!(|squad| !squad.is_empty())) game.begin_match(now);
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

/// Take up a weapon lying on the unit's tile, leaving the one the recruit carries
/// in its place. A recruit on the standard issue rifle has nothing to leave. Costs
/// 1 AP and comes with a full magazine. The weapon goes home with the recruit: rank
/// only matters for issuing gear at headquarters.
entry fun pick_up_weapon(
    game: &mut Game,
    acc: &Account,
    clock: &Clock,
    x: u16,
    y: u16,
    ctx: &mut TxContext,
) {
    let recruit_id = game.begin_unit_action(acc, clock, x, y, ctx);

    let index = game.dropped.find_index!(|d| d.x == x && d.y == y);
    assert!(index.is_some(), ENoWeaponHere);
    let Dropped { weapon, .. } = game.dropped.swap_remove(index.destroy_some());

    let recruit = &mut game.recruits[recruit_id];
    if (recruit.weapon().is_some()) {
        game.dropped.push_back(Dropped { x, y, weapon: recruit.remove_weapon() });
    };
    recruit.add_weapon(weapon);
    game.history.add(game.map.perform_pick_up(&game.recruits[recruit_id], x, y));
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
    let attacker = game.begin_unit_action(acc, clock, x0, y0, ctx);

    let mut rng = rng.new_generator(ctx);
    let history = game.map.perform_grenade(&mut rng, x0, y0, x1, y1);

    game.bury_fallen(attacker, &history, ctx);
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
    let attacker = game.begin_unit_action(acc, clock, x0, y0, ctx);

    let mut rng = rng.new_generator(ctx);
    let history = game.map.perform_attack(&mut rng, x0, y0, x1, y1);

    game.bury_fallen(attacker, &history, ctx);
    game.history.append(history)
}

/// Switch to the next turn: the current player at any time, the other one once
/// the turn is out of time, which goes against the player who let it run out:
/// `MAX_MISSED_TURNS` in a row abandon the game. Past the time to deploy, it also
/// ends the deployment of a side that did not make it: the first turn starts, or
/// the game is over.
entry fun next_turn(game: &mut Game, acc: &Account, clock: &Clock, ctx: &mut TxContext) {
    let side = game.side(acc, ctx);
    assert!(!game.is_over(), EGameOver);

    let now = clock.timestamp_ms();
    if (game.deploying) {
        assert!(now > game.deploy_until_ms, EStillDeploying);
        return game.begin_match(now)
    };

    let active = game.active_side();
    if (side == active) {
        *&mut game.missed[active] = 0;
    } else {
        assert!(now - game.turn_started_ms > TURN_LIMIT_MS, ETurnNotExpired);
        *&mut game.missed[active] = game.missed[active] + 1;
        if (game.missed[active] == MAX_MISSED_TURNS) {
            game.abandoned_by.fill(game.players[active]);
            return
        };
    };

    game.history.add(game.map.next_turn());
    game.turn_started_ms = now;
}

// === Getters ===

/// Get the current turn of the game.
public fun turn(self: &Game): u16 { self.map.turn() }

/// Get the `Account` that won a game that is over: whoever did not abandon it, or
/// the side with someone left. None for a draw, or while the game is on.
public fun winner(self: &Game): Option<ID> {
    if (!self.is_over()) return option::none();

    let (first, second) = (self.players[0], self.players[1]);
    if (self.abandoned_by.is_some()) {
        return option::some(if (self.abandoned_by == option::some(first)) second else first)
    };

    let (first_out, second_out) = (self.squads[0].is_empty(), self.squads[1].is_empty());
    if (first_out == second_out) option::none() else option::some(if (second_out) first else second)
}

// === Internal ===

/// The side of the `Account` in the game, after checking the sender controls it.
fun side(game: &Game, acc: &Account, ctx: &mut TxContext): u64 {
    acc.authorize(ctx);
    let (found, side) = game.players.index_of(&object::id(acc));
    assert!(found, ENotPlayer);
    side
}

/// The side whose turn it is.
fun active_side(game: &Game): u64 {
    (game.map.turn() as u64) % game.players.length()
}

/// A game ends when a player abandons it, when a side has nobody on the map after
/// deployment, whether all its recruits fell or it never picked any, or at
/// `MAX_TURNS`.
fun is_over(game: &Game): bool {
    game.abandoned_by.is_some()
        || (
            !game.deploying
                && (game.map.turn() >= MAX_TURNS || game.squads.any!(|squad| squad.is_empty()))
        )
}

/// Whether a side is to blame for how the game ended: it abandoned the game, or
/// the deployment ended without it having anyone to show, fallen or alive.
fun misbehaved(game: &Game, side: u64): bool {
    game.abandoned_by == option::some(game.players[side])
        || (!game.deploying && game.squads[side].is_empty() && game.fallen[side].is_empty())
}

/// Deployment is over: the first turn starts now.
fun begin_match(game: &mut Game, now: u64) {
    game.deploying = false;
    game.turn_started_ms = now;
}

/// Whether neither side deployed anyone.
fun nobody_showed(game: &Game): bool {
    !game.deploying
        && game.squads.all!(|squad| squad.is_empty())
        && game.fallen.all!(|tags| tags.is_empty())
}

/// What a side earns from how the game ended: credits, and experience for each
/// recruit coming home. Nothing for a side that left or never showed, for one whose
/// opponent never showed, or for one left behind before the game got anywhere.
fun earnings(game: &Game, side: u64, winner: Option<ID>): (u64, u16) {
    let other = 1 - side;
    if (game.abandoned_by == option::some(game.players[other])) {
        if (game.turn() < MIN_TURNS_TO_PAY) return (0, 0);
        return (WALKOVER_CREDITS, SURVIVAL_XP)
    };
    if (game.misbehaved(side) || game.misbehaved(other)) return (0, 0);

    if (winner.is_none()) (DRAW_CREDITS, SURVIVAL_XP) else if (
        winner == option::some(game.players[side])
    ) (WIN_CREDITS, SURVIVAL_XP + WIN_XP) else (LOSS_CREDITS, SURVIVAL_XP)
}

/// Hand a side's survivors and dog tags over to its `Account`, with what it earned.
/// Kills pay on top of a game that pays at all.
fun send_home(game: &mut Game, acc: &mut Account, side: u64, credits: u64, xp: u16) {
    if (credits > 0) {
        let mut kills = 0u64;
        game.kills[side].length().do!(|i| {
            let (_, count) = game.kills[side].get_entry_by_idx(i);
            kills = kills + (*count as u64);
        });
        acc.pay(credits + kills * KILL_CREDITS);

        game.squads[side].do_ref!(|id| {
            let made = game.kills[side].try_get(id).destroy_or!(0);
            game.recruits[*id].add_xp(xp + (made as u16) * KILL_XP);
        });
    };

    let squad = game.squads[side];
    squad.do!(|id| acc.return_recruit(game.recruits.remove(id)));
    *&mut game.squads[side] = vector[];

    let fallen = &mut game.fallen[side];
    while (!fallen.is_empty()) acc.add_fallen(fallen.pop_back());
}

/// Check the sender can act: their turn, in time, in a running game. Returns their side.
fun begin_turn_action(game: &mut Game, acc: &Account, clock: &Clock, ctx: &mut TxContext): u64 {
    let side = game.side(acc, ctx);
    assert!(!game.is_over(), EGameOver);
    assert!(!game.deploying, EStillDeploying);
    assert!(side == game.active_side(), ENotYourTurn);
    assert!(clock.timestamp_ms() - game.turn_started_ms <= TURN_LIMIT_MS, ETurnExpired);
    *&mut game.missed[side] = 0;
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
    let side = game.begin_turn_action(acc, clock, ctx);
    let unit = game.map.unit(x, y);
    assert!(unit.is_some(), ENotYourUnit);
    let recruit = unit.borrow().recruit_id();
    assert!(game.squads[side].contains(&recruit), ENotYourUnit);
    recruit
}

/// Take the fallen recruits out of their squads, keeping their dog tags, leaving
/// their weapons where they fell, and crediting `attacker` for the other side's.
fun bury_fallen(game: &mut Game, attacker: ID, records: &vector<Record>, ctx: &mut TxContext) {
    let attacker_side = if (game.squads[0].contains(&attacker)) 0 else 1;
    let tiles = history::list_kia_tiles(records);

    history::list_kia(records).length().do!(|n| {
        let id = history::list_kia(records)[n];
        if (id.to_address() == @0) return; // skip empty addresses

        let side = if (game.squads[0].contains(&id)) 0 else 1;
        let (found, i) = game.squads[side].index_of(&id);
        if (!found) return; // a unit the preset placed, no recruit behind it

        game.squads[side].swap_remove(i);
        let (dog_tag, weapon) = game.recruits.remove(id).kill(ctx);
        game.fallen[side].push_back(dog_tag);

        let (x, y) = (tiles[n][0], tiles[n][1]);
        weapon.do!(|weapon| game.dropped.push_back(Dropped { x, y, weapon }));

        if (side != attacker_side) {
            let kills = &mut game.kills[attacker_side];
            if (kills.contains(&attacker)) {
                let count = &mut kills[&attacker];
                *count = *count + 1;
            } else kills.insert(attacker, 1);
        };
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

    // the default buckets and windows, with tickets as long-lived as a search
    let config = matchmaker::new_config(100, 32, 50, 30_000, 1_000, SEARCH_TIMEOUT_MS);
    matchmaker::new(internal::permit<Ghosts>(), config, ctx).share();
}

// === Tests ===

#[test_only]
use ghosts::{account::{Self, Registry}, items, recruit as recruit_module};
#[test_only]
use sui::{clock, random, test_scenario::{Self as ts, Scenario}};

#[test_only]
const ALICE: address = @0xA11CE;
#[test_only]
const BOB: address = @0xB0B;
#[test_only]
const CAROL: address = @0xCA401;

/// Everything a game needs, held across the transactions of a test.
#[test_only]
public struct Fixture {
    ts: Scenario,
    registry: Registry,
    mm: Matchmaker<Ghosts>,
    rng: Random,
    clock: Clock,
    preset: Preset,
    alice: Account,
    bob: Account,
    /// The armed recruit each player starts with.
    alice_recruit: ID,
    bob_recruit: ID,
}

/// Publish the game, open an `Account` for Alice and Bob, and play on Demo 1:
/// one recruit a side keeps the tests short.
#[test_only]
fun setup(): Fixture {
    setup_on!(|id| map::demo_1(id), vector[vector[0, 3], vector[6, 5]])
}

/// `setup` with the matches on another map: Demo 2 has two recruits a side.
#[test_only]
fun setup_on_demo_2(): Fixture {
    let positions = vector[vector[8, 2], vector[7, 6], vector[1, 2], vector[1, 7]];
    setup_on!(|id| map::demo_2(id), positions)
}

#[test_only]
macro fun setup_on($map: |ID| -> Map, $positions: vector<vector<u8>>): Fixture {
    let mut ts = ts::begin(@0);
    init(ts.ctx());
    account::init_for_testing(ts.ctx());
    random::create_for_testing(ts.ctx());

    ts.next_tx(ALICE);
    let id = object::new(ts.ctx());
    let preset = Preset {
        map: $map(id.to_inner()),
        name: "Test",
        positions: $positions,
        id,
    };

    let mut registry = ts.take_shared<Registry>();
    registry.new_account(ts.ctx());
    ts.next_tx(BOB);
    registry.new_account(ts.ctx());
    ts.next_tx(ALICE);

    let mut alice = ts.take_shared_by_id<Account>(registry.account_of(ALICE));
    let mut bob = ts.take_shared_by_id<Account>(registry.account_of(BOB));
    let alice_recruit = hire(&mut alice, ts.ctx());
    ts.next_tx(BOB);
    let bob_recruit = hire(&mut bob, ts.ctx());
    ts.next_tx(ALICE);
    let mm = ts.take_shared<Matchmaker<Ghosts>>();
    let rng = ts.take_shared<Random>();
    let clock = clock::create_for_testing(ts.ctx());

    Fixture {
        ts,
        registry,
        mm,
        rng,
        clock,
        preset,
        alice,
        bob,
        alice_recruit,
        bob_recruit,
    }
}

#[test_only]
fun finish(f: Fixture) {
    let Fixture { ts, registry, mm, rng, clock, preset, alice, bob, .. } = f;
    ts::return_shared(registry);
    ts::return_shared(mm);
    ts::return_shared(rng);
    ts::return_shared(alice);
    ts::return_shared(bob);
    let Preset { id, map, .. } = preset;
    map.destroy();
    id.delete();
    clock.destroy_for_testing();
    ts.end();
}

/// Alice queues, Bob finds her and starts the game. Alice goes first.
#[test_only]
fun start(f: &mut Fixture): Game {
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    f.ts.take_shared<Game>()
}

/// A recruit armed like the ones in `demo_test`, in the `Account` of the sender.
#[test_only]
fun hire(acc: &mut Account, ctx: &mut TxContext): ID {
    let mut recruit = recruit_module::new("Jane Doe", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(3, ctx));
    let id = object::id(&recruit);
    acc.add_recruit(recruit, ctx);
    id
}

/// Both sides pick their recruit: Alice stands at (0, 3), Bob at (6, 5), Alice is next.
#[test_only]
fun deploy(f: &mut Fixture, game: &mut Game) {
    f.ts.next_tx(ALICE);
    deploy_squad(game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());

    f.ts.next_tx(BOB);
    deploy_squad(game, &mut f.bob, &f.clock, vector[f.bob_recruit], f.ts.ctx());

    f.ts.next_tx(ALICE);
}

#[test]
fun test_search_and_start() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    // nobody is waiting: Alice's order is queued and her `Account` records it
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    assert!(f.mm.is_queued(ALICE));
    assert!(f.alice.search_order().is_some());

    // Alice cancels: the order leaves the queue and the `Account` is free again
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(!f.mm.is_queued(ALICE));
    assert!(f.alice.is_idle());

    // Alice queues again and Bob is paired with her right away
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());
    assert_eq!(f.mm.queue_length(), 0);
    assert_eq!(f.bob.opponent(), option::some(ALICE));
    assert!(f.alice.search_order().is_some());

    // Bob's follow-up starts the game for both, with Alice going first
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    let game = f.ts.take_shared<Game>();
    let id = object::id(&game);
    assert_eq!(f.alice.playing(), option::some(id));
    assert_eq!(f.bob.playing(), option::some(id));
    assert_eq!(game.players, vector[object::id(&f.alice), object::id(&f.bob)]);
    assert_eq!(game.active_side(), 0);
    assert_eq!(game.positions, vector[vector[vector[0, 3]], vector[vector[6, 5]]]);
    assert!(game.deploying);
    assert_eq!(game.deploy_until_ms, DEPLOY_LIMIT_MS);

    ts::return_shared(game);
    fixture.finish();
}

/// The one map: Black Rain, three recruits a side, on tiles a recruit can stand
/// on, and nothing else frozen next to it.
#[test]
fun test_map_preset() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    init(ts.ctx());
    let frozen = ts.next_tx(ALICE).frozen();
    assert_eq!(frozen.length(), 1);

    let preset = ts.take_immutable_by_id<Preset>(frozen[0]);
    assert_eq!(preset.map.id(), frozen[0]);
    assert_eq!(preset.positions.length(), 6);
    preset.positions.do_ref!(|position| {
        let (x, y) = (position[0] as u16, position[1] as u16);
        assert!(preset.map.is_tile_walkable(x, y));
        assert!(!preset.map.tile_has_unit(x, y));
    });

    ts::return_immutable(preset);
    ts.end();
}

#[test]
fun test_anyone_cancels_after_timeout() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    f.ts.next_tx(BOB);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(!f.mm.is_queued(ALICE));
    assert!(f.alice.is_idle());

    fixture.finish();
}

#[test, expected_failure(abort_code = ESearchNotTimedOut)]
fun test_cancel_foreign_search_before_timeout_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS);
    f.ts.next_tx(BOB);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ESearchNotTimedOut)]
fun test_cancel_foreign_match_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    // a match has no timeout: only its owner clears it
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.bob, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_find_game_twice_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_find_game_while_playing_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let _game = f.start();
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENotSearching)]
fun test_cancel_search_not_searching_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENotSearching)]
fun test_cancel_search_while_playing_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let _game = f.start();
    // leaving a game is not a matter of cancelling a search
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_find_game_with_foreign_account_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    // Alice tries to queue with Bob's rating
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = account::ENotMatched)]
fun test_start_game_without_match_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(BOB);
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = account::ENotOpponent)]
fun test_start_game_after_opponent_moved_on_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    // Alice moves on before Bob's follow-up: her new order is none of his
    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());

    f.ts.next_tx(BOB);
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_start_game_from_foreign_account_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    f.ts.next_tx(ALICE);
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());
    abort
}

/// A whole game on the Demo 1 map: both sides deploy, Bob closes in and they
/// trade fire until one falls. The game is then over, both players leave for
/// free, the fallen recruit's dog tag lands on the wall, and the game is gone.
#[test]
fun test_full_game() {
    use std::unit_test::assert_eq;
    use grid::direction::{up, left};

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    assert_eq!(game.turn(), 0);
    assert!(!game.deploying);
    assert_eq!(game.squads[0].length(), 1);
    assert_eq!(game.squads[1].length(), 1);

    // Alice waits; Bob moves into the firing lane and shoots
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    let path = vector[6, 5, up!(), up!(), left!(), left!(), left!(), left!(), up!()];
    move_unit(&mut game, &f.bob, &f.clock, path, f.ts.ctx());
    perform_attack(&mut game, &f.bob, &f.rng, &f.clock, 3, 1, 0, 3, f.ts.ctx());

    let mut turns = 0u64;
    while (!game.is_over()) {
        assert!(turns < 200);
        turns = turns + 1;

        if (game.active_side() == 1) {
            next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
            f.ts.next_tx(ALICE);
            if (game.map.unit(0, 3).borrow().ammo() == 0) {
                perform_reload(&mut game, &f.alice, &f.clock, 0, 3, f.ts.ctx());
            };
            perform_attack(&mut game, &f.alice, &f.rng, &f.clock, 0, 3, 3, 1, f.ts.ctx());
        } else {
            next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
            f.ts.next_tx(BOB);
            if (game.map.unit(3, 1).borrow().ammo() == 0) {
                perform_reload(&mut game, &f.bob, &f.clock, 3, 1, f.ts.ctx());
            };
            perform_attack(&mut game, &f.bob, &f.rng, &f.clock, 3, 1, 0, 3, f.ts.ctx());
        };
    };

    // exactly one side fell, with a dog tag to show for it
    let alice_won = game.squads[0].length() == 1;
    let (winner, loser) = if (alice_won) (0, 1) else (1, 0);
    assert_eq!(game.squads[loser].length(), 0);
    assert_eq!(game.fallen[loser].length(), 1);
    assert_eq!(game.fallen[winner].length(), 0);
    assert!(game.abandoned_by.is_none());

    assert_eq!(game.winner(), option::some(game.players[winner]));

    // a stranger can wrap it up: both are `Idle`, and nobody is suspended
    f.ts.next_tx(CAROL);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), 0);
    assert_eq!(f.bob.suspended_until(), 0);

    // the survivor is home, and the fallen recruit's dog tag is on the wall
    assert_eq!(f.alice.num_recruits(), if (alice_won) 1 else 0);
    assert_eq!(f.bob.num_recruits(), if (alice_won) 0 else 1);
    assert_eq!(f.alice.num_dog_tags(), if (alice_won) 0 else 1);
    assert_eq!(f.bob.num_dog_tags(), if (alice_won) 1 else 0);

    // the score has it too
    let (alice_wins, alice_losses, _) = f.alice.score();
    assert_eq!(alice_wins, if (alice_won) 1 else 0);
    assert_eq!(alice_losses, if (alice_won) 0 else 1);

    // and the game is gone
    f.ts.next_tx(CAROL);
    assert!(!ts::has_most_recent_shared<Game>());
    fixture.finish();
}

#[test]
fun test_next_turn_after_time_limit() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    // Alice's turn runs out: Bob moves the game on, and the clock starts anew
    f.clock.set_for_testing(TURN_LIMIT_MS + 1);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 1);
    assert_eq!(game.turn_started_ms, TURN_LIMIT_MS + 1);

    // Bob's own turn can be ended by Bob at any time
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 2);

    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = ETurnNotExpired)]
fun test_next_turn_of_running_turn_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.clock.set_for_testing(TURN_LIMIT_MS);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());

    abort
}

#[test]
fun test_act_at_time_limit() {
    use grid::direction::down;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.clock.set_for_testing(TURN_LIMIT_MS);
    move_unit(&mut game, &f.alice, &f.clock, vector[0, 3, down!()], f.ts.ctx());

    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = ETurnExpired)]
fun test_order_after_time_limit_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.clock.set_for_testing(TURN_LIMIT_MS + 1);
    perform_reload(&mut game, &f.alice, &f.clock, 0, 3, f.ts.ctx());

    abort
}

/// The clock of the first turn starts when the last side has deployed, and the
/// sides can do so in any order.
#[test]
fun test_deploy_in_any_order() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.ts.next_tx(BOB);
    deploy_squad(&mut game, &mut f.bob, &f.clock, vector[f.bob_recruit], f.ts.ctx());
    assert!(game.deploying);

    f.clock.set_for_testing(DEPLOY_LIMIT_MS);
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());

    assert!(!game.deploying);
    assert_eq!(game.turn_started_ms, DEPLOY_LIMIT_MS);
    assert_eq!(game.active_side(), 0);
    assert_eq!(f.alice.num_recruits(), 0);

    ts::return_shared(game);
    fixture.finish();
}

/// The match preset's squad: three recruits picked out of four.
#[test]
fun test_pick_squad_on_match_preset() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on!(|id| map::black_rain(id), map::black_rain_positions());
    let f = &mut fixture;
    let mut game = f.start();

    let picked = vector[
        f.alice_recruit,
        hire(&mut f.alice, f.ts.ctx()),
        hire(&mut f.alice, f.ts.ctx()),
    ];
    let benched = hire(&mut f.alice, f.ts.ctx());
    deploy_squad(&mut game, &mut f.alice, &f.clock, picked, f.ts.ctx());

    assert_eq!(game.squads[0], picked);
    assert_eq!(game.positions[0].length(), 0);
    assert_eq!(f.alice.num_recruits(), 1);
    assert!(game.map.unit(11, 10).is_some() && game.map.unit(12, 8).is_some());
    assert!(f.alice.recruits_contain_for_testing(benched));

    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = ENoPositions)]
fun test_pick_more_than_map_allows_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    let squad = vector[f.alice_recruit, hire(&mut f.alice, f.ts.ctx())];
    deploy_squad(&mut game, &mut f.alice, &f.clock, squad, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENoPositions)]
fun test_pick_nobody_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[], f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EAlreadyDeployed)]
fun test_deploy_twice_fail() {
    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let mut game = f.start();

    let second = hire(&mut f.alice, f.ts.ctx());
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[second], f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EDeploymentOver)]
fun test_deploy_after_time_limit_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EDeploymentOver)]
fun test_deploy_after_both_deployed_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    let id = hire(&mut f.alice, f.ts.ctx());
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[id], f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EStillDeploying)]
fun test_order_during_deployment_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());
    perform_reload(&mut game, &f.alice, &f.clock, 0, 3, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EStillDeploying)]
fun test_next_turn_during_deployment_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotYourTurn)]
fun test_order_out_of_turn_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.ts.next_tx(BOB);
    perform_reload(&mut game, &f.bob, &f.clock, 6, 5, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotYourUnit)]
fun test_order_opponents_unit_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    perform_reload(&mut game, &f.alice, &f.clock, 6, 5, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotYourUnit)]
fun test_order_empty_tile_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    perform_reload(&mut game, &f.alice, &f.clock, 2, 2, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_act_with_foreign_account_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    // Alice signs, Bob's `Account` is passed
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotPlayer)]
fun test_act_as_stranger_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.ts.next_tx(CAROL);
    f.registry.new_account(f.ts.ctx());
    f.ts.next_tx(CAROL);
    let carol = f.ts.take_shared_by_id<Account>(f.registry.account_of(CAROL));
    next_turn(&mut game, &carol, &f.clock, f.ts.ctx());

    abort
}

/// Whoever picks nobody in time has lost, and is suspended for it.
#[test]
fun test_no_show_loses() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    // Alice never deploys; Bob does, and moves the game on when the time is up
    f.ts.next_tx(BOB);
    deploy_squad(&mut game, &mut f.bob, &f.clock, vector[f.bob_recruit], f.ts.ctx());
    assert!(!game.is_over());

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert!(game.is_over());
    assert_eq!(game.winner(), option::some(game.players[1]));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), DEPLOY_LIMIT_MS + 1 + SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), 0);
    assert_eq!(f.alice.num_recruits(), 1);
    assert_eq!(f.bob.num_recruits(), 1);

    fixture.finish();
}

/// Nobody picks anyone: a draw, both are free of the game, and both are suspended.
#[test]
fun test_nobody_shows() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert!(game.is_over());
    assert!(game.winner().is_none());

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), DEPLOY_LIMIT_MS + 1 + SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), DEPLOY_LIMIT_MS + 1 + SUSPENSION_MS);

    fixture.finish();
}

/// Abandoning while the other side is still picking is not their fault.
#[test]
fun test_abandon_during_deployment() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    assert_eq!(game.winner(), option::some(object::id(&f.bob)));
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.suspended_until(), SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), 0);
    assert!(f.alice.is_idle() && f.bob.is_idle());

    fixture.finish();
}

/// Missing turns in a row abandons the game, whoever is keeping count.
#[test]
fun test_missed_turns_abandon_the_game() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    // Alice has gone quiet: Bob moves past her turn and ends his own, three times
    let mut now = 0u64;
    MAX_MISSED_TURNS.do!(|_| {
        now = now + TURN_LIMIT_MS + 1;
        f.clock.set_for_testing(now);
        f.ts.next_tx(BOB);
        next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
        if (!game.is_over()) next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    });

    assert!(game.is_over());
    assert_eq!(game.abandoned_by, option::some(object::id(&f.alice)));
    assert_eq!(game.winner(), option::some(object::id(&f.bob)));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.suspended_until(), now + SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), 0);
    assert_eq!(f.alice.num_recruits(), 1);
    assert_eq!(f.bob.num_recruits(), 1);

    fixture.finish();
}

/// Coming back clears the count: only turns missed in a row add up.
#[test]
fun test_acting_resets_missed_turns() {
    use std::unit_test::assert_eq;
    use grid::direction::{down, up};

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    // Alice misses one, and is back for the next
    let mut now = TURN_LIMIT_MS + 1;
    f.clock.set_for_testing(now);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.missed[0], 1);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());

    f.ts.next_tx(ALICE);
    move_unit(&mut game, &f.alice, &f.clock, vector[0, 3, down!()], f.ts.ctx());
    assert_eq!(game.missed[0], 0);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());

    // ending her own turn late counts as being there too
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    now = now + TURN_LIMIT_MS + 1;
    f.clock.set_for_testing(now);
    f.ts.next_tx(ALICE);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert_eq!(game.missed[0], 0);

    f.ts.next_tx(BOB);
    move_unit(&mut game, &f.bob, &f.clock, vector[6, 5, up!()], f.ts.ctx());

    ts::return_shared(game);
    fixture.finish();
}

/// A game going nowhere can't hold anyone hostage: a draw at the turn limit,
/// without blame, and everyone goes home.
#[test]
fun test_stalemate_ends_in_a_draw() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    while (!game.is_over()) {
        f.ts.next_tx(if (game.active_side() == 0) ALICE else BOB);
        let acc = if (game.active_side() == 0) &f.alice else &f.bob;
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    };

    assert_eq!(game.turn(), MAX_TURNS);
    assert!(game.winner().is_none());

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), 0);
    assert_eq!(f.bob.suspended_until(), 0);
    assert_eq!(f.alice.num_recruits(), 1);
    assert_eq!(f.bob.num_recruits(), 1);

    fixture.finish();
}

/// Walking away from a match takes the other player out of the queue for nothing.
#[test]
fun test_cancel_held_match_is_punished() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    cancel_search(&mut f.mm, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.bob.is_idle());
    assert_eq!(f.bob.suspended_until(), SUSPENSION_MS);

    // Alice is not stuck: she leaves the empty search, for free, and is back
    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.suspended_until(), 0);
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    assert!(f.mm.is_queued(ALICE));

    fixture.finish();
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_search_after_walking_away_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());
    cancel_search(&mut f.mm, &mut f.bob, &f.clock, f.ts.ctx());
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    abort
}

/// The opponent left first: the match is let go of, without blame.
#[test]
fun test_release_match_after_opponent_left() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());

    f.ts.next_tx(BOB);
    release_match(&mut f.bob, &f.alice, &f.clock, f.ts.ctx());
    assert!(f.bob.is_idle());
    assert_eq!(f.bob.suspended_until(), 0);

    fixture.finish();
}

/// The opponent's search ran out: no game on a player long gone, and no blame.
#[test]
fun test_release_match_after_search_ran_out() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    release_match(&mut f.bob, &f.alice, &f.clock, f.ts.ctx());
    assert!(f.bob.is_idle());

    fixture.finish();
}

#[test, expected_failure(abort_code = EOpponentWaiting)]
fun test_release_match_with_opponent_waiting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());
    release_match(&mut f.bob, &f.alice, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_release_foreign_match_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    f.ts.next_tx(ALICE);
    release_match(&mut f.bob, &f.alice, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = account::ENotOpponent)]
fun test_start_game_after_search_ran_out_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.rng, &f.clock, f.ts.ctx());

    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    start_game(&mut f.bob, &mut f.alice, &f.preset, &f.clock, f.ts.ctx());

    abort
}

/// Nobody gets matched against a player with nobody to send.
#[test, expected_failure(abort_code = ENoSquad)]
fun test_search_without_recruits_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.ts.next_tx(CAROL);
    f.registry.new_account(f.ts.ctx());
    f.ts.next_tx(CAROL);
    let mut carol = f.ts.take_shared_by_id<Account>(f.registry.account_of(CAROL));
    find_game(&mut f.mm, &mut carol, &f.rng, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EGameOver)]
fun test_next_turn_after_game_over_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());

    abort
}

/// Abandoning ends the game for both: the recruits go home, the other side wins,
/// and only the one who abandoned is suspended, for `SUSPENSION_MS` exactly.
#[test]
fun test_abandon() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.clock.set_for_testing(1000);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    assert_eq!(game.abandoned_by, option::some(object::id(&f.alice)));
    assert!(game.is_over());

    assert_eq!(game.winner(), option::some(object::id(&f.bob)));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), 1000 + SUSPENSION_MS);
    assert_eq!(f.alice.num_recruits(), 1);
    assert_eq!(f.bob.num_recruits(), 1);
    assert_eq!(f.bob.suspended_until(), 0);

    // the suspension is over at the hour
    f.clock.set_for_testing(1000 + SUSPENSION_MS);
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());
    assert!(f.alice.search_order().is_some());

    fixture.finish();
}

/// A side with more than one recruit is only out when the last one falls, and
/// the winner goes home with whoever is left.
#[test]
fun test_every_recruit_must_fall() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let mut game = f.start();

    let second = hire(&mut f.alice, f.ts.ctx());
    let squad = vector[f.alice_recruit, second];
    deploy_squad(&mut game, &mut f.alice, &f.clock, squad, f.ts.ctx());

    f.ts.next_tx(BOB);
    let (third, fourth) = (f.bob_recruit, hire(&mut f.bob, f.ts.ctx()));
    deploy_squad(&mut game, &mut f.bob, &f.clock, vector[third, fourth], f.ts.ctx());
    assert!(!game.is_over());

    // Bob loses one: still in it
    game.bury_fallen(f.bob_recruit, &vector[history::new_kia(third, 0, 0)], f.ts.ctx());
    assert_eq!(game.squads[1], vector[fourth]);
    assert_eq!(game.fallen[1].length(), 1);
    assert!(!game.is_over());

    // and the other: out
    game.bury_fallen(f.bob_recruit, &vector[history::new_kia(fourth, 0, 0)], f.ts.ctx());
    assert!(game.is_over());
    assert_eq!(game.winner(), option::some(object::id(&f.alice)));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.num_recruits(), 2);
    assert_eq!(f.bob.num_recruits(), 0);
    assert_eq!(f.bob.num_dog_tags(), 2);
    assert_eq!(f.alice.num_dog_tags(), 0);

    fixture.finish();
}

/// Both sides gone at once is a draw.
#[test]
fun test_draw() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    let (a, b) = (game.squads[0][0], game.squads[1][0]);
    game.bury_fallen(
        f.bob_recruit,
        &vector[history::new_kia(a, 0, 0), history::new_kia(b, 0, 0)],
        f.ts.ctx(),
    );
    assert!(game.is_over());
    assert!(game.winner().is_none());

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());

    fixture.finish();
}

/// Every finished game goes on both scores, whatever ended it.
#[test]
fun test_scores() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    // Alice abandons: a win for Bob
    let mut game = f.start();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.games_played(), 1);
    let (wins, losses, draws) = f.alice.score();
    assert_eq!(vector[wins, losses, draws], vector[0, 1, 0]);
    let (wins, losses, draws) = f.bob.score();
    assert_eq!(vector[wins, losses, draws], vector[1, 0, 0]);

    // nobody shows: that isn't a game, past Alice's suspension
    let rating = f.alice.rating().rating();
    f.clock.set_for_testing(SUSPENSION_MS);
    let mut game = f.start();
    f.clock.set_for_testing(SUSPENSION_MS + DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.games_played(), 1);
    assert_eq!(f.bob.games_played(), 1);
    assert_eq!(f.alice.rating().rating(), rating);

    fixture.finish();
}

/// Bob's recruit falls at the hands of Alice's, on the tile it stands on.
#[test_only]
fun alice_kills_bob(f: &mut Fixture, game: &mut Game) {
    let records = vector[history::new_kia(f.bob_recruit, 6, 5)];
    game.bury_fallen(f.alice_recruit, &records, f.ts.ctx());
}

/// A fight to the end: the winner is paid in full, the loser for showing up, each
/// kill on top, and the survivor's experience makes them a Squaddie.
#[test]
fun test_a_finished_fight_pays() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let start = f.alice.credits();
    let (rating_alice, rating_bob) = (f.alice.rating().rating(), f.bob.rating().rating());

    f.alice_kills_bob(&mut game);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.credits(), start + WIN_CREDITS + KILL_CREDITS);
    assert_eq!(f.bob.credits(), start + LOSS_CREDITS);

    let survivor = f.alice.recruit_for_testing(f.alice_recruit);
    assert_eq!(survivor.xp(), SURVIVAL_XP + WIN_XP + KILL_XP);
    assert!(survivor.rank().is_squaddie());

    assert!(f.alice.rating().rating() > rating_alice);
    assert!(f.bob.rating().rating() < rating_bob);
    fixture.finish();
}

/// Both sides gone at once: a draw, paid as one, with no winner's experience and
/// nobody left to earn any.
#[test]
fun test_a_draw_pays() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let start = f.alice.credits();

    f.alice_kills_bob(&mut game);
    let records = vector[history::new_kia(f.alice_recruit, 0, 3)];
    game.bury_fallen(f.alice_recruit, &records, f.ts.ctx()); // no credit for your own
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.credits(), start + DRAW_CREDITS + KILL_CREDITS);
    assert_eq!(f.bob.credits(), start + DRAW_CREDITS);
    fixture.finish();
}

/// Walking out costs rating and earns nothing. The survivors still go home. The one
/// left behind is paid a little, once the game has got somewhere.
#[test]
fun test_a_walkout_costs_rating_and_pays_little() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let start = f.alice.credits();
    let rating = f.alice.rating().rating();

    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.credits(), start);
    assert!(f.alice.rating().rating() < rating);
    assert_eq!(f.alice.recruit_for_testing(f.alice_recruit).xp(), 0);

    assert_eq!(f.bob.credits(), start + WALKOVER_CREDITS);
    assert_eq!(f.bob.recruit_for_testing(f.bob_recruit).xp(), SURVIVAL_XP);
    fixture.finish();
}

/// Two accounts have nothing to farm by walking out on each other right away.
#[test]
fun test_an_early_walkout_pays_nobody() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let start = f.alice.credits();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.credits(), start);
    assert_eq!(f.bob.credits(), start);
    assert_eq!(f.bob.recruit_for_testing(f.bob_recruit).xp(), 0);
    fixture.finish();
}

/// Not deploying pays nobody either, and costs the one who didn't their rating.
#[test]
fun test_a_no_show_pays_nobody() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());
    let start = f.bob.credits();
    let rating = f.bob.rating().rating();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.credits(), start);
    assert_eq!(f.bob.credits(), start);
    assert!(f.bob.rating().rating() < rating);
    fixture.finish();
}

/// The weapon a recruit stands to leave behind.
#[test_only]
fun weapon_of(acc: &Account, recruit: ID): ID {
    object::id(acc.recruit_for_testing(recruit).weapon().borrow())
}

/// A game on Demo 2 with Alice's one recruit at (7, 6) against two of Bob's, so the
/// fight goes on when one of his falls, on Alice's turn.
#[test_only]
fun fight_two_of_bob(f: &mut Fixture): Game {
    f.ts.next_tx(BOB);
    let second = hire(&mut f.bob, f.ts.ctx());
    let mut game = f.start();

    deploy_squad(&mut game, &mut f.alice, &f.clock, vector[f.alice_recruit], f.ts.ctx());
    f.ts.next_tx(BOB);
    let squad = vector[f.bob_recruit, second];
    deploy_squad(&mut game, &mut f.bob, &f.clock, squad, f.ts.ctx());
    f.ts.next_tx(ALICE);
    game
}

/// Bob's first recruit falls on the tile Alice's unit stands on.
#[test_only]
fun bob_falls_on_alice(f: &mut Fixture, game: &mut Game) {
    let records = vector[history::new_kia(f.bob_recruit, 7, 6)];
    game.bury_fallen(f.alice_recruit, &records, f.ts.ctx());
}

/// A fallen recruit's weapon stays where they fell: a unit standing there can take
/// it up, loaded, for an action, and carries it home, whatever their rank.
#[test]
fun test_pick_up_a_weapon_from_the_fallen() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let weapon = weapon_of(&f.bob, f.bob_recruit);
    // Alice's recruit goes on the standard issue rifle
    f.alice.unequip_weapon(f.alice_recruit, f.ts.ctx());
    let mut game = f.fight_two_of_bob();

    f.bob_falls_on_alice(&mut game);
    assert_eq!(game.dropped.length(), 1);

    let crit = game.map.unit(7, 6).borrow().stats().crit_chance();
    let ap = game.map.unit(7, 6).borrow().ap();
    pick_up_weapon(&mut game, &f.alice, &f.clock, 7, 6, f.ts.ctx());

    let unit = game.map.unit(7, 6).borrow();
    assert!(unit.stats().crit_chance() > crit);
    assert_eq!(unit.ammo(), unit.stats().ammo() as u16);
    assert_eq!(unit.ap(), ap - 1);
    // the standard issue rifle isn't a thing to leave behind
    assert_eq!(game.dropped.length(), 0);

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    let home = f.alice.recruit_for_testing(f.alice_recruit);
    assert!(home.rank().is_rookie());
    assert_eq!(weapon_of(&f.alice, f.alice_recruit), weapon);
    fixture.finish();
}

/// Taking a weapon up leaves your own in its place, for anyone else to take, and
/// what's still on the ground when the game ends goes with it.
#[test]
fun test_swapping_leaves_your_own() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let own = weapon_of(&f.alice, f.alice_recruit);
    let theirs = weapon_of(&f.bob, f.bob_recruit);
    let mut game = f.fight_two_of_bob();

    f.bob_falls_on_alice(&mut game);
    pick_up_weapon(&mut game, &f.alice, &f.clock, 7, 6, f.ts.ctx());
    assert_eq!(game.dropped.length(), 1);
    assert_eq!(object::id(&game.dropped[0].weapon), own);

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(weapon_of(&f.alice, f.alice_recruit), theirs);
    fixture.finish();
}

/// A recruit on the standard issue rifle leaves nothing behind to take.
#[test, expected_failure(abort_code = ENoWeaponHere)]
fun test_pick_up_with_nothing_there_fail() {
    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    f.ts.next_tx(BOB);
    f.bob.unequip_weapon(f.bob_recruit, f.ts.ctx());
    let mut game = f.fight_two_of_bob();

    f.bob_falls_on_alice(&mut game);
    pick_up_weapon(&mut game, &f.alice, &f.clock, 7, 6, f.ts.ctx());

    abort
}

/// The weapon is on another tile.
#[test, expected_failure(abort_code = ENoWeaponHere)]
fun test_pick_up_from_another_tile_fail() {
    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let mut game = f.fight_two_of_bob();

    let records = vector[history::new_kia(f.bob_recruit, 1, 2)];
    game.bury_fallen(f.alice_recruit, &records, f.ts.ctx());
    pick_up_weapon(&mut game, &f.alice, &f.clock, 7, 6, f.ts.ctx());

    abort
}

/// Only the side whose turn it is takes anything up.
#[test, expected_failure(abort_code = ENotYourTurn)]
fun test_pick_up_out_of_turn_fail() {
    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let mut game = f.fight_two_of_bob();

    f.bob_falls_on_alice(&mut game);
    f.ts.next_tx(BOB);
    pick_up_weapon(&mut game, &f.bob, &f.clock, 7, 6, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_search_while_suspended_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SUSPENSION_MS - 1);
    find_game(&mut f.mm, &mut f.alice, &f.rng, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EGameOver)]
fun test_act_after_abandon_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EGameOver)]
fun test_abandon_twice_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.ts.next_tx(BOB);
    abandon_game(&mut game, &f.bob, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EGameNotOver)]
fun test_complete_running_game_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENotPlayer)]
fun test_complete_with_swapped_accounts_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.bob, &mut f.alice, &f.clock, f.ts.ctx());

    abort
}
