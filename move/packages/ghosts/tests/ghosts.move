// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::ghosts;

use ghosts::{account::{Self, Registry}, action, items, recruit as recruit_module};
use sui::{clock, random, test_scenario::{Self as ts, Scenario}};

/// The recruits fall, the way they do to an attack: off the map, the game over if
/// that was a side's last, and still in the game until `bury_fallen`.
fun kill(game: &mut Game, recruits: vector<ID>) {
    let records = recruits.map!(|id| game.map.kill_for_testing(id));
    game.count_losses(&records);
}

fun is_deploying(game: &Game): bool {
    match (&game.state) {
        State::Deploying { .. } => true,
        _ => false,
    }
}

fun deploy_until_ms(game: &Game): u64 {
    match (&game.state) {
        State::Deploying { until_ms } => *until_ms,
        _ => abort,
    }
}

fun turn_started_ms(game: &Game): u64 {
    match (&game.state) {
        State::Playing { started_ms, .. } => *started_ms,
        _ => abort,
    }
}

fun missed(game: &Game, side: u64): u8 {
    match (&game.state) {
        State::Playing { missed, .. } => missed[side],
        _ => abort,
    }
}

const ALICE: address = @0xA11CE;

const BOB: address = @0xB0B;

const CAROL: address = @0xCA401;

/// Everything a game needs, held across the transactions of a test.
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
fun setup(): Fixture {
    setup_on!(|id| map::demo_1(id), vector[vector[0, 3], vector[6, 5]], |acc, ctx| hire(acc, ctx))
}

/// `setup` with recruits who carry no weapon and nothing else.
fun setup_unarmed(): Fixture {
    setup_on!(
        |id| map::demo_1(id),
        vector[vector[0, 3], vector[6, 5]],
        |acc, ctx| hire_with(acc, false, false, ctx),
    )
}

/// `setup` with recruits who carry a frag grenade too.
fun setup_grenadiers(): Fixture {
    setup_on!(
        |id| map::demo_1(id),
        vector[vector[0, 3], vector[6, 5]],
        |acc, ctx| hire_with(acc, true, true, ctx),
    )
}

/// `setup` with the matches on another map: Demo 2 has two recruits a side.
fun setup_on_demo_2(): Fixture {
    let positions = vector[vector[8, 2], vector[7, 6], vector[1, 2], vector[1, 7]];
    setup_on!(|id| map::demo_2(id), positions, |acc, ctx| hire(acc, ctx))
}

