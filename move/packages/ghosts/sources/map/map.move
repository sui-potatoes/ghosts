// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the game `Map` - a grid of tiles where the game takes place. Map is
/// the most important component of the game, which provides direct access to
/// the stored data and objects and is used by game logic.
///
/// Traits:
/// - from_bcs
/// - to_string
module ghosts::map;

use ghosts::{history::{Self, Record}, recruit::Recruit, unit::{Self, Unit}};
use grid::{cell, cursor, grid::{Self, Grid}};
use std::string::String;
use sui::{bcs::{Self, BCS}, random::RandomGenerator};

/// Attempt to place a `Recruit` on a tile that already has a unit.
const EUnitAlreadyOnTile: u64 = 1;
/// Attempt to place a `Recruit` on an unwalkable tile.
const ETileIsUnwalkable: u64 = 2;
/// The path is unwalkable.
const EPathUnwalkable: u64 = 3;
/// The unit is not on the tile.
const ENoUnit: u64 = 5;
/// The path is too short.
const EPathTooShort: u64 = 6;
/// The tile is out of bounds.
const ETileOutOfBounds: u64 = 7;
/// Attempt to stand on or target a `Wall` tile.
const ETileIsWall: u64 = 8;
/// No line of sight (or throw) from the attacker to the target.
const ENoLineOfSight: u64 = 9;

#[allow(unused_const)]
/// Constant for no cover in the `TileType::Cover`.
const NO_COVER: u8 = 0;
#[allow(unused_const)]
/// Constant for low cover in the `TileType::Cover`.
const LOW_COVER: u8 = 1;
/// Constant for high cover in the `TileType::Cover`.
const HIGH_COVER: u8 = 2;
/// Constant for the defense bonus.
const DEFENSE_BONUS: u8 = 25;

/// The range of the grenade.
const GRENADE_RANGE: u16 = 5;
/// The radius of the grenade explosion (von Neumann neighborhood).
const GRENADE_RADIUS: u16 = 2;
/// The damage the grenade deals to every unit in the area.
const GRENADE_DAMAGE: u8 = 4;

/// Defines a single Tile in the game `Map`. Tiles can be empty, provide cover
/// or be unwalkable. Additionally, a unit standing on a tile effectively makes
/// it unwalkable.
public struct Tile has copy, store {
    /// The type of the tile.
    tile_type: TileType,
    /// The position of the tile on the map.
    unit: Option<Unit>,
}

/// A type of the `Tile`.
public enum TileType has copy, drop, store {
    /// An empty tile without any cover.
    Empty,
    /// A low cover tile. Provides partial cover from 1-3 sides. Can be
    /// destroyed by explosives and heavy weapons.
    ///
    /// Cover also limits the movement of units, as they cannot move through
    /// cover sides.
    Cover {
        left: u8,
        top: u8,
        right: u8,
        bottom: u8,
    },
    /// An empty tile that cannot be walked on, like water or a pit. Does not
    /// block line of sight and can be targeted by area weapons.
    Unwalkable,
    /// A solid tile: cannot be walked on, cannot be targeted and blocks line
    /// of sight. A dead zone for both movement and aiming.
    Wall,
}

/// Defines the game Map - a grid of tiles where the game takes place.
public struct Map has store {
    /// The unique identifier of the map.
    id: ID,
    /// The grid of tiles.
    grid: Grid<Tile>,
    /// The units killed since the last `bury`, taken off their tiles. They stay
    /// in the `Map` until then so that a kill never frees storage in the call
    /// that rolled it: an attacker cannot tell a kill from a hit by its gas.
    fallen: vector<Unit>,
}

public fun new(id: ID, size: u16): Map {
    Map {
        id,
        grid: grid::tabulate!(
            size,
            size,
            |_, _| Tile {
                tile_type: TileType::Empty,
                unit: option::none(),
            },
        ),
        fallen: vector[],
    }
}

/// Default Map is 30x30 tiles for now. Initially empty.
public fun default(id: ID): Map { new(id, 30) }

/// Destroy the `Map` struct, returning the IDs of the units on the map.
public fun destroy(map: Map): vector<ID> {
    let Map { grid, fallen, .. } = map;
    let mut units = vector[];
    fallen.destroy!(|unit| { unit.destroy(); });
    grid.destroy!(|Tile { unit, .. }| unit.destroy!(|unit| units.push_back(unit.destroy())));
    units
}

