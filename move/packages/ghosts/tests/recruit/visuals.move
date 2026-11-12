// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

#[test_only]
extend module ghosts::visuals;

#[test]
fun test_pack_and_defaults() {
    use std::unit_test::assert_eq;

    let v = new(vector[1, 2, 3], vector[4, 5], vector[6], vector[7], vector[8, 9]);
    assert_eq!(bf::read_u8_at_offset!(v.head, 0), 1);
    assert_eq!(bf::read_u8_at_offset!(v.head, 1), 2);
    assert_eq!(bf::read_u8_at_offset!(v.head, 2), 3);
    assert_eq!(bf::read_u8_at_offset!(v.face, 0), 4);
    assert_eq!(bf::read_u8_at_offset!(v.face, 1), 5);
    assert_eq!(bf::read_u8_at_offset!(v.eyes, 0), 6);
    assert_eq!(bf::read_u8_at_offset!(v.body, 0), 7);
    assert_eq!(bf::read_u8_at_offset!(v.outfit, 1), 9);
    assert_eq!(bf::read_u8_at_offset!(v.outfit, 2), 0);
    assert_eq!(default(), new_unchecked(0, 0, 0, 0, 0));

    // a full area: slot 31 lands in the top byte
    let full = new(vector::tabulate!(32, |i| i as u8), vector[], vector[], vector[], vector[]);
    assert_eq!(bf::read_u8_at_offset!(full.head, 31), 31);
}

#[test, expected_failure(abort_code = ETooManyValues)]
fun test_too_many_values_fail() {
    new(vector[], vector[], vector::tabulate!(33, |i| i as u8), vector[], vector[]);
}