macro fun setup_on(
    $map: |ID| -> Map,
    $positions: vector<vector<u8>>,
    $hire: |&mut Account, &mut TxContext| -> ID,
): Fixture {
    let mut ts = ts::begin(@0);
    init_for_testing(ts.ctx());
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
    let alice_recruit = $hire(&mut alice, ts.ctx());
    ts.next_tx(BOB);
    let bob_recruit = $hire(&mut bob, ts.ctx());
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

/// Alice queues, Bob finds her, which starts the game, and Alice takes her seat.
/// Alice goes first.
fun start(f: &mut Fixture): Game {
    f.match_up();
    f.ts.next_tx(ALICE);
    let game = f.ts.take_shared<Game>();
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    game
}

/// Alice queues and Bob finds her: the game is on, and Alice's seat on its way.
fun match_up(f: &mut Fixture) {
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
}

/// The seat last sent to Alice's `Account`.
fun seat(f: &Fixture): Receiving<Seat> {
    ts::most_recent_receiving_ticket<Seat>(&object::id(&f.alice))
}

/// A recruit armed like the ones in `demo_test`, in the `Account` of the sender.
fun hire(acc: &mut Account, ctx: &mut TxContext): ID { hire_with(acc, true, false, ctx) }

/// A recruit in the `Account` of the sender: with the armor and rifle of `hire` if
/// `armed`, and with a frag grenade if `grenade`.
fun hire_with(acc: &mut Account, armed: bool, grenade: bool, ctx: &mut TxContext): ID {
    let mut recruit = recruit_module::new("Jane Doe", ctx);
    if (armed) {
        recruit.add_armor(items::armor(2, ctx));
        recruit.add_weapon(items::rifle(3, ctx));
    };
    if (grenade) recruit.add_utility(items::frag_grenade(ctx));
    let id = object::id(&recruit);
    acc.add_recruit(recruit);
    id
}

/// The recruits with these IDs, as the `Account` they were sent to hands them over.
fun tickets(ids: vector<ID>): vector<Receiving<Recruit>> {
    ids.map!(|id| ts::receiving_ticket_by_id<Recruit>(id))
}

/// A look at a recruit at home in Alice's or Bob's `Account`, as the last
/// transaction left them.
macro fun look_at<$R>($f: &mut Fixture, $id: ID, $look: |&Recruit| -> $R): $R {
    let f = $f;
    let id = $id;
    let sender = f.ts.sender();
    f.ts.next_tx(sender);
    let alice = object::id_address(&f.alice);
    let home = if (ts::ids_for_address<Recruit>(alice).contains(&id)) alice
    else object::id_address(&f.bob);
    let recruit = f.ts.take_from_address_by_id<Recruit>(home, id);
    let result = $look(&recruit);
    ts::return_to_address(home, recruit);
    result
}

/// How many dog tags have been sent to an `Account`, as of the last transaction.
fun dog_tags(f: &mut Fixture, acc: address): u64 {
    let sender = f.ts.sender();
    f.ts.next_tx(sender);
    ts::ids_for_address<recruit_module::DogTag>(acc).length()
}

/// Both sides pick their recruit: Alice stands at (0, 3), Bob at (6, 5), Alice is next.
fun deploy(f: &mut Fixture, game: &mut Game) {
    f.ts.next_tx(ALICE);
    deploy_squad(game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());

    f.ts.next_tx(BOB);
    deploy_squad(game, &mut f.bob, &f.clock, tickets(vector[f.bob_recruit]), f.ts.ctx());

    f.ts.next_tx(ALICE);
}

#[test]
fun test_search_and_start() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    // nobody is waiting: Alice's order is queued and her `Account` records it
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert!(f.mm.is_queued(object::id(&f.alice)));
    assert!(f.alice.search_order().is_some());

    // Alice cancels: the order leaves the queue and the `Account` is free again
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(!f.mm.is_queued(object::id(&f.alice)));
    assert!(f.alice.is_idle());

    // Alice queues again and Bob is paired with her right away: his call starts
    // the game, and he is in it; Alice is still on her search
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    let order = f.alice.search_order();
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert_eq!(f.mm.queue_length(), 0);
    assert_eq!(f.alice.search_order(), order);
    f.ts.next_tx(ALICE);
    let game = f.ts.take_shared<Game>();
    let id = object::id(&game);
    assert_eq!(f.bob.playing(), option::some(id));

    // the seat Bob's call sent puts Alice into the game, going first
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    assert_eq!(f.alice.playing(), option::some(id));
    assert_eq!(game.players, vector[object::id(&f.alice), object::id(&f.bob)]);
    assert_eq!(game.active_side(), 0);
    assert_eq!(game.positions, vector[vector[vector[0, 3]], vector[vector[6, 5]]]);
    assert!(game.is_deploying());
    assert_eq!(game.deploy_until_ms(), DEPLOY_LIMIT_MS);

    ts::return_shared(game);
    fixture.finish();
}

/// The one map: Black Rain, three recruits a side, on tiles a recruit can stand
/// on, and nothing else frozen next to it.
#[test]
fun test_map_preset() {
    use std::unit_test::assert_eq;

    let mut ts = ts::begin(@0);
    init_for_testing(ts.ctx());
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

    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    f.ts.next_tx(BOB);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(!f.mm.is_queued(object::id(&f.alice)));
    assert!(f.alice.is_idle());

    fixture.finish();
}

#[test, expected_failure(abort_code = ESearchNotTimedOut)]
fun test_cancel_foreign_search_before_timeout_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS);
    f.ts.next_tx(BOB);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());

    abort
}

