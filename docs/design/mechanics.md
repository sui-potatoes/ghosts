# Core mechanics: map and action resolution (on-chain game)

Scope: the Move package `ghosts` (map structure, movement, lines, cover, attack, grenade, reload, stats, match flow) as implemented in `move/packages/ghosts/sources`, plus a short table of where the local demo engine differs. It states what the code does, not what it should do; the list of actions per unit is in [actions.md](actions.md) and action names, descriptions and AP are in [`packages/catalog/actions.json`](../../packages/catalog/actions.json), neither is repeated here.

Date: 2026-11-12. Commit: `80498e7` (Move sources unmodified in the working tree at that commit).

Conventions. Paths are relative to the repo root; `S/` = `move/packages/ghosts/sources/`, `T/` = `move/packages/ghosts/tests/`, `G/` = the `grid` dependency (`@potatoes/grid`) as built under `move/packages/ghosts/build/ghosts/sources/dependencies/grid/` (a build artifact; the same files as the dependency). Numbers marked "run" were checked by running Move tests in a scratch copy of the package (outside the repo); everything else is read from the code. Line numbers will drift: re-derive them from the commit.

## 1. Map structure

### 1.1 Types

| Item | Definition | Ref |
| --- | --- | --- |
| `Map` | `id: ID`, `grid: Grid<Tile>`, `fallen: vector<Unit>` (units killed since the last `bury`, already taken off their tiles) | `S/map/map.move:87` |
| `Tile` | `tile_type: TileType`, `unit: Option<Unit>` (copy, store) | `S/map/map.move:56` |
| `TileType` | enum `Empty`, `Cover { left, top, right, bottom: u8 }`, `Unwalkable`, `Wall`, `Obstacle` (BCS tags 0..4 in that order) | `S/map/map.move`, `TileType`, `peel_without_units` |
| `Grid<T>` | `grid: vector<vector<T>>`, `rows: u16`, `cols: u16` | `G/grid.move:41` |

Cover side values: `NO_COVER` 0, `LOW_COVER` 1, `HIGH_COVER` 2 (`S/map/map.move:37-42`). Side names are tile-local: `top` is the side towards row x-1, `bottom` towards x+1, `left` towards column y-1, `right` towards y+1 (see 1.2; `side_cover!` at `S/map/map.move:512`). The type does not validate side values: `from_bcs` takes any `u8` (`:724-729`); only 0, 1 and 2 are given meaning (a value of 3 would be read as a cover worth 75 and would not block lines or paths, since those test `== HIGH_COVER`; this is derived from the code, not run).

| `TileType` | Walk on / place a recruit | Blocks movement into/out of it | Blocks line of sight | Blocks line of throw | Can be an attack target | Other |
| --- | --- | --- | --- | --- | --- | --- |
| `Empty` | yes | no | no | no | yes | |
| `Cover` | yes | a side with `HIGH_COVER` blocks the edge it faces; `LOW_COVER` never blocks (`:584`, `:529`) | a high side blocks an inner edge it faces (`:683-687`); low never | no | yes | destroyed (becomes `Empty`) by explosions with `env_damage` (`:446-451`); gives the cover bonus (section 4) |
| `Unwalkable` | no (`ETileIsUnwalkable`, `place_recruit` `:138`; paths `:583`) | blocks entering it | no | no | yes (an area weapon or a grenade may target it; a single-target attack needs a unit on the tile, so no) | docs: "water or a pit" (`:78`) |
| `Wall` | no (`ETileIsWall`, `:139`; paths `:583`) | blocks entering it | yes, always, also on the end edges (`:684`) | yes | no: `ETileIsWall` for area weapons (`:239`) and grenades (`:391`); a single-target shot needs a unit, and none can stand on a wall | counts as `HIGH_COVER` on all four sides for the cover bonus of a neighbor (`:369`); not destroyed by explosions (only `Cover` and `Obstacle` are, `:447`) |
| `Obstacle` | walk over, never stand on: `place_unit` aborts `ETileIsObstacle` (11); a path may cross it but not end on it (`ETileIsObstacle`) nor step from it onto another obstacle (`EObstaclesInARow`, 12); see 2.2 | no: it has no sides, so no edge is high | no | no | yes for an area weapon or a grenade; a single-target shot needs a unit, and none stands on an obstacle | counts as `LOW_COVER` on all four sides for the cover bonus of a neighbor (`tile_cover!`); destroyed (becomes `Empty`) by explosions with `env_damage` |

An obstacle, in the owner's words, is "something that can be hovered over": it acts as a low cover on each side and cannot be walked onto. It gives low cover (25) on each of its four sides to units on the neighboring tiles; no unit can ever stand on it (not as the end of a move, not at deploy or spawn); a move may pass over it (the vault), and that step counts as one tile of distance like any other. Two obstacles in a row cannot be passed: the step off an obstacle lands on a tile a unit can stand on. A `Cover` tile is still edge cover a unit stands on, 1 to 3 sides as designed; a `Cover` low on all four sides stays legal and standable, but no baked level uses it for a prop any more.

A tile with a unit is not walkable for anyone else (`:582`), but units block neither line of sight nor line of throw.

### 1.2 Coordinates

A tile is addressed as `(x, y)` = `(row, column)`: `x` is the first index and selects the row (the outer vector), `y` the second and selects the column. `(0, 0)` is the top-left tile; `x` grows downwards, `y` grows to the right. `grid[x, y]` is `Grid.borrow(row, col)`, which aborts with `EIndexOutOfBounds` (1, `G/grid.move:38`) if `x >= rows` or `y >= cols` (`G/grid.move:99-102`). `Map.size` returns `(rows, cols)` (`S/map/map.move:458`).

`G/direction.move:8-12` documents "X-axis: horizontal, Y-axis: vertical". The macros in the same file name their parameters `row`/`col` and compare the first argument for up/down (`:48-85`), and `cursor.move_to` changes the first index on up/down (`G/cursor.move:104-118`). The code treats the first index as the row (vertical); the module doc comment says the opposite. This document follows the code.

```
          y=0 y=1 y=2 y=3        A at (x=2, y=0)   B at (x=1, y=2)
   x=0     .   .   .   .         rows = 3, cols = 4
   x=1     .   .   B   .         up    = x-1   down  = x+1
   x=2     A   .   .   .         left  = y-1   right = y+1
```

Entry-function arguments (all `u16` unless noted): `move_unit(game, acc, clock, path: vector<u8>)` with `path[0] = x`, `path[1] = y` of the unit, then direction bytes (`S/ghosts.move:378`); `perform_reload(.., x, y)` (`:390`); `perform_attack(.., x0, y0, x1, y1)` and `perform_grenade(.., x0, y0, x1, y1)` with `(x0, y0)` the acting unit and `(x1, y1)` the target (`:403`, `:424`). Because a path stores coordinates as `u8`, a unit can only be moved while it stands at `x, y <= 255` (`S/map/map.move:176`).

### 1.3 Size and creation

- `Map::new(id, size: u16)` makes a `size x size` grid of `Empty` tiles with no units; `default` is 30 x 30 (`S/map/map.move:98-114`). No upper bound is enforced in code beyond `u16` and the Sui object size limit (not checked here). `from_bcs` takes row and column counts from the vectors themselves: `rows`/`cols` are derived from `grid.length()` and `grid[0].length()`, the trailing `u16` pair is read and ignored, and ragged rows are not rejected (`G/grid.move:62-68`, `:623-629`). An empty grid aborts (`grid[0]`).
- Distances in the attack and grenade code use `grid::manhattan_distance!` (`G/grid.move:221`), `|x0-x1| + |y0-y1|`; neighborhoods use `Grid.von_neumann_neighbors` (`G/grid.move:349`), the cells within Manhattan distance `r`, excluding the center, clipped to the grid.
- There is one preset, `black_rain`, plus test-only `demo_1`, `demo_2` (`T/map/map.move:41-55`). `Preset` is created once in `init` and frozen (`S/ghosts.move:665-672`); a game clones its map (`:262-270`, `Map.clone` at `S/map/map.move:129`).

`Map` BCS layout (`from_bcs`, `S/map/map.move:718-741`; `from_bytes` requires every byte to be consumed, `:710-715`):

