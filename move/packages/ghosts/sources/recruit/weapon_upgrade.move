// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the `WeaponUpgrade` - a module that can be attached to a `Weapon` to
/// modify its stats.
module ghosts::weapon_upgrade;

use ghosts::stats::Stats;
use std::string::String;

/// `WeaponUpgrade` is an upgrade module for a `Weapon`: an object of its own,
/// kept in the stock of an `Account` it is sent to, or fitted to a `Weapon` to
/// modify its stats. A `Weapon` takes one upgrade of each `kind`.
public struct WeaponUpgrade has key, store {
    id: UID,
    name: String,
    /// The family of the upgrade: scope, laser sight, stock, etc.
    kind: u8,
    tier: u8,
    modifier: Stats,
}

/// Create a new `WeaponUpgrade` with the provided parameters.
public(package) fun new(
    name: String,
    kind: u8,
    tier: u8,
    modifier: Stats,
    ctx: &mut TxContext,
): WeaponUpgrade {
    WeaponUpgrade { id: object::new(ctx), name, kind, tier, modifier }
}

/// Get the name of the `WeaponUpgrade`.
public fun name(u: &WeaponUpgrade): String { u.name }

/// Get the kind of the `WeaponUpgrade`.
public fun kind(u: &WeaponUpgrade): u8 { u.kind }

/// Get the tier of the `WeaponUpgrade`.
public fun tier(u: &WeaponUpgrade): u8 { u.tier }

/// Get the modifier of the `WeaponUpgrade`.
public fun modifier(u: &WeaponUpgrade): &Stats { &u.modifier }

/// Destroy the `WeaponUpgrade`.
public fun destroy(u: WeaponUpgrade) {
    let WeaponUpgrade { id, .. } = u;
    id.delete();
}

/// Issue a `Permit` for the `WeaponUpgrade` type. Package-only: used to create
/// `Display<WeaponUpgrade>` in the `display` module.
public(package) fun permit(): internal::Permit<WeaponUpgrade> { internal::permit() }

/// Print the `WeaponUpgrade` as a string.
public fun to_string(u: &WeaponUpgrade): String {
    let mut str = u.name;
    str.append_utf8(b" (Tier ");
    str.append(u.tier.to_string());
    str.append_utf8(b")");
    str
}
