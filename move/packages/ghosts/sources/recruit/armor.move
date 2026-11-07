// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the Armor - an equipment that Recruits can wear in battle.
module ghosts::armor;

use ghosts::{rank::{Self, Rank}, stats::{Self, Stats}};
use std::string::String;

/// Armor is a piece of equipment that Recruits can use in battle. Each armor has
/// its own stats, normally adding to the `defense` and `health` of the Recruit.
///
/// However, given reusability of `Stats`, it can augment other stats as well.
public struct Armor has key, store {
    id: UID,
    /// The name of the armor. "Standard Armor", "Titanium Armor", etc.
    name: String,
    /// The `Stats` of the armor.
    stats: Stats,
    /// The rank a recruit needs to be issued this armor at headquarters.
    required_rank: Rank,
}

/// Create a new `Armor` with the provided parameters.
public(package) fun new(name: String, stats: Stats, ctx: &mut TxContext): Armor {
    Armor { id: object::new(ctx), name, stats, required_rank: rank::default() }
}

/// The same armor, for recruits of at least this rank.
public(package) fun for_rank(mut a: Armor, rank: Rank): Armor {
    a.required_rank = rank;
    a
}

/// The rank a recruit needs to be issued this armor.
public fun required_rank(a: &Armor): &Rank { &a.required_rank }

/// Create a new default `Armor`.
public(package) fun default(ctx: &mut TxContext): Armor {
    new("Standard Armor", stats::default_armor(), ctx)
}

/// Destroy the `Armor`.
public fun destroy(armor: Armor) {
    let Armor { id, .. } = armor;
    id.delete();
}

/// Issue a `Permit` for the `Armor` type. Package-only: used to create
/// `Display<Armor>` in the `display` module.
public(package) fun permit(): internal::Permit<Armor> { internal::permit() }

// === Reads ===

/// Get the name of the `Armor`.
public fun name(a: &Armor): String { a.name }

/// Get the stats of the `Armor`.
public fun stats(a: &Armor): &Stats { &a.stats }

// === Convenience and compatibility ===

/// Add an upgrade to the `Armor`.
public fun to_string(a: &Armor): String { a.name }
