// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::ghosts;

use ghosts::{account::{Self, Registry}, action, items, recruit as recruit_module};
use glicko::glicko::{Self, Rating};
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
    lobbies: Lobbies,
    rules: Rules,
    /// The ranked queues of three and four.
    three: Matchmaker<Ranked>,
    four: Matchmaker<Ranked>,
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
    let lobbies = ts.take_shared<Lobbies>();
    let rng = ts.take_shared<Random>();
    let clock = clock::create_for_testing(ts.ctx());

    // ranked squads of three play on the preset
    let mut rules = ts.take_shared<Rules>();
    let three = ts.take_shared_by_id(rules.size_for_testing(3).queue_for_testing());
    let four = ts.take_shared_by_id(rules.size_for_testing(4).queue_for_testing());
    rules.set_level_for_testing(3, object::id(&preset));

    Fixture {
        ts,
        registry,
        mm,
        lobbies,
        rules,
        three,
        four,
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
    let Fixture {
        ts,
        registry,
        mm,
        lobbies,
        rules,
        three,
        four,
        rng,
        clock,
        preset,
        alice,
        bob,
        ..,
    } = f;
    ts::return_shared(registry);
    ts::return_shared(mm);
    ts::return_shared(lobbies);
    ts::return_shared(rules);
    ts::return_shared(three);
    ts::return_shared(four);
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
/// Alice goes first, whatever the draw: see `put_first`.
fun match_up(f: &mut Fixture) {
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.alice_first();
}

/// The game just started, with Alice going first, whatever the draw.
fun alice_first(f: &mut Fixture) {
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    game.put_first(object::id(&f.alice));
    ts::return_shared(game);
}

/// Make `player` the one who goes first, before anyone deployed: the draw undone,
/// so that a test knows who acts. The spawn positions stay with the sides.
fun put_first(game: &mut Game, player: ID) {
    if (game.players[0] != player) game.players.swap(0, 1);
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

    // the seat Bob's call sent puts Alice into the game; who goes first is drawn
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    assert_eq!(f.alice.playing(), option::some(id));
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    assert!(game.players == vector[alice, bob] || game.players == vector[bob, alice]);
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

/// The queue keeps a search up to `TICKET_TTL_MS`: Bob finds Alice right at it.
#[test]
fun test_search_lasts_the_ticket_lifetime() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(TICKET_TTL_MS);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert_eq!(f.mm.queue_length(), 0);
    assert!(f.bob.playing().is_some());

    fixture.finish();
}

/// Past `TICKET_TTL_MS` the queue drops Alice's search when Bob's walks by it: no
/// match, Bob waits instead, and Alice's `Account` is sent a notice, which anyone
/// dismisses, Alice idle again. Nobody is left on a ticket that is gone.
#[test]
fun test_expired_search_is_told() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(TICKET_TTL_MS + 1);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert!(!f.mm.is_queued(object::id(&f.alice)));
    assert!(f.mm.is_queued(object::id(&f.bob)));

    // Alice is still searching, the ticket gone: a cancel has nothing to take
    assert!(f.alice.search_order().is_some());
    f.ts.next_tx(CAROL);
    let notice = f.seat();
    dismiss_seat(&mut f.alice, notice);
    assert!(f.alice.is_idle());

    // and she can search again
    f.ts.next_tx(ALICE);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert!(f.alice.playing().is_some());
    assert_eq!(f.mm.queue_length(), 0);

    fixture.finish();
}

/// A notice is not a seat in a game, nor the other way round.
#[test, expected_failure(abort_code = EWrongSeat)]
fun test_accept_a_notice_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(TICKET_TTL_MS + 1);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    let notice = f.seat();
    accept_seat(&mut f.alice, notice);
    abort
}

#[test, expected_failure(abort_code = EWrongSeat)]
fun test_dismiss_a_seat_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.match_up();
    f.ts.next_tx(ALICE);
    let seat = f.seat();
    dismiss_seat(&mut f.alice, seat);
    abort
}

/// The ticket of a dropped search is gone: cancelling it finds nothing.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_dropped_search_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(TICKET_TTL_MS + 1);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    abort
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

    // played for stakes, not for rating: no score, and no rating moved
    assert_eq!(f.alice.games_played() + f.bob.games_played(), 0);
    assert_eq!(f.alice.rating(), glicko::default());
    assert_eq!(f.bob.rating(), glicko::default());

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

/// A game for stakes goes on no score and moves no rating, whatever ended it:
/// only ranked games do.
#[test]
fun test_stakes_are_unrated() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;

    // Alice abandons: a win for Bob, and nothing on either score
    let mut game = f.start();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.games_played() + f.bob.games_played(), 0);
    assert_eq!(f.alice.rating(), glicko::default());
    assert_eq!(f.bob.rating(), glicko::default());

    // nobody shows, past Alice's suspension
    f.clock.set_for_testing(SUSPENSION_MS);
    let mut game = f.start();
    f.clock.set_for_testing(SUSPENSION_MS + DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.games_played() + f.bob.games_played(), 0);
    assert_eq!(f.alice.rating(), glicko::default());

    fixture.finish();
}

/// Bob's recruit falls at the hands of Alice's, on the tile it stands on.
fun alice_kills_bob(f: &mut Fixture, game: &mut Game) {
    game.kill(vector[f.bob_recruit]);
}

/// A fight to the end: the survivor comes home with a winner's experience; the
/// ratings stay, as stakes are not ranked.
#[test]
fun test_a_finished_fight_earns() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.alice_kills_bob(&mut game);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    let id = f.alice_recruit;
    assert_eq!(f.look_at!(id, |r| r.xp()), SURVIVAL_XP + WIN_XP);

    assert_eq!(f.alice.rating(), glicko::default());
    assert_eq!(f.bob.rating(), glicko::default());
    fixture.finish();
}

/// Both sides gone at once: a draw, and nobody left to earn anything.
#[test]
fun test_a_draw() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    f.alice_kills_bob(&mut game);
    game.kill(vector[f.alice_recruit]);
    assert_eq!(game.state, State::Over(Ending::Draw));
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.num_recruits(), 0);
    fixture.finish();
}

/// Walking out earns nothing. The survivors still go home. The one left behind
/// earns a little, once the game has got somewhere.
#[test]
fun test_a_walkout_earns_little() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy(&mut game);

    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.alice.rating(), glicko::default());
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

