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

// === Effects ===

/// Abort unless every unit on the map carries exactly the effects a replay of
/// the `records` from the start says it does (see `history::replay_effects`).
public fun assert_effects_replay(map: &Map, records: &vector<Record>) {
    use std::unit_test::assert_eq;

    let (tiles, effects) = history::replay_effects(records);
    let cols = map.grid.cols();
    map.units.do_ref!(|tile| {
        let (x, y) = (*tile / cols, *tile % cols);
        let (found, i) = tiles.index_of(&((x as u32) << 16 | (y as u32)));
        let carried = *map.grid[x, y].unit.borrow().effects();
        if (found) assert_eq!(carried, effects[i]) else assert_eq!(carried, vector[]);
    });
    tiles.do_ref!(|t| assert!(map.grid[(*t >> 16) as u16, (*t & 0xFFFF) as u16].unit.is_some()));
}

/// The effects on the unit at `(x, y)`.
public fun effects_at(map: &Map, x: u16, y: u16): vector<Effect> {
    *map.grid[x, y].unit.borrow().effects()
}

/// A recruit of `owner` carrying the utility of the `kind` (see `items::utility`).
fun carrier_of(owner: address, kind: u8, ctx: &mut TxContext): ghosts::recruit::Recruit {
    let mut recruit = recruit_of(owner, ctx);
    recruit.add_utility(ghosts::items::utility(kind, ctx));
    recruit
}

/// Throw the grenade of the utility `$kind` (1 flashbang, 2 smoke) from
/// `(x, y)` at `(x1, y1)`.
macro fun throw_effect(
    $map: &mut Map,
    $kind: u8,
    $x: u16,
    $y: u16,
    $x1: u16,
    $y1: u16,
): vector<Record> {
    let (map, kind) = ($map, $kind);
    if (kind == 1) map.perform_flashbang($x, $y, $x1, $y1)
    else map.perform_smoke_grenade($x, $y, $x1, $y1)
}

/// Thrower of Alice at (0, 0), her other unit at (0, 2), Bob's at (1, 1),
/// (2, 1) and (4, 4), a low cover at (1, 2); the grenade of `kind` lands on
/// (1, 1): every unit but the one at (4, 4) has the effect, both sides', the
/// thrower too; nobody is hurt, the cover stands, the thrower spent 1 AP and
/// its one use.
fun effect_grenade_area(kind: u8, effect: Effect, header: Record) {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, kind, ctx);
    let (own, foe, near, far) = (
        recruit_of(ALICE, ctx),
        recruit_of(BOB, ctx),
        recruit_of(BOB, ctx),
        recruit_of(BOB, ctx),
    );
    *&mut map.grid[1, 2].tile_type = cover(LOW_COVER, 0, 0, 0);
    map.place_recruit(&thrower, 0, 0);
    map.place_recruit(&own, 0, 2);
    map.place_recruit(&foe, 1, 1);
    map.place_recruit(&near, 2, 1);
    map.place_recruit(&far, 4, 4);

    let history = map.throw_effect!(kind, 0, 0, 1, 1);
    assert_eq!(
        history,
        vector[
            header,
            history::new_effect_start(0, 0, effect),
            history::new_effect_start(0, 2, effect),
            history::new_effect_start(1, 1, effect),
            history::new_effect_start(2, 1, effect),
        ],
    );
    assert_eq!(map.effects_at(4, 4), vector[]);
    map.units.do_ref!(|tile| {
        let unit = map.grid[*tile / 6, *tile % 6].unit.borrow();
        assert_eq!(unit.hp(), 10);
    });
    assert!(map.is_tile_cover(1, 2));
    let unit = map.grid[0, 0].unit.borrow();
    assert_eq!(unit.ap(), 1);
    assert_eq!(unit.actions()[1].uses(), option::some(0));
    map.assert_effects_replay(&history);

    destroy(vector[thrower, own, foe, near, far]);
    map.destroy();
}

#[test]
fun flashbang_dazes_the_area() {
    let header = history::new_flashbang(vector[0, 0], vector[1, 1]);
    effect_grenade_area(1, effect::daze(), header)
}

#[test]
fun smoke_grenade_smokes_the_area() {
    let header = history::new_smoke_grenade(vector[0, 0], vector[1, 1]);
    effect_grenade_area(2, effect::smoke(), header)
}