/// Get the ID of the map.
public fun id(map: &Map): ID { map.id }

/// Clone the `Map`.
public(package) fun clone(map: &Map): Map { Map { id: map.id, grid: map.grid, fallen: map.fallen } }

// === Actions ===

/// Place a `Recruit` on the map at the given position.
public fun place_recruit(map: &mut Map, recruit: &Recruit, x: u16, y: u16): Record {
    let target_tile = &map.grid[x, y];

    assert!(target_tile.unit.is_none(), EUnitAlreadyOnTile);
    assert!(target_tile.tile_type != TileType::Unwalkable, ETileIsUnwalkable);
    assert!(target_tile.tile_type != TileType::Wall, ETileIsWall);

    map.grid[x, y].unit.fill(recruit.to_unit());
    history::new_recruit_placed(x, y)
}

/// The recruits of the `Account` `owner` still on the map.
public fun units_of(map: &Map, owner: ID): vector<ID> {
    let mut units = vector[];
    map.grid.do_ref!(|tile| tile.unit.do_ref!(|unit| {
        if (unit.owner() == owner) units.push_back(unit.recruit_id());
    }));
    units
}

/// Give the units of the `Account` `owner` their action points back: their turn
/// begins.
public fun reset_ap(map: &mut Map, owner: ID) {
    map.grid.do_mut!(|tile| tile.unit.do_mut!(|unit| {
        if (unit.owner() == owner) unit.reset_ap();
    }));
}

/// Reload the unit's weapon. It costs 1 AP.
public fun perform_reload(map: &mut Map, x: u16, y: u16): Record {
    assert!(map.grid[x, y].unit.is_some(), ENoUnit);
    let unit = map.grid[x, y].unit.borrow_mut();
    unit.perform_reload();

    history::new_reload(x, y)
}

/// Move a unit along the path. The first cell is the current position of the unit.
public fun move_unit(map: &mut Map, path: vector<u8>): Record {
    assert!(path.length() > 2, EPathTooShort);

    let distance = path.length() - 2;
    let (x0, y0) = (path[0] as u16, path[1] as u16);
    let (rows, cols) = (map.grid.rows(), map.grid.cols());

    assert!(x0 < rows && y0 < cols, ETileOutOfBounds);
    let search = map.check_path(path).destroy_or!(abort EPathUnwalkable);
    let (x1, y1) = (search[0], search[1]);
    assert!(x1 < rows && y1 < cols, ETileOutOfBounds);

    let mut unit = map.grid[x0, y0].unit.extract();
    unit.perform_move(distance as u8);
    map.grid[x1, y1].unit.fill(unit);

    history::new_move(path)
}

