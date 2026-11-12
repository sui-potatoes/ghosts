// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::weapon_upgrade;

#[test]
fun new_weapon_upgrade() {
    use std::unit_test::assert_eq;
    use ghosts::stats;
    let modifier = stats::default();
    let ctx = &mut tx_context::dummy();
    let upgrade = Self::new(b"Damage Upgrade".to_string(), 0, 1, modifier, ctx);

    assert_eq!(upgrade.name(), b"Damage Upgrade".to_string());
    assert_eq!(upgrade.kind(), 0);
    assert_eq!(upgrade.tier(), 1);
    assert_eq!(upgrade.modifier().inner(), modifier.inner());
    assert_eq!(upgrade.to_string(), b"Damage Upgrade (Tier 1)".to_string());

    upgrade.destroy();
}