/// A search the queue answered ends with its seat: no leaving it otherwise.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_answered_search_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());

    abort
}

/// Not by anyone else long after the search timed out either.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_clear_answered_search_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.clock.set_for_testing(100 * SEARCH_TIMEOUT_MS);
    f.ts.next_tx(CAROL);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());

    abort
}

/// One seat at a time: with one waiting, there is no new search.
#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_search_with_a_seat_waiting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());

    abort
}

/// Anyone can accept the seat: here Bob, for an Alice who is away.
#[test]
fun test_anyone_accepts_the_seat() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(BOB);
    let game = f.ts.take_shared<Game>();
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    assert_eq!(f.alice.playing(), option::some(object::id(&game)));

    ts::return_shared(game);
    fixture.finish();
}

/// Accepting comes before anything else: no squad from an `Account` still on its search.
#[test, expected_failure(abort_code = ESeatNotAccepted)]
fun test_deploy_before_accepting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());

    abort
}

/// Nor walking out of a game not yet accepted: accept, then abandon.
#[test, expected_failure(abort_code = ESeatNotAccepted)]
fun test_abandon_before_accepting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    abandon_game(&mut game, &f.alice, f.ts.ctx());

    abort
}

/// Alice wants out once matched: she accepts her seat and walks away from the game.
#[test]
fun test_walk_away_after_accepting() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    f.match_up();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), SUSPENSION_MS);

    fixture.finish();
}

/// The queue keeps a search as long as it takes: Bob finds Alice however long after.
#[test]
fun test_searches_never_expire_in_the_queue() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(1000 * SEARCH_TIMEOUT_MS);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert_eq!(f.mm.queue_length(), 0);
    assert!(f.bob.playing().is_some());

    fixture.finish();
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_find_game_twice_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_find_game_while_playing_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let _game = f.start();
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
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
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    abort
}

/// A whole game on the Demo 1 map: both sides deploy, Bob closes in and they
/// trade fire until one falls. The game is then over, both players leave for
/// free, the fallen recruit's dog tag is on the wall, and the game is gone.
#[test]
fun test_full_game() {
    use std::unit_test::assert_eq;
    use grid::direction::{up, left};

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    assert_eq!(game.turn(), 0);
    assert!(!game.is_deploying());
    assert_eq!(game.squad(0).length(), 1);
    assert_eq!(game.squad(1).length(), 1);

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

    // exactly one side fell
    let alice_won = game.squad(0).length() == 1;
    let (winner, loser) = if (alice_won) (0, 1) else (1, 0);
    assert_eq!(game.squad(loser).length(), 0);
    assert!(
        match (game.state) {
            State::Over(Ending::Won(_)) => true,
            _ => false,
        },
    );

    assert_eq!(game.winner(), option::some(game.players[winner]));

    // a stranger can wrap it up: both are `Idle`, and nobody is suspended
    f.ts.next_tx(CAROL);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), 0);
    assert_eq!(f.bob.suspended_until(), 0);

    // the survivor is home, and the fallen recruit's dog tag on the wall
    assert_eq!(f.alice.num_recruits(), if (alice_won) 1 else 0);
    assert_eq!(f.bob.num_recruits(), if (alice_won) 0 else 1);
    let (alice, bob) = (object::id_address(&f.alice), object::id_address(&f.bob));
    assert_eq!(f.dog_tags(alice), if (alice_won) 0 else 1);
    assert_eq!(f.dog_tags(bob), if (alice_won) 1 else 0);

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
    f.clock.set_for_testing(FIRST_TURN_MS + 1);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 1);
    assert_eq!(game.turn_started_ms(), FIRST_TURN_MS + 1);

    // Bob's own turn can be ended by Bob at any time
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 2);

    ts::return_shared(game);
    fixture.finish();
}