#[allow(lint(public_random))]
/// Perform a ranged attack from `(x0, y0)` at `(x1, y1)`.
///
/// The hit chance is the attacker's aim adjusted for range, minus the target's
/// defense. With a single-target weapon (`area_size` of 0) the target tile must
/// hold a unit, and the defense is the directional cover bonus plus the
/// target's natural `defense` stat. With an area weapon (`area_size` above 0)
/// the target is any tile but a `Wall`, defense does not apply, and a hit
/// explodes with the radius `area_size` (see `explode`). The weapon's
/// `can_be_dodged` stat decides whether the damage can be dodged. Either way
/// the attacker needs a line of sight to the target (see `line_of_sight`).
///
/// Records: `Attack`, then `Miss`; or for a single target `Dodged`, or
/// `Damage` / `CriticalHit`, `[UnitKIA]`; or for an area weapon the records
/// of `explode`.
///
/// What is worse for the attacker never takes more storage than what is better:
/// a miss and a dodge are one record of the same size, a hit a larger one, a
/// kill adds another and leaves the unit in `fallen`. A gas budget cannot be
/// set to let through only the good outcomes.
public fun perform_attack(
    map: &mut Map,
    rng: &mut RandomGenerator,
    x0: u16,
    y0: u16,
    x1: u16,
    y1: u16,
): vector<Record> {
    let mut history = vector[history::new_attack(vector[x0, y0], vector[x1, y1])];
    let range = grid::manhattan_distance!(x0, y0, x1, y1) as u8;

    let attacker = &map.grid[x0, y0].unit;
    assert!(attacker.is_some(), ENoUnit);

    let stats = attacker.borrow().stats();
    let radius = stats.area_size() as u16;
    let can_dodge = stats.can_be_dodged() != 0;
    let env_damage = stats.env_damage() != 0;

    // single target: the tile must hold a unit, whose cover and natural defense
    // lower the hit chance; an area weapon targets a tile and ignores both
    let target_defense = if (radius == 0) {
        let target = &map.grid[x1, y1].unit;
        assert!(target.is_some(), ENoUnit);
        let cover = if (range > 0) map.cover_bonus(x0, y0, x1, y1) else 0;
        let natural = target.borrow().stats().defense();
        ((cover as u16) + (natural as u16)).min(100) as u8
    } else {
        assert!(!map.is_tile_wall(x1, y1), ETileIsWall);
        0
    };

    assert!(map.line_of_sight(x0, y0, x1, y1), ENoLineOfSight);

    let unit = map.grid[x0, y0].unit.borrow_mut();
    let (is_hit, _, is_crit, damage, _) = unit.perform_attack(rng, range, target_defense);
    if (!is_hit) {
        history.push_back(history::new_miss());
        return history
    };

    if (radius > 0) {
        history.append(map.explode(rng, x1, y1, radius, damage, env_damage, can_dodge));
        return history
    };

    let mut target = map.grid[x1, y1].unit.extract();
    let (is_dodged, damage, is_kia) = if (damage > 0) {
        target.apply_damage(rng, damage, can_dodge)
    } else (false, 0, false);

    history.push_back({
        if (is_dodged) history::new_dodged()
        else if (is_crit) history::new_critical_hit(damage) // same cost
        else history::new_damage(damage)
    });

    if (is_kia) {
        history.push_back(history::new_kia(target.recruit_id(), x1, y1));
        map.fallen.push_back(target);
    } else map.grid[x1, y1].unit.fill(target);

    history
}

/// Take the units killed since the last call out of the `Map`. Returns the IDs
/// of their recruits.
public fun bury(map: &mut Map): vector<ID> {
    let mut fallen = vector[];
    while (!map.fallen.is_empty()) fallen.push_back(map.fallen.pop_back().destroy());
    fallen
}

/// Calculate the cover bonus for the given tile. The cover bonus is calculated
/// based on the direction of the attack and the type of cover on the tile.
///
/// - no cover - 0
/// - LOW_COVER - 25
/// - HIGH_COVER - 50
///
/// A `Wall` tile next to the target counts as high cover on that side.
public(package) fun cover_bonus(map: &Map, x0: u16, y0: u16, x1: u16, y1: u16): u8 {
    use grid::direction::{direction, none, up, down, left, right};

    let direction = direction!(x0, y0, x1, y1);
    let (up, down, left, right) = map.tile_cover!(x1, y1);

    // edge case: same tile, should never happen
    if (direction == none!()) return 0;

    // target tile cover type (does not check neighboring tiles with reverse defense)
    let cover_type = if (direction == up!()) {
        if (down != 0) down // target tile has cover
        else {
            let (top, _, _, _) = map.tile_cover!(x1 + 1, y1);
            top
        }
    } else if (direction == down!()) {
        if (up != 0) up
        else {
            let (_, bottom, _, _) = map.tile_cover!(x1 - 1, y1);
            bottom
        }
    } else if (direction == left!()) {
        if (right != 0) right
        else {
            let (_, _, left, _) = map.tile_cover!(x1, y1 + 1);
            left
        }
    } else if (direction == right!()) {
        if (left != 0) left
        else {
            let (_, _, _, right) = map.tile_cover!(x1, y1 - 1);
            right
        }
    } else if (direction == up!() | left!()) {
        let cover_type = down.max(right);
        if (cover_type  != 0) cover_type
        else {
            let (top, _, _, _) = map.tile_cover!(x1 + 1, y1);
            let (_, _, left, _) = map.tile_cover!(x1, y1 + 1);
            top.max(left)
        }
    } else if (direction == up!() | right!()) {
        let cover_type = down.max(left);
        if (cover_type != 0) cover_type
        else {
            let (top, _, _, _) = map.tile_cover!(x1 + 1, y1);
            let (_, _, _, right) = map.tile_cover!(x1, y1 - 1);
            top.max(right)
        }
    } else if (direction == down!() | left!()) {
        let cover_type = up.max(right);
        if (cover_type != 0) cover_type
        else {
            let (_, bottom, _, _) = map.tile_cover!(x1 - 1, y1);
            let (_, _, left, _) = map.tile_cover!(x1, y1 + 1);
            bottom.max(left)
        }
    } else if (direction == down!() | right!()) {
        let cover_type = up.max(left);
        if (cover_type != 0) cover_type
        else {
            let (_, bottom, _, _) = map.tile_cover!(x1 - 1, y1);
            let (_, _, _, right) = map.tile_cover!(x1, y1 - 1);
            bottom.max(right)
        }
    } else abort; // unreachable

    // cover enum is 0, 1, 2, so by multiplying it by 25 we get the value we
    // need; same, as if we matched it to 0, 25, 50
    cover_type * DEFENSE_BONUS
}

