// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::map;

/// Kill the unit of the `recruit`, the way an attack does: off its tile and into
/// `fallen`, until `bury`.
public fun kill_for_testing(map: &mut Map, recruit: ID): Record {
    let (rows, cols) = map.size();
    let mut record = option::none();
    rows.do!(|x| cols.do!(|y| {
        if (map.grid[x, y].unit.is_some_and!(|unit| unit.recruit_id() == recruit)) {
            let unit = map.grid[x, y].unit.extract();
            map.fallen.push_back(unit);
            record.fill(history::new_kia(recruit, x, y));
        }
    }));
    record.destroy_some()
}

// === Demo Maps ===

/// Creates a demo map #1.
///
/// - Map: 01 - 7x7 LEGO prototype.
/// - Unit positions: (0, 3), (1, 6), (6, 5)
/// - Firing lane in the demo: (3, 1) <-> (0, 3)
/// - Contains low and high cover around a close-range firing lane.
/// - Schema:
///
/// ```
/// |     |     |2002-|0001-|0002-|     |     |
/// | XXX |     |     |     |     |     |     |
/// |     |     |     |     |     |0001-|0001-|
/// |0100-|0120-|     | XXX |     |1000-|1000-|
/// |0001-|0102-|     |     |     |     |     |
/// |     |     |     |     |     |     |     |
/// |     | XXX |     |     |1100-|0100-|0110-|
/// ```
public fun demo_1(id: ID): Map {
    let mut preset_bytes = bcs::to_bytes(&id);
    // prettier-ignore
    preset_bytes.append(x"07070000000001020000020001000000010001000000020000000000070200000000000000000000000000070000000000000000000001000000010001000000010007010001000000010001020000000002000000010100000000010100000000070100000001000100010002000000000000000000000007000000000000000000000000000007000002000000000001010100000001000100000001000101000000070007");
    preset_bytes.push_back(0); // nobody has fallen
    from_bytes(preset_bytes)
}

/// Creates a demo map #2.
public fun demo_2(id: ID): Map {
    // prettier-ignore
    let mut map = from_bytes(x"00000000000000000000000000000000000000000000000000000000000000000a0a00000000000000000000000000000000000000000a00000101000001000100000001000100000101000000000001010000010001000000010001000001010000000a00000000000000000000000000000000000000000a00000200020002000000000002000200020000000a000001010000010000000100000101000000000000000200000000000a00000000000000000000000000000000000000000a00000000000000000000000000000000000000000a010202000000010001000000010001000000010002020000000000000101020000000100010000000100010000000100020200000a01020000000000000000010000010000000000000000000000000100000200000a010200000200010000000200010000000200010000000200010000000200010000000200010000000200010000000200010000000200010000020200000a000a00");
    map.id = id;
    map
}

public fun debug(map: &Map) {
    std::debug::print(&map.to_string())
}

