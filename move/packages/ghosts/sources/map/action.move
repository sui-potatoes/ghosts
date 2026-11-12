// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Something a `Unit` can be ordered to do. A unit carries the set of actions
/// it is allowed to perform; each unit-level action checks it first.
///
/// An `Action` is a kind and a budget: `uses` is how many times it may still be
/// performed in a match, `none` for as many as there are turns. So an action
/// that can be done once a match (a grenade, a quick shot) is an `Action` with
/// `uses: some(1)`, not a kind of its own.
///
/// Variant order of `ActionKind` is the BCS tag: new variants are only appended.
///
/// Traits:
/// - from_bcs
module ghosts::action;

use sui::bcs::BCS;

/// Spending a use of an `Action` that has none left.
const ENoUsesLeft: u64 = 0;

/// What an `Action` does.
public enum ActionKind has copy, drop, store {
    /// Walk along a path, see `Map.move_unit`.
    Move,
    /// Fire the weapon, see `Map.perform_attack`.
    Attack,
    /// Refill the weapon's magazine, see `Map.perform_reload`.
    Reload,
    /// Throw a grenade, see `Map.perform_grenade`.
    Grenade,
}

/// An `ActionKind` a `Unit` can perform, and how many more times.
public struct Action has copy, drop, store {
    /// How many times the action may still be performed in a match: `none` is
    /// unlimited, `some(n)` is `n` left.
    uses: Option<u8>,
    kind: ActionKind,
}

// === Constructors ===

/// Create an `Action` of the `kind` with the given `uses`.
public fun new(kind: ActionKind, uses: Option<u8>): Action { Action { uses, kind } }

/// Create an `Action` with no limit on its uses.
public fun unlimited(kind: ActionKind): Action { new(kind, option::none()) }

/// Create an `Action` that can be performed `uses` times.
public fun limited(kind: ActionKind, uses: u8): Action { new(kind, option::some(uses)) }

/// Create `ActionKind::Move`.
public fun new_move(): ActionKind { ActionKind::Move }

/// Create `ActionKind::Attack`.
public fun new_attack(): ActionKind { ActionKind::Attack }

/// Create `ActionKind::Reload`.
public fun new_reload(): ActionKind { ActionKind::Reload }

/// Create `ActionKind::Grenade`.
public fun new_grenade(): ActionKind { ActionKind::Grenade }

// === Reads ===

/// What the `Action` does.
public fun kind(a: &Action): ActionKind { a.kind }

/// How many uses the `Action` has left: `none` for unlimited.
public fun uses(a: &Action): Option<u8> { a.uses }

/// Whether the `Action` can still be performed: unlimited, or with a use left.
public fun has_uses(a: &Action): bool { a.uses.is_none() || *a.uses.borrow() > 0 }

/// Spend one use of the `Action`, if it is limited. Aborts with `ENoUsesLeft` at
/// zero; an unlimited action is left alone.
public(package) fun spend(a: &mut Action) {
    if (a.uses.is_some()) {
        let left = a.uses.extract();
        assert!(left > 0, ENoUsesLeft);
        a.uses.fill(left - 1);
    }
}

// === Compatibility / Conversion ===

/// Deserialize `ActionKind` from the BCS reader.
public(package) fun kind_from_bcs(bcs: &mut BCS): ActionKind {
    match (bcs.peel_enum_tag()) {
        0 => ActionKind::Move,
        1 => ActionKind::Attack,
        2 => ActionKind::Reload,
        3 => ActionKind::Grenade,
        _ => abort,
    }
}

/// Deserialize `Action` from the BCS reader: the `uses` option, then the kind.
public(package) fun from_bcs(bcs: &mut BCS): Action {
    Action { uses: bcs.peel_option!(|bcs| bcs.peel_u8()), kind: kind_from_bcs(bcs) }
}