#[test]
/// Both kinds on the same units: they coexist, and a second smoke refreshes
/// the first, reported with its new turns.
fun effects_from_both_grenades_coexist() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let (smoker, flasher, smoker_2) = (
        carrier_of(ALICE, 2, ctx),
        carrier_of(ALICE, 1, ctx),
        carrier_of(ALICE, 2, ctx),
    );
    map.place_recruit(&smoker, 0, 0);
    map.place_recruit(&flasher, 0, 1);
    map.place_recruit(&smoker_2, 5, 5);

    let mut history = map.perform_smoke_grenade(0, 0, 0, 0);
    history.push_back(history::new_next_turn(1));
    history.append(map.next_turn(BOB.to_id()));
    assert_eq!(map.effects_at(0, 1), vector[effect::new(1, 1)]);
    history.append(map.perform_flashbang(0, 1, 0, 1));
    assert_eq!(map.effects_at(0, 1), vector[effect::new(1, 1), effect::daze()]);
    // a smoke on nobody is the header alone
    let empty = map.perform_smoke_grenade(5, 5, 2, 3);
    assert_eq!(empty, vector[history::new_smoke_grenade(vector[5, 5], vector[2, 3])]);
    history.append(empty);
    // another smoke onto the same two units refreshes theirs
    let smoker_3 = carrier_of(ALICE, 2, ctx);
    map.place_recruit(&smoker_3, 2, 0);
    let refresh = map.perform_smoke_grenade(2, 0, 0, 0);
    assert_eq!(
        refresh,
        vector[
            history::new_smoke_grenade(vector[2, 0], vector[0, 0]),
            history::new_effect_start(0, 0, effect::smoke()),
            history::new_effect_start(0, 1, effect::smoke()),
            history::new_effect_start(2, 0, effect::smoke()),
        ],
    );
    history.append(refresh);
    assert_eq!(map.effects_at(0, 1), vector[effect::smoke(), effect::daze()]);
    assert_eq!(map.unit(0, 1).borrow().effective_stats().aim(), 0);
    map.assert_effects_replay(&history);

    destroy(vector[smoker, flasher, smoker_2, smoker_3]);
    map.destroy();
}

#[test]
/// `next_turn` runs down every unit's effects, either side's, whoever's turn
/// begins, and gives AP back only to the side whose turn it is; it ends the
/// effects at zero with `EffectEnd`, unit by unit in the order of `Map.units`.
fun next_turn_ticks_every_unit() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let (thrower, foe) = (carrier_of(ALICE, 1, ctx), carrier_of(BOB, 2, ctx));
    map.place_recruit(&thrower, 0, 0);
    map.place_recruit(&foe, 0, 2);
    let mut history = map.perform_flashbang(0, 0, 0, 1);

    let records = map.next_turn(BOB.to_id());
    assert_eq!(records, vector[]);
    assert_eq!(map.effects_at(0, 0), vector[effect::new(0, 1)]);
    assert_eq!(map.unit(0, 0).borrow().ap(), 1);
    assert_eq!(map.unit(0, 2).borrow().ap(), 2);
    history.push_back(history::new_next_turn(1));
    history.append(records);

    let records = map.next_turn(ALICE.to_id());
    assert_eq!(records, vector[history::new_effect_end(0, 0, 0), history::new_effect_end(0, 2, 0)]);
    assert_eq!(map.effects_at(0, 0), vector[]);
    assert_eq!(map.effects_at(0, 2), vector[]);
    assert_eq!(map.unit(0, 0).borrow().ap(), 2);
    history.push_back(history::new_next_turn(2));
    history.append(records);
    map.assert_effects_replay(&history);

    destroy(vector[thrower, foe]);
    map.destroy();
}

/// Out of 20 seeded shots from (0, 0) at the unit at (0, 2) on open ground, with
/// a weapon of range 2 that adds `aim_mod` to the default aim of 65, how many
/// hit. `$prepare` runs on the map before each shot.
macro fun hits($aim_mod: u8, $prepare: |&mut Map|): u64 {
    use std::unit_test::destroy;

    let ctx = &mut tx_context::dummy();
    let mut shooter = recruit_of(ALICE, ctx);
    let weapon = ghosts::stats_builder::new()
        .aim($aim_mod)
        .damage(1)
        .spread(0)
        .crit_chance(0)
        .range(2)
        .build_weapon();
    shooter.add_weapon(ghosts::weapon::new(b"Test".to_string(), weapon, ctx));
    let target = recruit_of(BOB, ctx);

    let mut hits = 0;
    20u8.do!(|seed| {
        let mut rng = sui::random::new_generator_from_seed_for_testing(vector[seed]);
        let mut map = new(@0.to_id(), 4);
        map.place_recruit(&shooter, 0, 0);
        map.place_recruit(&target, 0, 2);
        $prepare(&mut map);
        let history = map.perform_attack(&mut rng, 0, 0, 0, 2);
        if (history[1] != history::new_miss()) hits = hits + 1;
        map.destroy();
    });
    destroy(vector[shooter, target]);
    hits
}

