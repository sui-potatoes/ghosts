// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::map;

/// Kill the unit of the `recruit`, the way an attack does: off its tile and
/// `Map.units`, and into `fallen`, until `bury`.
public fun kill_for_testing(map: &mut Map, recruit: ID): Record {
    let cols = map.grid.cols();
    let at = map.units.find_index!(|tile| {
        map.grid[*tile / cols, *tile % cols].unit.borrow().recruit_id() == recruit
    });
    let tile = map.units.remove(at.destroy_some());
    let (x, y) = (tile / cols, tile % cols);
    let unit = map.grid[x, y].unit.extract();
    map.fallen.push_back(unit);
    history::new_kia(recruit, x, y)
}

// === Unit Index ===

/// The tiles holding a unit as a walk of the whole grid finds them, as row-major
/// indices: what `Map.units` must always be.
public fun units_by_walk(map: &Map): vector<u16> {
    let (rows, cols) = map.size();
    let mut units = vector[];
    rows.do!(|x| cols.do!(|y| if (map.grid[x, y].unit.is_some()) units.push_back(x * cols + y)));
    units
}

/// The recruits of `owner` as a walk of the whole grid finds them: what
/// `units_of` gave before `Map.units`.
public fun units_of_by_walk(map: &Map, owner: ID): vector<ID> {
    let mut units = vector[];
    map.grid.do_ref!(|tile| tile.unit.do_ref!(|unit| {
        if (unit.owner() == owner) units.push_back(unit.recruit_id());
    }));
    units
}

/// Abort unless `Map.units` lists exactly the tiles a walk of the grid finds.
public fun assert_units_match_grid(map: &Map) {
    std::unit_test::assert_eq!(map.units, map.units_by_walk());
}

/// The tiles in `Map.units`.
public fun unit_tiles(map: &Map): vector<u16> { map.units }

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
// A step is up, down, left or right. Diagonal bytes, which would cover two
// tiles for one step and slip past cover, and anything else are not a path.
fun test_check_path_orthogonal_only() {
    use grid::direction::{up, down, left, right};

    let map = new(@1.to_id(), 3);

    vector[up!(), down!(), left!(), right!()].do!(|d| {
        assert!(map.check_path(vector[1, 1, d]).is_some());
    });

    let diagonals = vector[
        up!() | right!(),
        right!() | down!(),
        down!() | left!(),
        up!() | left!(),
    ];
    diagonals.do!(|d| assert!(map.check_path(vector[1, 1, d]).is_none()));
    vector[0, 5, 7, 10, 15, 16, 255].do!(|d| assert!(map.check_path(vector[1, 1, d]).is_none()));

    // a diagonal anywhere in the path spoils it
    assert!(map.check_path(vector[1, 1, up!(), down!() | right!()]).is_none());

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
    let mut recruit_one = recruit::default(ctx);
    let recruit_two = recruit::default(ctx);
    recruit_one.add_weapon(
        ghosts::weapon::new(b"Test".to_string(), ghosts::stats::default_weapon(), ctx),
    );

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

    let (weapon, armor, utilities) = recruit_one.dismiss();
    utilities.destroy!(|u| u.destroy());
    weapon.destroy!(|w| w.destroy());
    armor.destroy!(|a| a.destroy());

    let (weapon, armor, utilities) = recruit_two.dismiss();
    utilities.destroy!(|u| u.destroy());
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

/// The frag grenade destroys covers in its area and leaves walls alone.
#[test]
fun test_grenade_destroys_cover() {
    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let (no, low, high) = (NO_COVER, LOW_COVER, HIGH_COVER);
    let mut map = new(@0.to_id(), 6);
    let mut recruit = ghosts::recruit::default(ctx);
    recruit.add_utility(ghosts::items::frag_grenade(ctx));

    *&mut map.grid[0, 3].tile_type = cover(no, no, high, no);
    *&mut map.grid[2, 4].tile_type = cover(low, no, no, no); // 3 tiles from the target
    map.place_recruit(&recruit, 0, 0);
    map.perform_grenade(&mut rng, 0, 0, 0, 3);

    assert!(!map.is_tile_cover(0, 3));
    assert!(map.is_tile_cover(2, 4));

    recruit.kill(ctx).throw_away();
    map.destroy();
}

#[test, expected_failure(abort_code = ENoLineOfSight)]
fun test_grenade_without_line_of_throw_fails() {
    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 5);
    let mut recruit = ghosts::recruit::default(ctx);
    recruit.add_utility(ghosts::items::frag_grenade(ctx));

    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    map.place_recruit(&recruit, 0, 0);
    map.perform_grenade(&mut rng, 0, 0, 0, 4);
    abort
}

