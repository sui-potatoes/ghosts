// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the Utility - an equipment that Recruits carry into battle for the
/// actions it grants: a grenade, and whatever follows it.
module ghosts::utility;

use ghosts::{action::Action, stats::Stats};
use std::string::String;

/// Utility is a piece of equipment that gives a Recruit its own actions: a
/// grenade, and whatever follows it. The `stats` of an item are modifiers added to
/// the unit that carries it, like those of an `Armor` (a grenade adds nothing:
/// zero), and its `actions` are added to the unit's actions with their `uses`.
/// What an action does is in its own function, not on the item.
public struct Utility has key, store {
    id: UID,
    /// The name of the utility. "Frag Grenade", etc.
    name: String,
    /// The `Stats` modifier the utility adds to its carrier.
    stats: Stats,
    /// The actions the utility adds to its carrier.
    actions: vector<Action>,
}

/// Create a new `Utility` with the provided parameters.
public(package) fun new(
    name: String,
    stats: Stats,
    actions: vector<Action>,
    ctx: &mut TxContext,
): Utility {
    Utility { id: object::new(ctx), name, stats, actions }
}

/// Destroy the `Utility`.
public fun destroy(utility: Utility) {
    let Utility { id, .. } = utility;
    id.delete();
}

/// Issue a `Permit` for the `Utility` type. Package-only: used to create
/// `Display<Utility>` in the `display` module.
public(package) fun permit(): internal::Permit<Utility> { internal::permit() }

// === Reads ===

/// Get the name of the `Utility`.
public fun name(u: &Utility): String { u.name }

/// Get the stats of the `Utility`.
public fun stats(u: &Utility): &Stats { &u.stats }

/// Get the actions the `Utility` adds to its carrier.
public fun actions(u: &Utility): &vector<Action> { &u.actions }