/// Not deploying earns nobody anything either, and costs the one who didn't a
/// suspension.
#[test]
fun test_a_no_show_earns_nobody() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(vector[f.alice_recruit]), f.ts.ctx());

    f.clock.set_for_testing(DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert_eq!(f.bob.rating(), glicko::default());
    assert_eq!(f.bob.suspended_until(), DEPLOY_LIMIT_MS + 1 + SUSPENSION_MS);
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
    game.map.units_of_by_walk(game.players[side])
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

// === Effects ===

/// Utility kinds, see `items::utility`.
const FRAG: u8 = 0;
const FLASHBANG: u8 = 1;
const SMOKE: u8 = 2;

/// An armed recruit carrying the utility of the `kind`, in the `Account` of the sender.
fun hire_carrying(acc: &mut Account, kind: u8, ctx: &mut TxContext): ID {
    let mut recruit = recruit_module::new("Jane Doe", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(3, ctx));
    recruit.add_utility(items::utility(kind, ctx));
    let id = object::id(&recruit);
    acc.add_recruit(recruit);
    id
}

/// One recruit a side carrying the utility of `$kind` on an empty 6x6 map:
/// Alice at (0, 0), Bob at (0, 3). Deployed, Alice is next.
macro fun setup_carriers($kind: u8): (Fixture, Game) {
    let kind = $kind;
    let mut f = setup_on!(
        |id| map::new(id, 6),
        vector[vector[0, 0], vector[0, 3]],
        |acc, ctx| hire_carrying(acc, kind, ctx),
    );
    let mut game = f.start();
    f.deploy(&mut game);
    (f, game)
}

/// Throw the grenade of the utility `kind` (flashbang or smoke) as `acc`.
fun throw_effect(
    f: &mut Fixture,
    game: &mut Game,
    alice: bool,
    kind: u8,
    from: vector<u16>,
    to: vector<u16>,
) {
    let acc = if (alice) &f.alice else &f.bob;
    if (kind == FLASHBANG) {
        perform_flashbang(game, acc, &f.clock, from[0], from[1], to[0], to[1], f.ts.ctx())
    } else perform_smoke_grenade(game, acc, &f.clock, from[0], from[1], to[0], to[1], f.ts.ctx())
}

/// End the turn of the side whose it is.
fun end_turn(f: &mut Fixture, game: &mut Game) {
    let alice = game.active_side() == 0;
    f.ts.next_tx(if (alice) ALICE else BOB);
    let acc = if (alice) &f.alice else &f.bob;
    next_turn(game, acc, &f.clock, f.ts.ctx());
    f.ts.next_tx(if (alice) BOB else ALICE);
}

/// The effects every unit carries are what a replay of the history says.
fun check_replay(game: &Game) { game.map.assert_effects_replay(game.history.inner()) }

/// The effect of the `kind` thrown on Alice's turn, at (0, 1): both units have
/// it, Alice's thrower too, through her turn and Bob's, and it ends when Bob
/// ends his. Thrown on Bob's turn, it ends when Alice ends hers.
fun effect_timing(kind: u8, effect: ghosts::effect::Effect) {
    use std::unit_test::assert_eq;

    let (mut fixture, mut game) = setup_carriers!(kind);
    let f = &mut fixture;
    let ticked = ghosts::effect::new(effect.kind(), 1);

    // thrown on Alice's turn
    f.throw_effect(&mut game, true, kind, vector[0, 0], vector[0, 1]);
    assert_eq!(game.map.effects_at(0, 0), vector[effect]);
    assert_eq!(game.map.effects_at(0, 3), vector[effect]);
    check_replay(&game);
    f.end_turn(&mut game); // Alice ends: Bob's turn, one left
    assert_eq!(game.map.effects_at(0, 0), vector[ticked]);
    assert_eq!(game.map.effects_at(0, 3), vector[ticked]);
    check_replay(&game);
    f.end_turn(&mut game); // Bob ends: gone
    assert_eq!(game.map.effects_at(0, 0), vector[]);
    assert_eq!(game.map.effects_at(0, 3), vector[]);
    let records = game.history.inner();
    let n = records.length();
    assert_eq!(records[n - 3], history::new_next_turn(2));
    assert_eq!(records[n - 2], history::new_effect_end(0, 0, effect.kind()));
    assert_eq!(records[n - 1], history::new_effect_end(0, 3, effect.kind()));
    check_replay(&game);

    // Alice's turn again; she ends it, Bob throws on his
    f.end_turn(&mut game);
    f.throw_effect(&mut game, false, kind, vector[0, 3], vector[0, 2]);
    assert_eq!(game.map.effects_at(0, 0), vector[effect]);
    assert_eq!(game.map.effects_at(0, 3), vector[effect]);
    f.end_turn(&mut game); // Bob ends: Alice's turn, one left
    assert_eq!(game.map.effects_at(0, 0), vector[ticked]);
    assert_eq!(game.map.effects_at(0, 3), vector[ticked]);
    check_replay(&game);
    f.end_turn(&mut game); // Alice ends: gone
    assert_eq!(game.map.effects_at(0, 0), vector[]);
    assert_eq!(game.map.effects_at(0, 3), vector[]);
    check_replay(&game);

    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}

#[test]
fun test_daze_timing() { effect_timing(FLASHBANG, ghosts::effect::daze()) }

#[test]
fun test_smoke_timing() { effect_timing(SMOKE, ghosts::effect::smoke()) }

#[test, expected_failure(abort_code = ENotYourTurn)]
fun test_flashbang_out_of_turn_fail() {
    let (mut f, mut game) = setup_carriers!(FLASHBANG);
    f.ts.next_tx(BOB);
    f.throw_effect(&mut game, false, FLASHBANG, vector[0, 3], vector[0, 2]);
    abort
}

#[test, expected_failure(abort_code = ENotYourTurn)]
fun test_smoke_grenade_out_of_turn_fail() {
    let (mut f, mut game) = setup_carriers!(SMOKE);
    f.ts.next_tx(BOB);
    f.throw_effect(&mut game, false, SMOKE, vector[0, 3], vector[0, 2]);
    abort
}

#[test, expected_failure(abort_code = ENotYourUnit)]
fun test_flashbang_with_opponents_unit_fail() {
    let (mut f, mut game) = setup_carriers!(FLASHBANG);
    f.throw_effect(&mut game, true, FLASHBANG, vector[0, 3], vector[0, 2]);
    abort
}

#[test, expected_failure(abort_code = ETurnExpired)]
fun test_smoke_grenade_after_time_limit_fail() {
    let (mut f, mut game) = setup_carriers!(SMOKE);
    f.clock.increment_for_testing(FIRST_TURN_MS + 1);
    f.throw_effect(&mut game, true, SMOKE, vector[0, 0], vector[0, 1]);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
/// The frag grenade's carrier has no flashbang: a grenade must be equipped.
fun test_flashbang_without_utility_fail() {
    let (mut f, mut game) = setup_carriers!(FRAG);
    f.throw_effect(&mut game, true, FLASHBANG, vector[0, 0], vector[0, 1]);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
/// The flashbang's carrier has no smoke grenade.
fun test_smoke_grenade_without_utility_fail() {
    let (mut f, mut game) = setup_carriers!(FLASHBANG);
    f.throw_effect(&mut game, true, SMOKE, vector[0, 0], vector[0, 1]);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
/// The smoke grenade's carrier throws no frag grenade.
fun test_frag_with_smoke_utility_fail() {
    let (mut f, mut game) = setup_carriers!(SMOKE);
    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, 0, 0, 0, 1, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::ENoUsesLeft)]
fun test_flashbang_once_per_match() {
    let (mut f, mut game) = setup_carriers!(FLASHBANG);
    f.throw_effect(&mut game, true, FLASHBANG, vector[0, 0], vector[0, 1]);
    f.throw_effect(&mut game, true, FLASHBANG, vector[0, 0], vector[0, 1]);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::ENoUsesLeft)]
fun test_smoke_grenade_once_per_match() {
    let (mut f, mut game) = setup_carriers!(SMOKE);
    f.throw_effect(&mut game, true, SMOKE, vector[0, 0], vector[0, 1]);
    f.end_turn(&mut game);
    f.end_turn(&mut game);
    f.throw_effect(&mut game, true, SMOKE, vector[0, 0], vector[0, 1]);
    abort
}

#[test, expected_failure(abort_code = ghosts::recruit::EUtilitiesFull)]
/// One utility slot, one grenade: a recruit carrying one takes no second.
fun test_one_grenade_per_recruit() {
    let ctx = &mut tx_context::dummy();
    let mut recruit = recruit_module::new("Jane Doe", ctx);
    recruit.add_utility(items::utility(FLASHBANG, ctx));
    recruit.add_utility(items::utility(SMOKE, ctx));
    abort
}

/// The tile of the unit of `owner` among `tiles` that has the action `kind`.
fun carrier_tile(game: &Game, tiles: vector<vector<u16>>, kind: action::ActionKind): vector<u16> {
    let at = tiles.find_index!(|t| game.map.unit(t[0], t[1]).borrow().has_action(kind));
    tiles[at.destroy_some()]
}

#[test]
/// A scripted match with both grenades on both sides, two recruits a side: a
/// smoke, its refresh by the other side, a daze on top, a unit walking off in
/// its effects, a kill, expiry, and a new daze. After every step, a replay of
/// the history from the start gives exactly the effects the units carry.
fun test_effects_replay_through_a_match() {
    use grid::direction::down;
    use std::unit_test::assert_eq;
    use ghosts::effect;

    let mut fixture = setup_on!(
        |id| map::new(id, 8),
        vector[vector[0, 0], vector[0, 1], vector[0, 3], vector[0, 4]],
        |acc, ctx| {
            hire_carrying(acc, SMOKE, ctx);
            hire_carrying(acc, FLASHBANG, ctx)
        },
    );
    let f = &mut fixture;
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    check_replay(&game);

    let alice = vector[vector[0u16, 0], vector[0, 1]];
    let bob = vector[vector[0u16, 3], vector[0, 4]];
    let (smoke, flash) = (action::new_smoke_grenade(), action::new_flashbang());
    let (alice_smoke, alice_flash) = (
        carrier_tile(&game, alice, smoke),
        carrier_tile(&game, alice, flash),
    );
    let (bob_smoke, bob_flash) = (carrier_tile(&game, bob, smoke), carrier_tile(&game, bob, flash));

    // Alice smokes all four
    f.throw_effect(&mut game, true, SMOKE, alice_smoke, vector[0, 2]);
    check_replay(&game);
    f.end_turn(&mut game);
    check_replay(&game);
    assert_eq!(game.map.effects_at(0, 0), vector[effect::new(1, 1)]);

    // Bob refreshes the smoke, then dazes all four
    f.throw_effect(&mut game, false, SMOKE, bob_smoke, vector[0, 2]);
    check_replay(&game);
    assert_eq!(game.map.effects_at(0, 0), vector[effect::smoke()]);
    f.throw_effect(&mut game, false, FLASHBANG, bob_flash, vector[0, 2]);
    check_replay(&game);
    assert_eq!(game.map.effects_at(0, 4), vector[effect::smoke(), effect::daze()]);

    // Bob walks a unit off at (0, 4), its effects with it
    move_unit(&mut game, &f.bob, &f.clock, vector[0, 4, down!()], f.ts.ctx());
    check_replay(&game);
    assert_eq!(game.map.effects_at(1, 4), vector[effect::smoke(), effect::daze()]);
    f.end_turn(&mut game);
    check_replay(&game);

    // Alice's turn: Bob's unit at (0, 3) falls, its effects with it
    let fallen = game.map.unit(0, 3).borrow().recruit_id();
    let records = vector[game.map.kill_for_testing(fallen)];
    game.history.append(records);
    game.count_losses(&records);
    check_replay(&game);

    // Alice ends: every effect runs out
    f.end_turn(&mut game);
    check_replay(&game);
    assert_eq!(game.map.effects_at(1, 4), vector[]);
    f.end_turn(&mut game);
    check_replay(&game);

    // a new daze from Alice, on her own and Bob's walker
    f.throw_effect(&mut game, true, FLASHBANG, alice_flash, vector[0, 3]);
    check_replay(&game);
    assert_eq!(game.map.effects_at(1, 4), vector[effect::daze()]);
    f.end_turn(&mut game);
    check_replay(&game);

    f.ts.next_tx(ALICE);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}

// Read with `sui move test -s bench_effects`: four armed recruits a side on an
// empty 16x16 map, deployed; `a` is the base, `b` adds one `next_turn` with no
// effects on the map, `c` puts both effects on all eight units, `d` does that
// and one `next_turn` (all sixteen tick, none runs out), `e` two (the second
// ends all sixteen).

/// Four recruits a side on an empty 16x16 map, Alice in row 0, Bob in row 15.
fun setup_effects_bench(): (Fixture, Game) {
    let positions = vector[
        vector[0, 0],
        vector[0, 2],
        vector[0, 4],
        vector[0, 6],
        vector[15, 0],
        vector[15, 2],
        vector[15, 4],
        vector[15, 6],
    ];
    let mut f = setup_on!(|id| map::new(id, 16), positions, |acc, ctx| {
        hire_carrying(acc, FRAG, ctx);
        hire_carrying(acc, FRAG, ctx);
        hire_carrying(acc, FRAG, ctx);
        hire_carrying(acc, FRAG, ctx)
    });
    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    (f, game)
}

/// Daze and smoke on all eight units.
fun effects_on_everyone(game: &mut Game) {
    let tiles = game.map.unit_tiles();
    tiles.do!(|t| {
        let (x, y) = (t / 16, t % 16);
        game.map.apply_effect_for_testing(x, y, ghosts::effect::daze());
        game.map.apply_effect_for_testing(x, y, ghosts::effect::smoke());
    });
}

fun bench_effects(effects: bool, turns: u64) {
    let (mut fixture, mut game) = setup_effects_bench();
    let f = &mut fixture;
    if (effects) effects_on_everyone(&mut game);
    turns.do!(|_| f.end_turn(&mut game));
    transfer::share_object(game);
    fixture.finish();
}

#[test]
fun bench_effects_a_deploy() { bench_effects(false, 0) }

#[test]
fun bench_effects_b_next_turn() { bench_effects(false, 1) }

#[test]
fun bench_effects_b_next_turn_x2() { bench_effects(false, 2) }

#[test]
fun bench_effects_c_applied() { bench_effects(true, 0) }

#[test]
fun bench_effects_d_next_turn() { bench_effects(true, 1) }

#[test]
fun bench_effects_e_next_turn_x2() { bench_effects(true, 2) }

// === Friendly ===

/// The invite code of the invite-only lobbies here, as the host's client makes it.
const CODE: vector<u8> = x"0102030405060708";

/// The hash of `CODE`, which the host's client sends to open the lobby.
fun code_hash(): address {
    let code = CODE;
    address::from_bytes(hash::blake2b256(&code))
}

/// Alice opens a lobby of `size`: invite-only with `CODE`, or listed.
fun open(f: &mut Fixture, size: u8, invite: bool) {
    f.ts.next_tx(ALICE);
    let code_hash = if (invite) option::some(code_hash()) else option::none();
    open_lobby(&mut f.lobbies, &mut f.alice, &f.clock, size, code_hash, f.ts.ctx());
}

/// Bob joins Alice's invite-only lobby with `CODE`, which starts the game.
fun join_invite(f: &mut Fixture): Game {
    f.ts.next_tx(BOB);
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        CODE,
        f.ts.ctx(),
    );
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    game.put_first(object::id(&f.alice));
    game
}

/// Bob takes the guest slot of Alice's listed lobby.
fun join_listed(f: &mut Fixture) {
    f.ts.next_tx(BOB);
    join_open(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
}

/// Alice starts the game of her listed lobby with Bob in it.
fun start_listed(f: &mut Fixture): Game {
    f.ts.next_tx(ALICE);
    start_friendly(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        f.ts.ctx(),
    );
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    game.put_first(object::id(&f.alice));
    game
}

/// Carol, with an `Account` and a recruit: free to play.
fun carol(f: &mut Fixture): Account {
    f.ts.next_tx(CAROL);
    f.registry.new_account(f.ts.ctx());
    f.ts.next_tx(CAROL);
    let mut carol = f.ts.take_shared_by_id<Account>(f.registry.account_of(CAROL));
    hire(&mut carol, f.ts.ctx());
    carol
}

/// Whether there is a lobby of Alice's, of either kind.
fun alice_hosts(f: &Fixture): bool { f.lobbies.is_open(object::id(&f.alice), CODE) }

/// What a game can change on an `Account`, besides where it stands.
public struct Standing has copy, drop {
    rating: Rating,
    score: vector<u64>,
    suspended_until: u64,
    recruits: u64,
}

fun standing(acc: &Account): Standing {
    let (wins, losses, draws) = acc.score();
    Standing {
        rating: acc.rating(),
        score: vector[wins, losses, draws],
        suspended_until: acc.suspended_until(),
        recruits: acc.num_recruits(),
    }
}

/// The recruits at home in an `Account`, as of the last transaction.
fun at_home(f: &mut Fixture, acc: address): vector<ID> {
    let sender = f.ts.sender();
    f.ts.next_tx(sender);
    ts::ids_for_address<Recruit>(acc)
}

/// The experience and rank of each recruit, at home.
fun records(f: &mut Fixture, ids: vector<ID>): vector<vector<u64>> {
    ids.map!(|id| f.look_at!(id, |r| vector[r.xp() as u64, r.rank().ordinal() as u64]))
}

/// `setup` on an empty map with four spawn positions and four recruits a side.
fun setup_four_a_side(): Fixture {
    let mut positions = vector[];
    4u8.do!(|i| positions.push_back(vector[0, i]));
    4u8.do!(|i| positions.push_back(vector[7, i]));
    setup_on!(|id| map::new(id, 8), positions, |acc, ctx| {
        hire(acc, ctx);
        hire(acc, ctx);
        hire(acc, ctx);
        hire(acc, ctx)
    })
}

/// A whole friendly game by invite on Black Rain: the code starts it at once, the
/// host first, both sides deploy, Bob loses everyone, and the game is wrapped up.
/// Nothing on either `Account` moved, and Bob's fallen are home, alive.
#[test]
fun test_friendly_by_invite() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    let (alice_home, bob_home) = (alice.to_address(), bob.to_address());
    let (alice_before, bob_before) = (standing(&f.alice), standing(&f.bob));
    let (alice_squad, bob_squad) = (f.at_home(alice_home), f.at_home(bob_home));
    let (alice_records, bob_records) = (f.records(alice_squad), f.records(bob_squad));

    // Alice opens: she searches on the key, the code hashed twice
    f.open(3, true);
    let key = lobby::protected_key(CODE).to_id();
    assert_eq!(f.alice.search_order(), option::some(key));
    assert!(f.alice_hosts());

    // Bob brings the code: the game is on, the lobby gone, both playing
    let mut game = f.join_invite();
    let id = object::id(&game);
    assert!(!f.alice_hosts());
    assert_eq!(f.alice.playing(), option::some(id));
    assert_eq!(f.bob.playing(), option::some(id));
    assert_eq!(game.players, vector[alice, bob]);
    assert_eq!(game.mode(), Mode::Friendly { size: 3 });
    assert_eq!(game.active_side(), 0);
    assert!(game.is_deploying());
    assert_eq!(game.deploy_until_ms(), DEPLOY_LIMIT_MS);

    // three a side; Bob loses two, who stay in the game past the turn, then the last
    f.deploy_black_rain(&mut game);
    let fallen = game.squad(1);
    assert_eq!(fallen.length(), 3);
    game.kill(vector[fallen[0], fallen[1]]);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert!(game.recruits.contains(fallen[0]) && game.recruits.contains(fallen[1]));
    game.kill(vector[fallen[2]]);
    assert_eq!(game.winner(), option::some(alice));

    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(standing(&f.alice), alice_before);
    assert_eq!(standing(&f.bob), bob_before);
    assert_eq!(f.dog_tags(bob_home), 0);
    let bob_after = f.at_home(bob_home);
    assert_eq!(bob_after.length(), 3);
    bob_squad.do!(|id| assert!(bob_after.contains(&id)));
    assert_eq!(f.records(alice_squad), alice_records);
    assert_eq!(f.records(bob_squad), bob_records);

    fixture.finish();
}

/// A whole friendly game in a listed lobby: Bob takes the slot and waits, Alice
/// starts, and walks out once it is under way. Nobody is suspended, and nothing
/// on either `Account` moved.
#[test]
fun test_friendly_listed() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    let (alice_before, bob_before) = (standing(&f.alice), standing(&f.bob));
    let bob_squad = f.at_home(bob.to_address());
    let bob_records = f.records(bob_squad);

    // the key is Alice's `Account`, and Bob waits on it too
    f.open(4, false);
    assert_eq!(f.alice.search_order(), option::some(alice));
    assert!(f.lobbies.guest(alice).is_none());
    f.join_listed();
    assert_eq!(f.bob.search_order(), option::some(alice));
    assert_eq!(f.lobbies.guest(alice), option::some(bob));

    let mut game = f.start_listed();
    let id = object::id(&game);
    assert!(!f.alice_hosts());
    assert_eq!(f.alice.playing(), option::some(id));
    assert_eq!(f.bob.playing(), option::some(id));
    assert_eq!(game.players, vector[alice, bob]);
    assert_eq!(game.mode(), Mode::Friendly { size: 4 });

    // a casualty, a few turns, and Alice walks out
    f.deploy_black_rain(&mut game);
    let fallen = game.squad(1)[0];
    game.kill(vector[fallen]);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    f.ts.next_tx(ALICE);
    f.clock.set_for_testing(1000);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(standing(&f.alice), alice_before);
    assert_eq!(standing(&f.bob), bob_before);
    assert_eq!(f.records(bob_squad), bob_records);

    // and she can play again right away
    f.open(3, false);
    fixture.finish();
}