/// The first turn outlasts the usual limit, the later ones don't.
#[test]
fun test_first_turn_is_longer() {
    use std::unit_test::assert_eq;
    use grid::direction::down;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    assert_eq!(FIRST_TURN_MS, 120_000);
    assert!(FIRST_TURN_MS > TURN_LIMIT_MS);

    // past the usual limit, Alice still acts on the first turn
    f.clock.set_for_testing(TURN_LIMIT_MS + 1);
    move_unit(&mut game, &f.alice, &f.clock, vector[0, 3, down!()], f.ts.ctx());
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());

    // Bob's turn starts now and runs out after the usual limit only
    f.clock.set_for_testing(TURN_LIMIT_MS + 1 + TURN_LIMIT_MS + 1);
    f.ts.next_tx(ALICE);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 2);
    assert_eq!(game.missed(1), 1);

    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = ETurnNotExpired)]
fun test_next_turn_of_running_turn_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.clock.set_for_testing(FIRST_TURN_MS);
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

    f.clock.set_for_testing(FIRST_TURN_MS);
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

    f.clock.set_for_testing(FIRST_TURN_MS + 1);
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
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(vector[f.bob_recruit]), f.ts.ctx());
    assert!(game.is_deploying());

    f.clock.set_for_testing(DEPLOY_LIMIT_MS);
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());

    assert!(!game.is_deploying());
    assert_eq!(game.turn_started_ms(), DEPLOY_LIMIT_MS);
    assert_eq!(game.active_side(), 0);
    assert_eq!(f.alice.num_recruits(), 0);

    ts::return_shared(game);
    fixture.finish();
}

/// The match preset's squad: three recruits picked out of four.
#[test]
fun test_pick_squad_on_match_preset() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on!(
        |id| map::black_rain(id),
        map::black_rain_positions(),
        |acc, ctx| hire(acc, ctx),
    );
    let f = &mut fixture;
    let mut game = f.start();

    let picked = vector[
        f.alice_recruit,
        hire(&mut f.alice, f.ts.ctx()),
        hire(&mut f.alice, f.ts.ctx()),
    ];
    let benched = hire(&mut f.alice, f.ts.ctx());
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(picked), f.ts.ctx());

    assert_eq!(game.squad(0).length(), 3);
    assert!(picked.all!(|id| game.squad(0).contains(id)));
    assert_eq!(game.positions[0].length(), 0);
    assert_eq!(f.alice.num_recruits(), 1);
    assert!(game.map.unit(11, 10).is_some() && game.map.unit(12, 8).is_some());
    assert!(!game.squad(0).contains(&benched));
    assert!(f.look_at!(benched, |r| r.leader() == object::id_address(&f.alice)));

    ts::return_shared(game);
    fixture.finish();
}

/// A squad fresh from `hire_recruits` goes into a match on the match preset
/// ready to shoot: every unit has `Attack` and `Reload`, and Alice opens fire.
#[test]
fun test_hired_squad_shoots() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_on!(
        |id| map::black_rain(id),
        map::black_rain_positions(),
        |acc, ctx| hire(acc, ctx),
    );
    let f = &mut fixture;
    f.alice.hire_recruits(&f.registry, &f.rng, f.ts.ctx());
    f.ts.next_tx(BOB);
    f.bob.hire_recruits(&f.registry, &f.rng, f.ts.ctx());
    let mut game = f.start();

    // the three each side hired, not the recruit the fixture gave it
    let (alice, bob) = (object::id_address(&f.alice), object::id_address(&f.bob));
    let alice_recruit = f.alice_recruit;
    let bob_recruit = f.bob_recruit;
    let alice_hires = ts::ids_for_address<Recruit>(alice).filter!(|id| id != &alice_recruit);
    let bob_hires = ts::ids_for_address<Recruit>(bob).filter!(|id| id != &bob_recruit);
    assert_eq!(alice_hires.length(), 3);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(alice_hires), f.ts.ctx());
    f.ts.next_tx(BOB);
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(bob_hires), f.ts.ctx());
    assert!(!game.is_deploying());

    map::black_rain_positions().do!(|p| {
        let unit = game.map.unit(p[0] as u16, p[1] as u16).borrow();
        assert!(unit.has_action(action::new_attack()));
        assert!(unit.has_action(action::new_reload()));
        assert_eq!(unit.ammo(), 3);
    });

    // Alice goes first: the enemy is out of range, so (11, 10) fires at her own
    // recruit at (12, 8), which spends a round all the same
    f.ts.next_tx(ALICE);
    perform_attack(&mut game, &f.alice, &f.rng, &f.clock, 11, 10, 12, 8, f.ts.ctx());
    assert_eq!(game.map.unit(11, 10).borrow().ammo(), 2);

    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = ENoPositions)]