// === Unit Index Tests ===

const ALICE: address = @0xA;
const BOB: address = @0xB;

/// A default recruit of the `Account` `owner`.
fun recruit_of(owner: address, ctx: &mut TxContext): ghosts::recruit::Recruit {
    let mut recruit = ghosts::recruit::default(ctx);
    recruit.set_leader(owner);
    recruit
}

/// A recruit of `owner` with 4 HP: a grenade kills it.
fun frail_of(owner: address, ctx: &mut TxContext): ghosts::recruit::Recruit {
    let mut recruit = recruit_of(owner, ctx);
    let armor = ghosts::stats::new(0, 0, 0x80 + 6, 0, 0);
    recruit.add_armor(ghosts::armor::new(b"Frail".to_string(), armor, ctx));
    recruit
}

/// A recruit of `owner` whose weapon always hits for `damage`, in an area of
/// `radius` that cannot be dodged.
fun shooter_of(
    owner: address,
    damage: u8,
    radius: u8,
    ctx: &mut TxContext,
): ghosts::recruit::Recruit {
    let mut recruit = recruit_of(owner, ctx);
    let stats = ghosts::stats_builder::new()
        .aim(35)
        .damage(damage)
        .spread(0)
        .crit_chance(0)
        .area_size(radius)
        .can_be_dodged(0)
        .build_weapon();
    recruit.add_weapon(ghosts::weapon::new(b"Test".to_string(), stats, ctx));
    recruit
}

/// `units_of` for both owners agrees with a walk of the grid, and so do `Map.units`.
fun assert_index(map: &Map) {
    use std::unit_test::assert_eq;

    map.assert_units_match_grid();
    let (alice, bob) = (ALICE.to_id(), BOB.to_id());
    assert_eq!(map.units_of(alice), map.units_of_by_walk(alice));
    assert_eq!(map.units_of(bob), map.units_of_by_walk(bob));
    let (a, b) = map.units_of_both(alice, bob);
    assert_eq!(a, map.units_of_by_walk(alice));
    assert_eq!(b, map.units_of_by_walk(bob));
}

#[test]
/// Placing and moving units keeps `Map.units` sorted and in step with the grid;
/// `reset_ap` finds only the owner's units through it.
fun units_follow_placement_and_moves() {
    use grid::direction::{up, down};
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let (a1, a2) = (recruit_of(ALICE, ctx), recruit_of(ALICE, ctx));
    let (b1, b2) = (recruit_of(BOB, ctx), recruit_of(BOB, ctx));

    map.place_recruit(&a1, 3, 3);
    assert_eq!(map.unit_tiles(), vector[21]);
    map.place_recruit(&b1, 0, 5);
    map.place_recruit(&a2, 5, 0);
    map.place_recruit(&b2, 0, 1);
    assert_eq!(map.unit_tiles(), vector[1, 5, 21, 30]);
    assert_index(&map);
    assert_eq!(map.units_of(ALICE.to_id()), vector[object::id(&a1), object::id(&a2)]);
    assert_eq!(map.units_of(BOB.to_id()), vector[object::id(&b2), object::id(&b1)]);

    // a1 walks from (3, 3) to (0, 3), ahead of b1 in the walk order
    map.move_unit(vector[3, 3, up!(), up!(), up!()]);
    assert_eq!(map.unit_tiles(), vector[1, 3, 5, 30]);
    assert_index(&map);

    // b2 steps from (0, 1) down to (1, 1), now behind a1 and b1
    map.move_unit(vector[0, 1, down!()]);
    assert_eq!(map.unit_tiles(), vector[3, 5, 7, 30]);
    assert_index(&map);
    assert_eq!(map.units_of(BOB.to_id()), vector[object::id(&b1), object::id(&b2)]);

    // Alice's turn: her units get their AP back, Bob's do not
    map.reset_ap(ALICE.to_id());
    assert!(map.unit(0, 3).is_some_and!(|u| u.ap() == 2));
    assert!(map.unit(1, 1).is_some_and!(|u| u.ap() == 1));
    map.reset_ap(BOB.to_id());
    assert!(map.unit(1, 1).is_some_and!(|u| u.ap() == 2));
    assert_index(&map);

    destroy(vector[a1, a2, b1, b2]);
    map.destroy();
}

