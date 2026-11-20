// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// A status effect on a `Unit`: what it does and for how many more turns.
///
/// An `Effect` is a single byte: the kind in the high four bits, the turns left
/// in the low four, `kind << 4 | turns`. A unit carries them in a list, one per
/// kind at most, so the list of a unit without effects is a single zero byte.
///
/// `turns` counts `next_turn` calls: every one, whoever ends the turn, takes one
/// off every effect on every unit on the map, and an effect at zero is gone. An
/// effect never changes a unit's `Stats`: it contributes a `modifier`, added to
/// them where they are read (see `Unit.effective_stats`).
///
/// Kind numbers are the wire format: new kinds are only appended. A new kind is
/// a constant here, its turns, and an arm of `modifier` (the zero modifier for
/// a kind that changes no stat). A kind that acts on its own, as damage over
/// time would, adds its rule where the turn changes, `Map.next_turn`, which
/// already visits every unit with effects; nothing else has to change.
///
/// Traits:
/// - from_bcs
module ghosts::effect;

use ghosts::stats::{Self, Stats};
use sui::bcs::BCS;

/// An unknown kind, or turns out of `1..=MAX_TURNS`.
const EInvalidEffect: u64 = 0;

/// Dazed: the unit's aim is 0. From the flashbang.
const DAZE: u8 = 0;
/// In smoke: the unit's defense is up by `SMOKE_DEFENSE`, its aim down by
/// `SMOKE_AIM_PENALTY`. From the smoke grenade.
const SMOKE: u8 = 1;
/// The last kind there is. Kinds are `0..=LAST_KIND`.
const LAST_KIND: u8 = 1;

/// How long a daze lasts: the rest of the turn it lands in, and the next one.
const DAZE_TURNS: u8 = 2;
/// How long smoke lasts: the rest of the turn it lands in, and the next one.
const SMOKE_TURNS: u8 = 2;
/// What smoke adds to the defense of the unit in it.
const SMOKE_DEFENSE: u8 = 30;
/// What smoke takes from the aim of the unit in it, down to 0.
const SMOKE_AIM_PENALTY: u8 = 30;

/// The most turns an effect can have: what the low four bits hold.
const MAX_TURNS: u8 = 15;
/// The bits of the turns in an `Effect`.
const TURNS_MASK: u8 = 0x0F;
/// The sign bit of a `Stats` modifier value: `SIGN + n` is `-n`.
const SIGN: u8 = 0x80;
/// The largest modifier value, as `-AIM_ALL` takes any aim to 0.
const AIM_ALL: u8 = 0x7F;
/// The `Stats` modifier of a daze: `-AIM_ALL` aim (offset 1).
const DAZE_MODIFIER: u128 = ((SIGN + AIM_ALL) as u128) << (1 * 8);
/// The `Stats` modifier of smoke: `-SMOKE_AIM_PENALTY` aim (offset 1),
/// `+SMOKE_DEFENSE` defense (offset 5).
const SMOKE_MODIFIER: u128 =
    ((SIGN + SMOKE_AIM_PENALTY) as u128) << (1 * 8) | (SMOKE_DEFENSE as u128) << (5 * 8);

/// A status effect: `kind << 4 | turns`.
public struct Effect(u8) has copy, drop, store;

// === Constructors ===

/// A daze, for `DAZE_TURNS`.
public fun daze(): Effect { Effect(DAZE << 4 | DAZE_TURNS) }

/// Smoke, for `SMOKE_TURNS`.
public fun smoke(): Effect { Effect(SMOKE << 4 | SMOKE_TURNS) }

/// An effect of the `kind`, for `turns`. Aborts on an unknown kind, or turns
/// outside `1..=MAX_TURNS`.
public fun new(kind: u8, turns: u8): Effect {
    assert!(kind <= LAST_KIND && turns > 0 && turns <= MAX_TURNS, EInvalidEffect);
    Effect(kind << 4 | turns)
}

// === Reads ===

/// The kind of the effect: `DAZE` (0), `SMOKE` (1).
public fun kind(e: &Effect): u8 { e.0 >> 4 }

/// How many more `next_turn` calls the effect lasts.
public fun turns(e: &Effect): u8 { e.0 & TURNS_MASK }

/// Whether the effect is a daze.
public fun is_daze(e: &Effect): bool { e.kind() == DAZE }

/// Whether the effect is smoke.
public fun is_smoke(e: &Effect): bool { e.kind() == SMOKE }

/// The `Stats` modifier the effect adds to the unit it is on, see `stats::add`.
/// A daze takes all the aim, which no smoke can give back: the aim of a unit
/// that has both is 0.
public fun modifier(e: &Effect): Stats {
    stats::new_unchecked(match (e.0 >> 4) {
        DAZE => DAZE_MODIFIER,
        SMOKE => SMOKE_MODIFIER,
        _ => abort,
    })
}

// === Changes ===

/// Take one turn off the effect. Returns whether it has any left: if not, it
/// has expired and goes.
public(package) fun tick(e: &mut Effect): bool {
    e.0 = e.0 - 1;
    e.0 & TURNS_MASK != 0
}

/// Reapply the effect: `other` of the same kind refreshes the timer to the
/// larger of the two, it does not stack.
public(package) fun refresh(e: &mut Effect, other: Effect) {
    e.0 = e.0.max(other.0)
}

// === Compatibility / Conversion ===

/// Deserialize an `Effect` from the BCS reader.
public(package) fun from_bcs(bcs: &mut BCS): Effect {
    let byte = bcs.peel_u8();
    new(byte >> 4, byte & TURNS_MASK)
}