fun test_pick_more_than_map_allows_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    let squad = vector[f.alice_recruit, hire(&mut f.alice, f.ts.ctx())];
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = ENoPositions)]
fun test_pick_nobody_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[]), f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EAlreadyDeployed)]
fun test_deploy_twice_fail() {
    let mut fixture = setup_on_demo_2();
    let f = &mut fixture;
    let mut game = f.start();

    let second = hire(&mut f.alice, f.ts.ctx());
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[second]), f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EDeploymentOver)]
fun test_deploy_after_time_limit_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EDeploymentOver)]
fun test_deploy_after_both_deployed_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    let id = hire(&mut f.alice, f.ts.ctx());
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[id]), f.ts.ctx());

    abort
}

#[test, expected_failure(abort_code = EStillDeploying)]
fun test_order_during_deployment_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());
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

/// A recruit with no utility cannot throw a grenade, however the order comes in.
#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
fun test_grenade_without_utility_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 0, 3, 0, 5, f.ts.ctx());

    abort
}

/// A recruit with no weapon cannot attack.
#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
fun test_unarmed_attack_fail() {
    let mut fixture = setup_unarmed();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    // the tile holds a unit (its own), so the refusal is the action's
    perform_attack(&mut game, &f.alice, &f.rng, &f.clock, 0, 3, 0, 3, f.ts.ctx());

    abort
}

/// With a frag grenade the throw works once; the second one is refused.
#[test, expected_failure(abort_code = ghosts::unit::ENoUsesLeft)]
fun test_grenade_once_per_match() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_grenadiers();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 0, 3, 0, 5, f.ts.ctx());
    assert_eq!(game.map.unit(0, 3).borrow().ap(), 1);
    assert_eq!(game.map.unit(0, 3).borrow().actions()[3].uses(), option::some(0));
    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 0, 3, 0, 5, f.ts.ctx());

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
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(vector[f.bob_recruit]), f.ts.ctx());
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
        now = now + FIRST_TURN_MS + 1;
        f.clock.set_for_testing(now);
        f.ts.next_tx(BOB);
        next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
        if (!game.is_over()) next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    });

    assert!(game.is_over());
    assert_eq!(game.state, State::Over(Ending::Forfeited(object::id(&f.alice))));
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
    let mut now = FIRST_TURN_MS + 1;
    f.clock.set_for_testing(now);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.missed(0), 1);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());

    f.ts.next_tx(ALICE);
    move_unit(&mut game, &f.alice, &f.clock, vector[0, 3, down!()], f.ts.ctx());
    assert_eq!(game.missed(0), 0);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());

    // ending her own turn late counts as being there too
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    now = now + TURN_LIMIT_MS + 1;
    f.clock.set_for_testing(now);
    f.ts.next_tx(ALICE);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert_eq!(game.missed(0), 0);

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

/// No wrapping up with a seat not yet accepted.
#[test, expected_failure(abort_code = ESeatNotAccepted)]
fun test_complete_with_a_seat_waiting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.match_up();
    f.ts.next_tx(BOB);
    let mut game = f.ts.take_shared<Game>();
    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    abort
}

