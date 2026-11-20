module ghosts::bench_test;

use ghosts::{
    armor,
    items,
    map,
    recruit::{Self, Recruit},
    stats::{Self, Stats},
    stats_builder,
    weapon
};
use std::unit_test::destroy;
use sui::random;

fun setup(ctx: &mut TxContext): (map::Map, Recruit, Recruit) {
    let id = ctx.fresh_object_address().to_id();
    let mut map = map::demo_1(id);
    let (r1, r3) = (recruit_one(ctx), recruit_two(ctx));
    map.place_recruit(&r1, 6, 5);
    map.place_recruit(&r3, 0, 3);
    (map, r1, r3)
}

fun teardown(map: map::Map, r1: Recruit, r3: Recruit) {
    destroy(vector[r1, r3]);
    let _ = map.destroy();
}

fun do_move(map: &mut map::Map) {
    use grid::direction::{up, left};
    map.move_unit(vector[6, 5, up!(), up!(), left!(), left!(), left!(), left!(), up!()]);
}

#[test]
fun a_baseline() {
    let ctx = &mut tx_context::dummy();
    let (map, r1, r3) = setup(ctx);
    teardown(map, r1, r3);
}

#[test]
fun b_move() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    teardown(map, r1, r3);
}

#[test]
fun c_move_shoot() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_attack(&mut rng, 3, 1, 0, 3);
    teardown(map, r1, r3);
}

#[test]
fun d_move_grenade() {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup(ctx);
    do_move(&mut map);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_grenade(&mut rng, 3, 1, 0, 3);
    teardown(map, r1, r3);
}

fun recruit_one(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::new("Recruit 1", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(3, ctx));
    recruit.add_utility(items::frag_grenade(ctx));
    recruit
}

fun recruit_two(ctx: &mut TxContext): Recruit {
    let mut recruit = recruit::new("Recruit 2", ctx);
    recruit.add_armor(items::armor(2, ctx));
    recruit.add_weapon(items::rifle(2, ctx));
    recruit
}

// === Outcomes ===
//
// Read with `sui move test -s bench_test`: each outcome against the same
// setup, `e_outcome_baseline`, so the difference is what the call costs.
// The attacker at (0, 0) of a 4x4 map shoots or throws at the target at (1, 1).

/// A weapon that always hits for exactly `damage`.
fun sure_shot(damage: u8): Stats {
    stats_builder::new().aim(35).damage(damage).spread(0).crit_chance(0).build_weapon()
}

/// The attacker with `weapon` and a frag grenade, and the target with `armor`,
/// on a 4x4 map.
fun setup_outcome(weapon: Stats, armor: Stats, ctx: &mut TxContext): (map::Map, Recruit, Recruit) {
    let mut map = map::new(ctx.fresh_object_address().to_id(), 4);
    let mut attacker = recruit::default(ctx);
    attacker.add_weapon(weapon::new(b"Test".to_string(), weapon, ctx));
    attacker.add_utility(items::frag_grenade(ctx));
    let mut target = recruit::default(ctx);
    target.add_armor(armor::new(b"Test".to_string(), armor, ctx));
    map.place_recruit(&attacker, 0, 0);
    map.place_recruit(&target, 1, 1);
    (map, attacker, target)
}

/// Shoot from (0, 0) at (1, 1).
fun shoot(weapon: Stats, armor: Stats) {
    let ctx = &mut tx_context::dummy();
    let (mut map, attacker, target) = setup_outcome(weapon, armor, ctx);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_attack(&mut rng, 0, 0, 1, 1);
    teardown(map, attacker, target);
}

/// Throw a grenade from (0, 0) at (1, 1).
fun throw(armor: Stats) {
    let ctx = &mut tx_context::dummy();
    let (mut map, attacker, target) = setup_outcome(sure_shot(1), armor, ctx);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    let _ = map.perform_grenade(&mut rng, 0, 0, 1, 1);
    teardown(map, attacker, target);
}

#[test]
fun e_outcome_baseline() {
    let ctx = &mut tx_context::dummy();
    let (map, attacker, target) = setup_outcome(sure_shot(1), stats::new(0, 0, 0, 0, 0), ctx);
    teardown(map, attacker, target);
}

#[test]
fun f_attack_miss() { shoot(sure_shot(1), stats::new_unchecked(100 << (5 * 8))) }

#[test]
fun g_attack_dodge() { shoot(sure_shot(1), stats::new(0, 0, 0, 0, 100)) }

#[test]
fun h_attack_hit() { shoot(sure_shot(1), stats::new(0, 0, 0, 0, 0)) }

#[test]
fun i_attack_kill() { shoot(sure_shot(99), stats::new(0, 0, 0, 0, 0)) }

