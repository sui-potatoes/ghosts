// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Something a `Unit` can be ordered to do. A unit carries the set of actions
/// it is allowed to perform; each unit-level action checks it first.
///
/// Variant order is the BCS tag: new variants are only appended.
///
/// Traits:
/// - from_bcs
module ghosts::action;

use sui::bcs::BCS;

/// An action a `Unit` can perform.
public enum Action has copy, drop, store {
    /// Walk along a path, see `Map.move_unit`.
    Move,
    /// Fire the weapon, see `Map.perform_attack`.
    Attack,
    /// Refill the weapon's magazine, see `Map.perform_reload`.
    Reload,
    /// Throw a grenade, see `Map.perform_grenade`.
    Grenade,
}

// === Constructors ===

/// Create `Action::Move`.
public fun new_move(): Action { Action::Move }

/// Create `Action::Attack`.
public fun new_attack(): Action { Action::Attack }

/// Create `Action::Reload`.
public fun new_reload(): Action { Action::Reload }

/// Create `Action::Grenade`.
public fun new_grenade(): Action { Action::Grenade }

// === Compatibility / Conversion ===

/// Deserialize `Action` from the BCS reader.
public(package) fun from_bcs(bcs: &mut BCS): Action {
    match (bcs.peel_enum_tag()) {
        0 => Action::Move,
        1 => Action::Attack,
        2 => Action::Reload,
        3 => Action::Grenade,
        _ => abort,
    }
}