/// Missing turns and not deploying cost nothing in a friendly game either.
#[test]
fun test_friendly_forfeit_and_no_show() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let (alice_before, bob_before) = (standing(&f.alice), standing(&f.bob));

    // Alice goes quiet until she forfeits
    f.open(3, true);
    let mut game = f.join_invite();
    f.deploy(&mut game);
    let mut now = 0u64;
    MAX_MISSED_TURNS.do!(|_| {
        now = now + FIRST_TURN_MS + 1;
        f.clock.set_for_testing(now);
        f.ts.next_tx(BOB);
        next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
        if (!game.is_over()) next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    });
    assert_eq!(game.state, State::Over(Ending::Forfeited(object::id(&f.alice))));
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(standing(&f.alice), alice_before);
    assert_eq!(standing(&f.bob), bob_before);

    // neither deploys
    f.open(3, false);
    f.join_listed();
    let mut game = f.start_listed();
    f.clock.set_for_testing(now + DEPLOY_LIMIT_MS + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert_eq!(game.state, State::Over(Ending::NobodyShowed));
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(standing(&f.alice), alice_before);
    assert_eq!(standing(&f.bob), bob_before);
    assert!(f.alice.is_idle() && f.bob.is_idle());

    fixture.finish();
}

/// A friendly game of four: four a side deploy, and win, draw or lose, all eight
/// come home.
#[test]
fun test_friendly_size() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_four_a_side();
    let f = &mut fixture;
    f.open(4, true);
    let mut game = f.join_invite();
    let (alice_home, bob_home) = (object::id_address(&f.alice), object::id_address(&f.bob));
    let squad = f.at_home(alice_home);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());
    f.ts.next_tx(BOB);
    let squad = f.at_home(bob_home);
    deploy_squad(&mut game, &mut f.bob, &f.clock, tickets(squad), f.ts.ctx());

    let (mut everyone, second) = game.squads();
    everyone.append(second);
    game.kill(everyone);
    assert_eq!(game.state, State::Over(Ending::Draw));
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.num_recruits(), 4);
    assert_eq!(f.bob.num_recruits(), 4);
    assert_eq!(f.at_home(alice_home).length(), 4);
    assert_eq!(f.at_home(bob_home).length(), 4);

    fixture.finish();
}

/// No more recruits than the size, even where the map has room.
#[test, expected_failure(abort_code = ESquadTooLarge)]
fun test_friendly_squad_too_large_fail() {
    let mut fixture = setup_four_a_side();
    let f = &mut fixture;
    f.open(3, true);
    let mut game = f.join_invite();
    let home = object::id_address(&f.alice);
    let squad = f.at_home(home);
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());

    abort
}

/// The host kicks the guest, who is idle again and kept out; another takes the
/// slot.
#[test]
fun test_kick_guest() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));

    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.bob.is_idle());
    assert!(f.lobbies.guest(alice).is_none());
    assert_eq!(f.lobbies.kicked(alice), vector[bob]);

    f.ts.next_tx(CAROL);
    join_open(&mut f.lobbies, &f.alice, &mut carol, &f.clock, f.ts.ctx());
    assert_eq!(f.lobbies.guest(alice), option::some(object::id(&carol)));

    // Bob is free for anything else meanwhile
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());

    ts::return_shared(carol);
    fixture.finish();
}

