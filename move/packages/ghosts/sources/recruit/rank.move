// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Defines the ranking system for the game. Each Recruit gets assigned a rank,
/// normally starting with a `Rookie` and then getting promoted to higher ranks.
///
/// Traits:
/// - default
/// - from_bcs
/// - to_string
module ghosts::rank;

use std::string::String;
use sui::bcs::{Self, BCS};

const EMaxRank: u64 = 1;

/// Defines all available ranks in the game.
public enum Rank has copy, drop, store {
    Rookie,
    Squaddie,
    Corporal,
    Sergeant,
    Lieutenant,
    Captain,
    Major,
    Colonel,
}

/// Default rank for a new Recruit.
public fun default(): Rank { Rank::Rookie }

/// Create a new `Rookie` rank.
public fun rookie(): Rank { Rank::Rookie }

/// Create a new `Squaddie` rank.
public fun squaddie(): Rank { Rank::Squaddie }

/// Create a new `Corporal` rank.
public fun corporal(): Rank { Rank::Corporal }

/// Create a new `Sergeant` rank.
public fun sergeant(): Rank { Rank::Sergeant }

/// Create a new `Lieutenant` rank.
public fun lieutenant(): Rank { Rank::Lieutenant }

/// Create a new `Captain` rank.
public fun captain(): Rank { Rank::Captain }

/// Create a new `Major` rank.
public fun major(): Rank { Rank::Major }

/// Create a new `Colonel` rank.
public fun colonel(): Rank { Rank::Colonel }

/// The experience a recruit needs for the rank after this one, in total. A
/// `Colonel` is as far as it goes.
public fun next_rank_xp(rank: &Rank): Option<u16> {
    match (rank) {
        Rank::Rookie => option::some(3),
        Rank::Squaddie => option::some(8),
        Rank::Corporal => option::some(15),
        Rank::Sergeant => option::some(25),
        Rank::Lieutenant => option::some(40),
        Rank::Captain => option::some(60),
        Rank::Major => option::some(90),
        Rank::Colonel => option::none(),
    }
}

/// The rank's place in the order, a `Rookie` being 0.
public fun ordinal(rank: &Rank): u8 {
    match (rank) {
        Rank::Rookie => 0,
        Rank::Squaddie => 1,
        Rank::Corporal => 2,
        Rank::Sergeant => 3,
        Rank::Lieutenant => 4,
        Rank::Captain => 5,
        Rank::Major => 6,
        Rank::Colonel => 7,
    }
}

/// Whether the rank is the given one or above it.
public fun at_least(rank: &Rank, other: &Rank): bool { rank.ordinal() >= other.ordinal() }

/// Promotes the rank of the Recruit.
public(package) fun rank_up(rank: &mut Rank) {
    *rank =
        match (rank) {
            Rank::Rookie => Rank::Squaddie,
            Rank::Squaddie => Rank::Corporal,
            Rank::Corporal => Rank::Sergeant,
            Rank::Sergeant => Rank::Lieutenant,
            Rank::Lieutenant => Rank::Captain,
            Rank::Captain => Rank::Major,
            Rank::Major => Rank::Colonel,
            Rank::Colonel => abort EMaxRank,
        }
}

// === Checks ===

/// Check if the rank is a `Rookie`.
public fun is_rookie(rank: &Rank): bool {
    match (rank) {
        Rank::Rookie => true,
        _ => false,
    }
}

/// Check if the rank is a `Squaddie`.
public fun is_squaddie(rank: &Rank): bool {
    match (rank) {
        Rank::Squaddie => true,
        _ => false,
    }
}

/// Check if the rank is a `Corporal`.
public fun is_corporal(rank: &Rank): bool {
    match (rank) {
        Rank::Corporal => true,
        _ => false,
    }
}

/// Check if the rank is a `Sergeant`.
public fun is_sergeant(rank: &Rank): bool {
    match (rank) {
        Rank::Sergeant => true,
        _ => false,
    }
}

/// Check if the rank is a `Lieutenant`.
public fun is_lieutenant(rank: &Rank): bool {
    match (rank) {
        Rank::Lieutenant => true,
        _ => false,
    }
}

/// Check if the rank is a `Captain`.
public fun is_captain(rank: &Rank): bool {
    match (rank) {
        Rank::Captain => true,
        _ => false,
    }
}

/// Check if the rank is a `Major`.
public fun is_major(rank: &Rank): bool {
    match (rank) {
        Rank::Major => true,
        _ => false,
    }
}

/// Check if the rank is a `Colonel`.
public fun is_colonel(rank: &Rank): bool {
    match (rank) {
        Rank::Colonel => true,
        _ => false,
    }
}

// === Convenience and compatibility ===

/// Deserialize bytes into a `Rank`.
public fun from_bytes(bytes: vector<u8>): Rank {
    from_bcs(&mut bcs::new(bytes))
}

/// Helper method to allow nested deserialization of `Rank`.
public(package) fun from_bcs(bcs: &mut BCS): Rank {
    match (bcs.peel_u8()) {
        0 => Rank::Rookie,
        1 => Rank::Squaddie,
        2 => Rank::Corporal,
        3 => Rank::Sergeant,
        4 => Rank::Lieutenant,
        5 => Rank::Captain,
        6 => Rank::Major,
        7 => Rank::Colonel,
        _ => abort,
    }
}

/// Convert the rank to a string. Very useful for debugging and logging.
public fun to_string(rank: &Rank): String {
    match (rank) {
        Rank::Rookie => "Rookie",
        Rank::Squaddie => "Squaddie",
        Rank::Corporal => "Corporal",
        Rank::Sergeant => "Sergeant",
        Rank::Lieutenant => "Lieutenant",
        Rank::Captain => "Captain",
        Rank::Major => "Major",
        Rank::Colonel => "Colonel",
    }
}