/// A weapon modifier of `-n` aim.
const MINUS: u8 = 0x80;

#[test]
/// A shooter with 30 aim against a target in smoke (defense 30) never hits;
/// before the smoke and once it has run out, it does, the same shots.
fun target_in_smoke_is_harder_to_hit() {
    use std::unit_test::assert_eq;

    let before = hits!(MINUS + 35, |_| ());
    assert!(before > 0 && before < 20);
    let during = hits!(MINUS + 35, |map| {
        map.grid[0, 2].unit.borrow_mut().apply_effect(effect::smoke());
        map.next_turn(BOB.to_id());
    });
    assert_eq!(during, 0);
    let after = hits!(MINUS + 35, |map| {
        map.grid[0, 2].unit.borrow_mut().apply_effect(effect::smoke());
        map.next_turn(BOB.to_id());
        map.next_turn(ALICE.to_id());
    });
    assert_eq!(after, before);
}

#[test]
/// A shooter in smoke loses 30 aim: from 30 it never hits.
fun shooter_in_smoke_misses() {
    use std::unit_test::assert_eq;

    let during = hits!(MINUS + 35, |map| {
        map.grid[0, 0].unit.borrow_mut().apply_effect(effect::smoke());
    });
    assert_eq!(during, 0);
}

#[test]
/// A dazed shooter has no aim: one who never misses never hits while dazed, at
/// the weapon's own range (no distance bonus).
fun dazed_shooter_misses() {
    use std::unit_test::assert_eq;

    assert_eq!(hits!(62, |_| ()), 20);
    let dazed = hits!(62, |map| {
        map.grid[0, 0].unit.borrow_mut().apply_effect(effect::daze());
    });
    assert_eq!(dazed, 0);
}

/// A recruit of `owner` that dodges every dodgeable hit: dodge 100.
fun dodger_of(owner: address, ctx: &mut TxContext): ghosts::recruit::Recruit {
    let mut recruit = recruit_of(owner, ctx);
    let armor = ghosts::stats::new(0, 0, 0, 0, 100);
    recruit.add_armor(ghosts::armor::new(b"Dodger".to_string(), armor, ctx));
    recruit
}

#[test]
/// A dazed target has no dodge: one who dodges every shot is hit while dazed,
/// and dodges again once the daze has run out. The daze takes the dodge out of
/// the outcomes, it adds none: a hit still costs no less than a dodge.
fun dazed_target_cannot_dodge() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(b"daze");
    let mut map = new(@0.to_id(), 4);
    let mut shooter = recruit_of(ALICE, ctx);
    let weapon = ghosts::stats_builder::new().aim(35).damage(1).spread(0).build_weapon();
    shooter.add_weapon(ghosts::weapon::new(b"Test".to_string(), weapon, ctx));
    let target = dodger_of(BOB, ctx);
    map.place_recruit(&shooter, 0, 0);
    map.place_recruit(&target, 0, 2);

    let dodged = map.perform_attack(&mut rng, 0, 0, 0, 2);
    assert_eq!(dodged[1], history::new_dodged());

    // dazed: dodge 0, every shot lands
    map.apply_effect_for_testing(0, 2, effect::daze());
    assert_eq!(map.unit(0, 2).borrow().effective_stats().dodge(), 0);
    map.reset_ap(ALICE.to_id());
    let hit = map.perform_attack(&mut rng, 0, 0, 0, 2);
    assert_eq!(hit[1], history::new_damage(1));
    assert_eq!(map.unit(0, 2).borrow().hp(), 9);
    assert!(bcs::to_bytes(&dodged).length() <= bcs::to_bytes(&hit).length());

    // the daze runs out as Bob ends his turn: the dodge is back
    map.next_turn(BOB.to_id());
    map.next_turn(ALICE.to_id());
    assert_eq!(map.effects_at(0, 2), vector[]);
    assert_eq!(map.unit(0, 2).borrow().effective_stats().dodge(), 100);
    let history = map.perform_attack(&mut rng, 0, 0, 0, 2);
    assert_eq!(history[1], history::new_dodged());
    assert_eq!(map.unit(0, 2).borrow().hp(), 9);

    destroy(vector[shooter, target]);
    map.destroy();
}

#[test, expected_failure(abort_code = EPathTooShort)]
fun flashbang_out_of_range_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 8);
    let thrower = carrier_of(ALICE, 1, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_flashbang(0, 0, 3, 3);
    abort
}