#[test]
/// A - Attacker
/// Top-left corner - Target
/// ```
///    0  1  2
///  0 _|    A
///  1
///  2 A     A
/// ```
fun test_cover_system_a() {
    use std::unit_test::assert_eq;

    let (no, low, high) = (NO_COVER, LOW_COVER, HIGH_COVER);
    let mut map = new(@0.to_id(), 3);

    assert_eq!(map.cover_bonus(2, 0, 0, 0), 0); // attack up
    assert_eq!(map.cover_bonus(0, 2, 0, 0), 0); // attack left
    assert_eq!(map.cover_bonus(2, 2, 0, 0), 0); // attack up-right

    // top-left corner, protected by covers
    *&mut map.grid[0, 0].tile_type = TileType::Cover { right: low, bottom: low, left: no, top: no };

    assert_eq!(map.cover_bonus(2, 0, 0, 0), DEFENSE_BONUS); // attack up
    assert_eq!(map.cover_bonus(0, 2, 0, 0), DEFENSE_BONUS); // attack left
    assert_eq!(map.cover_bonus(2, 2, 0, 0), DEFENSE_BONUS); // attack up-right

    // replace the top-left cover with high cover
    *&mut map.grid[0, 0].tile_type =
        TileType::Cover { right: high, bottom: high, left: no, top: no };

    assert_eq!(map.cover_bonus(2, 0, 0, 0), 2 * DEFENSE_BONUS); // attack up
    assert_eq!(map.cover_bonus(0, 2, 0, 0), 2 * DEFENSE_BONUS); // attack left
    assert_eq!(map.cover_bonus(2, 2, 0, 0), 2 * DEFENSE_BONUS); // attack up-right

    // now remove the cover on the target tile, and place on neighboring tiles: to the right and bottom
    *&mut map.grid[0, 0].tile_type = TileType::Empty;
    *&mut map.grid[1, 0].tile_type = TileType::Cover { right: no, bottom: no, left: no, top: low };
    *&mut map.grid[0, 1].tile_type = TileType::Cover { right: no, bottom: no, left: low, top: no };

    assert_eq!(map.cover_bonus(2, 0, 0, 0), 1 * DEFENSE_BONUS); // attack up
    assert_eq!(map.cover_bonus(0, 2, 0, 0), 1 * DEFENSE_BONUS); // attack left
    assert_eq!(map.cover_bonus(2, 2, 0, 0), 1 * DEFENSE_BONUS); // attack up-right

    // replace one of the covers with high cover and attack diagonally
    *&mut map.grid[0, 1].tile_type = TileType::Cover { right: no, bottom: no, left: high, top: no };
    assert_eq!(map.cover_bonus(2, 2, 0, 0), 2 * DEFENSE_BONUS); // attack up-right

    map.destroy();
}

#[test]
/// A - Attacker
/// Bottom-right corner - Target
/// ```
///    0  1  2
///  0 A     A
///  1       _
///  2 A    |
/// ```
fun test_cover_system_b() {
    use std::unit_test::assert_eq;

    let (no, low, high) = (NO_COVER, LOW_COVER, HIGH_COVER);
    let mut map = new(@0.to_id(), 3);

    assert_eq!(map.cover_bonus(0, 2, 2, 2), 0); // attack down
    assert_eq!(map.cover_bonus(2, 0, 2, 2), 0); // attack right
    assert_eq!(map.cover_bonus(0, 0, 2, 2), 0); // attack down-right

    // top-left corner, protected by covers
    *&mut map.grid[2, 2].tile_type = TileType::Cover { right: no, bottom: no, left: low, top: low };

    assert_eq!(map.cover_bonus(0, 2, 2, 2), DEFENSE_BONUS); // attack down
    assert_eq!(map.cover_bonus(2, 0, 2, 2), DEFENSE_BONUS); // attack right
    assert_eq!(map.cover_bonus(0, 0, 2, 2), DEFENSE_BONUS); // attack down-right

    // replace the top-left cover with high cover
    *&mut map.grid[2, 2].tile_type =
        TileType::Cover { right: no, bottom: no, left: high, top: high };

    assert_eq!(map.cover_bonus(0, 2, 2, 2), 2 * DEFENSE_BONUS); // attack down
    assert_eq!(map.cover_bonus(2, 0, 2, 2), 2 * DEFENSE_BONUS); // attack right
    assert_eq!(map.cover_bonus(0, 0, 2, 2), 2 * DEFENSE_BONUS); // attack down-right

    // now remove the cover on the target tile, and place on neighboring tiles: to the right and bottom
    *&mut map.grid[2, 2].tile_type = TileType::Empty;
    *&mut map.grid[1, 2].tile_type = TileType::Cover { right: no, bottom: low, left: no, top: no };
    *&mut map.grid[2, 1].tile_type = TileType::Cover { right: low, bottom: no, left: no, top: no };

    assert_eq!(map.cover_bonus(2, 0, 2, 2), 1 * DEFENSE_BONUS); // attack right
    assert_eq!(map.cover_bonus(0, 2, 2, 2), 1 * DEFENSE_BONUS); // attack down
    assert_eq!(map.cover_bonus(0, 0, 2, 2), 1 * DEFENSE_BONUS); // attack down-right

    // replace one of the covers with high cover and attack diagonally
    *&mut map.grid[2, 1].tile_type = TileType::Cover { right: high, bottom: no, left: no, top: no };
    assert_eq!(map.cover_bonus(0, 0, 2, 2), 2 * DEFENSE_BONUS); // attack up-right

    map.destroy();
}