#[test]
/// A kill by a single shot takes the tile out of `Map.units`; `bury` leaves them.
fun units_follow_kill_by_attack() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 6);
    let shooter = shooter_of(ALICE, 99, 0, ctx);
    let (target, other) = (recruit_of(BOB, ctx), recruit_of(BOB, ctx));

    map.place_recruit(&shooter, 0, 0);
    map.place_recruit(&target, 1, 1);
    map.place_recruit(&other, 2, 2);
    assert_eq!(map.unit_tiles(), vector[0, 7, 14]);

    let history = map.perform_attack(&mut rng, 0, 0, 1, 1);
    assert_eq!(history::list_kia(&history).length(), 1);
    assert_eq!(map.unit_tiles(), vector[0, 14]);
    assert_index(&map);

    assert_eq!(map.bury(), vector[object::id(&target)]);
    assert_eq!(map.unit_tiles(), vector[0, 14]);
    assert_index(&map);

    destroy(vector[shooter, target, other]);
    map.destroy();
}

#[test]
/// A grenade killing several units at once, the thrower's own among them, takes
/// every one of their tiles out of `Map.units`, and only theirs.
fun units_follow_grenade_kills() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 6);
    let mut thrower = recruit_of(ALICE, ctx);
    thrower.add_utility(ghosts::items::frag_grenade(ctx));
    let near = recruit_of(BOB, ctx); // survives with 6 HP
    let own = frail_of(ALICE, ctx);
    let (foe_1, foe_2) = (frail_of(BOB, ctx), frail_of(BOB, ctx));
    let far = frail_of(BOB, ctx); // out of the radius

    map.place_recruit(&thrower, 0, 0);
    map.place_recruit(&near, 0, 1);
    map.place_recruit(&own, 0, 2);
    map.place_recruit(&foe_1, 1, 1);
    map.place_recruit(&foe_2, 2, 0);
    map.place_recruit(&far, 3, 3);
    assert_eq!(map.unit_tiles(), vector[0, 1, 2, 7, 12, 21]);

    // target (1, 1): every unit but `far` is within 2 tiles
    let history = map.perform_grenade(&mut rng, 0, 0, 1, 1);
    assert_eq!(history::list_kia(&history).length(), 3);
    assert_eq!(map.unit_tiles(), vector[0, 1, 21]);
    assert_index(&map);

    assert_eq!(map.bury().length(), 3);
    assert_index(&map);

    destroy(vector[thrower, near, own, foe_1, foe_2, far]);
    map.destroy();
}

#[test]
/// An area weapon killing several units at once takes their tiles out of
/// `Map.units`.
fun units_follow_area_attack_kills() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = new(@0.to_id(), 6);
    let shooter = shooter_of(ALICE, 99, 1, ctx);
    let (one, two, three) = (recruit_of(BOB, ctx), recruit_of(BOB, ctx), recruit_of(ALICE, ctx));
    let far = recruit_of(BOB, ctx);

    // target (2, 2): (2, 1), (2, 3) and (3, 2) are in the radius, the shooter is not
    map.place_recruit(&shooter, 1, 1);
    map.place_recruit(&one, 2, 1);
    map.place_recruit(&two, 2, 3);
    map.place_recruit(&three, 3, 2);
    map.place_recruit(&far, 5, 5);
    assert_eq!(map.unit_tiles(), vector[7, 13, 15, 20, 35]);

    let history = map.perform_attack(&mut rng, 1, 1, 2, 2);
    assert_eq!(history::list_kia(&history).length(), 3);
    assert_eq!(map.unit_tiles(), vector[7, 35]);
    assert_index(&map);

    destroy(vector[shooter, one, two, three, far]);
    map.destroy();
}

