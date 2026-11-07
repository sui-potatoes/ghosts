// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the `WeaponUpgrade` - a module that can be attached to a `Weapon` to
/// modify its stats.
module ghosts::weapon_upgrade;

use ghosts::stats::Stats;
use std::string::String;

/// `WeaponUpgrade` is a primitive which represents an upgrade module for a
/// `Weapon`. Upgrades are identified by their name, and can be applied to a
/// `Weapon` to modify its stats. A `Weapon` takes one upgrade of each `kind`.
public struct WeaponUpgrade has drop, store {
    name: String,
    /// The family of the upgrade: scope, laser sight, stock, etc.
    kind: u8,
    tier: u8,
    modifier: Stats,
}

/// Create a new `WeaponUpgrade` with the provided parameters.
public(package) fun new(name: String, kind: u8, tier: u8, modifier: Stats): WeaponUpgrade {
    WeaponUpgrade { name, kind, tier, modifier }
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
public fun destroy(u: WeaponUpgrade) { let WeaponUpgrade { .. } = u; }

/// Print the `WeaponUpgrade` as a string.
public fun to_string(u: &WeaponUpgrade): String {
    let mut str = u.name;
    str.append_utf8(b" (Tier ");
    str.append(u.tier.to_string());
    str.append_utf8(b")");
    str
}

#[test]
fun new_weapon_upgrade() {
    use std::unit_test::assert_eq;
    use ghosts::stats;
    let modifier = stats::default();
    let upgrade = Self::new(b"Damage Upgrade".to_string(), 0, 1, modifier);

    assert_eq!(upgrade.name(), b"Damage Upgrade".to_string());
    assert_eq!(upgrade.kind(), 0);
    assert_eq!(upgrade.tier(), 1);
    assert_eq!(upgrade.modifier().inner(), modifier.inner());
    assert_eq!(upgrade.to_string(), b"Damage Upgrade (Tier 1)".to_string());

    upgrade.destroy();
}