#[test, expected_failure(abort_code = EPathTooShort)]
fun smoke_grenade_out_of_range_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 8);
    let thrower = carrier_of(ALICE, 2, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_smoke_grenade(0, 0, 0, 6);
    abort
}

#[test, expected_failure(abort_code = ETileIsWall)]
fun flashbang_on_wall_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 1, ctx);
    *&mut map.grid[0, 3].tile_type = TileType::Wall;
    map.place_recruit(&thrower, 0, 0);
    map.perform_flashbang(0, 0, 0, 3);
    abort
}

#[test, expected_failure(abort_code = ETileIsWall)]
fun smoke_grenade_on_wall_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 2, ctx);
    *&mut map.grid[0, 3].tile_type = TileType::Wall;
    map.place_recruit(&thrower, 0, 0);
    map.perform_smoke_grenade(0, 0, 0, 3);
    abort
}

#[test, expected_failure(abort_code = ENoLineOfSight)]
fun flashbang_without_line_of_throw_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 1, ctx);
    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    map.place_recruit(&thrower, 0, 0);
    map.perform_flashbang(0, 0, 0, 4);
    abort
}

#[test, expected_failure(abort_code = ENoLineOfSight)]
fun smoke_grenade_without_line_of_throw_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 2, ctx);
    *&mut map.grid[0, 2].tile_type = TileType::Wall;
    map.place_recruit(&thrower, 0, 0);
    map.perform_smoke_grenade(0, 0, 0, 4);
    abort
}

#[test]
/// Covers do not stop a throw of either: it flies over them, as the frag does.
fun effect_grenades_fly_over_cover() {
    use std::unit_test::destroy;

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let (flasher, smoker) = (carrier_of(ALICE, 1, ctx), carrier_of(ALICE, 2, ctx));
    *&mut map.grid[0, 2].tile_type = cover(HIGH_COVER, HIGH_COVER, HIGH_COVER, HIGH_COVER);
    map.place_recruit(&flasher, 0, 0);
    map.place_recruit(&smoker, 1, 0);
    map.perform_flashbang(0, 0, 0, 4);
    map.perform_smoke_grenade(1, 0, 1, 4);
    assert!(map.is_tile_cover(0, 2));

    destroy(vector[flasher, smoker]);
    map.destroy();
}

#[test, expected_failure(abort_code = ENoUnit)]
fun flashbang_from_empty_tile_fails() {
    let mut map = new(@0.to_id(), 6);
    map.perform_flashbang(0, 0, 0, 1);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
/// The frag grenade does not give a flashbang, nor a flashbang a smoke grenade.
fun flashbang_without_the_utility_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 0, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_flashbang(0, 0, 0, 1);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::EActionNotAllowed)]
fun smoke_grenade_without_the_utility_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 1, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_smoke_grenade(0, 0, 0, 1);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::ENoUsesLeft)]
fun flashbang_twice_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 1, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_flashbang(0, 0, 0, 1);
    map.perform_flashbang(0, 0, 0, 1);
    abort
}

#[test, expected_failure(abort_code = ghosts::unit::ENoUsesLeft)]
fun smoke_grenade_twice_fails() {
    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 6);
    let thrower = carrier_of(ALICE, 2, ctx);
    map.place_recruit(&thrower, 0, 0);
    map.perform_smoke_grenade(0, 0, 0, 1);
    map.reset_ap(ALICE.to_id());
    map.perform_smoke_grenade(0, 0, 0, 1);
    abort
}

#[test]
/// Bytes of a map whose units carry effects read back the same.
fun map_bcs_with_effects() {
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut map = new(@0.to_id(), 4);
    let (a, b) = (carrier_of(ALICE, 1, ctx), carrier_of(BOB, 2, ctx));
    map.place_recruit(&a, 0, 0);
    map.place_recruit(&b, 1, 1);
    map.perform_flashbang(0, 0, 0, 0);
    map.perform_smoke_grenade(1, 1, 1, 1);
    let bytes = bcs::to_bytes(&map);
    let restored = from_bytes(bytes);
    assert_eq!(bcs::to_bytes(&restored), bytes);
    assert_eq!(restored.effects_at(0, 0), vector[effect::daze(), effect::smoke()]);

    destroy(vector[a, b]);
    restored.destroy();
    map.destroy();
}

/// Put the `effect` on the unit at `(x, y)`, as a grenade would.
public fun apply_effect_for_testing(map: &mut Map, x: u16, y: u16, effect: Effect): Record {
    let effect = map.grid[x, y].unit.borrow_mut().apply_effect(effect);
    history::new_effect_start(x, y, effect)
}

// === Black Rain ===