macro fun tile_cover($map: &Map, $x: u16, $y: u16): (u8, u8, u8, u8) {
    let map = $map;
    match (map.grid[$x, $y].tile_type) {
        TileType::Cover { left, right, top, bottom } => (top, bottom, left, right),
        TileType::Wall => (HIGH_COVER, HIGH_COVER, HIGH_COVER, HIGH_COVER),
        _ => (0, 0, 0, 0),
    }
}

#[allow(lint(public_random))]
/// Throw a grenade from `(x, y)` at `(x1, y1)`. This action costs 1 AP, deals
/// `GRENADE_DAMAGE` to every unit in the von Neumann neighborhood of radius
/// `GRENADE_RADIUS` around the target tile (a diamond), cannot be dodged, and
/// destroys covers in the area. The target tile must be reachable by a throw:
/// walls block it, covers do not (see `line_of_throw`).
///
/// Records: `Grenade`, then the records of `explode`.
public fun perform_grenade(
    map: &mut Map,
    rng: &mut RandomGenerator,
    x: u16,
    y: u16,
    x1: u16,
    y1: u16,
): vector<Record> {
    assert!(grid::manhattan_distance!(x, y, x1, y1) <= GRENADE_RANGE, EPathTooShort);
    assert!(!map.is_tile_wall(x1, y1), ETileIsWall);
    assert!(map.line_of_throw(x, y, x1, y1), ENoLineOfSight);
    let unit = &mut map.grid[x, y].unit;
    assert!(unit.is_some(), ENoUnit);

    // update unit's stats
    let unit = unit.borrow_mut();
    unit.perform_grenade();

    let mut history = vector[history::new_grenade(vector[x, y], vector[x1, y1])];
    history.append(map.explode(rng, x1, y1, GRENADE_RADIUS, GRENADE_DAMAGE, true, false));
    history
}

/// Apply area damage centered at `(x, y)`: every unit in the von Neumann
/// neighborhood of `radius` (center included) takes `damage`, reduced by its
/// armor and dodged only if `can_dodge`. With `env_damage`, covers in the area
/// are destroyed (`Cover` -> `Empty`). Shared by grenades and area weapons.
///
/// Records: `Explosion`, then `Dodged`, or `Damage`, `[UnitKIA]`, per unit in
/// the area. Tiles are visited in the order of `Grid.von_neumann_neighbors`
/// with the center tile last.
fun explode(
    map: &mut Map,
    rng: &mut RandomGenerator,
    x: u16,
    y: u16,
    radius: u16,
    damage: u8,
    env_damage: bool,
    can_dodge: bool,
): vector<Record> {
    let mut history = vector[history::new_explosion(x, y, radius)];
    let mut cells = map.grid.von_neumann_neighbors(cell::new(x, y), radius);

    cells.push_back(cell::new(x, y));
    cells.do!(|p| {
        let (x, y) = p.to_values();
        let tile = &mut map.grid[x, y];

        if (tile.unit.is_some()) {
            let mut unit = tile.unit.extract();
            let (is_dodged, dmg, is_kia) = unit.apply_damage(rng, damage, can_dodge);

            history.push_back({
                if (is_dodged) history::new_dodged() else history::new_damage(dmg)
            });

            if (!is_kia) tile.unit.fill(unit)
            else {
                history.push_back(history::new_kia(unit.recruit_id(), x, y));
                map.fallen.push_back(unit);
            };
        };

        if (env_damage) {
            match (tile.tile_type) {
                TileType::Cover { .. } => tile.tile_type = TileType::Empty,
                _ => (),
            }
        };
    });

    history
}