/// Alice never shows: Bob accepts her seat to wrap up, and she is back to `Idle`,
/// suspended for not deploying.
#[test]
fun test_no_show_on_an_untaken_seat() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    f.match_up();
    f.ts.next_tx(BOB);
    let mut game = f.ts.take_shared<Game>();
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(vector[f.bob_recruit]), f.ts.ctx());

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.winner(), option::some(game.players[1]));

    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), DEPLOY_LIMIT_MS + 1 + SUSPENSION_MS);

    fixture.finish();
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
    find_game(&mut f.mm, &mut carol, &f.preset, &f.rng, &f.clock, f.ts.ctx());

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
    assert_eq!(game.state, State::Over(Ending::Abandoned(object::id(&f.alice))));
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
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
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
    f.ts.next_tx(ALICE);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());

    f.ts.next_tx(BOB);
    let (third, fourth) = (f.bob_recruit, hire(&mut f.bob, f.ts.ctx()));
    f.ts.next_tx(BOB);
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(vector[third, fourth]), f.ts.ctx());
    assert!(!game.is_over());

    // Bob loses one: still in it
    game.kill(vector[third]);
    assert_eq!(game.squad(1), vector[fourth]);
    assert!(!game.is_over());

    // the fallen stays in the game until the turn changes: a kill frees nothing
    assert!(game.recruits.contains(third));
    f.ts.next_tx(ALICE);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert!(!game.recruits.contains(third));

    // and the other: out
    game.kill(vector[fourth]);
    assert!(game.is_over());
    assert_eq!(game.winner(), option::some(object::id(&f.alice)));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.num_recruits(), 2);
    assert_eq!(f.bob.num_recruits(), 0);
    let (alice, bob) = (object::id_address(&f.alice), object::id_address(&f.bob));
    assert_eq!(f.dog_tags(bob), 2);
    assert_eq!(f.dog_tags(alice), 0);

    fixture.finish();
}

/// Both sides gone at once is a draw.
#[test]
fun test_draw() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    let (a, b) = (game.squad(0)[0], game.squad(1)[0]);
    game.kill(vector[a, b]);
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
fun alice_kills_bob(f: &mut Fixture, game: &mut Game) {
    game.kill(vector[f.bob_recruit]);
}

/// A fight to the end: the survivor comes home with a winner's experience, and the
/// ratings move.
#[test]
fun test_a_finished_fight_earns() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let (rating_alice, rating_bob) = (f.alice.rating().rating(), f.bob.rating().rating());

    f.alice_kills_bob(&mut game);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    let id = f.alice_recruit;
    assert_eq!(f.look_at!(id, |r| r.xp()), SURVIVAL_XP + WIN_XP);

    assert!(f.alice.rating().rating() > rating_alice);
    assert!(f.bob.rating().rating() < rating_bob);
    fixture.finish();
}

/// Both sides gone at once: a draw on both scores, and nobody left to earn anything.
#[test]
fun test_a_draw() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.alice_kills_bob(&mut game);
    game.kill(vector[f.alice_recruit]);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    let (_, _, draws) = f.alice.score();
    assert_eq!(draws, 1);
    assert_eq!(f.alice.num_recruits(), 0);
    fixture.finish();
}

/// Walking out costs rating and earns nothing. The survivors still go home. The one
/// left behind earns a little, once the game has got somewhere.
#[test]
fun test_a_walkout_costs_rating_and_earns_little() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    let rating = f.alice.rating().rating();

    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert!(f.alice.rating().rating() < rating);
    let (alice, bob) = (f.alice_recruit, f.bob_recruit);
    assert_eq!(f.look_at!(alice, |r| r.xp()), 0);
    assert_eq!(f.look_at!(bob, |r| r.xp()), SURVIVAL_XP);
    fixture.finish();
}

/// Two accounts have nothing to farm by walking out on each other right away.
#[test]
fun test_an_early_walkout_earns_nobody() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    let id = f.bob_recruit;
    assert_eq!(f.look_at!(id, |r| r.xp()), 0);
    fixture.finish();
}

/// Not deploying earns nobody anything either, and costs the one who didn't their
/// rating.
#[test]
fun test_a_no_show_earns_nobody() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());
    let rating = f.bob.rating().rating();

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert!(f.bob.rating().rating() < rating);
    let id = f.alice_recruit;
    assert_eq!(f.look_at!(id, |r| r.xp()), 0);
    fixture.finish();
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_search_while_suspended_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();

    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SUSPENSION_MS - 1);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());

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