#[test]
/// The grenade hits the thrower too: both survive.
fun j_grenade_hit() { throw(stats::new(0, 0, 0, 0, 0)) }

#[test]
/// The target has 4 HP left and falls; the thrower survives.
fun k_grenade_kill() { throw(stats::new(0, 0, 0x80 + 6, 0, 0)) }

// === Outcomes with effects ===
//
// The same shots with effects on the units, the outcome unchanged, so the
// difference to the shots above is what reading the effects costs.

/// `setup_outcome` with the `shooter` and `target` effects put on the units.
fun shoot_with(
    weapon: Stats,
    armor: Stats,
    shooter: vector<ghosts::effect::Effect>,
    target: vector<ghosts::effect::Effect>,
    attack: bool,
) {
    let ctx = &mut tx_context::dummy();
    let (mut map, attacker, defender) = setup_outcome(weapon, armor, ctx);
    shooter.do!(|e| { map.apply_effect_for_testing(0, 0, e); });
    target.do!(|e| { map.apply_effect_for_testing(1, 1, e); });
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    if (attack) {
        let _ = map.perform_attack(&mut rng, 0, 0, 1, 1);
    };
    teardown(map, attacker, defender);
}

/// Daze and smoke.
fun both(): vector<ghosts::effect::Effect> {
    vector[ghosts::effect::daze(), ghosts::effect::smoke()]
}

#[test]
/// `e_outcome_baseline` with both effects on both units.
fun l_outcome_baseline_effects() {
    shoot_with(sure_shot(1), stats::new(0, 0, 0, 0, 0), both(), both(), false)
}

#[test]
/// `f_attack_miss` with both effects on both units: the same miss.
fun m_attack_miss_effects() {
    shoot_with(sure_shot(1), stats::new_unchecked(100 << (5 * 8)), both(), both(), true)
}

#[test]
/// The target of `h_attack_hit` dazed: its aim does not count, the same hit.
fun n_outcome_baseline_target_dazed() {
    shoot_with(
        sure_shot(1),
        stats::new(0, 0, 0, 0, 0),
        vector[],
        vector[ghosts::effect::daze()],
        false,
    )
}

#[test]
/// `h_attack_hit` on a dazed target: the same hit.
fun o_attack_hit_target_dazed() {
    shoot_with(
        sure_shot(1),
        stats::new(0, 0, 0, 0, 0),
        vector[],
        vector[ghosts::effect::daze()],
        true,
    )
}

#[test]
/// A flashbang from (0, 0) at (1, 1): both units dazed.
fun p_flashbang() {
    let ctx = &mut tx_context::dummy();
    let mut map = map::new(ctx.fresh_object_address().to_id(), 4);
    let mut attacker = recruit::default(ctx);
    attacker.add_utility(items::flashbang(ctx));
    let target = recruit::default(ctx);
    map.place_recruit(&attacker, 0, 0);
    map.place_recruit(&target, 1, 1);
    let _ = map.perform_flashbang(0, 0, 1, 1);
    teardown(map, attacker, target);
}

// === Obstacles ===
//
// Read with `sui move test -s bench_test`: on Black Rain, Alice's recruit at
// (11, 6) and Bob's at (3, 6), against `q_black_rain_baseline`. Moves of the
// same length over ground and over obstacles; a shot up column 6 at (8, 6),
// beside the obstacle at (9, 6), the cover tile that was there, or neither;
// a frag at (9, 7) clearing the two obstacles there or the two cover tiles.

/// Black Rain, or `black_rain_as_covers`, with the two recruits on it.
fun setup_black_rain(covers: bool, ctx: &mut TxContext): (map::Map, Recruit, Recruit) {
    let id = ctx.fresh_object_address().to_id();
    let mut map = if (covers) map::black_rain_as_covers(id) else map::black_rain(id);
    let (r1, r3) = (recruit_one(ctx), recruit_two(ctx));
    map.place_recruit(&r1, 11, 6);
    map.place_recruit(&r3, 3, 6);
    (map, r1, r3)
}

/// Move Alice's recruit along `steps` on Black Rain.
fun walk(steps: vector<u8>) {
    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup_black_rain(false, ctx);
    let mut path = vector[11, 6];
    path.append(steps);
    map.move_unit(path);
    teardown(map, r1, r3);
}