| Bytes | Content |
| --- | --- |
| 32 | `id` (address); presets are stored with 32 zero bytes and the `id` is overwritten (`:696`) |
| ULEB128 | number of rows, then per row: ULEB128 column count, then the tiles |
| per tile | 1 byte tag (0 Empty, 1 Cover, 2 Unwalkable, 3 Wall, 4 Obstacle); for Cover 4 more bytes in the order `left, top, right, bottom` (no other tag has fields); then `Option<Unit>` (1 byte `0` for none, `1` + a `Unit` for some). An empty tile, a wall or an obstacle is 2 bytes, a cover 6 |
| 2 + 2 | `rows`, `cols` as `u16` little-endian (read, ignored) |
| ULEB128 | `fallen`: number of units, then the units |

`Unit` BCS (`S/map/unit.move:282-292`): `recruit` (32), `owner` (32), `ap` (`u16 value`, `u16 max`), `hp`, `ammo` (same), `stats` (`u128`, 16 bytes little-endian), `actions` (vector of `Action`: option-`u8` uses, then the `ActionKind` tag, `S/map/action.move:101-103`).

### 1.4 `black_rain`

`black_rain` (`S/map/map.move:693`) is a generated 14 rows x 18 columns map (rows 0-13, columns 0-17) of the Kōra district. The block between `maps:begin`/`maps:end` is written by `pnpm --dir app build:map-preset`, i.e. `app/scripts/build-map-preset.ts`, which reads the engine scenario `blackRain` (`packages/engine/src/scenario.ts:74`) through `TacticalMap` (`packages/engine/src/map.ts`): a cell the scene calls cover holds a prop (a barrier, a crate, cargo, barrels, a fence sheet, a smoking barrel) and becomes an `Obstacle`, an open cell `Empty`, a building footprint `Wall`, anything else `Unwalkable` (`encode` in the script). The script also checks that every spawn is `Empty` (not an obstacle) and has at least one `Empty` or `Cover` neighbor. Decoded from the bytes (556, before obstacles 596): 178 `Empty`, 64 `Wall`, 10 `Obstacle`, 0 `Cover`, 0 `Unwalkable`. So on this map no high cover exists; walls and units block movement and sight, obstacles block standing and give their neighbors low cover. Spawn cells are `[row, col]`, swapped from the scene's `[x, z]` (`:87`).

```
    cols  0         1
          012345678901234567       A = side 0 spawn   B = side 1 spawn
   0      #####........#####       o = Obstacle       # = Wall
   1      #####........#####
   2      #####.......o#####
   3      #####.B..o...#####
   4      .....o.....B......
   5      ..............B...
   6      .............oo...
   7      ..................
   8      ..................
   9      ###...oo...oo.....
  10      ###...............
  11      ###o..A...A..####.
  12      ###.....A....####.
  13      .............####.
```

`black_rain_positions` = `[[11,6],[12,8],[11,10],[4,11],[5,14],[3,6]]` (`:701-704`). The first half (`length / 2`) belongs to side 0, the second to side 1 (`S/ghosts.move:262-268`); the half size is the maximum squad (3). A side's recruits are placed by `positions[side].pop_back()`, so the first recruit received gets the last position of its half: side 0 fills `(11,10)`, `(12,8)`, `(11,6)`; side 1 fills `(3,6)`, `(5,14)`, `(4,11)` (`:367`).

### 1.5 `Unit` on a tile

`Unit` (`S/map/unit.move:45-65`), built by `from_recruit` at deployment (`:211-238`):

| Field | Meaning | Fixed for the match? |
| --- | --- | --- |
| `recruit: ID` | the `Recruit` object | fixed |
| `owner: ID` | the `Account` ID of the recruit's leader; the side | fixed |
| `ap: Param` (value, max) | action points; max is 2 (`param::new(2)`, `:232`) | max fixed; value changes |
| `hp: Param` | max = `stats.health` | max fixed; value falls |
| `ammo: Param` | max = `stats.ammo` | max fixed; value changes |
| `stats: Stats` | all stats after gear (section 8) | fixed; no action changes it |
| `actions: vector<Action>` | `Move`; `Attack` + `Reload` if a weapon; then each utility's actions, with `uses` | `uses` of limited actions change |

`Param.decrease` saturates at 0 (`S/map/param.move:40`).

## 2. Movement

`Map.move_unit(map, path)` (`S/map/map.move:172-189`). `path = [x0, y0, d1, d2, ..., dn]`: start tile, then one direction byte per step. `distance = path.length - 2`.

Direction bytes (`G/direction.move:119-128`): `up` = 1 (x-1), `right` = 2 (y+1), `down` = 4 (x+1), `left` = 8 (y-1). `cursor.move_to` applies the bits independently (up wins over down, left over right, `G/cursor.move:104-118`), so 3, 6, 12, 9 would be diagonal steps (up+right, right+down, down+left, up+left); `check_path` rejects them (see 2.1). The app and agent only send orthogonal steps (`packages/agent/src/rules.ts:114`).

Check order and aborts:

1. `path.length > 2`, else `EPathTooShort` (6).
2. `x0 < rows && y0 < cols`, else `ETileOutOfBounds` (7).
3. `trace_path(map, path, strict = true)`, the walk `check_path` makes too (there with `strict = false`, returning `None` where `move_unit` aborts). For a path with at least one step: the start tile must be standable (`Empty` or `Cover`), else `EPathUnwalkable` (3); then for every step, the target tile (a) must hold no unit (any unit, either side), (b) must be neither `Wall` nor `Unwalkable`, (c) the edge crossed must not be high cover on either side: `side_cover(source, d) == HIGH || side_cover(target, inverse(d)) == HIGH` (`is_edge_high_cover!`); each of these aborts `EPathUnwalkable` (3); (d) if the source tile is an `Obstacle`, the target must not be one: `EObstaclesInARow` (12). After the last step, the end tile must not be an `Obstacle`: `ETileIsObstacle` (11). A step off the grid at the low end aborts in `cursor.move_to` (`EOutOfBounds`, 0); past the high end it aborts in the grid index (`EIndexOutOfBounds`).
4. The unit is taken off the start tile (aborts if empty) and `Unit.perform_move(distance)`: `has_action(Move)` else `EActionNotAllowed` (5); `mobility >= distance` else `ERangeExceeded` (1); `ap > 0` else `ENoAP` (3); then `ap -= 1` (`S/map/unit.move:71-78`).
5. The unit is placed on the last tile of the path, and `Move(path)` is recorded.

Rules that follow:

- AP cost: 1 AP per move order, whatever its length up to `mobility`. `mobility` (7 for a recruit, 6 with heavy armor) is the maximum number of direction bytes in one order. A unit with 2 AP can order two moves.
- Per-side cover rule: only `HIGH_COVER` (2) blocks. It blocks a step when the side of the tile being left that faces the step, or the side of the tile being entered that faces back, is high. "Faces the step": for `up` the leaving tile's `top` and the entering tile's `bottom`; `down`: `bottom` / `top`; `left`: `left` / `right`; `right`: `right` / `left` (`side_cover!` `:512-525`, `inverse!` `G/direction.move:150-162`). The three other sides of a tile do not matter for that step. Low cover never blocks; a unit may stand on and pass through low cover tiles. An `Obstacle` has no sides: a step onto or off it is blocked only by a high side of the `Cover` tile on the other end of the edge.
- Intermediate tiles must be free of units, and so must the destination. The moving unit is still on its start tile while the path is checked (it is extracted at `:184`), so a path cannot cross or end on its own start tile.
- Nothing else happens at the destination: no reaction, pick-up or terrain effect.

Worked example (run, `black_rain_vault_costs_its_steps`), `black_rain`, a unit at `(11,6)`, `path = [11, 6, 1, 1, 1]`: up to `(10,6)` (empty), up onto `(9,6)` (an obstacle: passed over), up to `(8,6)` (empty: the vault lands). `distance = 3`: allowed with mobility 3 (the unit stands at `(8,6)`, `(11,6)` is empty, AP 2 -> 1, record `Move([11,6,1,1,1])`), refused with mobility 2 (`ERangeExceeded`, `black_rain_vault_out_of_range_fail`).

The example this section used to give, `[11, 6, 1, 1, 2]` (up to `(10,6)`, up onto `(9,6)`, right onto `(9,7)`), is now refused with `EObstaclesInARow`: `(9,6)` and `(9,7)` are both obstacles, and the path would also end on one. Neither can be stood on.