// === Benchmarks ===
//
// Read with `sui move test -s bench_`: each one plays a game on the published
// preset, Black Rain with three recruits a side, up to one more step than the
// one before it, so the difference between two is what that step costs.

/// `setup` on Black Rain, with three armed grenadiers a side.
fun setup_black_rain(): Fixture {
    setup_on!(|id| map::black_rain(id), map::black_rain_positions(), |acc, ctx| {
        hire_with(acc, true, true, ctx);
        hire_with(acc, true, true, ctx);
        hire_with(acc, true, true, ctx)
    })
}

/// Both sides deploy their three recruits. Alice stands at (11, 10), (12, 8)
/// and (11, 6), Bob at (3, 6), (5, 14) and (4, 11). Alice is next.
fun deploy_black_rain(f: &mut Fixture, game: &mut Game) {
    f.ts.next_tx(ALICE);
    let squad = ts::ids_for_address<Recruit>(object::id_address(&f.alice));
    deploy_squad(game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());

    f.ts.next_tx(BOB);
    let squad = ts::ids_for_address<Recruit>(object::id_address(&f.bob));
    deploy_squad(game, &mut f.bob, &f.clock, tickets(squad), f.ts.ctx());

    f.ts.next_tx(ALICE);
}

/// Alice walks from (11, 10) five tiles up to (6, 10), within reach of Bob's
/// recruit at (4, 11).
fun advance_black_rain(f: &mut Fixture, game: &mut Game) {
    use grid::direction::up;
    let path = vector[11, 10, up!(), up!(), up!(), up!(), up!()];
    move_unit(game, &f.alice, &f.clock, path, f.ts.ctx());
}

#[test]
fun bench_a_setup() {
    let fixture = setup_black_rain();
    fixture.finish();
}

