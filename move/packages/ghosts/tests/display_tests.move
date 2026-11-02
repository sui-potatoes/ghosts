// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

module ghosts::display_tests;

use ghosts::{armor::Armor, display, recruit::{DogTag, Recruit}, weapon::Weapon};
use std::unit_test::{assert_eq, destroy};
use sui::{display_registry::{Display, DisplayRegistry}, test_scenario};

#[test]
fun create_displays() {
    let mut test = test_scenario::begin(@1);
    test.create_system_objects();

    let mut registry = test.take_shared<DisplayRegistry>();
    let recruit_cap = display::recruit(&mut registry, test.ctx());
    let dog_tag_cap = display::dog_tag(&mut registry, test.ctx());
    let weapon_cap = display::weapon(&mut registry, test.ctx());
    let armor_cap = display::armor(&mut registry, test.ctx());
    test_scenario::return_shared(registry);
    test.next_tx(@1);

    let recruit = test.take_shared<Display<Recruit>>();
    assert_eq!(recruit.cap_id(), option::some(object::id(&recruit_cap)));
    assert_eq!(recruit.fields()[&"name"], "{metadata.name}");
    assert_eq!(recruit.fields()[&"link"], "https://potatoes.app/commander/recruit/{id}");
    test_scenario::return_shared(recruit);

    let dog_tag = test.take_shared<Display<DogTag>>();
    assert_eq!(dog_tag.cap_id(), option::some(object::id(&dog_tag_cap)));
    assert_eq!(dog_tag.fields()[&"description"], "Fallen in the line of duty.");
    test_scenario::return_shared(dog_tag);

    let weapon = test.take_shared<Display<Weapon>>();
    assert_eq!(weapon.cap_id(), option::some(object::id(&weapon_cap)));
    assert_eq!(weapon.fields()[&"name"], "{name}");
    test_scenario::return_shared(weapon);

    let armor = test.take_shared<Display<Armor>>();
    assert_eq!(armor.cap_id(), option::some(object::id(&armor_cap)));
    assert_eq!(armor.fields()[&"name"], "{name}");
    test_scenario::return_shared(armor);

    destroy(recruit_cap);
    destroy(dog_tag_cap);
    destroy(weapon_cap);
    destroy(armor_cap);
    test.end();
}

#[test, expected_failure(abort_code = sui::display_registry::EDisplayAlreadyExists)]
fun create_display_twice_fails() {
    let mut test = test_scenario::begin(@1);
    test.create_system_objects();

    let mut registry = test.take_shared<DisplayRegistry>();
    destroy(display::recruit(&mut registry, test.ctx()));
    destroy(display::recruit(&mut registry, test.ctx()));

    abort
}