High-cover example (`T/map/map.move:178-192`): with `Cover{right: HIGH}` at `(0,0)`, `[0,0,right]` and `[0,1,left]` are both blocked (the edge is high from either tile), while `[0,0,down,right,left]` is allowed.

### 2.1 Only orthogonal steps

`check_path` accepts a direction byte only if it is exactly `up`, `right`, `down` or `left` (1, 2, 4, 8); any other byte, a diagonal (3, 6, 9, 12) or 0 included, makes the path invalid and `move_unit` aborts with `EPathUnwalkable` (`S/map/map.move`, `check_path`; test `test_check_path_orthogonal_only` in `T/map/map.move`). Changed after commit 80498e7: before, diagonal bytes were accepted, moved two tiles of distance for one step and read only the `right` side of both tiles for cover.

### 2.2 Distance, obstacles and reach

How a move is counted, the same on chain and in every client:

1. A path is a start tile and a list of steps; each step goes to one of the four orthogonal neighbors (2.1).
2. The distance of a move is the number of steps in its path, `path.length - 2`. A step onto an obstacle and the step off it count one tile each, like any other step. The contract does not ask for the shortest path: a longer path to the same tile costs its own length.
3. Every tile a step goes onto is free of units (either side) and is not a `Wall` or `Unwalkable`; the edge crossed has no high side. A step onto an `Obstacle` must be followed by a step onto a standable tile: two obstacles in a row cannot be passed (obstacle, ground, obstacle, ground is fine).
4. The destination, the last tile, is standable: `Empty` or `Cover` (edge cover), never an `Obstacle`, and free of units.
5. `mobility` (effective stats) bounds the number of steps: `distance <= mobility`.
6. A move costs 1 AP, whatever its distance (`Unit.perform_move`).

Landing a vault: as every tile a path steps onto must be free of units (3), the tile after an obstacle is always free, mid-path or at the end; no path makes two units share a tile.

Reach: the tiles a unit can move to in one order are the standable, unit-free tiles (other than its own) at a breadth-first distance of 1 to `mobility` from it, where the search steps orthogonally onto any unit-free tile that is not a `Wall` or `Unwalkable`, across no high edge, and never from an obstacle onto an obstacle; an obstacle is searched through but not listed. Each tile's number of steps is its breadth-first distance, the fewest steps a valid path to it takes. As every rule is a rule of one step (its two tiles and the edge between them) or of the last tile, the breadth-first search over tiles is exact.

Reach tables (run, `black_rain_reach` in `T/map/map.move`, constants `BLACK_RAIN_REACH_3` and `BLACK_RAIN_REACH_7`): a unit at side 0's spawn `(11,6)` on `black_rain`, alone on the map. For mobility 3 the test also tries every path of up to 3 steps through `check_path` and gets the same set. `(x,y)` is `(row,col)`.

Mobility 3, 20 tiles:

| Steps | Tiles | `(row,col)` |
| ---: | ---: | --- |
| 1 | 4 | (10,6) (11,5) (11,7) (12,6) |
| 2 | 7 | (10,5) (10,7) (11,4) (11,8) (12,5) (12,7) (13,6) |
| 3 | 9 | (8,6) (9,5) (10,4) (10,8) (11,9) (12,4) (12,8) (13,5) (13,7) |

Mobility 7, 70 tiles:

| Steps | Tiles | `(row,col)` |
| ---: | ---: | --- |
| 1 | 4 | (10,6) (11,5) (11,7) (12,6) |
| 2 | 7 | (10,5) (10,7) (11,4) (11,8) (12,5) (12,7) (13,6) |
| 3 | 9 | (8,6) (9,5) (10,4) (10,8) (11,9) (12,4) (12,8) (13,5) (13,7) |
| 4 | 12 | (7,6) (8,5) (8,7) (9,4) (9,8) (10,3) (10,9) (11,10) (12,3) (12,9) (13,4) (13,8) |
| 5 | 12 | (6,6) (7,5) (7,7) (8,4) (8,8) (9,3) (9,9) (10,10) (11,11) (12,10) (13,3) (13,9) |
| 6 | 13 | (5,6) (6,5) (6,7) (7,4) (7,8) (8,3) (8,9) (9,10) (10,11) (11,12) (12,11) (13,2) (13,10) |
| 7 | 13 | (4,6) (5,5) (5,7) (6,4) (6,8) (7,3) (7,9) (8,2) (8,10) (10,12) (12,12) (13,1) (13,11) |

`(8,6)` at 3 steps and `(8,7)` at 4 are reached over the obstacles `(9,6)` and `(9,7)`, at the same distance as over open ground; `(9,6)` and `(9,7)` themselves are not in the set.

## 3. Lines

`line_of_sight(map, x0, y0, x1, y1)` = `trace_line(.., high_cover_blocks = true)`; `line_of_throw` = `trace_line(.., false)` (`S/map/map.move:596-604`). Attacks use sight, grenades use throw.

| | Wall in a tile entered | High cover on a crossed inner edge | Low cover or `Obstacle` | `Unwalkable` | Units |
| --- | --- | --- | --- | --- | --- |
| Line of sight | blocks | blocks | no | no | no |
| Line of throw | blocks | no | no | no | no |

Algorithm (`trace_line`, `:623-678`), Amanatides-Woo grid traversal of the segment between the two tile centers, in integers:

```
dx = |x0-x1|, dy = |y0-y1|, edges = dx + dy      (a straight or diagonal line also counts edges this way)
i = row steps done, j = column steps done, k = i + j
next row edge   at (i + 0.5)/dx   compared as  t_row = (2i+1) * dy
next col edge   at (j + 0.5)/dy   compared as  t_col = (2j+1) * dx
t_row < t_col : step one row (down if x1 > x0, else up); i += 1
t_col < t_row : step one column (right if y1 > y0, else left); j += 1
equal         : the segment passes through a vertex: two edges at once (corner)
```

The walk takes `edges` edge crossings. Each crossing from tile `a` to neighbor `b` in direction `d` is checked by `step_blocks` (`:683-687`): blocked if `b` is a `Wall`; else, with `high_cover_blocks` and an inner edge, blocked if `is_edge_high_cover!(a, b, d)` (high on `a`'s side facing `d` or `b`'s side facing back).

"Inner" edge (`:619-621`): an edge is inner when it is neither the first (`k == 0`) nor the last (`k + 1 == edges`) of the `edges` crossed. Cover on the first edge (next to the attacker) or the last edge (next to the target) therefore never blocks sight: it is cover, not a wall (`:609-610`). In a corner, the two crossings are edges `k` and `k+1`; `inner1 = k > 0`, `inner2 = k + 2 < edges` (`:661`). At a corner, the line is clear if either orthogonal route around the vertex is clear (`via_row || via_col`, `:662-669`); each route is two `step_blocks` calls, so a wall on both routes blocks, a wall on one does not.

A wall in a tile entered blocks regardless of position, including the end tile (an end tile cannot be a wall in practice, see 1.1). The start tile's own type never blocks.

Symmetry: the same edges are visited from either end, so `line_of_sight(a, b) == line_of_sight(b, a)` and likewise for throws. Run: on a random 7x7 map with walls, unwalkable tiles and cover sides of 0-2 (1681 ordered tile pairs with non-wall ends: 870 blocked sights, 746 blocked throws) no pair differed. Range 0 (`a == b`): `edges = 0`, clear.

Example 1 (run), 5x5, attacker `(0,0)`, target `(2,3)`: `dx = 2, dy = 3, edges = 5`. Steps: `t_row = 3 > t_col = 2`: column to `(0,1)`; then row to `(1,1)`; column to `(1,2)`; row to `(2,2)`; column to `(2,3)`.

| Edge no. | Crossing | Direction | Inner |
| --- | --- | --- | --- |
| 1 | `(0,0)` to `(0,1)` | right | no (first) |
| 2 | `(0,1)` to `(1,1)` | down | yes |
| 3 | `(1,1)` to `(1,2)` | right | yes |
| 4 | `(1,2)` to `(2,2)` | down | yes |
| 5 | `(2,2)` to `(2,3)` | right | no (last) |