#[test]
fun bench_b_match() {
    let mut fixture = setup_black_rain();
    let game = fixture.start();
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_c_deploy() {
    let mut fixture = setup_black_rain();
    let mut game = fixture.start();
    fixture.deploy_black_rain(&mut game);
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_d_next_turn_x10() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    10u64.do!(|i| {
        f.ts.next_tx(if (i % 2 == 0) ALICE else BOB);
        let acc = if (i % 2 == 0) &f.alice else &f.bob;
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    });
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_e_move() {
    let mut fixture = setup_black_rain();
    let mut game = fixture.start();
    fixture.deploy_black_rain(&mut game);
    fixture.advance_black_rain(&mut game);
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_f_attack() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    f.advance_black_rain(&mut game);
    perform_attack(&mut game, &f.alice, &f.rng, &f.clock, 6, 10, 4, 11, f.ts.ctx());
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_g_grenade() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    f.advance_black_rain(&mut game);
    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 6, 10, 4, 11, f.ts.ctx());
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_h_complete() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    f.ts.next_tx(BOB);
    abandon_game(&mut game, &f.bob, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}

// Read with `sui move test -s bench_size`: one armed recruit a side on an empty
// square map, Alice at (0, 0) and Bob in the far corner, deployed and then ten
// or twenty turns played. The difference between `deploy` and `next_turn_x10`
// at each size is what ten turns cost there, and between `x10` and `x20` what
// ten more cost once the game is under way.

/// `setup` on an empty square map of `size` tiles a side.
fun setup_on_empty(size: u8): Fixture {
    setup_on!(
        |id| map::new(id, size as u16),
        vector[vector[0, 0], vector[size - 1, size - 1]],
        |acc, ctx| hire(acc, ctx),
    )
}

/// Deploy on an empty map of `size`, then play `turns` turns.
fun bench_size(size: u8, turns: u64) {
    let mut fixture = setup_on_empty(size);
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    turns.do!(|i| {
        f.ts.next_tx(if (i % 2 == 0) ALICE else BOB);
        let acc = if (i % 2 == 0) &f.alice else &f.bob;
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    });
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_size_07_deploy() { bench_size(7, 0) }

#[test]
fun bench_size_07_next_turn_x10() { bench_size(7, 10) }

#[test]
fun bench_size_16_deploy() { bench_size(16, 0) }

#[test]
fun bench_size_16_next_turn_x10() { bench_size(16, 10) }

#[test]
fun bench_size_30_deploy() { bench_size(30, 0) }

#[test]
fun bench_size_30_next_turn_x10() { bench_size(30, 10) }

#[test]
fun bench_size_07_next_turn_x20() { bench_size(7, 20) }

#[test]
fun bench_size_30_next_turn_x20() { bench_size(30, 20) }

// === Unit Index ===

/// `Map.units` list exactly the tiles a walk of the grid finds, and each
/// side's `squad` is what a walk would give.
fun check_index(game: &Game) {
    use std::unit_test::assert_eq;

    game.map.assert_units_match_grid();
    let (first, second) = game.squads();
    assert_eq!(first, squad_by_walk(game, 0));
    assert_eq!(second, squad_by_walk(game, 1));
    assert_eq!(game.squad(0), first);
    assert_eq!(game.squad(1), second);
}

/// A side's `squad` as a walk of the whole grid finds it.
fun squad_by_walk(game: &Game, side: u64): vector<ID> {
    game.map.units_of_by_walk(game.players[side]).filter!(|id| game.recruits.contains(*id))
}

#[test]
/// Deploy, moves, a grenade and turns on Black Rain, three a side: `Map.units`
/// stays in step, and every new turn gives the side starting it its AP back.
fun test_unit_index_on_black_rain() {
    use grid::direction::{down, left};
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start();
    check_index(&game);
    f.deploy_black_rain(&mut game);
    check_index(&game);
    assert_eq!(game.map.unit_tiles().length(), 6);

    f.advance_black_rain(&mut game);
    check_index(&game);
    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 6, 10, 4, 11, f.ts.ctx());
    check_index(&game);

    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    check_index(&game);
    let bob = game.players[1];
    game.map.unit_tiles().do!(|tile| {
        let (_, cols) = game.map.size();
        let unit = game.map.unit(tile / cols, tile % cols).borrow();
        if (unit.owner() == bob) assert_eq!(unit.ap(), 2);
    });

    // Bob walks from (3, 6) down and left to (5, 5)
    f.ts.next_tx(BOB);
    move_unit(&mut game, &f.bob, &f.clock, vector[3, 6, down!(), down!(), left!()], f.ts.ctx());
    check_index(&game);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    check_index(&game);

    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}

#[test]
/// `test_full_game` with `Map.units` checked after every call, through the kill
/// that ends it and the turn that buries the fallen.
fun test_unit_index_through_a_full_game() {
    use grid::direction::{up, left};

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);
    check_index(&game);

    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    check_index(&game);
    f.ts.next_tx(BOB);
    let path = vector[6, 5, up!(), up!(), left!(), left!(), left!(), left!(), up!()];
    move_unit(&mut game, &f.bob, &f.clock, path, f.ts.ctx());
    check_index(&game);
    perform_attack(&mut game, &f.bob, &f.rng, &f.clock, 3, 1, 0, 3, f.ts.ctx());
    check_index(&game);

    while (!game.is_over()) {
        let (acc, other, from, to) = if (game.active_side() == 1) {
            (&f.bob, ALICE, vector[0u16, 3], vector[3u16, 1])
        } else (&f.alice, BOB, vector[3u16, 1], vector[0u16, 3]);
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
        check_index(&game);
        f.ts.next_tx(other);
        let acc = if (other == ALICE) &f.alice else &f.bob;
        if (game.map.unit(from[0], from[1]).borrow().ammo() == 0) {
            perform_reload(&mut game, acc, &f.clock, from[0], from[1], f.ts.ctx());
        };
        perform_attack(
            &mut game,
            acc,
            &f.rng,
            &f.clock,
            from[0],
            from[1],
            to[0],
            to[1],
            f.ts.ctx(),
        );
        check_index(&game);
    };

    assert!(game.map.unit_tiles().length() == 1);
    f.ts.next_tx(CAROL);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}