/// The guest leaves on their own: idle, and free to come back.
#[test]
fun test_leave_lobby() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let alice = object::id(&f.alice);
    f.open(3, false);
    f.join_listed();
    leave_lobby(&mut f.lobbies, &mut f.bob, f.ts.ctx());
    assert!(f.bob.is_idle());
    assert!(f.lobbies.guest(alice).is_none());
    assert!(f.lobbies.kicked(alice).is_empty());

    f.join_listed();
    assert_eq!(f.lobbies.guest(alice), option::some(object::id(&f.bob)));
    fixture.finish();
}

/// The host closes a lobby of either kind at any time, and is idle again.
#[test]
fun test_close_lobby() {
    let mut fixture = setup();
    let f = &mut fixture;

    f.open(3, true);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle());
    assert!(!f.alice_hosts());

    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert!(!f.alice_hosts());

    fixture.finish();
}

/// Past the lifetime, anyone cleans up a lobby with a guest in one transaction:
/// the guest kicked, but not kept out, then the lobby closed. Nobody is left
/// searching in a lobby that is gone.
#[test]
fun test_stranger_cleans_up() {
    let mut fixture = setup();
    let f = &mut fixture;
    let alice = object::id(&f.alice);

    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    f.ts.next_tx(CAROL);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    assert!(f.lobbies.kicked(alice).is_empty());
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert!(!f.alice_hosts());

    // and an invite-only one
    f.open(3, true);
    f.clock.set_for_testing(2 * lobby::lifetime_ms() + 2);
    f.ts.next_tx(CAROL);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle());
    assert!(!f.alice_hosts());

    fixture.finish();
}

/// The kicked list keeps the latest kicks: past the cap, the oldest is forgotten.
#[test]
fun test_kicked_cap() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    f.open(3, false);
    f.lobbies.fill_kicked(alice, lobby::max_kicked(), f.ts.ctx());
    let oldest = f.lobbies.kicked(alice)[0];
    let second = f.lobbies.kicked(alice)[1];

    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    let kicked = f.lobbies.kicked(alice);
    assert_eq!(kicked.length(), lobby::max_kicked());
    assert!(!kicked.contains(&oldest));
    assert_eq!(kicked[0], second);
    assert_eq!(kicked[kicked.length() - 1], bob);

    fixture.finish();
}

// === Friendly: refusals ===

#[test, expected_failure(abort_code = lobby::EKeyTaken)]
fun test_open_taken_key_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.ts.next_tx(BOB);
    open_lobby(&mut f.lobbies, &mut f.bob, &f.clock, 3, option::some(code_hash()), f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::EWrongSize)]
fun test_open_too_small_fail() {
    let mut fixture = setup();
    fixture.open(2, true);
    abort
}

#[test, expected_failure(abort_code = lobby::EWrongSize)]
fun test_open_too_large_fail() {
    let mut fixture = setup();
    fixture.open(5, false);
    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_open_foreign_account_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(BOB);
    open_lobby(&mut f.lobbies, &mut f.alice, &f.clock, 3, option::none(), f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ENoSquad)]
fun test_open_without_recruits_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(CAROL);
    f.registry.new_account(f.ts.ctx());
    f.ts.next_tx(CAROL);
    let mut carol = f.ts.take_shared_by_id<Account>(f.registry.account_of(CAROL));
    open_lobby(&mut f.lobbies, &mut carol, &f.clock, 3, option::none(), f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_join_wrong_code_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.ts.next_tx(BOB);
    let code = x"0102030405060709";
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        code,
        f.ts.ctx(),
    );
    abort
}

/// The code is the permission, but only for its lobby: its host is the one passed.
#[test, expected_failure(abort_code = lobby::EWrongHost)]
fun test_join_wrong_host_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    f.open(3, true);
    f.ts.next_tx(BOB);
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut carol,
        &mut f.bob,
        &f.rng,
        &f.clock,
        CODE,
        f.ts.ctx(),
    );
    abort
}

/// The code hash is never a key: hashing it again is.
#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_join_with_the_hash_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.ts.next_tx(BOB);
    let code = code_hash().to_bytes();
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        code,
        f.ts.ctx(),
    );
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyExpired)]
fun test_join_expired_invite_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    let _game = f.join_invite();
    abort
}

/// Up to the lifetime, to the millisecond, the lobby is open.
#[test]
fun test_join_at_the_lifetime() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.clock.set_for_testing(lobby::lifetime_ms());
    let game = f.join_invite();
    ts::return_shared(game);
    fixture.finish();
}

#[test, expected_failure(abort_code = lobby::ELobbyExpired)]
fun test_join_expired_listed_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    f.join_listed();
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyExpired)]
fun test_start_expired_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    let _game = f.start_listed();
    abort
}

#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_join_listed_without_lobby_fail() {
    let mut fixture = setup();
    fixture.join_listed();
    abort
}

#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_join_listed_invite_only_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.join_listed();
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyFull)]
fun test_join_full_lobby_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(CAROL);
    join_open(&mut f.lobbies, &f.alice, &mut carol, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::EKicked)]
fun test_kicked_rejoins_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.join_listed();
    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_guest_starts_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(BOB);
    start_friendly(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        f.ts.ctx(),
    );
    abort
}

/// Not even past the lifetime: a stranger can only clean up.
#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_stranger_starts_expired_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    f.ts.next_tx(CAROL);
    start_friendly(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        f.ts.ctx(),
    );
    abort
}

#[test, expected_failure(abort_code = lobby::ENoGuest)]
fun test_start_without_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    let _game = f.start_listed();
    abort
}

#[test, expected_failure(abort_code = lobby::EWrongGuest)]
fun test_start_with_wrong_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    start_friendly(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut carol,
        &f.rng,
        &f.clock,
        f.ts.ctx(),
    );
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyNotExpired)]
fun test_stranger_kicks_before_lifetime_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(lobby::lifetime_ms());
    f.ts.next_tx(CAROL);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyNotExpired)]
fun test_stranger_closes_before_lifetime_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.clock.set_for_testing(lobby::lifetime_ms());
    f.ts.next_tx(CAROL);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// The guest cannot close the lobby, nor kick themself out with a record: they leave.
#[test, expected_failure(abort_code = lobby::ELobbyNotExpired)]
fun test_guest_kicks_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyHasGuest)]
fun test_close_with_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ELobbyHasGuest)]
fun test_stranger_closes_with_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(lobby::lifetime_ms() + 1);
    f.ts.next_tx(CAROL);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ENoGuest)]
fun test_kick_without_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

/// Only the guest of the host's lobby can be kicked out of it, not the guest of
/// Carol's.
#[test, expected_failure(abort_code = lobby::ENoGuest)]
fun test_kick_another_lobbys_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    open_lobby(&mut f.lobbies, &mut carol, &f.clock, 3, option::none(), f.ts.ctx());
    f.ts.next_tx(BOB);
    join_open(&mut f.lobbies, &carol, &mut f.bob, &f.clock, f.ts.ctx());
    f.open(3, false);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_open_while_suspended_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SUSPENSION_MS - 1);
    f.open(3, false);
    abort
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_join_while_suspended_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.ts.next_tx(BOB);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SUSPENSION_MS - 1);
    f.ts.next_tx(BOB);
    open_lobby(&mut f.lobbies, &mut f.bob, &f.clock, 3, option::some(code_hash()), f.ts.ctx());
    f.ts.next_tx(ALICE);
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.bob,
        &mut f.alice,
        &f.rng,
        &f.clock,
        CODE,
        f.ts.ctx(),
    );
    abort
}

/// Past the suspension, a lobby is open to the `Account` again.
#[test]
fun test_open_after_suspension() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut game = f.start();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    f.clock.set_for_testing(SUSPENSION_MS);
    f.open(3, false);
    fixture.finish();
}

// === Friendly: the `Account` state machine ===

/// A host is searching: no second lobby, no queue, no other lobby to join.
#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_host_opens_again_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.open(3, true);
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_host_queues_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_host_joins_another_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.ts.next_tx(BOB);
    open_lobby(&mut f.lobbies, &mut f.bob, &f.clock, 3, option::none(), f.ts.ctx());
    f.open(3, true);
    join_open(&mut f.lobbies, &f.bob, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// A guest is searching too: no queue, no other lobby, no lobby of its own.
#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_guest_queues_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_guest_opens_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    open_lobby(&mut f.lobbies, &mut f.bob, &f.clock, 3, option::none(), f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_guest_joins_another_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let mut carol = f.carol();
    open_lobby(&mut f.lobbies, &mut carol, &f.clock, 3, option::none(), f.ts.ctx());
    f.open(3, false);
    f.join_listed();
    join_open(&mut f.lobbies, &carol, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

/// A queued `Account` cannot open or join a lobby.
#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_queued_opens_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    f.open(3, false);
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_queued_joins_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        CODE,
        f.ts.ctx(),
    );
    abort
}

/// Nor can one with a seat waiting.
#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_seat_waiting_opens_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.match_up();
    f.open(3, false);
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_playing_opens_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    let _game = f.start();
    f.open(3, false);
    abort
}

#[test, expected_failure(abort_code = EAlreadySearching)]
fun test_playing_friendly_queues_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    let _game = f.join_invite();
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    abort
}

/// A lobby's search is not in the queue: `cancel_search` refuses it, the host's...
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_search_of_host_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// ...and the guest's, even past every timeout.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_search_of_guest_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.clock.set_for_testing(100 * SEARCH_TIMEOUT_MS);
    f.ts.next_tx(CAROL);
    cancel_search(&mut f.mm, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

/// The queue's search is no lobby's: closing it refuses...
#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_close_queued_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// ...even for a stranger long past the lifetime, and with a seat waiting...
#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_stranger_closes_seat_waiting_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.match_up();
    f.clock.set_for_testing(100 * lobby::lifetime_ms());
    f.ts.next_tx(CAROL);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// ...and leaving refuses it.
#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_leave_queued_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    leave_lobby(&mut f.lobbies, &mut f.alice, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_leave_idle_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    leave_lobby(&mut f.lobbies, &mut f.alice, f.ts.ctx());
    abort
}

/// The host does not leave their own lobby: they close it.
#[test, expected_failure(abort_code = lobby::ENoGuest)]
fun test_host_leaves_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    leave_lobby(&mut f.lobbies, &mut f.alice, f.ts.ctx());
    abort
}