Results, each the same from `(2,3)` to `(0,0)`: `(0,0).right = HIGH`: clear (edge 1); `(2,3).left = HIGH`: clear (edge 5); `(1,1).top = HIGH`: blocked (edge 2), but the line of throw is clear; `(2,2).top = HIGH`: blocked (edge 4); wall at `(0,1)`: blocked for sight and throw; walls at `(0,2)` and `(1,0)` (off the line): clear.

Example 2 (existing test `T/map/map.move:392-411`, passes), 5x5, `(0,0)` to `(2,2)`: `dx = dy = 2`, `edges = 4`, and both steps are corners: the first through the vertex shared by `(0,0),(0,1),(1,0),(1,1)` (`inner1` false, `inner2` true), the second through the one shared by `(1,1),(1,2),(2,1),(2,2)` (`inner1` true, `inner2` false). A wall at `(0,1)` alone: clear (route via `(1,0)`); walls at both `(0,1)` and `(1,0)`: blocked, and `(0,0)` to `(1,1)` is blocked too; with high covers on `(1,0).right` and `(0,1).bottom` (the two inner edges of the first corner) sight is blocked, the adjacent diagonal `(0,0)` to `(1,1)` is clear (all its edges touch an end tile), and the throw is clear.

## 4. Cover and defense

Computed only for a single-target attack with range > 0 (`S/map/map.move:232-241`); area weapons and grenades use no defense.

`cover_bonus(map, x0, y0, x1, y1)` (`:292-363`); `(x0,y0)` is the attacker, `(x1,y1)` the target:

```
direction = grid::direction::direction!(x0, y0, x1, y1)   // from attacker to target
cover_type = max cover value on the sides of the target facing the attacker (table below)
bonus = cover_type * DEFENSE_BONUS          // DEFENSE_BONUS = 25: none 0, low 25, high 50
```

`direction!` (`G/direction.move:178-197`) returns `none` for the same tile, the dominant axis alone when `|dx| != |dy|` (a vertical-dominant shot is `up`/`down`, a horizontal-dominant one `left`/`right`), and a diagonal only when `|dx| == |dy|`. Cover is read for the target tile first and falls back to the neighbor tile on the attacker's side, only when the target tile has no cover on the relevant side(s):

| Direction | Attacker lies | Target sides read | Fallback (only if those are 0): neighbor tile, its side |
| --- | --- | --- | --- |
| `up` (1) | x0 > x1 | `bottom` | `(x1+1, y1)`, `top` |
| `down` (4) | x0 < x1 | `top` | `(x1-1, y1)`, `bottom` |
| `left` (8) | y0 > y1 | `right` | `(x1, y1+1)`, `left` |
| `right` (2) | y0 < y1 | `left` | `(x1, y1-1)`, `right` |
| `up`+`left` (9) | x0 > x1, y0 > y1 | `max(bottom, right)` | `max((x1+1,y1).top, (x1,y1+1).left)` |
| `up`+`right` (3) | x0 > x1, y0 < y1 | `max(bottom, left)` | `max((x1+1,y1).top, (x1,y1-1).right)` |
| `down`+`left` (12) | x0 < x1, y0 > y1 | `max(top, right)` | `max((x1-1,y1).bottom, (x1,y1+1).left)` |
| `down`+`right` (6) | x0 < x1, y0 < y1 | `max(top, left)` | `max((x1-1,y1).bottom, (x1,y1-1).right)` |

Rules (all from the code above):

- Only the sides facing the attacker count; the others are ignored. There is no separate flanking bonus: a shot from a direction whose facing sides are bare is simply uncovered.
- For the four straight directions the target tile's own side wins when it is not 0, even if lower than the neighbor's (a low side on the target hides a high side on the neighbor); the neighbor is read only when the target's side is 0. Diagonals take the max of the two target sides first, then the max of the two neighbor sides.
- An `Obstacle` counts as `LOW_COVER` on all four sides (`tile_cover!`), so a unit next to an obstacle has 25 against a shot from across it (the fallback column above) and 0 from its open sides; a unit diagonal to an obstacle gets nothing from it, as the fallback reads only orthogonal neighbors. This is what a four-sided low `Cover` tile gives its neighbors (`obstacle_gives_low_cover`, `obstacle_lowers_the_hit_chance`). The target itself never stands on an obstacle.
- A `Wall` counts as `HIGH_COVER` on all four sides (`tile_cover!`, `:365-372`), so a wall on the neighbor tile between attacker and target gives 50. An `Unwalkable` neighbor gives 0 (`T/map/map.move:305-306`). Tests: `(0,1)` shooting `(2,1)` with a wall at `(1,1)` gives 50; from `(2,0)` gives 0 (`T/map/map.move:301-303`).
- Only a neighbor on the attacker's side is read, so the indexes `x1 + 1` and so on stay inside the grid.
- The values are not additive: the result is the maximum, 0, 25 or 50.

Combination with `defense`:

```
defense = min(cover_bonus + target.stats.defense, 100)            // u16 math, capped at 100  (:237)
hit_chance' = hit_chance - min(hit_chance, defense)               // subtractive, floored at 0  (unit.move:155)
```

`defense` is the target unit's `Stats.defense` (a recruit starts at 0; no catalogue item supplies it, see 8.3). Cover is not looked up when `range == 0` (`:235`). Run: `cover_bonus` of 25 for a low `left` side on a target east of the attacker.

## 5. Attack resolution (`Map.perform_attack` and `Unit.perform_attack`)

Entry: `ghosts::perform_attack` (`S/ghosts.move:424`) first passes `begin_unit_action` (section 9): the sender controls the `Account`, it is that side's turn and in time, the tile holds a unit whose `owner` is that `Account` (`ENotYourUnit`, 14). Then `Map.perform_attack` (`S/map/map.move:211-274`):

1. `history = [Attack{origin, target}]`; `range = manhattan_distance(x0,y0,x1,y1) as u8` (aborts above 255).
2. Attacker tile must hold a unit: else `ENoUnit` (5). Read the attacker's `area_size` (radius), `can_be_dodged != 0`, `env_damage != 0`.
3. If `radius == 0` (single target): the target tile must hold a unit, else `ENoUnit`; `defense` per section 4. If `radius > 0`: the target tile must not be a `Wall` (`ETileIsWall`, 8); defense is 0.
4. `line_of_sight(attacker, target)` else `ENoLineOfSight` (9).
5. `Unit.perform_attack(rng, range, defense)` (`S/map/unit.move:122-174`), in this order: `has_action(Attack)` else `EActionNotAllowed` (5); `ap > 0` else `ENoAP` (3); `ammo > 0` else `EOutOfAmmo` (2); then `spend_use(Attack)`, `ap = 0` (`deplete`), `ammo -= 1`; then `eff_range + 3 >= range` else `ERangeExceeded` (1). All aborts roll the transaction back, so AP and ammo are only lost on a completed order.

There is no check on who owns the target: an attack can target a unit of the attacker's own side, or the attacker itself (range 0). Run: a recruit with a Standard Rifle shooting its own tile `(1,1)` got `[Attack, Damage(4)]` and lost 4 HP.

### 5.1 Hit chance

Constants: `MAX_RANGE_OFFSET` 3, `DISTANCE_BONUS` 5, `DISTANCE_PENALTY` 10 (`S/map/unit.move:38-42`). With `R = stats.range`, `d = range`:

```
d == R : hit_chance = aim
d <  R : hit_chance = min(aim + 5 * (R - d), 100)
d >  R : hit_chance = aim - min(10 * (d - R), aim)         // d may exceed R by at most 3
hit_chance = hit_chance - min(hit_chance, target_defense)
is_hit = random u8 in [0, 99] < hit_chance
```

`aim` is the shooter's effective aim and `target_defense` includes the target's effective `defense` (section 6.1): both are read through `Unit.effective_stats`, the base stats with each status effect's modifier added. There is no minimum hit chance: at effective aim 0 (dazed) the hit chance is `5 * (R - d)` for `d < R` (the distance bonus still applies), 0 at `d >= R`, minus defense, floored at 0. Area weapons ignore defense, so smoke does not help against them.

The bonus is capped at 100 only on the `d < R` branch; `aim` itself can be up to 127 and then always hits. Run/tests (`T/map/unit_tests.move:203-251`): aim 65, R 4: d = 1..7 gives 80, 75, 70, 65, 55, 45, 35.

### 5.2 Random draws and damage (in order)