#[test]
// Map in this test is 3x3
//
// First (high cover):
//  o| o  o
//  o  o  o
//  o  o  o
//
// Second (high cover):
//  _  o  o
//  o  o  o
//  o  o  o
//
// Third (low cover):
// _| _ |_
// o| o |o
// o| o |o
fun test_check_path() {
    use grid::direction::{up, down, left, right};

    let mut map = Self::new(@1.to_id(), 3);
    *&mut map.grid[0, 0].tile_type =
        TileType::Cover { left: NO_COVER, right: HIGH_COVER, top: NO_COVER, bottom: NO_COVER };

    // try going right and then back-left
    assert!(map.check_path(vector[0, 0, right!()]).is_none());
    assert!(map.check_path(vector[0, 1, left!()]).is_none());

    // try going down, right and then back-up; then reverse
    assert!(map.check_path(vector[0, 0, down!(), right!(), left!()]).is_some());
    assert!(map.check_path(vector[0, 1, down!(), left!(), up!()]).is_some());
    map.destroy();

    let mut map = Self::new(@1.to_id(), 3);
    *&mut map.grid[0, 0].tile_type =
        TileType::Cover { left: NO_COVER, right: NO_COVER, top: NO_COVER, bottom: HIGH_COVER };

    // try going down and then back-up
    assert!(map.check_path(vector[0, 0, down!()]).is_none());
    assert!(map.check_path(vector[1, 0, up!()]).is_none());

    // try going right, down and then back-left; then reverse
    assert!(map.check_path(vector[0, 0, right!(), down!(), left!()]).is_some());
    assert!(map.check_path(vector[1, 0, right!(), up!(), left!()]).is_some());

    // crawl over the cover
    *&mut map.grid[0, 0].tile_type =
        TileType::Cover {
            left: NO_COVER,
            right: LOW_COVER,
            top: NO_COVER,
            bottom: LOW_COVER,
        };

    *&mut map.grid[0, 1].tile_type =
        TileType::Cover {
            left: LOW_COVER,
            right: NO_COVER,
            top: NO_COVER,
            bottom: LOW_COVER,
        };

    *&mut map.grid[0, 2].tile_type =
        TileType::Cover {
            left: LOW_COVER,
            right: NO_COVER,
            top: LOW_COVER,
            bottom: NO_COVER,
        };

    map.destroy();
}

#[test]
fun test_map_with_units() {
    use sui::random;
    use ghosts::recruit;

    let ctx = &mut tx_context::dummy();
    let mut rng = random::new_generator_from_seed_for_testing(vector[2]);
    let recruit_one = recruit::default(ctx);
    let recruit_two = recruit::default(ctx);

    let mut map = Self::new(@1.to_id(), 6);

    assert!(!map.tile_has_unit(3, 3));
    assert!(!map.tile_has_unit(5, 2));

    map.place_recruit(&recruit_one, 3, 3);
    map.place_recruit(&recruit_two, 5, 2);

    assert!(map.tile_has_unit(3, 3));
    assert!(map.tile_has_unit(5, 2));

    // | | | | | | |
    // | | | | | | |
    // | | | | | |5|
    // | | | |5| | |
    // | | | | | | |
    // | | | | | | |

    // now try to attack another unit with the first one
    let mut damage = 0;
    map.grid[3, 3].unit.do_mut!(|unit| (_, _, _, damage, _) = unit.perform_attack(&mut rng, 4, 0));

    // apply the damage to the second unit
    map.grid[5, 2].unit.borrow_mut().apply_damage(&mut rng, damage, false);

    let (weapon, armor) = recruit_one.dismiss();
    weapon.destroy!(|w| w.destroy());
    armor.destroy!(|a| a.destroy());

    let (weapon, armor) = recruit_two.dismiss();
    weapon.destroy!(|w| w.destroy());
    armor.destroy!(|a| a.destroy());

    map.destroy();
}