/// The guest does not close the lobby they wait in: they leave it.
#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_guest_closes_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    close_lobby(&mut f.lobbies, &mut f.bob, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = lobby::ENoLobby)]
fun test_close_idle_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_leave_foreign_account_fail() {
    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(CAROL);
    leave_lobby(&mut f.lobbies, &mut f.bob, f.ts.ctx());
    abort
}

/// A rated game after a friendly one: the queue knows nothing of the lobby.
#[test]
fun test_queue_after_friendly() {
    use std::unit_test::assert_eq;

    let mut fixture = setup();
    let f = &mut fixture;
    f.open(3, true);
    let mut game = f.join_invite();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());

    let mut game = f.start();
    assert_eq!(game.mode(), Mode::Stakes);
    f.deploy(&mut game);
    f.alice_kills_bob(&mut game);
    complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    let bob = object::id_address(&f.bob);
    assert_eq!(f.dog_tags(bob), 1);

    fixture.finish();
}

// Read with `sui move test bench_lobby -s`: on Black Rain, each step of a lobby's
// life from the setup, so the difference between two is what the step costs.

#[test]
fun bench_lobby_a_setup() {
    let fixture = setup_black_rain();
    fixture.finish();
}

#[test]
fun bench_lobby_b_open_invite() {
    let mut fixture = setup_black_rain();
    fixture.open(3, true);
    fixture.finish();
}

#[test]
fun bench_lobby_c_join_invite() {
    let mut fixture = setup_black_rain();
    fixture.open(3, true);
    let game = fixture.join_invite();
    ts::return_shared(game);
    fixture.finish();
}

#[test]
fun bench_lobby_d_close_invite() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.open(3, true);
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    fixture.finish();
}

#[test]
fun bench_lobby_e_open_listed() {
    let mut fixture = setup_black_rain();
    fixture.open(3, false);
    fixture.finish();
}

#[test]
fun bench_lobby_f_join_listed() {
    let mut fixture = setup_black_rain();
    fixture.open(3, false);
    fixture.join_listed();
    fixture.finish();
}

#[test]
fun bench_lobby_g_kick() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    fixture.finish();
}

#[test]
fun bench_lobby_h_kick_and_close() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.open(3, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    kick_guest(&mut f.lobbies, &f.alice, &mut f.bob, &f.clock, f.ts.ctx());
    close_lobby(&mut f.lobbies, &mut f.alice, &f.clock, f.ts.ctx());
    fixture.finish();
}

#[test]
fun bench_lobby_i_start() {
    let mut fixture = setup_black_rain();
    fixture.open(3, false);
    fixture.join_listed();
    let game = fixture.start_listed();
    ts::return_shared(game);
    fixture.finish();
}

// === Ranked ===

/// The salt both ranked squads here are committed with: 32 bytes, as a client
/// draws them.
const SALT: vector<u8> = x"5a17000000000000000000000000000000000000000000000000000000005a17";

/// No utility, in a unit's bytes.
const NONE: u8 = 0xFF;

/// Alice's squad, a Contractor's: Assault with a frag grenade (55), Sniper (50),
/// Runner with a flashbang (40). 145 credits of 150.
fun alice_squad(): vector<u8> { vector[1, 2, FRAG, 2, 1, NONE, 1, 1, FLASHBANG] }

/// Bob's squad, a Contractor's: Assault with smoke (55), Assault with a frag
/// grenade (55), Runner with a frag grenade (40). 150 credits of 150.
fun bob_squad(): vector<u8> { vector[1, 2, SMOKE, 1, 2, FRAG, 1, 1, FRAG] }

/// The commitment to a squad with `SALT`: what a client sends to queue.
fun commitment(squad: vector<u8>): address {
    let mut bytes = squad;
    bytes.append(SALT);
    address::from_bytes(hash::blake2b256(&bytes))
}

/// Alice queues for ranked games of three, committed to `squad`.
fun queue_ranked(f: &mut Fixture, squad: vector<u8>) {
    f.ts.next_tx(ALICE);
    let commitment = commitment(squad);
    find_ranked(
        &mut f.three,
        &mut f.alice,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        vector[],
        commitment,
        f.ts.ctx(),
    );
}

/// Bob searches for a ranked game of three with `squad` in the clear: he finds
/// Alice if she is waiting.
fun find_ranked_with(f: &mut Fixture, squad: vector<u8>) {
    f.ts.next_tx(BOB);
    find_ranked(
        &mut f.three,
        &mut f.bob,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        squad,
        @0,
        f.ts.ctx(),
    );
}

/// Alice reveals `squad` with `SALT`, taking her seat.
fun reveal_with(f: &mut Fixture, game: &mut Game, squad: vector<u8>) {
    f.ts.next_tx(ALICE);
    let seat = f.seat();
    reveal_squad(game, &mut f.alice, &f.rules, seat, &f.clock, squad, SALT, f.ts.ctx());
}

/// Alice queues, Bob finds her: the game they are in.
fun match_ranked(f: &mut Fixture): Game {
    f.queue_ranked(alice_squad());
    f.find_ranked_with(bob_squad());
    f.ts.next_tx(ALICE);
    f.ts.take_shared<Game>()
}

/// A ranked game under way: Alice queued, Bob found her, she revealed.
fun start_ranked_game(f: &mut Fixture): Game {
    let mut game = f.match_ranked();
    f.reveal_with(&mut game, alice_squad());
    game
}

/// How the player's ranked games ended, as `[wins, losses, draws]`.
fun score_of(acc: &Account): vector<u64> {
    let (wins, losses, draws) = acc.score();
    vector[wins, losses, draws]
}

/// Wrap up a game, whoever went first.
fun complete(f: &mut Fixture, game: Game) {
    if (game.players[0] == object::id(&f.alice)) {
        complete_game(game, &mut f.alice, &mut f.bob, &f.clock, f.ts.ctx())
    } else complete_game(game, &mut f.bob, &mut f.alice, &f.clock, f.ts.ctx())
}

/// The side of the player in the game.
fun side_of(game: &Game, player: ID): u64 {
    let (_, side) = game.players.index_of(&player);
    side
}

/// Whose turn it is: the sender and the `Account` that acts, in a transaction of
/// theirs.
macro fun on_turn($f: &mut Fixture, $game: &Game): &Account {
    let f = $f;
    let game = $game;
    let alice = game.players[game.active_side()] == object::id(&f.alice);
    f.ts.next_tx(if (alice) ALICE else BOB);
    if (alice) &f.alice else &f.bob
}

/// Every unit of the side falls.
fun wipe_out(game: &mut Game, side: u64) {
    let squad = game.squad(side);
    game.kill(squad);
}

/// Check the side's units are the ranked `squad`, as `from_loadout` builds it,
/// one unit on each of the side's spawns on Black Rain, and nobody else's.
fun check_squad_on_map(game: &Game, side: u64, squad: vector<u8>) {
    use sui::bcs;

    let owner = game.players[side];
    let (_, cols) = game.map.size();
    let mut tiles = game.map.unit_tiles().filter!(|t| {
        game.map.unit(*t / cols, *t % cols).borrow().owner() == owner
    });
    // the squad's first unit went to the side's last spawn: see `place_squad`
    let spawns = spawns(side);
    (squad.length() / 3).do!(|i| {
        let p = spawns[spawns.length() - 1 - i];
        let (x, y) = (p[0] as u16, p[1] as u16);
        let unit = game.map.unit(x, y).borrow();
        let built = unit::from_loadout(
            unit.recruit_id(),
            owner,
            squad[3 * i],
            squad[3 * i + 1],
            squad[3 * i + 2],
        );
        assert!(bcs::to_bytes(unit) == bcs::to_bytes(&built));
        built.destroy();
        let (_, at) = tiles.index_of(&(x * cols + y));
        tiles.remove(at);
    });
    assert!(tiles.is_empty());
}

/// The spawn positions of a side on Black Rain.
fun spawns(side: u64): vector<vector<u8>> {
    let all = map::black_rain_positions();
    vector::tabulate!(3, |i| all[3 * side + i])
}

/// Nobody waiting: Alice's search holds the commitment to her squad, in the queue
/// of three, and her squad is nowhere.
#[test]
fun test_ranked_queue_alone() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    assert!(f.three.is_queued(object::id(&f.alice)));
    assert!(f.alice.search_order().is_some());
    assert_eq!(f.alice.search_queue(), option::some(object::id(&f.three)));
    assert_eq!(f.alice.commitment(), option::some(commitment(alice_squad())));

    f.ts.next_tx(ALICE);
    assert!(!ts::has_most_recent_shared<Game>());
    fixture.finish();
}

/// Bob finds Alice: the game starts between Contractors, Bob's squad is on the
/// map and he is in, who moves first is drawn, and Alice is sent her seat. She
/// reveals: her squad lands, she is in, and the first turn begins. No recruit is
/// in it, and both squads are what their loadouts make.
#[test]
fun test_ranked_match_and_reveal() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    let alice_recruits = f.alice.num_recruits();
    f.queue_ranked(alice_squad());
    f.clock.set_for_testing(1_000);
    f.find_ranked_with(bob_squad());
    let started = event::events_by_type<GameStarted>();
    assert_eq!(started.length(), 1);

    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    let id = object::id(&game);
    let mode = Mode::Ranked { size: 3, tier: 1 };
    assert_eq!(started[0], GameStarted { game: id, players: game.players, mode, listed: true });
    assert!(game.players == vector[alice, bob] || game.players == vector[bob, alice]);
    assert_eq!(game.mode(), mode);
    assert_eq!(game.deploy_until_ms(), 1_000 + f.rules.reveal_limit_ms());
    assert_eq!(f.bob.playing(), option::some(id));
    assert_eq!(f.alice.commitment(), option::some(commitment(alice_squad())));
    assert_eq!(f.three.queue_length(), 0);

    // Bob's squad is on the map, on his side's spawns; Alice's side is empty
    let (alice_side, bob_side) = (side_of(&game, alice), side_of(&game, bob));
    assert_eq!(game.squad(bob_side).length(), 3);
    assert_eq!(game.squad(alice_side).length(), 0);
    game.check_squad_on_map(bob_side, bob_squad());
    assert_eq!(game.history.length(), 3);
    assert_eq!(game.recruits.length(), 0);

    // Alice reveals at her limit, to the millisecond
    f.clock.set_for_testing(1_000 + f.rules.reveal_limit_ms());
    f.reveal_with(&mut game, alice_squad());
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    assert_eq!(f.alice.playing(), option::some(id));
    assert_eq!(game.turn_started_ms(), 1_000 + f.rules.reveal_limit_ms());
    assert_eq!(game.missed(0), 0);
    game.check_squad_on_map(alice_side, alice_squad());
    assert_eq!(game.recruits.length(), 0);
    assert_eq!(f.alice.num_recruits(), alice_recruits);
    check_index(&game);

    // the drawn first mover acts
    let acc = f.on_turn!(&game);
    next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    assert_eq!(game.turn(), 1);

    ts::return_shared(game);
    fixture.finish();
}