/// Get the size of the map as `(rows, cols)`.
public fun size(map: &Map): (u16, u16) { (map.grid.rows(), map.grid.cols()) }

/// Read the Unit at the given position.
public fun unit(map: &Map, x: u16, y: u16): &Option<Unit> {
    &map.grid[x, y].unit
}

/// Check if the given tile has a unit on it.
public fun tile_has_unit(map: &Map, x: u16, y: u16): bool {
    map.grid[x, y].unit.is_some()
}

/// Check if the given tile is a cover.
public fun is_tile_cover(map: &Map, x: u16, y: u16): bool {
    match (map.grid[x, y].tile_type) {
        TileType::Cover { .. } => true,
        _ => false,
    }
}

/// Check if the given tile is unwalkable.
public fun is_tile_unwalkable(map: &Map, x: u16, y: u16): bool {
    match (map.grid[x, y].tile_type) {
        TileType::Unwalkable => true,
        _ => false,
    }
}

/// Check if the given tile is a wall.
public fun is_tile_wall(map: &Map, x: u16, y: u16): bool { is_wall!(&map.grid[x, y]) }

/// Check if the given tile can be walked on: neither `Unwalkable` nor `Wall`.
public fun is_tile_walkable(map: &Map, x: u16, y: u16): bool { is_walkable!(&map.grid[x, y]) }

/// Whether `$tile` is a `Wall`.
macro fun is_wall($tile: &Tile): bool {
    let tile = $tile;
    match (tile.tile_type) {
        TileType::Wall => true,
        _ => false,
    }
}

/// Whether `$tile` can be walked on: neither `Unwalkable` nor `Wall`.
macro fun is_walkable($tile: &Tile): bool {
    let tile = $tile;
    match (tile.tile_type) {
        TileType::Unwalkable | TileType::Wall => false,
        _ => true,
    }
}

/// Cover value of the side of `$tile` facing `$direction`. A `Wall` has no
/// cover here: it is handled as a wall before cover is looked at.
macro fun side_cover($tile: &Tile, $direction: u8): u8 {
    use grid::direction::{up, down, left};

    let (tile, direction) = ($tile, $direction);
    match (tile.tile_type) {
        TileType::Cover { left: l, top, right, bottom } => {
            if (direction == up!()) top
            else if (direction == down!()) bottom
            else if (direction == left!()) l
            else right
        },
        _ => NO_COVER,
    }
}

/// Whether the edge between `$from` and its neighbor `$to` in `$direction`
/// has high cover on either side. Shared by `check_path` and `trace_line`.
macro fun is_edge_high_cover($from: &Tile, $to: &Tile, $direction: u8): bool {
    use grid::direction::inverse;

    let (from, to, direction) = ($from, $to, $direction);
    side_cover!(from, direction) == HIGH_COVER
        || side_cover!(to, inverse!(direction)) == HIGH_COVER
}

/// Alias to support the `Grid.to_string` method.
public use fun tile_to_string as Tile.to_string;

/// Print the `Tile` as a `String`. Used in the `Grid.to_string!()` macro.
public fun tile_to_string(tile: &Tile): String {
    match (tile.tile_type) {
        TileType::Empty => b"     ".to_string(),
        TileType::Cover { left, right, top, bottom } => {
            let mut str = b"".to_string();
            str.append(left.to_string());
            str.append(top.to_string());
            str.append(right.to_string());
            str.append(bottom.to_string());
            str.append_utf8(if (tile.unit.is_some()) b"U" else b"-");
            str
        },
        TileType::Unwalkable => b" XXX ".to_string(),
        TileType::Wall => b" ### ".to_string(),
    }
}