#[test]
/// A map with two units a side survives a BCS round trip, `Map.units` included,
/// which trail the encoding as a `vector<u16>`. Bytes without them, as the
/// presets are, decode to the same map.
fun units_bcs_round_trip() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@1.to_id(), 4);
    let (a1, a2) = (recruit_of(ALICE, ctx), recruit_of(ALICE, ctx));
    let (b1, b2) = (recruit_of(BOB, ctx), recruit_of(BOB, ctx));
    map.place_recruit(&a1, 0, 0);
    map.place_recruit(&a2, 0, 3);
    map.place_recruit(&b1, 3, 0);
    map.place_recruit(&b2, 3, 3);

    let bytes = bcs::to_bytes(&map);
    let restored = from_bytes(bytes);
    assert_eq!(bcs::to_bytes(&restored), bytes);
    assert_eq!(restored.unit_tiles(), vector[0, 3, 12, 15]);
    assert_index(&restored);

    // `fallen` is empty (`00`), then the four tiles: length 4, each a u16 LE
    let tail = x"0004000003000c000f00";
    let (len, tail_len) = (bytes.length(), tail.length());
    assert_eq!(bytes.skip(len - tail_len), tail);

    // without `Map.units` they are rebuilt from the grid
    let old = bytes.take(len - tail_len + 1);
    let rebuilt = from_bytes(old);
    assert_eq!(bcs::to_bytes(&rebuilt), bytes);

    destroy(vector[a1, a2, b1, b2]);
    restored.destroy();
    rebuilt.destroy();
    map.destroy();
}

#[test, expected_failure(abort_code = EUnitIndexMismatch)]
/// Decoded `Map.units` must list the tiles holding a unit: none listed is wrong.
fun units_bcs_mismatch_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@1.to_id(), 4);
    let recruit = recruit_of(ALICE, ctx);
    map.place_recruit(&recruit, 1, 2);

    let mut bytes = bcs::to_bytes(&map);
    bytes.pop_back(); // the tile, 6
    bytes.pop_back();
    bytes.pop_back(); // the length, 1
    bytes.push_back(0); // nothing listed
    from_bytes(bytes).destroy();
    abort
}

#[test]
/// The presets have no units: their bytes are the encoding of the `Map` without
/// the trailing `Map.units`, an empty vector, one `00` byte.
fun presets_decode_without_units() {
    use std::unit_test::assert_eq;

    vector[black_rain(@1.to_id()), demo_1(@1.to_id()), demo_2(@1.to_id())].destroy!(|map| {
        assert!(map.unit_tiles().is_empty());
        let mut bytes = bcs::to_bytes(&map);
        assert_eq!(bytes.pop_back(), 0);
        assert_eq!(bytes.pop_back(), 0); // nobody has fallen
        bytes.push_back(0);
        let decoded = from_bytes(bytes);
        assert_eq!(bcs::to_bytes(&decoded), bcs::to_bytes(&map));
        decoded.destroy();
        map.destroy();
    });
}

#[test]
/// A frag grenade does not roll: it cannot be dodged and its damage is fixed, so
/// whatever the seed, it ends the same way at the same cost. A thrower cannot
/// abort to choose an outcome, its own units in the radius included.
fun grenade_outcome_does_not_roll() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut thrower = recruit_of(ALICE, ctx);
    thrower.add_utility(ghosts::items::frag_grenade(ctx));
    let (own, foe, near) = (frail_of(ALICE, ctx), frail_of(BOB, ctx), recruit_of(BOB, ctx));

    let mut outcome = option::none();
    10u8.do!(|seed| {
        let mut rng = sui::random::new_generator_from_seed_for_testing(vector[seed]);
        let mut map = new(@0.to_id(), 6);
        map.place_recruit(&thrower, 0, 0);
        map.place_recruit(&own, 0, 2);
        map.place_recruit(&foe, 1, 1);
        map.place_recruit(&near, 2, 1);
        let history = map.perform_grenade(&mut rng, 0, 0, 1, 1);
        assert_eq!(history::list_kia(&history).length(), 2);
        let mut bytes = bcs::to_bytes(&map);
        bytes.append(bcs::to_bytes(&history));
        if (outcome.is_none()) outcome.fill(bytes) else assert_eq!(*outcome.borrow(), bytes);
        map.destroy();
    });

    destroy(vector[thrower, own, foe, near]);
}