/// Who moves first is drawn, game by game: both come up.
#[test]
fun test_ranked_first_mover_is_drawn() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (mut finder_first, mut waiter_first) = (false, false);
    let mut now = 0;
    8u64.do!(|_| {
        let mut game = f.start_ranked_game();
        if (game.players[0] == object::id(&f.bob)) finder_first = true else waiter_first = true;

        f.ts.next_tx(ALICE);
        abandon_game(&mut game, &f.alice, f.ts.ctx());
        f.complete(game);
        now = now + SUSPENSION_MS;
        f.clock.set_for_testing(now);
        f.alice.set_record_for_testing(1500, 0);
        f.bob.set_record_for_testing(1500, 0);
    });
    assert!(finder_first && waiter_first);
    fixture.finish();
}

/// The draw changes only the order of the players and the side the finder's
/// squad stands on: the `Game`, the seat and the event are the same bytes either
/// way, so that a finder cannot set a gas budget only one order fits in.
#[test]
fun test_first_mover_draw_costs_the_same() {
    use std::unit_test::assert_eq;
    use sui::bcs;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));
    let mode = Mode::Ranked { size: 3, tier: 1 };
    let mut sizes = vector[];
    vector[true, false].do!(|finder_first| {
        f.ts.next_tx(BOB);
        start_ranked(&f.preset, alice, &mut f.bob, mode, bob_squad(), finder_first, 1, f.ts.ctx());
        let event = bcs::to_bytes(&event::events_by_type<GameStarted>()[0]);
        f.bob.clear_search();

        f.ts.next_tx(BOB);
        let game = f.ts.take_shared<Game>();
        let seat = f.ts.take_from_address<Seat>(alice.to_address());
        let bob_side = if (finder_first) 0 else 1;
        assert_eq!(game.players[bob_side], bob);
        assert_eq!(game.squad(bob_side).length(), 3);
        assert_eq!(game.squad(1 - bob_side).length(), 0);
        sizes.push_back(vector[
            bcs::to_bytes(&game).length(),
            bcs::to_bytes(&seat).length(),
            event.length(),
        ]);
        ts::return_to_address(alice.to_address(), seat);
        ts::return_shared(game);
    });
    assert_eq!(sizes[0], sizes[1]);
    fixture.finish();
}

#[test, expected_failure(abort_code = ERevealMismatch)]
fun test_reveal_with_wrong_salt_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    f.ts.next_tx(ALICE);
    let seat = f.seat();
    let salt = x"5a17000000000000000000000000000000000000000000000000000000005a18";
    reveal_squad(
        &mut game,
        &mut f.alice,
        &f.rules,
        seat,
        &f.clock,
        alice_squad(),
        salt,
        f.ts.ctx(),
    );
    abort
}

/// Another squad than the one committed to, however legal.
#[test, expected_failure(abort_code = ERevealMismatch)]
fun test_reveal_another_squad_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    f.reveal_with(&mut game, bob_squad());
    abort
}

/// A squad committed to, but over the budget: it never lands.
#[test, expected_failure(abort_code = rules::EOverBudget)]
fun test_reveal_over_budget_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let squad = vector[2, 2, FRAG, 2, 2, FRAG, 1, 1, NONE];
    f.queue_ranked(squad);
    f.find_ranked_with(bob_squad());
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    f.reveal_with(&mut game, squad);
    abort
}

#[test, expected_failure(abort_code = EDeploymentOver)]
fun test_reveal_late_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    f.clock.set_for_testing(f.rules.reveal_limit_ms() + 1);
    f.reveal_with(&mut game, alice_squad());
    abort
}

/// Only the owner reveals: the squad is theirs to show.
#[test, expected_failure(abort_code = account::ENotOwner)]
fun test_reveal_for_someone_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    f.ts.next_tx(CAROL);
    let seat = f.seat();
    reveal_squad(
        &mut game,
        &mut f.alice,
        &f.rules,
        seat,
        &f.clock,
        alice_squad(),
        SALT,
        f.ts.ctx(),
    );
    abort
}

/// A ranked seat is not accepted without its squad: whoever took it would strip
/// the commitment.
#[test, expected_failure(abort_code = ERevealFirst)]
fun test_accept_ranked_seat_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let _game = f.match_ranked();
    f.ts.next_tx(BOB);
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    abort
}

/// Nobody but the owner takes a ranked seat while the reveal is open.
#[test, expected_failure(abort_code = EStillDeploying)]
fun test_take_seat_early_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let game = f.match_ranked();
    f.clock.set_for_testing(f.rules.reveal_limit_ms());
    f.ts.next_tx(BOB);
    let seat = f.seat();
    take_seat(&game, &mut f.alice, seat, &f.clock, f.ts.ctx());
    abort
}

/// A ranked squad is revealed, never deployed from recruits.
#[test, expected_failure(abort_code = EWrongMode)]
fun test_deploy_into_ranked_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    let seat = f.seat();
    take_seat(&game, &mut f.alice, seat, &f.clock, f.ts.ctx());
    let squad = ts::ids_for_address<Recruit>(object::id_address(&f.alice));
    deploy_squad(&mut game, &mut f.alice, &f.clock, tickets(squad), f.ts.ctx());
    abort
}

/// Alice never reveals: past the limit Bob moves the game on, a no-show, and wraps
/// it up once a stranger takes her seat for her. She loses rating and a game, and
/// is suspended; he wins both.
#[test]
fun test_ranked_no_show() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    let limit = f.rules.reveal_limit_ms();

    f.clock.set_for_testing(limit + 1);
    f.ts.next_tx(BOB);
    next_turn(&mut game, &f.bob, &f.clock, f.ts.ctx());
    assert_eq!(game.state, State::Over(Ending::NoShow(object::id(&f.alice))));

    f.ts.next_tx(CAROL);
    let seat = f.seat();
    take_seat(&game, &mut f.alice, seat, &f.clock, f.ts.ctx());
    f.complete(game);
    let ended = event::events_by_type<GameEnded>();
    assert_eq!(ended.length(), 1);
    assert_eq!(ended[0].ending, Ending::NoShow(object::id(&f.alice)));
    assert_eq!(ended[0].ended_ms, limit + 1);

    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until(), limit + 1 + SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), 0);
    assert_eq!(score_of(&f.alice), vector[0, 1, 0]);
    assert_eq!(score_of(&f.bob), vector[1, 0, 0]);
    assert!(f.alice.rating().rating() < 1500 && f.bob.rating().rating() > 1500);

    fixture.finish();
}

/// The owner can give up on the reveal: the seat taken, nobody on the map, a
/// no-show at the limit.
#[test]
fun test_owner_takes_seat_without_squad() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.match_ranked();
    let seat = f.seat();
    take_seat(&game, &mut f.alice, seat, &f.clock, f.ts.ctx());
    assert_eq!(f.alice.playing(), option::some(object::id(&game)));

    f.clock.set_for_testing(f.rules.reveal_limit_ms() + 1);
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    assert_eq!(game.state, State::Over(Ending::NoShow(object::id(&f.alice))));
    f.complete(game);
    fixture.finish();
}

/// A search shows its squad only to a waiting player: with nobody waiting, a
/// squad in the clear is refused.
#[test, expected_failure(abort_code = ESquadShown)]
fun test_ranked_squad_shown_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.find_ranked_with(bob_squad());
    abort
}

/// And with somebody waiting, a search without one is refused, to send again.
#[test, expected_failure(abort_code = rules::ESquadSize)]
fun test_ranked_find_without_squad_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    f.find_ranked_with(vector[]);
    abort
}

#[test, expected_failure(abort_code = rules::EItemLocked)]
fun test_ranked_find_with_locked_item_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    f.find_ranked_with(vector[3, 1, NONE, 1, 1, NONE, 1, 1, NONE]);
    abort
}

/// Four a side have no level: nobody queues for it.
#[test, expected_failure(abort_code = rules::ENoLevel)]
fun test_ranked_four_has_no_level_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let commitment = commitment(alice_squad());
    find_ranked(
        &mut f.four,
        &mut f.alice,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        vector[],
        commitment,
        f.ts.ctx(),
    );
    abort
}

/// The level is the one the rules name for the size, not the caller's.
#[test, expected_failure(abort_code = EWrongLevel)]
fun test_ranked_wrong_level_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.rules.set_level_for_testing(3, @0xB1.to_id());
    f.queue_ranked(alice_squad());
    abort
}

/// A ranked queue the rules do not know.
#[test, expected_failure(abort_code = rules::EWrongQueue)]
fun test_ranked_unknown_queue_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let config = f.three.config();
    let mut mm = matchmaker::new(internal::permit<Ranked>(), config, f.ts.ctx());
    find_ranked(
        &mut mm,
        &mut f.alice,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        vector[],
        @0,
        f.ts.ctx(),
    );
    abort
}

/// Players meet only within their tier: a Rookie at 1399 and a Contractor at 1400
/// never, however long they wait; a Contractor at 1649 meets the one at 1400.
#[test]
fun test_ranked_rookie_never_meets_contractor() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut carol = f.carol();

    // both placed, both waiting, up to the ticket lifetime
    f.alice.set_record_for_testing(1399, 5);
    f.bob.set_record_for_testing(1400, 5);
    f.queue_ranked(alice_squad());
    f.clock.set_for_testing(TICKET_TTL_MS);
    f.find_ranked_with(vector[]);
    assert_eq!(f.three.queue_length(), 2);

    // a Contractor at the top of the tier finds the one at its bottom, not the Rookie
    carol.set_record_for_testing(1649, 5);
    f.ts.next_tx(CAROL);
    find_ranked(
        &mut f.three,
        &mut carol,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        bob_squad(),
        @0,
        f.ts.ctx(),
    );
    assert!(carol.playing().is_some());
    assert_eq!(f.three.queue_length(), 1);
    assert!(f.three.is_queued(object::id(&f.alice)));

    ts::return_shared(carol);
    fixture.finish();
}

/// Nor a Contractor at 1649 and an Operative at 1650.
#[test]
fun test_ranked_contractor_never_meets_operative() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.alice.set_record_for_testing(1649, 5);
    f.bob.set_record_for_testing(1650, 5);
    f.queue_ranked(alice_squad());
    f.clock.set_for_testing(TICKET_TTL_MS);
    f.find_ranked_with(vector[]);
    assert_eq!(f.three.queue_length(), 2);
    assert!(f.bob.playing().is_none());
    fixture.finish();
}

