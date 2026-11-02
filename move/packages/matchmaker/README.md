# Matchmaker

Generic rating-based matchmaking for two-player games on Sui. A game package creates a
`Matchmaker<T>` for a type `T` it defines, shares it, and calls two functions:

- `find_game` - pair the sender with a compatible waiting player drawn at random, or queue
  them under a fresh order ID.
- `cancel_game` - leave the queue.

The matchmaker knows nothing about how ratings are computed or stored. The caller passes the
player's rating and a window, the tolerance in rating points this player accepts right now. Two
tickets are compatible when `|r_a - r_b| <= window_a + window_b`, and each window grows with the
time waited. Pair it with
[glicko](https://github.com/sui-potatoes/app/tree/main/packages/glicko) or any other rating
scheme.

Ownership of `T` is proven with `internal::Permit<T>`, so no witness value is needed and `T`
needs no abilities.

## Installing

Packages in this workspace depend on it by path, under the `[dependencies]` section of their
`Move.toml`:

```toml
matchmaker = { local = "../matchmaker" }
```

## Usage

```move
module my_game::ranked;

use glicko::glicko::Rating;
use matchmaker::matchmaker::{Self, Matchmaker};
use sui::{clock::Clock, random::Random, table::Table};

/// Identifies this game's queue; only this module can create `internal::Permit<RANKED>`.
public struct RANKED()

/// Ratings live in the game package, not in the matchmaker.
public struct Ladder has key {
    id: UID,
    ratings: Table<address, Rating>,
}

fun init(ctx: &mut TxContext) {
    matchmaker::new(internal::permit<RANKED>(), matchmaker::default_config(), ctx).share();
}

/// Queue up, or start a game right away if a compatible opponent is waiting. Not public, so the
/// random draw cannot be inspected and reverted by the caller.
entry fun find(
    ladder: &Ladder,
    mm: &mut Matchmaker<RANKED>,
    rng: &Random,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let rating = ladder.ratings[ctx.sender()];
    let window = rating.current_deviation(clock.timestamp_ms());
    let mut rng = rng.new_generator(ctx);
    let permit = internal::permit<RANKED>();

    let (_order, found) = matchmaker::find_game(permit, mm, rating.rating(), window, &mut rng, clock, ctx);
    found.do!(|m| {
        // m.players() is [waiting player, sender]; create the game here
    });
}

/// Bail out of the queue.
public fun cancel(mm: &mut Matchmaker<RANKED>, ctx: &mut TxContext) {
    mm.cancel_game(ctx)
}
```

`find_game` returns the sender's order ID either way. When it pairs the sender, it emits a
`MatchFound { match_id, players }` event whose `match_id` is the waiting player's order ID, so the
waiting player can recognise the pairing they were drawn into.

## API

- `new<T>(permit, config, ctx)` / `share(mm)` - create and share a matchmaker.
- `find_game<T>(permit, &mut mm, rating, window, &mut rng, &clock, ctx): (ID, Option<Match>)` -
  queue or pair; returns the sender's order ID. Aborts with `EAlreadyQueued` if the sender has a
  live ticket; an expired one is replaced.
- `cancel_game(&mut mm, ctx)` - leave the queue. Aborts with `ENotQueued` if not waiting.
- `set_config<T>(permit, &mut mm, config)` - replace the parameters; only while the queue is
  empty.
- `new_config(bucket_size, bucket_capacity, window_step, window_step_ms, max_window, ticket_ttl_ms)`
  / `default_config()`.
- `is_queued(&mm, player)`, `queue_length(&mm)`, `config(&mm)` - reads.
- `Match`: `match_id()` - the waiting player's order ID, `players()` - the first player is the
  one who waited.

## Matching rules

- A ticket's effective window is `window + waited / window_step_ms * window_step`, capped at
  `max_window`.
- Buckets are visited nearest first and the search stops at the first ring holding compatible
  tickets. The opponent is drawn uniformly at random among them, so a player cannot choose who
  they are paired with by timing their call.
- Tickets older than `ticket_ttl_ms` are dropped when their bucket is next visited, so a player
  who went away does not get paired with someone who is present.
- The default config uses 100-point buckets of up to 32 tickets, widens the window by 50 points
  every 30 seconds up to 1000 points, and expires tickets after 10 minutes.

## Storage and cost

Tickets live in dynamic fields keyed by rating bucket (`rating / bucket_size`, capped at 255),
each a vector of at most `bucket_capacity` tickets; a full bucket evicts its oldest ticket. A
`u256` bitmap in the shared object records which buckets are non-empty, and a `Table` maps each
waiting player to their bucket. The shared object itself never grows.

| Case                    | Dynamic field operations                                    | Vector work                |
| ----------------------- | ----------------------------------------------------------- | -------------------------- |
| Opponent waiting nearby | 1 table read, 1 bucket load, 1 bucket write, 1 table remove | one bucket                 |
| Nobody in reach         | 1 table read, 1 bucket add, 1 table add                     | none                       |
| Worst case              | 1 table read plus one load per non-empty bucket in reach    | capacity per loaded bucket |

The ring walk over the bitmap is pure arithmetic on a local value. The number of rings is
bounded by `(window + max_window) / bucket_size`.

## License

MIT
