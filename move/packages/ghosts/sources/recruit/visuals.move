// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Visual properties ("looks") of a `Recruit`: everything clients need to
/// render the character, nothing the game rules read. Values are packed with
/// `bit_field`: each area is a `u256` holding up to 32 `u8` slots, and the
/// slot layout is defined and interpreted by the client (the appearance codec
/// in `@ghosts/squad`, versioned by the first slot of `head`).
module ghosts::visuals;

use bit_field::bit_field as bf;

/// Attempt to pack more than `MAX_SLOTS` values into a single area.
const ETooManyValues: u64 = 0;

/// Each area is a `u256`: 32 slots of `u8` values.
const MAX_SLOTS: u64 = 32;

/// Packed visual properties of a `Recruit`, grouped by area.
public struct Visuals has copy, drop, store {
    /// Head: codec version, skull outline, skin, blush, hair, scars, tattoos.
    head: u256,
    /// Face: contour, jaw and neck, nose, mouth and ears morphs.
    face: u256,
    /// Eyes: iris, eye morphs, brows and forehead.
    eyes: u256,
    /// Body: base anatomy and proportions.
    body: u256,
    /// Outfit: armor colors and eyewear.
    outfit: u256,
}

/// Pack per-area values (up to `MAX_SLOTS` each) into `Visuals`.
public fun new(
    head: vector<u8>,
    face: vector<u8>,
    eyes: vector<u8>,
    body: vector<u8>,
    outfit: vector<u8>,
): Visuals {
    Visuals {
        head: pack(head),
        face: pack(face),
        eyes: pack(eyes),
        body: pack(body),
        outfit: pack(outfit),
    }
}

/// Create `Visuals` from already packed area values.
public fun new_unchecked(head: u256, face: u256, eyes: u256, body: u256, outfit: u256): Visuals {
    Visuals { head, face, eyes, body, outfit }
}

/// Default `Visuals`: every slot zeroed - codec version `0`, "unset".
public fun default(): Visuals {
    Visuals { head: 0, face: 0, eyes: 0, body: 0, outfit: 0 }
}

/// Pack up to `MAX_SLOTS` values into a single area.
fun pack(values: vector<u8>): u256 {
    assert!(values.length() <= MAX_SLOTS, ETooManyValues);
    bf::pack_u8!(values)
}