#[test]
/// Walls block movement in and out, count as high cover for a neighbor, give
/// no cover as `Unwalkable`, and survive a BCS roundtrip.
fun test_wall() {
    use grid::direction::{down, right};
    use std::unit_test::assert_eq;

    let mut map = new(@0.to_id(), 3);
    *&mut map.grid[1, 1].tile_type = TileType::Wall;

    assert!(map.is_tile_wall(1, 1));
    assert!(!map.is_tile_unwalkable(1, 1));
    assert!(map.check_path(vector[0, 1, down!()]).is_none());
    assert!(map.check_path(vector[1, 0, right!()]).is_none());
    assert!(map.check_path(vector[0, 0, right!(), right!(), down!()]).is_some());

    // target (2, 1) attacked from (0, 1): the wall at (1, 1) is high cover
    assert_eq!(map.cover_bonus(0, 1, 2, 1), 2 * DEFENSE_BONUS);
    assert_eq!(map.cover_bonus(2, 0, 2, 1), 0); // attack from the side

    *&mut map.grid[1, 1].tile_type = TileType::Unwalkable;
    assert_eq!(map.cover_bonus(0, 1, 2, 1), 0);

    *&mut map.grid[1, 1].tile_type = TileType::Wall;
    let restored = from_bytes(bcs::to_bytes(&map));
    assert!(restored.is_tile_wall(1, 1));
    assert_eq!(map.to_string(), restored.to_string());

    restored.destroy();
    map.destroy();
}

#[test, expected_failure(abort_code = ETileIsWall)]
fun test_place_recruit_on_wall_fails() {
    let ctx = &mut tx_context::dummy();
    let recruit = ghosts::recruit::default(ctx);
    let mut map = new(@0.to_id(), 3);
    *&mut map.grid[1, 1].tile_type = TileType::Wall;
    map.place_recruit(&recruit, 1, 1);
    abort
}

#[test, expected_failure(abort_code = ETileIsWall)]
/// An area weapon cannot target a wall tile; checked before the roll.
fun test_area_attack_on_wall_fails() {
    use ghosts::{recruit, stats, weapon};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 3);
    *&mut map.grid[0, 2].tile_type = TileType::Wall;

    // default weapon with `area_size` 1 (radius 1)
    let mut recruit = recruit::default(ctx);
    let launcher = stats::new_unchecked(0x03_04_00_01_01_00_00_02_04 << (6 * 8));
    recruit.add_weapon(weapon::new(b"Launcher".to_string(), launcher, ctx));
    map.place_recruit(&recruit, 0, 0);
    map.perform_attack(&mut rng, 0, 0, 0, 2);
    abort
}

fun cover(left: u8, top: u8, right: u8, bottom: u8): TileType {
    TileType::Cover { left, top, right, bottom }
}