Each draw is `generate_u8_in_range(0, 99)` unless stated. On a miss the order ends after draw 1 (record `Miss`, return).

| Draw | Where | Decides |
| --- | --- | --- |
| 1 | `unit.move:157` | hit: `< hit_chance` |
| 2 | `:163` | crit: `< crit_chance` (drawn on every hit, even if `crit_chance` is 0) |
| 3 | `:164` `generate_bool` | damage sign |
| 4 | `:165` or `:166` `generate_u8_in_range(0, spread)` | damage deviation; in the downward case `(0, min(spread, damage))` |
| 5 | `:169` | plus one: `< plus_one` |
| 6 | `unit.move:191` (`apply_damage`) | dodge: drawn once per target; used only if `can_dodge` |

```
base   = damage + U{0..spread}            if coin = true
       = damage - U{0..min(spread,damage)} if coin = false      // u16, never below 0
d      = base + 1                         if plus_one
d      = d + floor(damage_stat / 2)       if crit               // half the weapon's damage STAT, not of the roll
d      = min(d, 255)                      // capped as u8
```

`damage_stat` is `stats.damage` (`:171`); the crit bonus is added after the plus-one. Then `apply_damage(target, d, can_dodge)` (`:180-198`):

```
dmg = 1 if armor >= d else d - armor                 // minimum 1 per hit
dodge draw is made (always); dodged = can_dodge && draw < dodge_stat      // dodged: no damage
hp  = max(hp - dmg, 0); kia = (hp == 0)
```

`armor` and `dodge_stat` are the target's effective stats (a dazed target's dodge is 0). Armor is applied before the dodge roll and does not interact with it. When `d == 0` (only with a damage stat of 0 and no bonuses), `apply_damage` is skipped in single-target mode (`map.move:258-260`): no dodge draw, record `Damage(0)`.

Single target, after a hit (`map.move:257-273`): the target unit is extracted from its tile; the record is `Dodged` if dodged, else `CriticalHit(dmg)` if the crit roll succeeded, else `Damage(dmg)` (`dmg` after armor); if killed, `UnitKIA(recruit, x1, y1)` follows and the unit goes to `map.fallen`, otherwise it is put back. A kill therefore empties the tile at once; the recruit dies at the next turn change (below).

Area weapon (`radius > 0`, `map.move:252-255`): the hit roll covers the whole blast; on a hit `explode(rng, x1, y1, radius, d, env_damage, can_dodge)` is called with the damage rolled above (crit and plus-one included, no per-target crit record). Misses record only `Miss` and have no effect. No catalogue weapon has `area_size > 0` (8.2), the code path exists and is tested (`T/map/map_tests.move:231-300`).

`explode` (`:413-455`): records `Explosion(x, y, radius)`. Cells: `Grid.von_neumann_neighbors(center, radius)` (clipped to the grid, center excluded), then the center is appended and visited last. Order for radius 1: `(x-1,y), (x,y-1), (x+1,y), (x,y+1)`; radius 2: `(x-2,y), (x,y-2), (x-1,y), (x,y-1), (x+1,y), (x,y+1), (x+2,y), (x,y+2)`, then the diagonals `(x-1,y-1), (x-1,y+1), (x+1,y-1), (x+1,y+1)`; radius 3 and more: row-major over the bounding square (`G/cell.move:135-176`). Per cell: if a unit stands there it takes `apply_damage` (one record: `Dodged` or `Damage(dmg)`, then `UnitKIA` if it fell), whoever it belongs to, the attacker included; if `env_damage`, a `Cover` or `Obstacle` tile becomes `Empty` (units or not). Walls and `Unwalkable` tiles are unchanged; an `Obstacle` becomes `Empty` like a `Cover`, after which it is ground: standable, no cover. Line of sight is not checked from the blast center to the cells.

AP and ammo: an attack sets AP to 0 and spends 1 ammo whether it hits or not (`unit.move:133-134`). There is no kill refund.

Records written (`Attack` is always first): miss `[Attack, Miss]`; dodge `[Attack, Dodged]`; hit `[Attack, Damage(n)]` or `[Attack, CriticalHit(n)]`; kill adds `UnitKIA(id, x, y)`; area `[Attack, Miss]` or `[Attack, Explosion, (Dodged | Damage, [UnitKIA])...]`. After an attack the game ends the match if the kills left a side with nobody on the map (section 9).

### 5.3 Worked outcome table

Attacker: recruit with `Standard Rifle` (aim 65, damage 4, spread 2, plus_one 10, crit 10, range 4, dodgeable); target at range 3 behind a low cover side facing the attacker (`cover_bonus` 25, run) wearing `Light Armor` (armor 1, dodge 10), natural defense 0. Hit chance = 65 + 5 x (4-3) - 25 = 45. Base damage before bonuses: 4 with prob 1/3 (either coin with deviation 0), 3, 5, 2, 6 with 1/6 each.

| Outcome | Probability |
| --- | --- |
| Miss | 55.00% |
| Hit, dodged (45% x 10%) | 4.50% |
| Hit, not crit, not dodged: damage 1 / 2 / 3 / 4 / 5 / 6 | 5.47% / 6.08% / 11.54% / 6.68% / 6.08% / 0.61% (total 36.45%) |
| Hit, crit, not dodged: damage 3 / 4 / 5 / 6 / 7 / 8 | 0.61% / 0.68% / 1.28% / 0.74% / 0.68% / 0.07% (total 4.05%) |

Expected damage per shot 1.34 HP of a 10 HP target. Derivation: hit 45%, crit 10% of hits (+2), plus-one 10% (+1), armor -1 with minimum 1, then dodge 10%. Check (run): 4800 shots through `Map.perform_attack` (seeds 0..4799) gave 54.9% miss, 4.9% dodged, 36.2% plain damage and 4.0% crit, within sampling error of the table (for example crit damage 5: 1.29% observed vs 1.28%).

## 6. Grenade resolution (`Map.perform_grenade`)

Constants (`S/map/map.move:47-51`): `GRENADE_RANGE` = 5, `GRENADE_RADIUS` = 2, `GRENADE_DAMAGE` = 4. Entry `ghosts::perform_grenade` (`S/ghosts.move:403`) passes `begin_unit_action` for the thrower's tile, then (`map.move:382-403`), in order:

1. `manhattan_distance((x,y),(x1,y1)) <= 5`, else `EPathTooShort` (6; not `ERangeExceeded`).
2. Target tile is not a `Wall` (`ETileIsWall`, 8).
3. `line_of_throw` (only walls block, covers and units do not) else `ENoLineOfSight` (9).
4. The thrower's tile holds a unit (`ENoUnit`, 5).
5. `Unit.perform_grenade`: `has_action(Grenade)` else `EActionNotAllowed` (5); `ap > 0` else `ENoAP` (3); `spend_use(Grenade)`: the first `Grenade` action with a use left, else `ENoUsesLeft` (6); then `ap -= 1` (`unit.move:92-100`). No ammo is used; a grenade does not end the unit's activation (a unit with 2 AP may throw then move).
6. Records `Grenade{origin, target}`, then `explode(rng, x1, y1, 2, 4, env_damage = true, can_dodge = false)`.

There is no hit roll, scatter or miss: the grenade always explodes at the target tile. The area is the diamond of Manhattan radius 2 around the target (13 cells, fewer at the map edge): the target, the 4 cells at distance 1 and the 8 at distance 2; cells are visited in the order given in 5.2 with the target last. Every unit on those cells takes `GRENADE_DAMAGE` reduced by its armor (`4 - armor`, minimum 1), cannot dodge (but `apply_damage` still draws one number per unit), and records `Damage(n)` and, if it falls, `UnitKIA`. Allies, enemies and the thrower are treated the same; the thrower may throw at its own tile or within 2 tiles of itself (run by the existing test: thrower at `(0,0)` throwing at `(0,2)` gives `[Grenade([0,0],[0,2]), Explosion(0,2,2), Damage(4)]`, HP 10 to 6, `T/map/map_tests.move:312-333`). Every `Cover` tile (occupied or not) and every `Obstacle` in the area becomes `Empty`; a grenade may be thrown onto an obstacle (only a `Wall` is refused); `Wall` and `Unwalkable` tiles are untouched; line of sight from the center to the cells in the area is not checked, so a grenade also damages units behind a wall within 2 tiles of the target.