/// A shooter that never misses at (12, 6) shoots the target at (8, 6), if
/// `shoot`: beside an obstacle, a cover tile (`covers`) or nothing (`open`) at
/// (9, 6).
fun shoot_up_the_column(covers: bool, open: bool, shoot: bool) {
    let ctx = &mut tx_context::dummy();
    let mut map = if (covers) map::black_rain_as_covers(@1.to_id())
    else map::black_rain(@1.to_id());
    if (open) map.clear_tile_for_testing(9, 6);
    let mut shooter = recruit::default(ctx);
    let aim = stats_builder::new().aim(62).damage(1).spread(0).crit_chance(0).build_weapon();
    shooter.add_weapon(weapon::new(b"Test".to_string(), aim, ctx));
    let target = recruit::default(ctx);
    map.place_recruit(&shooter, 12, 6);
    map.place_recruit(&target, 8, 6);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    if (shoot) {
        let _ = map.perform_attack(&mut rng, 12, 6, 8, 6);
    };
    teardown(map, shooter, target);
}

/// Alice's recruit moves to (8, 3) and, if `throw`, throws a frag at (9, 7).
fun frag_at_the_barrier(covers: bool, throw: bool) {
    use grid::direction::{up, left};

    let ctx = &mut tx_context::dummy();
    let (mut map, r1, r3) = setup_black_rain(covers, ctx);
    map.move_unit(vector[11, 6, up!(), left!(), up!(), left!(), up!(), left!()]);
    let mut rng = random::new_generator_from_seed_for_testing(b"bench");
    if (throw) {
        let _ = map.perform_grenade(&mut rng, 8, 3, 9, 7);
    };
    teardown(map, r1, r3);
}

#[test]
fun q_black_rain_baseline() {
    let ctx = &mut tx_context::dummy();
    let (map, r1, r3) = setup_black_rain(false, ctx);
    teardown(map, r1, r3);
}

#[test]
/// Three steps over ground: (11, 6) to (11, 9).
fun r_move_3_plain() {
    use grid::direction::right;
    walk(vector[right!(), right!(), right!()])
}

#[test]
/// Three steps over the obstacle at (9, 6): (11, 6) to (8, 6).
fun s_move_3_vault() {
    use grid::direction::up;
    walk(vector[up!(), up!(), up!()])
}

#[test]
/// Seven steps over ground: (11, 6) to (5, 5).
fun t_move_7_plain() {
    use grid::direction::{up, left};
    walk(vector[left!(), up!(), up!(), up!(), up!(), up!(), up!()])
}

#[test]
/// Seven steps over the obstacle at (9, 6): (11, 6) to (4, 6).
fun u_move_7_vault() {
    use grid::direction::up;
    walk(vector[up!(), up!(), up!(), up!(), up!(), up!(), up!()])
}

#[test]
/// Seven steps over the obstacles at (9, 7) and (9, 6), up one column and
/// down the next: (11, 6) to (10, 6).
fun v_move_7_two_vaults() {
    use grid::direction::{up, down, left, right};
    walk(vector[right!(), up!(), up!(), up!(), left!(), down!(), down!()])
}

#[test]
/// `w_attack_open` but the shot.
fun w_attack_open_baseline() { shoot_up_the_column(false, true, false) }

#[test]
/// The target at (8, 6) beside nothing: (9, 6) cleared.
fun w_attack_open() { shoot_up_the_column(false, true, true) }

#[test]
/// `x_attack_beside_obstacle` but the shot.
fun x_attack_beside_obstacle_baseline() { shoot_up_the_column(false, false, false) }

#[test]
/// The target at (8, 6) beside the obstacle at (9, 6).
fun x_attack_beside_obstacle() { shoot_up_the_column(false, false, true) }

#[test]
/// `y_attack_beside_cover_tile` but the shot.
fun y_attack_beside_cover_tile_baseline() { shoot_up_the_column(true, false, false) }

#[test]
/// The target at (8, 6) beside the cover tile at (9, 6), low on all four sides.
fun y_attack_beside_cover_tile() { shoot_up_the_column(true, false, true) }

#[test]
/// `q_black_rain_baseline` on `black_rain_as_covers`.
fun q_black_rain_baseline_cover_tiles() {
    let ctx = &mut tx_context::dummy();
    let (map, r1, r3) = setup_black_rain(true, ctx);
    teardown(map, r1, r3);
}

#[test]
/// A frag clears the obstacles at (9, 6) and (9, 7).
fun z_frag_clears_obstacles() { frag_at_the_barrier(false, true) }

#[test]
/// `z_frag_clears_obstacles` but the throw.
fun z_frag_clears_obstacles_baseline() { frag_at_the_barrier(false, false) }

#[test]
/// `z_frag_clears_cover_tiles` but the throw.
fun z_frag_clears_cover_tiles_baseline() { frag_at_the_barrier(true, false) }

#[test]
/// A frag clears the cover tiles at (9, 6) and (9, 7).
fun z_frag_clears_cover_tiles() { frag_at_the_barrier(true, true) }