/// The placement floor: a new player who lost down to 1340 is still a Contractor
/// for their first games, and meets one at 1500, at a Contractor's budget.
#[test]
fun test_ranked_placement_floor_pairs() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.alice.set_record_for_testing(1340, 0);
    f.bob.set_record_for_testing(1500, 4);
    let game = f.match_ranked();
    assert_eq!(game.mode(), Mode::Ranked { size: 3, tier: 1 });
    ts::return_shared(game);
    fixture.finish();
}

/// Alice leaves the queue: idle, her commitment gone with the search.
#[test]
fun test_cancel_ranked() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    cancel_ranked(&mut f.three, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle());
    assert!(f.alice.commitment().is_none());
    assert_eq!(f.three.queue_length(), 0);

    // anyone, once the search timed out
    f.queue_ranked(alice_squad());
    f.clock.set_for_testing(SEARCH_TIMEOUT_MS + 1);
    f.ts.next_tx(CAROL);
    cancel_ranked(&mut f.three, &mut f.alice, &f.clock, f.ts.ctx());
    assert!(f.alice.is_idle());
    fixture.finish();
}

/// The search is in the queue of three, not four.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_ranked_other_queue_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    cancel_ranked(&mut f.four, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// Nor in the queue for stakes.
#[test, expected_failure(abort_code = ESeatWaiting)]
fun test_cancel_ranked_as_stakes_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    cancel_search(&mut f.mm, &mut f.alice, &f.clock, f.ts.ctx());
    abort
}

/// A ranked search past the ticket lifetime is dropped by the next search that
/// walks by: Alice is sent a notice, which clears her search, commitment and all.
/// Nobody is left searching on a ticket that is gone.
#[test]
fun test_ranked_ticket_expiry() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.queue_ranked(alice_squad());
    f.clock.set_for_testing(TICKET_TTL_MS + 1);
    f.find_ranked_with(vector[]);
    assert!(!f.three.is_queued(object::id(&f.alice)));
    assert!(f.three.is_queued(object::id(&f.bob)));
    assert!(f.alice.commitment().is_some());

    f.ts.next_tx(CAROL);
    let notice = f.seat();
    dismiss_seat(&mut f.alice, notice);
    assert!(f.alice.is_idle());
    assert!(f.alice.commitment().is_none());

    // and she is free to find Bob
    f.ts.next_tx(ALICE);
    let squad = alice_squad();
    find_ranked(
        &mut f.three,
        &mut f.alice,
        &f.rules,
        &f.preset,
        &f.rng,
        &f.clock,
        squad,
        @0,
        f.ts.ctx(),
    );
    assert!(f.alice.playing().is_some());
    assert_eq!(f.three.queue_length(), 0);
    fixture.finish();
}

/// A whole ranked game on Black Rain: the first mover walks up and fires, the
/// other side falls, and the game is wrapped up. Ratings and scores move, and
/// nothing else does: no recruit went in, none comes out, no dog tag, no
/// suspension.
#[test]
fun test_full_ranked_game() {
    use std::unit_test::assert_eq;
    use grid::direction::up;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice_home, bob_home) = (object::id_address(&f.alice), object::id_address(&f.bob));
    let (alice_squad, bob_squad) = (f.at_home(alice_home), f.at_home(bob_home));
    let (alice_records, bob_records) = (f.records(alice_squad), f.records(bob_squad));

    let mut game = f.start_ranked_game();
    let first = game.players[0];
    let acc = f.on_turn!(&game);
    move_unit(
        &mut game,
        acc,
        &f.clock,
        vector[11, 10, up!(), up!(), up!(), up!(), up!()],
        f.ts.ctx(),
    );
    perform_attack(&mut game, acc, &f.rng, &f.clock, 6, 10, 4, 11, f.ts.ctx());
    next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    let acc = f.on_turn!(&game);
    next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    game.wipe_out(1);
    assert_eq!(game.winner(), option::some(first));

    f.ts.next_tx(CAROL);
    f.complete(game);
    let ended = event::events_by_type<GameEnded>();
    assert_eq!(ended.length(), 1);
    assert_eq!(ended[0].ending, Ending::Won(first));

    let (winner, loser) = if (first == object::id(&f.alice)) (&f.alice, &f.bob) else (
        &f.bob,
        &f.alice,
    );
    assert_eq!(score_of(winner), vector[1, 0, 0]);
    assert_eq!(score_of(loser), vector[0, 1, 0]);
    assert!(winner.rating().rating() > 1500 && loser.rating().rating() < 1500);
    assert!(f.alice.is_idle() && f.bob.is_idle());
    assert_eq!(f.alice.suspended_until() + f.bob.suspended_until(), 0);

    assert_eq!(f.at_home(alice_home), alice_squad);
    assert_eq!(f.at_home(bob_home), bob_squad);
    assert_eq!(f.records(alice_squad), alice_records);
    assert_eq!(f.records(bob_squad), bob_records);
    assert_eq!(f.dog_tags(alice_home) + f.dog_tags(bob_home), 0);

    f.ts.next_tx(CAROL);
    assert!(!ts::has_most_recent_shared<Game>());
    fixture.finish();
}

/// Walking out of a ranked game: the other side wins, the ratings move, and the
/// one who left is suspended, then refused a new search until it is over.
#[test]
fun test_ranked_abandon() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start_ranked_game();
    f.clock.set_for_testing(1_000);
    f.ts.next_tx(BOB);
    abandon_game(&mut game, &f.bob, f.ts.ctx());
    f.complete(game);

    assert_eq!(f.bob.suspended_until(), 1_000 + SUSPENSION_MS);
    assert_eq!(f.alice.suspended_until(), 0);
    assert_eq!(score_of(&f.alice), vector[1, 0, 0]);
    assert!(f.bob.rating().rating() < 1500);

    // past the suspension, Bob searches again; both back at 1500, so as to meet
    f.clock.set_for_testing(1_000 + SUSPENSION_MS);
    f.alice.set_record_for_testing(1500, 0);
    f.bob.set_record_for_testing(1500, 0);
    f.queue_ranked(alice_squad());
    f.find_ranked_with(bob_squad());
    assert!(f.bob.playing().is_some());
    fixture.finish();
}

#[test, expected_failure(abort_code = ESuspended)]
fun test_ranked_while_suspended_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start_ranked_game();
    f.clock.set_for_testing(1_000);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.complete(game);
    f.clock.set_for_testing(1_000 + SUSPENSION_MS - 1);
    f.queue_ranked(alice_squad());
    abort
}

/// Missing turns in a row loses a ranked game, and suspends.
#[test]
fun test_ranked_missed_turns() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start_ranked_game();
    let (quiet, other) = (game.players[0], game.players[1]);
    let (sender, alice) = if (other == object::id(&f.alice)) (ALICE, true) else (BOB, false);

    let mut now = 0u64;
    MAX_MISSED_TURNS.do!(|_| {
        now = now + FIRST_TURN_MS + 1;
        f.clock.set_for_testing(now);
        f.ts.next_tx(sender);
        let acc = if (alice) &f.alice else &f.bob;
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
        if (!game.is_over()) next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    });
    assert_eq!(game.state, State::Over(Ending::Forfeited(quiet)));

    f.complete(game);
    let (quiet, other) = if (alice) (&f.bob, &f.alice) else (&f.alice, &f.bob);
    assert_eq!(quiet.suspended_until(), now + SUSPENSION_MS);
    assert_eq!(other.suspended_until(), 0);
    assert_eq!(score_of(other), vector[1, 0, 0]);
    fixture.finish();
}

/// A suspension from a ranked game is the `Account`'s own field: it keeps games
/// of every mode out until it is over, and no game after it clears it.
#[test]
fun test_suspension_outlives_other_games() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start_ranked_game();
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.complete(game);
    assert_eq!(f.alice.suspended_until(), SUSPENSION_MS);

    // a friendly game past it, and one for stakes, leave it as it was
    f.clock.set_for_testing(SUSPENSION_MS);
    f.open(3, true);
    let mut game = f.join_invite();
    f.deploy_black_rain(&mut game);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.complete(game);
    assert_eq!(f.alice.suspended_until(), SUSPENSION_MS);

    let mut game = f.start();
    f.deploy_black_rain(&mut game);
    f.ts.next_tx(BOB);
    abandon_game(&mut game, &f.bob, f.ts.ctx());
    f.complete(game);
    assert_eq!(f.alice.suspended_until(), SUSPENSION_MS);
    assert_eq!(f.bob.suspended_until(), SUSPENSION_MS + SUSPENSION_MS);
    fixture.finish();
}

/// All three grenades on units with no recruit behind them: Alice's squad
/// carries a frag grenade, a flashbang and a smoke grenade, and each unit throws
/// its own at its feet. The frag hurts the thrower, the flashbang dazes and the
/// smoke hides, and the effects run out as on any unit; the history replays them.
#[test]
fun test_grenades_on_virtual_units() {
    use std::unit_test::assert_eq;
    use ghosts::effect;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let squad = vector[1, 1, FRAG, 1, 1, FLASHBANG, 1, 1, SMOKE];
    f.queue_ranked(squad);
    f.find_ranked_with(bob_squad());
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    f.reveal_with(&mut game, squad);
    if (game.players[0] != object::id(&f.alice)) {
        let acc = f.on_turn!(&game);
        next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    };

    // the squad's units stand on Alice's spawns, last to first
    let spawns = spawns(side_of(&game, object::id(&f.alice)));
    let (frag, flash, smoke) = (spawns[2], spawns[1], spawns[0]);
    f.ts.next_tx(ALICE);
    let (x, y) = (frag[0] as u16, frag[1] as u16);
    perform_grenade(&mut game, &f.alice, &f.rng, &f.clock, x, y, x, y, f.ts.ctx());
    assert_eq!(game.map.unit(x, y).borrow().hp(), 10 - (4 - 1));
    let (x, y) = (flash[0] as u16, flash[1] as u16);
    perform_flashbang(&mut game, &f.alice, &f.clock, x, y, x, y, f.ts.ctx());
    assert_eq!(game.map.effects_at(x, y), vector[effect::daze()]);
    let (x, y) = (smoke[0] as u16, smoke[1] as u16);
    perform_smoke_grenade(&mut game, &f.alice, &f.clock, x, y, x, y, f.ts.ctx());
    assert_eq!(game.map.effects_at(x, y), vector[effect::smoke()]);
    check_replay(&game);

    // a turn each, and the effects are gone
    next_turn(&mut game, &f.alice, &f.clock, f.ts.ctx());
    check_replay(&game);
    let acc = f.on_turn!(&game);
    next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    check_replay(&game);
    assert_eq!(game.map.effects_at(flash[0] as u16, flash[1] as u16), vector[]);
    assert_eq!(game.map.effects_at(smoke[0] as u16, smoke[1] as u16), vector[]);

    ts::return_shared(game);
    fixture.finish();
}

