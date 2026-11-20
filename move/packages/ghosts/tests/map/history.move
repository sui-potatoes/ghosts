// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::history;

/// The key of the tile `(x, y)` in `replay_effects`.
fun tile_key(x: u16, y: u16): u32 { (x as u32) << 16 | (y as u32) }

/// Replay the `records` of a game from its start, the way a client without the
/// objects would, and return the effects each unit carries after the last one:
/// the tiles of the units that have any, as `x << 16 | y`, and their effects, in
/// the order the unit has them.
///
/// `EffectStart` puts its effect on the unit at its tile, in place of one of its
/// kind; `NextTurn` takes a turn off every effect; `EffectEnd` removes the one
/// of its kind, which must have run out; `Move` takes the effects along the
/// path; `UnitKIA` ends them all. Aborts if an effect ran out without its
/// `EffectEnd`, or one ended that was not there or had turns left.
public fun replay_effects(records: &vector<Record>): (vector<u32>, vector<vector<Effect>>) {
    let mut tiles = vector<u32>[];
    let mut effects = vector<vector<Effect>>[];

    records.do_ref!(
        |record| match (record) {
            Record::Move(path) => {
                let (found, i) = tiles.index_of(&tile_key(path[0] as u16, path[1] as u16));
                if (found) {
                    let mut cursor = grid::cursor::new(path[0] as u16, path[1] as u16);
                    (path.length() - 2).do!(|j| cursor.move_to(path[j + 2]));
                    let (x, y) = cursor.to_values();
                    *&mut tiles[i] = tile_key(x, y);
                }
            },
            Record::UnitKIA(_, x, y) => {
                let (found, i) = tiles.index_of(&tile_key(*x, *y));
                if (found) {
                    tiles.remove(i);
                    effects.remove(i);
                }
            },
            Record::NextTurn(_) => effects.do_mut!(|list| list.do_mut!(|e| { e.tick(); })),
            Record::EffectStart(x, y, effect) => {
                let key = tile_key(*x, *y);
                let (found, i) = tiles.index_of(&key);
                let i = if (found) i
                else {
                    tiles.push_back(key);
                    effects.push_back(vector[]);
                    tiles.length() - 1
                };
                let list = &mut effects[i];
                let at = list.find_index!(|e| e.kind() == effect.kind());
                if (at.is_some()) *&mut list[at.destroy_some()] = *effect
                else list.push_back(*effect);
            },
            Record::EffectEnd(x, y, kind) => {
                let (found, i) = tiles.index_of(&tile_key(*x, *y));
                assert!(found);
                let list = &mut effects[i];
                let at = list.find_index!(|e| e.kind() == *kind).destroy_some();
                assert!(list[at].turns() == 0);
                list.remove(at);
                if (list.is_empty()) {
                    tiles.remove(i);
                    effects.remove(i);
                }
            },
            _ => (),
        },
    );

    // every effect that ran out was ended
    effects.do_ref!(|list| assert!(list.all!(|e| e.turns() > 0)));
    (tiles, effects)
}