/// The low covers of Black Rain, `(x, y)` each: the scene's cover props, the
/// scene cell `[cx, cz]` at `(cz + 7, cx + 9)`.
const BLACK_RAIN_COVERS: vector<vector<u16>> = vector[
    vector[2, 12],
    vector[3, 9],
    vector[4, 5],
    vector[6, 13],
    vector[6, 14],
    vector[9, 6],
    vector[9, 7],
    vector[9, 11],
    vector[9, 12],
    vector[11, 3],
];

#[test]
/// Black Rain as the scene has it: 14 rows (the scene's z) by 18 columns (its
/// x); the four shops are walls, every cover is low on all four sides, the rest
/// is street. Every spawn is empty ground, and no unit stands within a rifle's
/// reach of the other side as it deploys: the closest are 8 tiles apart.
fun black_rain_tiles() {
    use std::unit_test::assert_eq;

    let map = black_rain(@1.to_id());
    let (rows, cols) = map.size();
    assert_eq!(vector[rows, cols], vector[14, 18]);
    let low = cover(LOW_COVER, LOW_COVER, LOW_COVER, LOW_COVER);
    let (mut walls, mut covers) = (0u64, vector[]);
    14u16.do!(
        |x| 18u16.do!(
            |y| match (map.grid[x, y].tile_type) {
                TileType::Wall => walls = walls + 1,
                TileType::Cover { .. } => {
                    assert_eq!(map.grid[x, y].tile_type, low);
                    covers.push_back(vector[x, y]);
                },
                TileType::Empty => (),
                TileType::Unwalkable => abort,
            },
        ),
    );
    assert_eq!(covers, BLACK_RAIN_COVERS);
    assert_eq!(walls, 64);

    // a shop's corner, a cover prop, the crossing in the middle of the street
    assert!(map.is_tile_wall(0, 0) && map.is_tile_wall(11, 13) && map.is_tile_wall(12, 2));
    assert!(map.is_tile_cover(9, 6) && map.is_tile_cover(3, 9));
    assert_eq!(map.grid[7, 9].tile_type, TileType::Empty);

    let positions = black_rain_positions();
    assert_eq!(
        positions,
        vector[
            vector[11, 6],
            vector[12, 8],
            vector[11, 10],
            vector[4, 11],
            vector[5, 14],
            vector[3, 6],
        ],
    );
    positions.do_ref!(|p| {
        assert_eq!(map.grid[p[0] as u16, p[1] as u16].tile_type, TileType::Empty);
        assert!(map.grid[p[0] as u16, p[1] as u16].unit.is_none());
    });
    let mut closest = 0xFFFFu16;
    3u64.do!(|i| 3u64.do!(|j| {
        let (a, b) = (positions[i], positions[3 + j]);
        let d = grid::manhattan_distance!(a[0] as u16, a[1] as u16, b[0] as u16, b[1] as u16);
        closest = closest.min(d);
    }));
    assert_eq!(closest, 8);
    map.destroy();
}

#[test]
/// A frag on Black Rain turns every cover in its blast into street, and only
/// those: the unit behind one loses its 25, and the tile walks like any other.
/// Walls stay.
fun black_rain_frag_clears_cover() {
    use grid::direction::{down, right};
    use std::unit_test::{assert_eq, destroy};

    let ctx = &mut tx_context::dummy();
    let mut rng = sui::random::new_generator_from_seed_for_testing(vector[1]);
    let mut map = black_rain(@1.to_id());
    let mut thrower = recruit_of(ALICE, ctx);
    thrower.add_utility(ghosts::items::frag_grenade(ctx));
    let target = recruit_of(BOB, ctx);
    map.place_recruit(&thrower, 8, 3);
    map.place_recruit(&target, 8, 6);

    // behind the cover at (9, 6) from a shot up the column
    assert_eq!(map.cover_bonus(12, 6, 8, 6), DEFENSE_BONUS);
    map.perform_grenade(&mut rng, 8, 3, 9, 7);

    BLACK_RAIN_COVERS.do!(|p| {
        let reached = grid::manhattan_distance!(p[0], p[1], 9, 7) <= GRENADE_RADIUS;
        assert_eq!(map.is_tile_cover(p[0], p[1]), !reached);
    });
    assert_eq!(map.grid[9, 6].tile_type, TileType::Empty);
    assert_eq!(map.grid[9, 7].tile_type, TileType::Empty);
    assert_eq!(map.cover_bonus(12, 6, 8, 6), 0);
    assert!(map.is_tile_wall(9, 2));
    assert!(map.check_path(vector[8, 6, down!(), right!()]).is_some());

    destroy(vector[thrower, target]);
    map.destroy();
}