/// Check if the given path is walkable. Can be an optimization for pathfinding,
/// if the path is traced on the frontend.
///
/// Returns `None` if the path is not walkable, otherwise returns the end cell
/// of the path.
public fun check_path(map: &Map, mut path: vector<u8>): Option<vector<u16>> {
    use grid::direction::{up, down, left, right};

    path.reverse();

    // first two values are X and Y coordinates, the rest are directions
    let (x0, y0) = (path.pop_back() as u16, path.pop_back() as u16);
    let mut cursor = cursor::new(x0, y0);
    let none = option::none();

    // the tile the path starts on; every later source is the previous target
    let mut source = &map.grid[x0, y0];
    if (!path.is_empty() && !is_walkable!(source)) return none;

    'path: {
        path.destroy!(|direction| {
            // a step goes to one of the four neighbors: no diagonals, no standing still
            let is_step =
                direction == up!() || direction == down!() ||
                direction == left!() || direction == right!();
            if (!is_step) return 'path none;

            cursor.move_to(direction);
            let (x1, y1) = cursor.to_values();
            let target = &map.grid[x1, y1];

            // units, walls, unwalkable tiles and high covers block the path
            if (target.unit.is_some()) return 'path none;
            if (!is_walkable!(target)) return 'path none;
            if (is_edge_high_cover!(source, target, direction)) return 'path none;
            source = target;
        });

        option::some(cursor.to_vector())
    }
}

// === Line of Sight ===

/// Check the line of sight for a shot from `(x0, y0)` to `(x1, y1)`: walls and
/// high covers block it, unwalkable tiles and units do not. See `trace_line`.
public fun line_of_sight(map: &Map, x0: u16, y0: u16, x1: u16, y1: u16): bool {
    map.trace_line(x0, y0, x1, y1, true)
}

/// Check the line of throw for a grenade from `(x0, y0)` to `(x1, y1)`: only
/// walls block it, a grenade flies over covers. See `trace_line`.
public fun line_of_throw(map: &Map, x0: u16, y0: u16, x1: u16, y1: u16): bool {
    map.trace_line(x0, y0, x1, y1, false)
}

/// Walk the segment between the centers of two tiles one edge at a time and
/// check that it is clear. Entering a `Wall` always blocks. With
/// `high_cover_blocks`, a high cover on either side of a crossed edge blocks
/// too, except on the edges touching the two end tiles: cover next to the
/// attacker or the target is cover, not a wall. `Unwalkable` tiles and units
/// never block. Where the segment passes exactly through a corner, it is
/// clear if either of the two orthogonal routes around the corner is clear.
///
/// The walk is the Amanatides-Woo grid traversal in unsigned integers: after
/// `i` row steps and `j` column steps the next row edge lies at
/// `(i + 0.5) / dx` of the segment and the next column edge at
/// `(j + 0.5) / dy`, compared as `(2i + 1) * dy` against `(2j + 1) * dx`.
/// It takes `dx + dy` steps with one tile read each: the tile being left was
/// read when it was entered. An edge is inner when it is neither the first
/// nor the last of the `dx + dy` edges crossed, counted as `i + j`. The same
/// edges are visited from either end, so the result is symmetric: `a` sees
/// `b` if and only if `b` sees `a`.
fun trace_line(map: &Map, x0: u16, y0: u16, x1: u16, y1: u16, high_cover_blocks: bool): bool {
    use grid::direction::{up, down, left, right};

    let (dx, dy) = (x0.diff(x1) as u64, y0.diff(y1) as u64);
    let edges = dx + dy;
    let (downward, rightward) = (x1 > x0, y1 > y0);
    let sx = if (downward) down!() else up!();
    let sy = if (rightward) right!() else left!();
    let (mut x, mut y) = (x0, y0);
    let mut cur = &map.grid[x0, y0];
    let (mut i, mut j) = (0u64, 0u64);

    while (i + j < edges) {
        let k = i + j; // edges crossed so far
        let (t_row, t_col) = ((2 * i + 1) * dy, (2 * j + 1) * dx);

        if (t_row < t_col) {
            let nx = if (downward) x + 1 else x - 1;
            let next = &map.grid[nx, y];
            if (step_blocks(cur, next, sx, k > 0 && k + 1 < edges, high_cover_blocks)) return false;
            cur = next;
            x = nx;
            i = i + 1;
        } else if (t_col < t_row) {
            let ny = if (rightward) y + 1 else y - 1;
            let next = &map.grid[x, ny];
            if (step_blocks(cur, next, sy, k > 0 && k + 1 < edges, high_cover_blocks)) return false;
            cur = next;
            y = ny;
            j = j + 1;
        } else {
            // corner: two edges are crossed at once, and the line is clear if
            // either route around the vertex is clear; the tiles beside the
            // vertex are never the end tile, the one past it is when it ends
            // the walk
            let nx = if (downward) x + 1 else x - 1;
            let ny = if (rightward) y + 1 else y - 1;
            let (a, b, c) = (&map.grid[nx, y], &map.grid[x, ny], &map.grid[nx, ny]);
            let (inner1, inner2) = (k > 0, k + 2 < edges);
            let via_row =
                !step_blocks(cur, a, sx, inner1, high_cover_blocks)
                    && !step_blocks(a, c, sy, inner2, high_cover_blocks);
            let via_col =
                !step_blocks(cur, b, sy, inner1, high_cover_blocks)
                    && !step_blocks(b, c, sx, inner2, high_cover_blocks);

            if (!via_row && !via_col) return false;
            cur = c;
            (x, y) = (nx, ny);
            i = i + 1;
            j = j + 1;
        }
    };

    true
}