#[test]
/// Line of sight: open map, walls, unwalkable tiles, covers on inner and end
/// edges, corners; every case checked from both ends.
fun test_line_of_sight() {
    let (no, low, high) = (NO_COVER, LOW_COVER, HIGH_COVER);
    let mut map = new(@0.to_id(), 5);

    // open map
    assert!(map.line_of_sight(0, 0, 4, 4) && map.line_of_sight(4, 4, 0, 0));
    assert!(map.line_of_sight(0, 0, 0, 4) && map.line_of_sight(0, 4, 0, 0));
    assert!(map.line_of_sight(0, 0, 4, 0) && map.line_of_sight(4, 0, 0, 0));
    assert!(map.line_of_sight(0, 0, 2, 4) && map.line_of_sight(2, 4, 0, 0));
    assert!(map.line_of_sight(1, 1, 1, 1));

    // a wall on the line blocks it, a wall next to the line does not
    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    assert!(!map.line_of_sight(0, 0, 0, 4) && !map.line_of_sight(0, 4, 0, 0));
    assert!(!map.line_of_throw(0, 0, 0, 4) && !map.line_of_throw(0, 4, 0, 0));
    assert!(map.line_of_sight(1, 0, 1, 4) && map.line_of_sight(1, 4, 1, 0));

    // an unwalkable tile does not block
    *&mut map.grid[0, 2].tile_type = TileType::Unwalkable;
    assert!(map.line_of_sight(0, 0, 0, 4) && map.line_of_sight(0, 4, 0, 0));
    *&mut map.grid[0, 2].tile_type = TileType::Empty;

    // high cover on the edge between (0, 2) and (0, 3): blocks a line passing
    // through, is plain cover for a line starting or ending next to it, and a
    // grenade flies over it
    *&mut map.grid[0, 2].tile_type = cover(no, no, high, no);
    assert!(!map.line_of_sight(0, 0, 0, 4) && !map.line_of_sight(0, 4, 0, 0));
    assert!(map.line_of_sight(0, 2, 0, 4) && map.line_of_sight(0, 4, 0, 2));
    assert!(map.line_of_sight(0, 0, 0, 3) && map.line_of_sight(0, 3, 0, 0));
    assert!(map.line_of_throw(0, 0, 0, 4) && map.line_of_throw(0, 4, 0, 0));

    // declared on the other side of the same edge; low cover never blocks
    *&mut map.grid[0, 2].tile_type = TileType::Empty;
    *&mut map.grid[0, 3].tile_type = cover(high, no, no, no);
    assert!(!map.line_of_sight(0, 0, 0, 4) && !map.line_of_sight(0, 4, 0, 0));
    *&mut map.grid[0, 3].tile_type = cover(low, no, no, no);
    assert!(map.line_of_sight(0, 0, 0, 4) && map.line_of_sight(0, 4, 0, 0));
    *&mut map.grid[0, 3].tile_type = TileType::Empty;

    // the diagonal (0, 0) -> (2, 2) passes through two corners; one open
    // route around a corner is enough, two walls close it
    *&mut map.grid[0, 1].tile_type = TileType::Wall;
    assert!(map.line_of_sight(0, 0, 2, 2) && map.line_of_sight(2, 2, 0, 0));
    *&mut map.grid[1, 0].tile_type = TileType::Wall;
    assert!(!map.line_of_sight(0, 0, 2, 2) && !map.line_of_sight(2, 2, 0, 0));
    assert!(!map.line_of_sight(0, 0, 1, 1) && !map.line_of_sight(1, 1, 0, 0));
    *&mut map.grid[0, 1].tile_type = TileType::Empty;
    *&mut map.grid[1, 0].tile_type = TileType::Empty;

    // the same corner closed by high covers on the two inner edges; the
    // adjacent diagonal stays clear since all its edges touch an end tile
    *&mut map.grid[1, 0].tile_type = cover(no, no, high, no);
    assert!(map.line_of_sight(0, 0, 2, 2) && map.line_of_sight(2, 2, 0, 0));
    *&mut map.grid[0, 1].tile_type = cover(no, no, no, high);
    assert!(!map.line_of_sight(0, 0, 2, 2) && !map.line_of_sight(2, 2, 0, 0));
    assert!(map.line_of_sight(0, 0, 1, 1) && map.line_of_sight(1, 1, 0, 0));
    assert!(map.line_of_throw(0, 0, 2, 2) && map.line_of_throw(2, 2, 0, 0));
    *&mut map.grid[1, 0].tile_type = TileType::Empty;
    *&mut map.grid[0, 1].tile_type = TileType::Empty;

    // (0, 0) -> (1, 3) crosses the vertex shared by (0, 1), (0, 2), (1, 1), (1, 2)
    *&mut map.grid[1, 1].tile_type = TileType::Wall;
    assert!(map.line_of_sight(0, 0, 1, 3) && map.line_of_sight(1, 3, 0, 0));
    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    assert!(!map.line_of_sight(0, 0, 1, 3) && !map.line_of_sight(1, 3, 0, 0));

    map.destroy();
}

#[test, expected_failure(abort_code = ENoLineOfSight)]
fun test_attack_without_line_of_sight_fails() {
    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 5);
    let (a, b) = (ghosts::recruit::default(ctx), ghosts::recruit::default(ctx));

    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    map.place_recruit(&a, 0, 0);
    map.place_recruit(&b, 0, 4);
    map.perform_attack(&mut rng, 0, 0, 0, 4);
    abort
}

#[test, expected_failure(abort_code = ENoLineOfSight)]
fun test_grenade_without_line_of_throw_fails() {
    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 5);
    let recruit = ghosts::recruit::default(ctx);

    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    map.place_recruit(&recruit, 0, 0);
    map.perform_grenade(&mut rng, 0, 0, 0, 4);
    abort
}
