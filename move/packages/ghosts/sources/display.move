// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Implements Sui Object Display (V2, `sui::display_registry`) for objects in
/// the game.
///
/// Each function creates and shares the `Display` for one type, proving type
/// ownership with an `internal::Permit` issued by the module that defines the
/// type, and returns the `DisplayCap` which manages the fields later on.
///
/// The `DisplayRegistry` holds a single `Display` per type, so each function
/// succeeds only once: call them right after publishing. The first caller gets
/// the `DisplayCap`, any following call aborts.
module ghosts::display;

use ghosts::{
    armor::{Self, Armor},
    recruit::{Self, DogTag, Recruit},
    weapon::{Self, Weapon},
    weapon_upgrade::{Self, WeaponUpgrade}
};
use sui::display_registry::{DisplayCap, DisplayRegistry};

/// Create and share the `Display` for the `Recruit` object.
public fun recruit(registry: &mut DisplayRegistry, ctx: &mut TxContext): DisplayCap<Recruit> {
    let (mut display, cap) = registry.new(recruit::permit(), ctx);
    display.set(&cap, "name", "{metadata.name}");
    display.set(&cap, "description", "A Ghosts operative.");
    display.set(&cap, "image_url", "https://suighosts.com/images/recruit.webp");
    display.set(&cap, "link", "https://suighosts.com");
    display.share();
    cap
}

/// Create and share the `Display` for the `DogTag` object.
public fun dog_tag(registry: &mut DisplayRegistry, ctx: &mut TxContext): DisplayCap<DogTag> {
    let (mut display, cap) = registry.new(recruit::dog_tag_permit(), ctx);
    display.set(&cap, "name", "{metadata.name}");
    display.set(&cap, "description", "Fallen in the line of duty.");
    display.set(&cap, "image_url", "https://suighosts.com/images/recruit.webp");
    display.set(&cap, "link", "https://suighosts.com");
    display.share();
    cap
}

/// Create and share the `Display` for the `Weapon` object.
public fun weapon(registry: &mut DisplayRegistry, ctx: &mut TxContext): DisplayCap<Weapon> {
    let (mut display, cap) = registry.new(weapon::permit(), ctx);
    display.set(&cap, "name", "{name}");
    display.set(&cap, "description", "A weapon that Recruits can use in battle.");
    display.set(&cap, "image_url", "https://suighosts.com/images/weapon.webp");
    display.share();
    cap
}

/// Create and share the `Display` for the `WeaponUpgrade` object.
public fun weapon_upgrade(
    registry: &mut DisplayRegistry,
    ctx: &mut TxContext,
): DisplayCap<WeaponUpgrade> {
    let (mut display, cap) = registry.new(weapon_upgrade::permit(), ctx);
    display.set(&cap, "name", "{name}");
    display.set(&cap, "description", "An upgrade module that fits a weapon.");
    display.share();
    cap
}

/// Create and share the `Display` for the `Armor` object.
public fun armor(registry: &mut DisplayRegistry, ctx: &mut TxContext): DisplayCap<Armor> {
    let (mut display, cap) = registry.new(armor::permit(), ctx);
    display.set(&cap, "name", "{name}");
    display.set(&cap, "description", "Armor that Recruits can wear in battle.");
    display.set(&cap, "image_url", "https://suighosts.com/images/armor-light.webp");
    display.share();
    cap
}