/// Whether stepping from `from` into its neighbor `to` in `direction` blocks
/// the line: `to` is a `Wall`, or, with `high_cover_blocks`, the edge is
/// `inner` (touches neither end tile) and has high cover on either side.
fun step_blocks(from: &Tile, to: &Tile, direction: u8, inner: bool, high_cover_blocks: bool): bool {
    if (is_wall!(to)) true
    else if (!high_cover_blocks || !inner) false
    else is_edge_high_cover!(from, to, direction)
}

// === Map Presets ===

// maps:begin - generated by `pnpm --dir app build:map-preset`
/// The Kōra district of the first demo, three recruits a side.
public fun black_rain(id: ID): Map {
    // prettier-ignore
    let mut map = from_bytes(x"00000000000000000000000000000000000000000000000000000000000000000e1203000300030003000300000000000000000000000000000000000300030003000300030012030003000300030003000000000000000000000000000000000003000300030003000300120300030003000300030000000000000000000000000000000101010101000300030003000300030012030003000300030003000000000000000000010101010100000000000000030003000300030003001200000000000000000000010101010100000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000101010101000101010101000000000000001200000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000120300030003000000000000000101010101000101010101000000000000000101010101000101010101000000000000000000000012030003000300000000000000000000000000000000000000000000000000000000000000120300030003000101010101000000000000000000000000000000000000000300030003000300000012030003000300000000000000000000000000000000000000000003000300030003000000120000000000000000000000000000000000000000000000000000030003000300030000000e00120000");
    map.id = id;
    map
}

/// Spawn positions of `black_rain`: half for the first player, half for the second.
public fun black_rain_positions(): vector<vector<u8>> {
    // prettier-ignore
    vector[vector[11, 6], vector[12, 8], vector[11, 10], vector[4, 11], vector[5, 14], vector[3, 6]]
}
// maps:end

// === Compatibility / Conversion ===

/// Deserializes the `Map` from the given bytes, all of them.
public fun from_bytes(bytes: vector<u8>): Map {
    let mut bcs = bcs::new(bytes);
    let map = from_bcs(&mut bcs);
    assert!(bcs.into_remainder_bytes().is_empty());
    map
}

/// Deserialize the `Map` from the `BCS` instance.
public(package) fun from_bcs(bcs: &mut BCS): Map {
    let id = bcs.peel_address().to_id();
    let grid = grid::from_bcs!(bcs, |bcs| {
        Tile {
            tile_type: match (bcs.peel_u8()) {
                0 => TileType::Empty,
                1 => TileType::Cover {
                    left: bcs.peel_u8(),
                    top: bcs.peel_u8(),
                    right: bcs.peel_u8(),
                    bottom: bcs.peel_u8(),
                },
                2 => TileType::Unwalkable,
                3 => TileType::Wall,
                _ => abort,
            },
            unit: bcs.peel_option!(|bcs| unit::from_bcs(bcs)),
        }
    });

    let fallen = bcs.peel_vec!(|bcs| unit::from_bcs(bcs));

    Map { id, grid, fallen }
}

/// Implements the `Grid.to_string` method due to `Tile` implementing
/// `to_string` too.
public fun to_string(map: &Map): String {
    map.grid.to_string!()
}