Steps 1-4 are `Map.thrower`, shared by all three grenades (6.1).

Uses: the frag grenade is one `Utility` carrying `Action { uses: some(1), kind: Grenade }` (`S/recruit/items.move:66-69`), so one throw per unit per match; `uses` is copied into the unit at deployment and never refilled during the match (`unit.move:222-227`). A recruit has `MAX_UTILITIES` = 1 slot (`S/recruit/recruit.move:39`).

### 6.1 Flashbang, smoke grenade and status effects

`Map.perform_flashbang` and `Map.perform_smoke_grenade`, entries `ghosts::perform_flashbang` and `ghosts::perform_smoke_grenade` (no `Random`), each after `begin_unit_action`: the throw checks 1-4 of section 6 (same `GRENADE_RANGE` 5, wall and line-of-throw rules, same error codes), then `Unit.perform_flashbang` / `perform_smoke_grenade`: `has_action(Flashbang | SmokeGrenade)` else `EActionNotAllowed`, `ap > 0` else `ENoAP`, a use else `ENoUsesLeft`, `ap -= 1`. Then every unit within Manhattan `GRENADE_RADIUS` 2 of the target, either side, the thrower included, gets the effect: a flashbang dazes, a smoke grenade smokes. No roll, no damage, no cover destroyed. Units are found through `Map.units` (row-major order), not by walking the area.

Effects (`S/map/effect.move`): an `Effect` is one byte, `kind << 4 | turns`. `Unit.effects: vector<Effect>` (the last field of `Unit`) holds at most one per kind, in the order they first landed; base `stats` are never changed.

| Kind | Tag | Turns | Modifier (added with `stats::add`, floored at 0, capped at 127) |
| --- | --- | --- | --- |
| Daze | 0 | 2 | aim -127, dodge -127: effective aim 0, dodge 0 |
| Smoke | 1 | 2 | aim -30, defense +30 |

- Effective stats: base, then each effect's modifier in list order. Daze takes all aim and all dodge, so a unit with both has aim 0, dodge 0 and defense +30 either way. A dazed target never dodges: its dodge draw is still made, against 0.
- Refresh: an effect of a kind the unit has sets its turns to the larger of the two; no stacking.
- `turns` counts `next_turn` calls. In `next_turn`, after `NextTurn`, `Map.next_turn` walks `Map.units` once: each unit (either side) loses one turn on every effect and those at 0 are removed (`EffectEnd` each), and the units of the side starting its turn get AP back. Thrown on A's turn with 2 turns, an effect lasts the rest of A's turn and B's turn, and ends when B ends his.
- A unit that falls takes its effects into `fallen`; nothing ticks them and no `EffectEnd` is written: its `UnitKIA` ends them.
- Area effects stay with the units hit at throw time, not the tiles.

## 7. Reload

`Map.perform_reload(x, y)` (`S/map/map.move:163-169`), entry `ghosts::perform_reload` (`S/ghosts.move:390`) after `begin_unit_action`. `Unit.perform_reload` (`S/map/unit.move:81-88`): `has_action(Reload)` else `EActionNotAllowed`; `ap > 0` else `ENoAP`; ammo not full else `EFullAmmo` (4); `spend_use(Reload)`; `ap -= 1`; `ammo = max` (full refill to `stats.ammo`, not by a fixed amount). Record `Reload([x, y])`. No random draw. Reload does not end the activation. A unit has 3 ammo with every catalogue rifle before clip upgrades (8.2); ammo is not refilled between turns, only by reload.

## 8. Stats

### 8.1 Layout

`Stats` is a `u128` of 16 bytes, byte `i` counted from the least significant byte, read by `read_u8_at_offset!(v, i)` = `(v >> 8*i) & 0xFF` (`S/recruit/stats.move:43`, `:79-124`; pack in `bit_field::pack_u8!`, first element at byte 0). There are 15 fields (`NUM_PARAMS` 15, `:20`); byte 15 is unused.

| Byte | Field | Meaning | Supplied by |
| --- | --- | --- | --- |
| 0 | `mobility` | maximum direction bytes in one move (section 2) | recruit base 7; heavy armor -1 |
| 1 | `aim` | base hit chance (percent) | recruit base 65; promotions +2 each; scope +5/+10/+15 |
| 2 | `health` | unit max HP | recruit base 10; every second promotion +1; heavy armor +1 |
| 3 | `armor` | flat damage reduction, minimum damage 1 | armor 1/2/3 |
| 4 | `dodge` | percent to dodge a dodgeable hit | light armor +10, heavy armor -10 |
| 5 | `defense` | natural defense, added to cover (section 4) | recruit base 0; no item sets it |
| 6 | `damage` | base damage | weapon |
| 7 | `spread` | max deviation of the damage roll | weapon |
| 8 | `plus_one` | percent chance of +1 damage | weapon |
| 9 | `crit_chance` | percent chance of a crit (+`damage / 2`) | weapon; laser sight +5/+10/+15 |
| 10 | `can_be_dodged` | nonzero: the weapon's damage can be dodged | weapon |
| 11 | `area_size` | blast radius, 0 = single target | weapon |
| 12 | `env_damage` | nonzero: destroys cover in the blast | weapon |
| 13 | `range` | ideal range | weapon; stock +1/+2/+3 |
| 14 | `ammo` | magazine | weapon; expanded clip +1/+2/+3 |

A stat is meaningful in 0..127; the top bit marks a negative modifier when a `Stats` is used as a modifier (`SIGN_VALUE` 0x80, `:18`). Display strings print a value with the sign bit as negative (`:172-185`).

### 8.2 Combination rules

`Stats.add(base, modifier)` (`:138-165`), per field: a modifier of 0 or 0x80 is skipped; a modifier above 0x80 subtracts `(m - 0x80)` from the base, floored at 0; a modifier below it adds; every changed field is then capped at 127. A field is only ever changed by a modifier that touches it, so values above 127 from a raw constructor survive until modified.

Order in `Unit.from_recruit` (`S/map/unit.move:211-218`), which the doc comment explains: `stats = recruit.stats.add(weapon).add(armor)`, then `.add(utility)` for each utility in slot order. The weapon and armor are not merged with each other first, because folding armor into the weapon would lose a negative armor modifier against the weapon's zero operative fields (floored at 0 before ever reaching the recruit's stats); each is applied against the recruit's own stats instead. Without a weapon, `default_weapon()` is added (damage 4, spread 2, dodgeable, range 4, ammo 3: `stats.move:69-73`) and no armor adds `default_armor()` (zeros). Therefore an unarmed unit has `ammo` 3 and `range` 4, but no `Attack` or `Reload` action (`unit.move:222-226`). A weapon's own stats include its fitted upgrades: `add_upgrade` adds the upgrade modifier to `weapon.stats` (at most 3, one of each kind, `S/recruit/weapon.move:74-79`); removal adds `negate(modifier)` (`:82-87`).

Promotion (`S/recruit/recruit.move:185-196`, `rank.move:59-70`): `xp` is a total. Thresholds to reach Squaddie, Corporal, Sergeant, Lieutenant, Captain, Major, Colonel: 3, 8, 15, 25, 40, 60, 90. Each promotion adds `PROMOTION_AIM` 2 to the recruit's `aim`; promotions to an even rank ordinal (Corporal, Lieutenant, Major) add `PROMOTION_HEALTH` 1 to `health` (`:41-44`, `:192`).

### 8.3 Catalogue (as of this commit)

Recruit base `Stats::default()` = mobility 7, aim 65, health 10, armor 0, dodge 0 (`stats.move:66`).

Weapons (`S/recruit/items.move:74-90`; all single-target, dodgeable, `area_size` 0, `env_damage` 0, ammo 3; byte constants decode to the values below, confirmed by `T/recruit/items_tests.move:18-47`):

| Tier | Name | damage | spread | plus_one | crit_chance | range | ammo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Standard Rifle | 4 | 2 | 10 | 10 | 4 | 3 |
| 2 | Sharpshooter Rifle | 5 | 1 | 20 | 20 | 5 | 3 |
| 3 | Plasma Rifle | 6 | 1 | 30 | 30 | 5 | 3 |

The code comments say "+10% CRIT" and so on and do not mention `plus_one`, which is set to the same number as `crit_chance` in each tier. `default_weapon` (`stats.move:69`) is damage 4, spread 2, plus_one 0, crit 0, range 4, ammo 3 (used only for unarmed units).