// === Levels ===

/// An empty 8x8 map, as `map::from_bytes` reads it, and four spawns a side.
fun open_ground(): (vector<u8>, vector<vector<u8>>) {
    let map = map::new(@0.to_id(), 8);
    let bytes = sui::bcs::to_bytes(&map);
    map.destroy();
    let mut spawns = vector[];
    4u8.do!(|i| spawns.push_back(vector[0, 2 * i]));
    4u8.do!(|i| spawns.push_back(vector[7, 2 * i]));
    (bytes, spawns)
}

/// The holder of the `RulesCap` adds a level with room for four a side and plays
/// ranked squads of four on it: the queue of four opens.
#[test]
fun test_new_level_for_four() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.ts.next_tx(@0);
    let cap = f.ts.take_from_sender<RulesCap>();
    let (map, spawns) = open_ground();
    new_level(&cap, "Open Ground", map, spawns, f.ts.ctx());
    f.ts.next_tx(@0);
    let level = f.ts.take_immutable<Preset>();
    assert_eq!(level.map.id(), object::id(&level));
    let version = f.rules.version();
    set_level(&mut f.rules, &cap, &level, 4);
    assert_eq!(f.rules.level_of(4), object::id(&level));
    assert_eq!(f.rules.version(), version + 1);

    // four a side, ranked, on it
    f.ts.next_tx(ALICE);
    let squad = vector[1, 1, NONE, 1, 1, NONE, 1, 1, NONE, 1, 1, NONE];
    let commitment = commitment(squad);
    find_ranked(
        &mut f.four,
        &mut f.alice,
        &f.rules,
        &level,
        &f.rng,
        &f.clock,
        vector[],
        commitment,
        f.ts.ctx(),
    );
    f.ts.next_tx(BOB);
    find_ranked(
        &mut f.four,
        &mut f.bob,
        &f.rules,
        &level,
        &f.rng,
        &f.clock,
        squad,
        @0,
        f.ts.ctx(),
    );
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    assert_eq!(game.mode(), Mode::Ranked { size: 4, tier: 1 });
    let seat = f.seat();
    reveal_squad(&mut game, &mut f.alice, &f.rules, seat, &f.clock, squad, SALT, f.ts.ctx());
    assert_eq!(game.map.unit_tiles().length(), 8);

    ts::return_shared(game);
    ts::return_immutable(level);
    ts::return_to_address(@0, cap);
    fixture.finish();
}

/// Black Rain has room for three a side, not four.
#[test, expected_failure(abort_code = EBadLevel)]
fun test_set_level_without_room_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.ts.next_tx(@0);
    let cap = f.ts.take_from_sender<RulesCap>();
    set_level(&mut f.rules, &cap, &f.preset, 4);
    abort
}

/// A spawn on a wall is no spawn.
#[test, expected_failure(abort_code = EBadLevel)]
fun test_new_level_spawn_on_wall_fail() {
    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    f.ts.next_tx(@0);
    let cap = f.ts.take_from_sender<RulesCap>();
    let map = sui::bcs::to_bytes(&f.preset.map);
    // (0, 0) is a wall on Black Rain
    assert!(f.preset.map.is_tile_wall(0, 0));
    new_level(&cap, "Walled", map, vector[vector[0, 0], vector[11, 6]], f.ts.ctx());
    abort
}

// === Events ===

/// Every game is announced once, as it is created, whatever its mode: listed but
/// for one from an invite-only lobby. Every one is told once as it ends.
#[test]
fun test_game_events() {
    use std::unit_test::assert_eq;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let (alice, bob) = (object::id(&f.alice), object::id(&f.bob));

    // for stakes: nothing on the search that waits, one on the match
    find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    f.ts.next_tx(BOB);
    find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
    let started = event::events_by_type<GameStarted>();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    assert_eq!(started, vector[game.started(Mode::Stakes, true)]);
    let seat = f.seat();
    accept_seat(&mut f.alice, seat);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.ts.next_tx(CAROL);
    f.complete_announced(game, Ending::Abandoned(alice));

    // friendly by invite: unlisted
    f.clock.set_for_testing(SUSPENSION_MS);
    f.open(3, true);
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    f.ts.next_tx(BOB);
    join_lobby(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        CODE,
        f.ts.ctx(),
    );
    let started = event::events_by_type<GameStarted>();
    f.ts.next_tx(BOB);
    let mut game = f.ts.take_shared<Game>();
    assert_eq!(started, vector[game.started(Mode::Friendly { size: 3 }, false)]);
    abandon_game(&mut game, &f.bob, f.ts.ctx());
    f.complete_announced(game, Ending::Abandoned(bob));

    // friendly, listed
    f.open(4, false);
    f.join_listed();
    f.ts.next_tx(ALICE);
    start_friendly(
        &mut f.lobbies,
        &f.preset,
        &mut f.alice,
        &mut f.bob,
        &f.rng,
        &f.clock,
        f.ts.ctx(),
    );
    let started = event::events_by_type<GameStarted>();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    assert_eq!(started, vector[game.started(Mode::Friendly { size: 4 }, true)]);
    abandon_game(&mut game, &f.alice, f.ts.ctx());
    f.complete_announced(game, Ending::Abandoned(alice));

    // ranked: nothing on the search that waits, nor on the reveal
    f.queue_ranked(alice_squad());
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    f.find_ranked_with(bob_squad());
    let started = event::events_by_type<GameStarted>();
    f.ts.next_tx(ALICE);
    let mut game = f.ts.take_shared<Game>();
    assert_eq!(started, vector[game.started(Mode::Ranked { size: 3, tier: 1 }, true)]);
    f.reveal_with(&mut game, alice_squad());
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
    let side = side_of(&game, bob);
    game.wipe_out(side);
    f.complete_announced(game, Ending::Won(alice));

    fixture.finish();
}

/// The `GameStarted` of a game.
fun started(game: &Game, mode: Mode, listed: bool): GameStarted {
    GameStarted { game: object::id(game), players: game.players, mode, listed }
}

/// Wrap the game up, and check it was told once, ending as `ending`, at the time
/// on the clock.
fun complete_announced(f: &mut Fixture, game: Game, ending: Ending) {
    use std::unit_test::assert_eq;

    let id = object::id(&game);
    f.complete(game);
    let ended_ms = f.clock.timestamp_ms();
    assert_eq!(
        event::events_by_type<GameEnded>(),
        vector[GameEnded { game: id, ending, ended_ms }],
    );
    assert_eq!(event::events_by_type<GameStarted>().length(), 0);
}

// === First mover ===

/// Friendly games and games for stakes draw who goes first too: both come up.
#[test]
fun test_first_mover_drawn_in_every_mode() {
    let mut fixture = setup();
    let f = &mut fixture;
    let alice = object::id(&f.alice);
    let (mut host_first, mut guest_first) = (false, false);
    8u64.do!(|_| {
        f.open(3, true);
        f.ts.next_tx(BOB);
        join_lobby(
            &mut f.lobbies,
            &f.preset,
            &mut f.alice,
            &mut f.bob,
            &f.rng,
            &f.clock,
            CODE,
            f.ts.ctx(),
        );
        f.ts.next_tx(BOB);
        let mut game = f.ts.take_shared<Game>();
        if (game.players[0] == alice) host_first = true else guest_first = true;
        abandon_game(&mut game, &f.bob, f.ts.ctx());
        f.complete(game);
    });
    assert!(host_first && guest_first);

    let (mut waiter_first, mut finder_first) = (false, false);
    let mut now = 0;
    8u64.do!(|_| {
        f.ts.next_tx(ALICE);
        find_game(&mut f.mm, &mut f.alice, &f.preset, &f.rng, &f.clock, f.ts.ctx());
        f.ts.next_tx(BOB);
        find_game(&mut f.mm, &mut f.bob, &f.preset, &f.rng, &f.clock, f.ts.ctx());
        f.ts.next_tx(BOB);
        let mut game = f.ts.take_shared<Game>();
        if (game.players[0] == alice) waiter_first = true else finder_first = true;
        abandon_game(&mut game, &f.bob, f.ts.ctx());
        let seat = f.seat();
        accept_seat(&mut f.alice, seat);
        f.complete(game);
        now = now + SUSPENSION_MS;
        f.clock.set_for_testing(now);
    });
    assert!(waiter_first && finder_first);
    fixture.finish();
}

// Read with `sui move test bench_ranked -s`: on Black Rain, each step of a ranked
// game from the setup, so the difference between two is what the step costs:
// `b` a search that waits, `c` one that finds (`c - b`), `d` the reveal, `e` a
// whole game, wrapped up.

#[test]
fun bench_ranked_a_setup() {
    let fixture = setup_black_rain();
    fixture.finish();
}

#[test]
fun bench_ranked_b_queue() {
    let mut fixture = setup_black_rain();
    fixture.queue_ranked(alice_squad());
    fixture.finish();
}

#[test]
fun bench_ranked_c_match() {
    let mut fixture = setup_black_rain();
    let game = fixture.match_ranked();
    ts::return_shared(game);
    fixture.finish();
}

#[test]
fun bench_ranked_d_reveal() {
    let mut fixture = setup_black_rain();
    let game = fixture.start_ranked_game();
    ts::return_shared(game);
    fixture.finish();
}

#[test]
fun bench_ranked_e_full() {
    use grid::direction::up;

    let mut fixture = setup_black_rain();
    let f = &mut fixture;
    let mut game = f.start_ranked_game();
    let acc = f.on_turn!(&game);
    move_unit(
        &mut game,
        acc,
        &f.clock,
        vector[11, 10, up!(), up!(), up!(), up!(), up!()],
        f.ts.ctx(),
    );
    perform_attack(&mut game, acc, &f.rng, &f.clock, 6, 10, 4, 11, f.ts.ctx());
    next_turn(&mut game, acc, &f.clock, f.ts.ctx());
    game.wipe_out(1);
    f.ts.next_tx(CAROL);
    f.complete(game);
    fixture.finish();
}