Armor (`items.move:28-45`; the modifier is added to the recruit):

| Tier | Name | mobility | health | armor | dodge | Unit with base recruit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Light Armor | 0 | 0 | +1 | +10 | mob 7, HP 10, armor 1, dodge 10 |
| 2 | Medium Armor | 0 | 0 | +2 | 0 | mob 7, HP 10, armor 2, dodge 0 |
| 3 | Heavy Armor | -1 | +1 | +3 | -10 | mob 6, HP 11, armor 3, dodge 0 (0 - 10 floors at 0) |

Weapon upgrades (`items.move:94-152`; one of each kind per weapon, three at most):

| Kind (id) | Tier 1 | Tier 2 | Tier 3 | Stat |
| --- | --- | --- | --- | --- |
| Scope (0): Basic / Advanced / Superior | +5 | +10 | +15 | `aim` |
| Laser Sight (1): Basic / Advanced / Sniper | +5 | +10 | +15 | `crit_chance` |
| Stock (2): Basic / Advanced / Sniper | +1 | +2 | +3 | `range` |
| Expanded Clip (3): Basic / Advanced / Superior | +1 | +2 | +3 | `ammo` |

Utilities (`items.move`), each with the zero stats modifier and one action with `uses: some(1)`: Frag Grenade (kind 0, `Grenade`), Flashbang (kind 1, `Flashbang`), Smoke Grenade (kind 2, `SmokeGrenade`). Their numbers are constants of the map functions and of `effect`, not stats (sections 6 and 6.1).

Hiring (`S/account.move:152-214`): recruits are made by `recruit::new` (`S/recruit/recruit.move:215-227`): Rookie, `xp` 0, default stats, no armor, no utility; `hire` equips each with a Standard Rifle (`items::rifle(1)`), a real `Weapon` like a requisitioned one. `FREE_RECRUITS` 4: `hire_recruits` tops the squad up to 4 for free, and 4 is the most an `Account` holds (`account.move:56`).

## 9. Turn structure and match flow

Constants (`S/ghosts.move:77-99`): `SEARCH_TIMEOUT_MS` 120_000; `DEPLOY_LIMIT_MS` 120_000; `TURN_LIMIT_MS` 90_000; `SUSPENSION_MS` 60_000; `MAX_MISSED_TURNS` 3; `MAX_TURNS` 60; `SURVIVAL_XP` 1; `WIN_XP` 1; `MIN_TURNS_TO_EARN` 2. Unit AP max: 2 (`unit.move:232`).

States (`:147-173`), forward only:

- `Deploying { until_ms }`: set to `now + DEPLOY_LIMIT_MS` when the game is created (`:274`). `deploy_squad` (`:346-375`): once per side, before or at `until_ms` (`now <= until_ms`, else `EDeploymentOver`), 1 to (positions per side) recruits (`ENoPositions`), placed as in 1.4 with a `RecruitPlaced(x, y)` record each. When both sides have a squad, `begin_match` starts play. After `until_ms`, anyone in the game can call `next_turn` (it requires `now > until_ms`): `begin_match` then sets `Over(NobodyShowed)` if neither side has units, `Over(NoShow(side))` if one has none, else `Playing`.
- `Playing { started_ms, missed: vector<u8> }`: `started_ms` is when the current turn began; `missed` is the count per side of turns let run out in a row. `turn` starts at 0; the active side is `turn % 2` (`:537`). Side 0 is `players[0]`, the player who was waiting in the queue, who goes first (`:217-218`); the finder is side 1. Both sides' units start with full AP (2) from creation.
- `Over(Ending)`: `Won(player)` (the other side has nobody on the map), `Draw` (both sides went down at once), `Stalemate` (`MAX_TURNS`), `Abandoned(player)`, `Forfeited(player)`, `NoShow(player)`, `NobodyShowed` (`:158-173`).

Orders during play: `begin_turn_action` (`:604-617`) requires `Playing`, `side == active` (`ENotYourTurn`, 11) and `now - started_ms <= TURN_LIMIT_MS` (`ETurnExpired`, 12), and resets that side's `missed` to 0. `begin_unit_action` (`:620-633`) then requires a unit on the tile owned by the `Account` (`ENotYourUnit`, 14). A unit may act in any order any number of times within its AP; there is no per-unit activation limit other than AP. A turn has no AP pool beyond the units' own.

`next_turn(game, acc, clock)` (`:449-487`):

1. `bury_fallen` runs first, in every state: each unit in `map.fallen` is destroyed and its recruit is killed (`Recruit.kill`: gear destroyed, `DogTag` sent to the leader, `S/recruit/recruit.move:243-251`; `:650-658`).
2. In `Deploying`, as above. In `Over`: `EGameOver`.
3. In `Playing`: if the caller is the active side, `missed[active] = 0`; otherwise it needs `now - started_ms > TURN_LIMIT_MS` (`ETurnNotExpired`, 13) and `missed[active] += 1`. If `missed[active] == MAX_MISSED_TURNS` the game ends as `Forfeited(active player)` and the turn number does not change.
4. `turn += 1`, record `NextTurn(turn)`; if `turn >= MAX_TURNS` the game ends as `Stalemate` (30 turns per side).
5. `state = Playing { started_ms: now, missed }` and `Map.next_turn(next player)`: every unit's effects lose one turn, those at 0 end with an `EffectEnd` record each (6.1), and only the units of the side whose turn begins get AP back to 2.

Leaving: `abandon_game` (`:287-292`), any non-`Over` state, ends as `Abandoned(caller)`. Kills: after `perform_attack` or `perform_grenade` with a `UnitKIA` in the records, `count_losses` (`:638-645`) counts the units each side still has on the map: neither -> `Draw`, one -> `Won(other)`. The fallen of an ended game are buried by `complete_game`.

`complete_game` (`:300-338`, anyone may call): result onto both scores (not for `NobodyShowed`), `rate_game` (Glicko, same exception), bury the fallen, `send_home` the survivors with their XP, release both accounts, suspend by `SUSPENSION_MS` a side that `misbehaved` (`Abandoned`, `Forfeited` or `NoShow` by it; both for `NobodyShowed`, `:551-560`), delete the game.

| Ending | Score | Rating | XP per surviving recruit | Suspension |
| --- | --- | --- | --- | --- |
| `Won` by elimination | win / loss | win / loss | winner 2 (`SURVIVAL_XP + WIN_XP`); loser has none left | none |
| `Draw` (both eliminated) | draw / draw | draw | none left | none |
| `Stalemate` | draw / draw | draw | 1 each | none |
| `Abandoned` / `Forfeited` by P | P loses, other wins | win / loss | P 0; other 1 if `turn >= 2`, else 0 (no win bonus) | P |
| `NoShow(P)` | P loses, other wins | win / loss | 0 for both | P |
| `NobodyShowed` | none | none | 0 | both |

(`experience`, `:584-594`; `add_result`/`rate_game` at `S/account.move:425-455`; XP applies through `add_xp`, section 8.2.)

## 10. Randomness

All randomness is a `RandomGenerator` made from `Random` per transaction (`rng.new_generator(ctx)`, `S/ghosts.move:416`, `:437`). Draws exist only in `perform_attack` and `perform_grenade` (the match has no other roll; `hire` also rolls, outside the match). Order for a single-target attack: hit, then (on a hit) crit, coin, deviation, plus-one, then one dodge draw; area weapon: those five, then one dodge draw per unit in the blast in the `explode` order; grenade: one draw per unit in the area, in `explode` order (all drawn even though a grenade cannot be dodged: `unit.move:191` is unconditional).

The rule the code follows (doc comment on `Map.perform_attack`, `S/map/map.move:207-210`, and `T/map/map_tests.move:181-204`, `attack_outcomes_cost_in_order`): an outcome that is worse for the attacker must never take more storage than one that is better, so a sender cannot set a gas budget that lets only the good outcomes through. Consequently:

- A miss and a dodge are one record of the same size (`Miss` is `[6]`, `Dodged` is `[11]`: no payload), and neither changes HP; `Damage(u8)` and `CriticalHit(u8)` are the same size (`:264` "same cost"), larger than those; a kill adds `UnitKIA` and leaves the unit in `fallen` (a vector push, no storage freed).
- The killed unit stays in `Map.fallen` and its recruit in `Game.recruits` until `next_turn` or `complete_game` (neither rolls), so that freeing the recruit's storage (a deletion, which refunds gas) does not happen in the transaction that rolled the kill (`S/map/map.move:92-94`, `S/ghosts.move:647-649`).
- The dodge draw is taken even when the weapon cannot be dodged, and the crit draw even at 0% crit, so the number of draws does not reveal the outcome.

The test asserts `miss == dodge <= hit < kill` in BCS bytes (map plus history).

## 11. History records

`Record` (`S/map/history.move:13-38`), BCS enum tag = declaration order (`from_bcs`, `:127-153`):

| Tag | Variant | Payload | Written when |
| --- | --- | --- | --- |
| 0 | `Reload` | `vector<u16>` `[x, y]` | `perform_reload` (`map.move:168`) |
| 1 | `NextTurn` | `u16` the new turn number | `next_turn`, after `turn += 1` (`ghosts.move:478`), also on the turn that ends as `Stalemate` |
| 2 | `Move` | `vector<u8>` the whole path as sent | `move_unit` (`map.move:188`) |
| 3 | `Attack` | `origin: vector<u16>`, `target: vector<u16>` | first record of every attack (`map.move:219`) |
| 4 | `RecruitPlaced` | `u16 x`, `u16 y` | `deploy_squad`, per recruit (`ghosts.move:368-371`) |
| 5 | `Damage` | `u8` damage applied after armor | hit, not crit, not dodged; per unit in a blast |
| 6 | `Miss` | none | the hit roll failed (attack or area attack) |
| 7 | `Explosion` | `u16 x`, `u16 y`, `u16 radius` | an area hit or a grenade, before the per-unit records |
| 8 | `CriticalHit` | `u8` damage applied after armor | single-target hit with a crit roll, not dodged; area weapons never write it |
| 9 | `Grenade` | `origin`, `target`: `vector<u16>` | first record of a grenade (`map.move:400`) |
| 10 | `UnitKIA` | `ID` of the recruit, `u16 x`, `u16 y` | a unit fell, after its `Damage` / `CriticalHit` record |
| 11 | `Dodged` | none | the target dodged (attack) or a unit dodged (area weapon) |
| 12 | `Flashbang` | `origin`, `target`: `vector<u16>` | first record of a flashbang, then `EffectStart` per unit |
| 13 | `SmokeGrenade` | `origin`, `target`: `vector<u16>` | first record of a smoke grenade, then `EffectStart` per unit |
| 14 | `EffectStart` | `u16 x`, `u16 y`, `Effect` (`u8`: `kind << 4 \| turns`) | an effect landed on the unit at `(x, y)`, or refreshed its kind; turns as the unit now has them |
| 15 | `EffectEnd` | `u16 x`, `u16 y`, `u8 kind` | an effect ran out in `next_turn`, after `NextTurn`; a fall (`UnitKIA`) ends a unit's effects without one |

Replaying `EffectStart` (set the kind), `NextTurn` (every effect -1), `EffectEnd` (remove), `Move` (carry along) and `UnitKIA` (drop all) gives every unit's effects at any point (test `test_effects_replay_through_a_match`).

Not recorded: the end of deployment, the end of the game and its reason (state only), a forfeit, an abandon. `History` is a vector appended in call order (`S/map/history.move:43-55`).

## 12. Differences in the demo engine (`packages/engine/src`)

Out of scope otherwise; the engine is a separate simulation with its own numbers.

| Topic | Chain | Engine | Ref |
| --- | --- | --- | --- |
| Crit | `crit_chance` stat (10/20/30 on rifles), bonus `damage / 2` after plus-one | flat 10%, bonus `floor(damage / 2)`, no plus-one | `game.ts:456`, `:59-61` |
| Dodge, spread, plus-one | all three exist | none | `game.ts:455-458` |
| Weapons | rifle 4-6 damage, range 4-5, aim 65 | rifle damage 6 range 8 aim 78; sniper 9 / 12 / 88; pistol 4 / 5 / 82 | `game.ts:10-21` |
| Damage vs armor | `d - armor`, minimum 1 | `max(1, damage + crit - armor)` | `game.ts:59-61` |
| Range bonus and limit | +5 per tile under, -10 per tile over, max `range + 3` | same numbers | `game.ts:416-427` |
| Cover | 0 / 25 / 50 from tile sides, plus `defense`; no hunker | 0 / 25 barrier (50 hunkered), 40 / 60 behind a high wall, by building geometry | `game.ts:399-414` |
| Grenade | 4 damage - armor (min 1), cannot be dodged, destroys covers, `uses` on the utility's `Action` | 6 - armor (min 1), once per unit via a `grenade` flag, props damaged by `blastProps` | `game.ts:473-483` |
| HP, armor, mobility | recruit 10 HP, armor by gear, mobility 7 | 12 HP (9 for enemies), armor 1 (heavy 2), mobility 7 (heavy 5) | `game.ts:70-77` |
| Extra actions | `Move`, `Attack`, `Reload`, `Grenade` | plus `Overwatch`, `Hunker`, `Secure`, `SwitchWeapon` | `game.ts:23`, `:496-503` |
| Attack AP | sets AP to 0 | sets AP to 0 except the pistol (1) | `game.ts:200` |
| Friendly target | not checked | `canShoot` requires `a.enemy !== b.enemy` | `game.ts:427-433` |
| RNG | `sui::random` | seeded LCG | `game.ts:147-149` |

## 13. Open edges

Facts about the code at this commit; nothing here is a recommendation.

- An attack can target the attacker's own units and its own tile; no owner or distinctness check in `perform_attack` (`S/map/map.move:232-241`). Run: self-shot yields `Damage(4)`.
- Hired recruits come with a Standard Rifle, unarmored and without a utility (`S/account.move`, `hire`); a recruit whose rifle was taken off has `Move` only (`S/map/unit.move:222-227`); it still carries `default_weapon` stats (`range` 4, `ammo` 3).
- A grenade hits every unit in the diamond, the thrower's side and the thrower included, and may be thrown at the thrower's own tile (`S/map/map.move:401`; test `T/map/map_tests.move:312-333`). An area weapon behaves the same (`:252-255`); no catalogue weapon is one.
- The grenade's area is not filtered by line of sight from the blast center, and `GRENADE_RANGE` is a Manhattan distance while the line is traced as a straight segment (`:390-392`).
- `defense` has no source in the catalogue (`S/recruit/armor.move:11` says armor normally adds to it; no tier does), so cover is the only defense term in practice.
- `plus_one` equals `crit_chance` on every rifle tier (10/20/30), which the item comments do not state (`S/recruit/items.move:76-81`; `T/recruit/items_tests.move:18-47`).
- A path cannot cross or end on the moving unit's own start tile, as the unit is still on it during `check_path` (`:180-186`).
- Cover side values other than 0, 1, 2 are accepted by `from_bcs`, with `cover_bonus` multiplying by 25 in `u8` (a value of 11 or more would overflow and abort) (`:724-729`, `:362`).
- The cover bonus uses only the dominant axis of the shot (a diagonal only at `|dx| == |dy|`), and the line of sight uses the exact segment; the two can disagree about which side the shot arrives from.
- In the preset `black_rain`, every cover prop is an `Obstacle` and there are no `Cover` tiles, so high cover (and the sight-blocking cover rule) is never used by the shipped map; there are no `Unwalkable` tiles (1.4).
- A kill frees the tile at once but the recruit dies only at the next turn change or `complete_game` (`S/ghosts.move:650-658`); a unit that fell can no longer be targeted.
- The chain's win by abandonment or forfeit gives the winner's survivors 1 XP, and none if fewer than 2 turns were played (`S/ghosts.move:584-594`).
- `MAX_TURNS` 60 counts both sides' turns, so a game is at most 30 turns per side (`S/ghosts.move:90`, `:479`).
- The `missed` counter only grows when the other side calls `next_turn` after `TURN_LIMIT_MS`; an active player who never calls it and never acts is moved on only by the opponent (`:455-467`).
- References in `docs/design/actions.md` to `unit.move:NN` use older line numbers (for example AP 2 is now at `unit.move:232`, `perform_attack` at `:122`); its rules agree with the code. `packages/catalog/actions.json` agrees with the code on AP, uses and records.
