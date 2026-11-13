# Matchmaking, rating and permadeath (on-chain game)

Scope: how the on-chain game pairs players, rates them and advances their recruits, as implemented in `move/packages/matchmaker` and `move/packages/ghosts`, and what permadeath does to a rated game. Part A (sections 1-8) states what the code does. Part B (sections 9-11) is a problem statement built from Part A: facts and consequences, then the open decisions, without recommendations. It is a companion to [mechanics.md](mechanics.md) (map, action resolution, stats catalogue, turn flow, ending table) and [actions.md](actions.md) (what a unit can do); neither is repeated here.

Date: 2026-11-12. Commit: `812f46c` (Move sources unmodified in the working tree at that commit).

Conventions. Paths are relative to the repo root. `M/` = `move/packages/matchmaker/sources/matchmaker.move`; `MT/` = `move/packages/matchmaker/tests/matchmaker_tests.move`; `S/` = `move/packages/ghosts/sources/`; `GL/` = the `glicko` dependency as built under `move/packages/ghosts/build/ghosts/sources/dependencies/glicko/glicko.move` (a build artifact; `move/packages/ghosts/Move.lock:50` pins the dependency at git rev `a890a5299d7ab34d94b5d853934ae6173bd4d373`, which I did not fetch separately); `APP/` = `app/src/`; `AG/` = `packages/agent/src/`. Numbers marked "run" were produced by Move tests in a scratch copy (matchmaker, glicko copied unchanged apart from test-only helpers) outside the repo, or, where said, by a Python script over the formulas of mechanics.md section 5; everything else is read from the code. Line numbers drift: re-derive them from the commit.

# Part A: how it works today

## 1. Identity and eligibility

A player is an `Account` (`S/account.move:84-98`), a shared object, identified everywhere by its object ID; the owner address only authorizes (`authorize`, `:464`). One account per address (`Registry.accounts`, `new_account` `:133-148`); nothing else limits how many addresses a person uses. A new account has `state = Idle`, `recruits = 0`, `rating = glicko::default()`, `score = {0, 0, 0}` (`:137-144`).

Fields: `owner`, `state`, `recruits` (the number of recruits at home: hired or back from a game, not out in one, `:91-93`), `rating: Rating` (`GL/glicko.move:83-90`: `rating`, `deviation`, `games`, `last_played_ms`), `score: Score` (`wins`, `losses`, `draws`, `:108-112`).

State machine (`S/account.move:117-127`; transitions by `public(package)` setters):

| From | To | Caused by | Ref |
| --- | --- | --- | --- |
| `Idle` | `Searching { order, since_ms }` | `find_game` with no compatible ticket (`start_search`) | `S/ghosts.move:213`, `account.move:407` |
| `Idle` | `Playing(game)` | `find_game` that found a waiting player (the finder) | `ghosts.move:220` |
| `Searching` | `Playing(game)` | `accept_seat` (the player who waited) | `ghosts.move:229-235` |
| `Searching` | `Idle` | `cancel_search` (`clear_search`) | `ghosts.move:257`, `account.move:420` |
| `Playing` | `Idle` | `complete_game` (`release` = `clear_search`) | `ghosts.move:329-330`, `:532-534` |
| `Playing` | `Suspended { until_ms }` | `complete_game` for a side that `misbehaved`, after the release | `ghosts.move:331-332`, `account.move:457` |
| `Suspended` | `Searching` / `Playing` | `find_game` once `now >= until_ms` | `ghosts.move:196` |

There is no transition from `Suspended` back to `Idle`: a lapsed suspension stays in the state and is treated as idle (`is_idle` is true for `Idle` and `Suspended`, `account.move:480-485`; `suspended_until` returns the stored time, `:505-510`).

To search, `find_game` (`S/ghosts.move:183-223`) requires: the sender controls the account (`:191`); `is_idle` (`EAlreadySearching`, `:192`); `now >= suspended_until` (`ESuspended`, `:196`); `num_recruits() > 0` (`ENoSquad`, `:197`). Nothing else is checked: not recruit rank, gear, health of a squad, or the number of recruits beyond one (section 7).

## 2. The queue

### 2.1 `Matchmaker<T>` and `Config`

`Matchmaker<T>` (`M/:49-58`) is one shared object: `config`, `occupied: u256` (bit `i` set while bucket `i` holds tickets), `players: Table<ID, u8>` (waiting player to bucket), `size`. Tickets live in dynamic fields `Bucket(u8)` holding a `vector<Ticket>` (`:76`, `:79-86`). Ghosts has one queue for all players, one map preset (`black_rain`), and no ranked or casual split.

`Config` (`M/:61-73`) and the values Ghosts passes in `init` (`S/ghosts.move:677`: `new_config(100, NO_LIMIT, 50, 30_000, 1_000, NO_LIMIT)`; `matchmaker::default_config()` is a different set, `M/:137-146`):

| Field | Meaning | Ghosts value | `default_config()` |
| --- | --- | --- | --- |
| `bucket_size` | rating points per bucket | 100 | 100 |
| `bucket_capacity` | tickets per bucket; the oldest is evicted at the cap (`M/:343-347`) | `NO_LIMIT` = 18_446_744_073_709_551_615 (`u64::MAX`) | 32 |
| `window_step` / `window_step_ms` | window points added per interval waited | 50 / 30_000 | 50 / 30_000 |
| `max_window` | cap of one ticket's window | 1_000 | 1_000 |
| `ticket_ttl_ms` | tickets older than this are dropped when their bucket is next scanned (`M/:310-314`) | `NO_LIMIT` | 600_000 |

The comment at `S/ghosts.move:674-676` and `:78`: the queue never lets go of a search itself; a search leaves it only by its player's cancel or by a match, which sends a `Seat`, so the `Account` always knows where it stands. With `NO_LIMIT` capacity and TTL, `tickets.length() >= capacity` and `now - since_ms > ttl` are never true: no eviction, no expiry. `set_config` only works on an empty queue (`M/:114-117`).

### 2.2 Tickets, buckets, bitmap

`Ticket { id, player, rating, window, since_ms }` (`M/:79-86`). `rating` and `window` are fixed at the search: the Account cannot play while `Searching`, so its rating does not change in the queue. `bucket_of(rating) = min(rating / bucket_size, 255)` (`:274-276`): ratings of 25_500 and above share bucket 255 (`MAX_BUCKET`, `:46`); the test `ratings_above_range_share_top_bucket` covers it (`MT/:153`). A bucket exists as a dynamic field only while it holds tickets; its bit in `occupied` is set on creation and cleared on removal (`:336-340`, `:378-382`), so a search touches only fields the bitmap marks occupied. At most one ticket per player (`players` table; `EAlreadyQueued`, `M/:175-179`; not reachable from Ghosts as read, since `find_game` first requires an idle account and match and cancel both remove the ticket).

### 2.3 The search, step by step (`M/:163-231`)

Inputs from Ghosts (`S/ghosts.move:194-210`): `rating = acc.rating().rating()`, `window = acc.rating().current_deviation(now)` (deviation grown for inactivity, section 3.5), the account ID as player, a `RandomGenerator` made in the non-public `entry` function so the draw cannot be inspected and reverted in the same transaction (`M/:15-19`).

```
window_f   = min(window, max_window)                         // config.window(ticket, now), waited = 0   (:183, :279-282)
window_t(w) = min(w0 + floor(waited / 30_000) * 50, 1_000)    // the same function for a stored ticket    (:316-317)
compatible  iff |r_f - r_t| <= window_f + window_t            // :318-319
center = min(r_f / 100, 255)
reach  = min((window_f + 1_000) / 100 + 1, 255)               // farthest ring a compatible ticket can sit in (:186)
```

1. If the player already has a ticket: it is taken out; if it was expired it is replaced, else abort `EAlreadyQueued` (`:175-179`).
2. `pending` = occupied buckets within `[center - reach, center + reach]` from the bitmap (`:189-192`).
3. Ring walk `d = 0, 1, 2, ...` while `pending != 0` and no candidates were found (`:197-213`): at each `d`, scan bucket `center - d` (if `d <= center`) and bucket `center + d` (if `d > 0` and `<= 255`) when occupied. Scanning a bucket (`scan_bucket`, `:295-327`) drops expired tickets (none under `NO_LIMIT`) and returns the indices of tickets that pass the compatibility test; an emptied bucket is deleted.
4. The walk stops at the first ring `d` with any compatible ticket, in either of the two buckets of that ring. Rings are bucket distances, not rating distances: any compatible ticket in a nearer ring is taken before a farther one, whatever the rating gaps inside the buckets (`nearest_ring_wins`, `MT/:206`).
5. `pick = rng.generate_u64_in_range(0, count - 1)` over the union of the compatible tickets of that ring (`:223`): uniform per ticket, not per bucket. Purpose (doc comment `M/:15-19`): the opponent is one of the closest within bucket granularity but not one the caller can choose by timing the call (`opponent_is_drawn_at_random`, `MT/:226`).
6. No candidate in reach: the ticket is inserted (`:216-219`) and `(order, none)` returned.

Which ticket's window counts: the finder's window is its current deviation (at most 350 for a rating produced by `compute`, see 3.5, and capped by `max_window`); a stored ticket's window has grown with the time since it was queued, so a waiting player gets easier to match as they wait, while the finder's does not.

### 2.4 On a match and on no match

Match: the waiting player's ticket is removed (`take_at`, `:225-227`); `Match { id: <waiting order>, players: [waiting, finder] }` (`:230`). Ghosts then (`S/ghosts.move:216-222`): `new_game(preset, waiting, finder, now)` with `players = [waiting, finder]` (`:262-280`: state `Deploying { until_ms: now + DEPLOY_LIMIT_MS }`, map cloned from the preset); a `Seat { game }` is transferred to the waiting `Account` (to its object address); the finder's `Account` is set `Playing(game)`; the game is shared. The waiting `Account` stays `Searching` until `accept_seat` (anyone may send it, the client does it as soon as it polls the seat, `APP/chain/matchmaking.ts:241-247`). Side 0 is `players[0]`: the player who waited moves first (`active_side = turn % 2`, `ghosts.move:537-539`); the finder is side 1. Which player waited is the only thing deciding it; the rating does not.

No match: the Account becomes `Searching { order, since_ms }` and waits for a later `find_game` by someone else. Pairing happens only inside the arriving player's `find_game`; two tickets that have become mutually compatible by waiting stay unmatched until a third player's search picks one of them.

### 2.5 Cancel and `SEARCH_TIMEOUT_MS`

`cancel_search` (`S/ghosts.move:241-258`): requires `Searching` (`ENotSearching`); the owner can always cancel; anyone else only when `now - since_ms > SEARCH_TIMEOUT_MS` (120_000, `:77`; `account.move:513-518`; `ESearchNotTimedOut`); and the ticket must still be in the queue (`ESeatWaiting`): once a match has taken the ticket, the way out is the game (accept the seat, then `abandon_game` or `complete_game`). A search abandoned by a closed app therefore stays in the queue (its window growing to 1_000) until the owner or anyone after 120 s cancels it; the agent cancels its own after the timeout (`AG/agent.ts:301-312`). A finder paired with such a ticket gets a game whose other side never deploys (ends `NoShow`, section 4).

### 2.6 Bound on queue size

Insert happens only when no compatible ticket exists within reach, so every ticket in the queue was incompatible with every ticket in the queue at the time it arrived. Reach is conservative (a compatible ticket's bucket distance is at most `(window_f + max_window) / bucket_size + 1`, `:186`), so "no candidate in reach" means "no compatible ticket exists".

```
window >= MIN_DEVIATION = 30 for every ticket             // GL/glicko.move:73; stored deviation is clamped to [30, 350] (:222), glicko::new asserts the same (:107), the default is 350
a ticket's window only grows with waiting
for tickets A (earlier) and B (later) in the queue:  |r_A - r_B| > window_A(t_B) + window_B >= 30 + 30
=> any two tickets in the queue are at least 61 rating points apart
```

A bucket spans 100 integer ratings, so it holds at most two tickets (for example ratings 1500 and 1561, or 1500 and 1599: a third rating in `[1500, 1599]` is within 60 of one of them). Per bucket: **2**. Across the queue the same argument bounds the count by `floor(max_rating / 61) + 1` (for ratings up to 3_000: 50 tickets); the exception is the top bucket (rating >= 25_500), which the argument does not cap and which no rating produced by 3.3 plausibly reaches (not computed). The pairwise gap holds at insertion; later growth of windows can make two queued tickets compatible without removing either (2.4).

Run (scratch, `queue_bound`): with Ghosts' `Config` and tickets of window 30: ratings 1500 and 1561 both queue (`queue_length` 2); 1599 then matches (diff 38) and 1530 matches the other, queue back to 0; 1500 then 1560 match (diff 60 = 30 + 30). A randomized run of 250 searches in rating 1500..1599, windows 30..350, random waiting gaps, never exceeded a queue length of 1 (a random sequence rarely builds the two-ticket case; the bound is the argument above plus the boundary cases, not an exhaustive search). Effect of the glicko floor: see 3.5 (in a mirror run deviation stopped at 50, so the effective sum of windows is larger than 60 in practice; whether any sequence reaches 30 is not determined).

## 3. Rating

### 3.1 What is stored

`Account.rating: Rating { rating: u64, deviation: u64, games: u64, last_played_ms: u64 }` (`GL/:83-90`). Defaults: `DEFAULT_RATING` 1500, `MAX_DEVIATION` 350 (also the upper bound), `MIN_DEVIATION` 30, `C2_PER_DAY` 1_200 (growth of `deviation^2` per day of inactivity), `MS_PER_DAY` 86_400_000 (`GL/:68-77`). `default()` has `games = 0`, `last_played_ms = 0` (`:101-103`). Rating is a `u64`: gains are unbounded above, a loss floors at 0 (`delta.min(player.rating)`, `:225`; test `rating_saturates_at_zero`).

### 3.2 When it changes

Only in `complete_game` (`S/ghosts.move:318-323`), once per game, for both accounts at once: `first.add_result(winner)`, `second.add_result(winner)`, `first.rate_game(second, winner, now)`, skipped when the ending is `NobodyShowed`. `rate_game` (`S/account.move:436-454`): `Win` if `winner == first`, `Loss` if `winner` is the second, `Draw` if none; calls `glicko::compute(&first.rating, &second.rating, score, now_ms)` and stores both results. `now_ms` is the time of the `complete_game` call, not of the end of the game; it is the clock for inactivity growth and the stored `last_played_ms`. A rating can only be wrapped up by someone calling `complete_game` (anyone can). Every other ending rates: `Won`, `Draw`, `Stalemate` as win/loss/draw; `Abandoned`, `Forfeited`, `NoShow` as a win for the other side (`winner`, `ghosts.move:500-508`).

### 3.3 The update as implemented (`GL/:198-262`)

Fixed point is `std::uq64_64`; each side is computed from the pre-game values of both (`compute`, `:170-177`).

```
RD      = player.current_deviation(now)       // grown for inactivity, 3.5
g       = 1 / sqrt(1 + 3 q^2 RD_opp^2 / pi^2) // RD_opp = opponent.current_deviation(now); sqrt by 5 Newton steps (:264-270)
q       = ln(10) / 400 = 0.0057565
E       = 1 / (1 + 10^(-g (r - r_opp) / 400)) // from E_TABLE, 81 entries, d = 0, 25, ..., 2000 in millionths, linear interpolation,
                                              // symmetry E(-d) = 1 - E(d), clamped to the last entry (0.99999) past 2000 effective points (:56-66, :242-262)
A       = 1/RD^2 + q^2 g^2 E (1 - E)
|dr|    = round( q g |s - E| / A )            // s = 1 (win), 0.5 (draw), 0 (loss); round = nearest, half up (:273-275)
r'      = r + |dr| if s >= E, else r - min(|dr|, r)
RD'     = clamp(round(sqrt(1 / A)), 30, 350)
games'  = games + 1;  last_played' = now
```

The reference is Glickman 1995 with a rating period of one game and `c` applied per day (`GL/:21-22`). Fixed-point detail that matters: `E` is table-interpolated, so ratings can differ from float Glicko by a point (the `glicko` tests compare ratings within 1 point of float references and allow 300 millionths on `E`); and `round(sqrt(1/A))` can leave `RD` unchanged when the exact decrease is below 0.5 (3.5).

### 3.4 Worked examples (all run unless noted; `now` within one hour of the last game, so no inactivity growth, except where stated)

| Case (A vs B) | Outcome | A after (RD) | B after (RD) |
| --- | --- | --- | --- |
| both default 1500 / 350 | A wins | 1662 (290) | 1338 (290) |
| both default | draw | 1500 (290) | 1500 (290) |
| 1500 / 100 vs 1500 / 100 | A wins | 1526 (96) | 1474 (96) |
| 1500 / 60 vs 1500 / 60 | A wins | 1510 (59) | 1490 (59) |
| 1500 / 50 vs 1500 / 50 | A wins | 1507 (50) | 1493 (50) |
| 1500 / 30 vs 1500 / 30 | A wins | 1503 (30) | 1497 (30) |
| 1900 / 350 vs 1500 / 350 | favourite wins | 1966 (311) | 1434 (311) |
| 1900 / 350 vs 1500 / 350 | upset (A loses) | 1593 (311) | 1807 (311) |
| 1900 / 60 vs 1500 / 60 | favourite wins | 1902 (60) | 1498 (60) |
| 1900 / 60 vs 1500 / 60 | upset | 1882 (60) | 1518 (60) |
| 1900 / 60 vs 1500 / 60 | draw | 1892 (60) | 1508 (60) |
| 2000 / 60 vs 1000 / 60 | favourite wins | 2000 (60) | 1000 (60) |
| 2000 / 60 vs 1000 / 60 | upset | 1980 (60) | 1020 (60) |
| established 1500 / 50 vs default | established wins | 1505 (50) | 1325 (248) |
| established 1500 / 50 vs default | established loses | 1495 (50) | 1675 (248) |
| 1500 / 50, idle 30 days (current RD 196) vs active 1500 / 50 | idle wins | 1583 (171) | 1494 (50) |

Reading the table: the default-vs-default first game is a 162-point swing; at established deviation (30 to 60) an equal-rating game moves 3 to 10 points; a newcomer's rating moves 175 points against an established account that moves 5; a large gap gives the favourite nothing (+0 at 1000 points, +2 at 400 with RD 60) and an upset costs the favourite 18 to 20 points at RD 60 or 307 at RD 350. A second game for the 1662 / 290 winner against a default account: a loss gives 1498 (256) for them and 1732 (287) for the default account.

### 3.5 Deviation over time, and its effect on the window

`current_deviation(now)` (`GL/:136-156`) is `RD` unchanged within one whole day of `last_played_ms` (integer day division), then `min(floor(sqrt(RD^2 + 1200 * days)), 350)`. Run:

| Days idle | 0 | 1 | 7 | 14 | 30 | 60 | 90 | 100 | 101 | 102 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| from RD 30 | 30 | 45 | 96 | 133 | 192 | 270 | 330 | 347 | 349 | 350 |
| from RD 60 | 60 | 69 | 109 | 142 | 198 | 274 | 334 | 350 | 350 | 350 |

Deviation after n games, run: for an account drawing against defaults, n = 1..10: 290, 253, 227, 208, 193, 181, 171, 162, 155, 149; for two accounts drawing against each other (both start default): 290, 247, 216, 192, 174, 159, 147, 137, 129, 122 (n = 10), about 100 at n = 14 to 15, 60 at n = 38, 50 at n = 48, and 50 unchanged through n = 400. The last is the rounding of 3.3: at RD 50 and equal ratings the exact `sqrt(1/A)` is about 49.5 and rounds back to 50, so the update stops shrinking RD. Not determined: whether a game sequence exists that reaches `MIN_DEVIATION` 30 (an unequal pairing shrinks less per game, so it would stop higher); only a rating built with `glicko::new(_, 30)` was run at 30.

Effect on search (`S/ghosts.move:199`): the window passed to the queue is the current deviation, so it is 350 for a new account, 290 after one game, near 100 after about 15 games against peers, and it widens again with inactivity (196 after 30 idle days from RD 50). Two defaults are always compatible (diff 0 <= 700). A finder at 350 meets a stored 1900 / RD 50 ticket immediately (limit `350 + 50 = 400`). Two established players 500 points apart (windows 50 each): limit 100 at once, `100 + 50k >= 500` at `k = 8`, i.e. 240 s of waiting. A ticket's window reaches `max_window` 1_000 after 13 steps (390 s) from 350, 19 steps (570 s) from 50, 20 steps (600 s) from 30; the largest compatible gap anywhere is `window_f + 1_000 <= 1_350`.

### 3.6 Score and games played

`Score { wins, losses, draws }` (`account.move:108-112`); `add_result` (`:425-433`): a draw if there is no winner (`Draw` and `Stalemate`), else win or loss. `games_played = wins + losses + draws` (`:539-541`). `Rating.games` is incremented in the same branch (`rate_game` runs where `add_result` does), so the two counts agree; `NobodyShowed` touches neither. Neither value distinguishes how a game ended (a win by walkover counts like a win by elimination).

## 4. Endings and their consequences

The ending table of mechanics.md section 9, extended. Rows: who is "P" (the side at fault, for `Abandoned`/`Forfeited`/`NoShow`) and the other side "O". XP is per surviving recruit (`experience`, `S/ghosts.move:584-594`; `SURVIVAL_XP` 1, `WIN_XP` 1, `MIN_TURNS_TO_EARN` 2, `:93-99`). Suspension is `SUSPENSION_MS` 60_000 (`:86`), from the time of `complete_game` (`:331-332`).

| Ending | Rating | Score | XP per survivor | Suspension | The dead |
| --- | --- | --- | --- | --- | --- |
| `Won(W)`: the other side has no unit on the map | W win, L loss | W win, L loss | W 2; L has no survivors | none | every recruit L deployed; plus W's recruits fallen during the game |
| `Draw`: both sides eliminated by one kill | draw | draw, draw | none left | none | every deployed recruit of both sides |
| `Stalemate`: turn 60 reached | draw | draw, draw | 1 each | none | only those fallen before |
| `Abandoned(P)`: `abandon_game` in `Deploying` or `Playing` | P loss, O win | P loss, O win | P 0; O 0 if `turn < 2`, else 1 (no `WIN_XP`) | P | only those already fallen; P's survivors come home |
| `Forfeited(P)`: 3 turns in a row run out | same as `Abandoned` | same | P 0; O 1 (the forfeit turn is 4 or 5, so `turn >= 2`) | P | those fallen; survivors home |
| `NoShow(P)`: P deployed nobody by `until_ms` | P loss, O win | P loss, O win | 0 for both | P | none (no fight happened) |
| `NobodyShowed` | none | none | 0 | both | none |

Notes: (1) in `Won`, the loser is defined as having nobody on the map (`count_losses`, `:638-645`, `squad`, `:522-524`): a decided game always costs the loser every recruit it deployed. (2) The kill removes the unit from its tile at once; the recruit is buried at the next `next_turn` or at `complete_game` (`bury_fallen`, `:650-659`), so abandoning after a kill does not save the killed recruit. (3) `Abandoned`/`Forfeited` by P: `winner` is the other side (`:500-508`), so the rating step is exactly a win/loss; the only differences from a loss by elimination are the survivors, the XP and the suspension. (4) The survivors of every ending, including the at-fault side's, are sent home (`send_home`, `:597-601`); recruits do not carry HP, ammo or AP between games.

## 5. Progression

XP lives on the recruit: `Recruit.xp: u16`, with `rank` and `stats` (`S/recruit/recruit.move:62-81`); the Account stores none. It is added at `send_home` to every survivor (`add_xp`, `:185-196`); a recruit not deployed earns nothing, a dead one loses all of it (the dog tag keeps only rank and metadata, `:85-91`). Sources: `SURVIVAL_XP` 1 for coming home, `WIN_XP` 1 more for coming home from a game won by elimination; a win handed over by a leaver pays only `SURVIVAL_XP`, and nothing if `turn < MIN_TURNS_TO_EARN` (`:94-99`, `:584-594`). A stalemate pays 1 to every survivor. So 2 XP per survivor is the most a game gives.

| Rank (ordinal) | Total XP to reach (`rank.move:59-70`) | Wins by elimination at 2 XP | Promotion stat (`recruit.move:42-44`, `:185-196`) |
| --- | --- | --- | --- |
| Rookie (0) | 0 | 0 | none |
| Squaddie (1) | 3 | 2 | +2 aim |
| Corporal (2) | 8 | 4 | +2 aim, +1 health |
| Sergeant (3) | 15 | 8 | +2 aim |
| Lieutenant (4) | 25 | 13 | +2 aim, +1 health |
| Captain (5) | 40 | 20 | +2 aim |
| Major (6) | 60 | 30 | +2 aim, +1 health |
| Colonel (7) | 90 | 45 | +2 aim |

Rank gates no gear: any recruit may equip any weapon, armor, upgrade or utility. The rules are on the items: weapon upgrades three per weapon, one of each of four kinds (`weapon.move`), and one utility slot (`recruit.move:39`). Colonel total: aim +14, health +3. Stat values and the item catalogue are in mechanics.md section 8.

## 6. Death and replacement

What a kill does: `Map` removes the unit to `fallen`; at `bury_fallen` the recruit leaves `Game.recruits` and `Recruit.kill` runs (`recruit.move:243-251`): the recruit object is deleted, its weapon (with upgrades), armor and utilities are destroyed, and a `DogTag { rank, metadata }` is sent to the recruit's leader (the Account address). The tag carries no XP and no stats, and is a plain object the owner may keep (`take_dog_tag`, `account.move:395`) or delete (`throw_away`, `recruit.move:237`). `Account.recruits` is decremented when a recruit is deployed (`remove_recruit`, `:278-286`) and incremented when one comes home (`add_recruit`, `:270`), so a death is simply a recruit that is not returned.

What it costs to replace one, from the code:

| Item | Rule | Ref | Price in the code |
| --- | --- | --- | --- |
| `hire_recruits` | tops the at-home count up to `FREE_RECRUITS` 4; aborts if already >= 4 (`ERecruitLimitReached`) or the account is `Playing` (`EInGame`) | `account.move:155-162` | none (no payment argument); Sui gas only |
| fresh recruit | Rookie, `xp` 0, default stats (mobility 7, aim 65, health 10, armor 0, dodge 0), no weapon, no armor, no utility, random name and looks | `recruit.move:215-227`, `account.move:174-214` | |
| `requisition_rifle/armor/utility/upgrade` | any tier, any kind, any number | `account.move:291-320`, `:338-357` | none |
| equip | any recruit, any gear; one utility slot | `:338-374` | none |

So the free squad is 4 recruits, which is also the hard cap on a roster at home (`hire_recruits` is the only way to hire); the deployable squad is 1 to 3 (`positions` per side, mechanics.md 1.4; `deploy_squad` requires at least one, `ghosts.move:362-363`). There is no in-game currency in the Move sources (no `Coin` or `Balance` in `S/`). Replacement is free of anything but gas: what a death costs is the recruit's rank, XP and the time to re-earn them (section 5). An unarmed recruit gets no `Attack` or `Reload` (mechanics.md 1.5), and may be deployed (no gear check in `deploy_squad`). `dismiss_recruit` (`account.move:258-266`) deletes a recruit voluntarily and returns its gear to the armory.

## 7. What matchmaking does not look at

Verified against `find_game` (`S/ghosts.move:183-223`) and `matchmaker::find_game` (`M/:163-231`), which receive only a player ID, `rating` and `window`:

| Property | Looked at? | Evidence |
| --- | --- | --- |
| Rating | yes | `rating.rating()` (`:208`) |
| Deviation | yes, as the window | `current_deviation(now)` (`:199`) |
| Time waited | yes, by the stored ticket's window | `M/:279-282` |
| Squad size | no | squads are picked after the match (`deploy_squad`, `:346-375`) |
| Recruit ranks, XP, stats | no | `find_game` never reads a recruit |
| Gear tiers and upgrades | no | same |
| Number of living recruits | only `> 0` | `acc.num_recruits() > 0` (`:197`); 1 and 8 are the same |
| Win/loss record, games played | no | `score` is not read |
| Opponent history, side balance, map | no | the waiting player is always side 0; one preset |

A consequence of the order (derived from the code, not run): a squad is chosen after the pairing and, because `Game` is a shared object holding the map and its units, the second side to deploy can read the first side's units on chain; the app's screen shows only "Opponent deployed" (`APP/screens/Match.tsx:192`).

## 8. Clients

App. `useMatchSearch` (`APP/chain/matchmaking.ts:161-222`): "find" sends `find_game` when the account has at least `FREE_RECRUITS` recruits; otherwise it creates the account if missing, sends `hire_recruits`, then `find_game` in one run (`:181-207`). It does not requisition gear. A search is re-read every `POLL_MS` 1_000 (`:39`, `:236`); a seat is accepted as soon as it appears (`:241-247`); the screen moves to `/match` when a game appears (`:253-260`). `cancel` sends `cancel_search` (`:83-90`, `:220`); the app's `SEARCH_TIMEOUT_MS` mirrors the chain's (`:42`). Main menu (`APP/screens/MainMenu.tsx:50-70`): one row "Find Match", which becomes "Resume Match", "Find Match" tagged "suspended Nm" and disabled, or "Cancel Search" with a clock; `{ label: "Leaderboard", tag: "soon", disabled: true }` (`:90`). Rating shows only in the post-match report as "before -> after" (`APP/screens/Match.tsx:463-467`, `:573-580`); no other screen shows rating or deviation (searched `app/src`).

Agent (`packages/agent`, `ghosts-fleet` bin, `package.json:14`). Same queue, same `Account`, rated like any player. The loop (`AG/agent.ts:522-526`): when idle, `setup` (hire, "hires are free: replace the fallen before queueing"), `findGame`, then play and `complete`. It arms every unarmed home recruit with a Standard Rifle and a frag grenade (`AG/sui.ts:382-394`), deploys the first `open` home recruits armed-first (`:406-412`, no rank ordering), cancels its own search after `SEARCH_TIMEOUT_MS` (`agent.ts:301-312`), and `abandon` exists but is never listed as a legal action (`AG/mcp.ts:48-49`). Fleet runs on testnet (`ghosts-fleet init/status/bots/clients/play`, `AG/bin/fleet.ts:8-12`).

# Part B: permadeath in a rated game

Each item is a fact from Part A and its consequence. Nothing here proposes a rule.

## 9. The problem statement

### 9.1 The rating measures the account; strength lives in mortal recruits

Facts. The rating is on the `Account` (`account.move:95`) and the update takes only the two ratings, the two deviations, the result and the time (3.3). The squad is chosen after matching, from up to 4 recruits at home, 1 to 3 deployed (section 6, 7). The recruits' rank, XP and gear are not inputs to the pairing or to the update.

How far squad power can diverge at equal rating (expected damage per shot at the weapon's ideal range, no cover, formulas of mechanics.md 5.1-5.2; computed by a Python script, not run in Move; a Rookie's aim is 65, each promotion adds 2, promotion health as in section 5):

| Attacker | vs unarmored (armor 0, dodge 0) | vs Light (armor 1, dodge 10) | vs Heavy (armor 3, dodge 0) | Own health (Heavy Armor adds 1) |
| --- | --- | --- | --- | --- |
| Rookie, no weapon | no `Attack` action | - | - | 10 |
| Rookie, Standard Rifle | 2.79 | 1.93 | 1.12 | 10 |
| Rookie, Standard Rifle + Superior Scope + Sniper Laser Sight (aim 80, crit 25) | 3.68 | 2.59 | 1.56 | 10 |
| Corporal, Sharpshooter, no upgrades (aim 69) | 3.86 | 2.86 | 1.79 | 11 |
| Lieutenant, Plasma Rifle, no upgrades (aim 73) | 5.26 | 4.07 | 3.07 | 12 |
| Lieutenant, Plasma + Scope + Laser (aim 88, crit 45) | 6.73 | 5.27 | 4.09 | 12 |
| Colonel, Plasma + Scope + Laser (aim 94, crit 45) | 7.19 | 5.63 | 4.37 | 13 |

The third upgrade (stock or clip) does not enter these figures. The spread between a plain armed Rookie and a fully equipped Colonel is 2.6x in damage per shot against an unarmored target and 3.9x against Heavy armor; a Colonel in Heavy Armor has 14 health against a Rookie's 10 (40% more). In shots to deal one unit's health on average: an upgraded Rookie against that Colonel needs about 9 (14 / 1.56); that Colonel against a Light-armored Rookie about 1.8 (10 / 5.63). These are mean-damage ratios, not kill-time simulations (variance, the 1-damage minimum, cover and range are ignored). Squad size multiplies this: a unit attacks once per turn (mechanics.md section 5, an attack sets AP to 0), so 3 units against 1 is 3 attacks a turn, and a side wins only by eliminating every opposing unit. No gear is gated by rank, so a Rookie squad can carry the same rifles, armor and upgrades as a veteran one from its first game; over the same gear, rank adds only the promotion stats (section 5).

Consequence. For two accounts with equal rating, `E = 0.5` in the update whatever they deploy, and the update after the game is the same as after a close game: +/-3 to 10 points at established deviation (3.4). The realized strength gap in a game between equal ratings ranges from none to the table's spread, plus the squad-size multiplier, and none of it is visible to the queue (section 7). The reverse also holds: a rating bought by a veteran squad does not follow the account when the veterans die.

### 9.2 The loss spiral: what a loss removes versus what the rating assumes

What a loss removes. A decided game (`Won`) is over only when the loser has no unit left, so the loser loses every recruit it deployed: 1 to 3 recruits with their XP, rank and gear. A full squad of three Lieutenants is 75 XP: each recruit needs 13 won games with a survival at 2 XP each (section 5), 39 recruit-games in all, against a rating change of -3 to -10 for an established account losing to an equal, -18 to -20 in an upset at RD 60, and -162 to -175 for a newcomer (3.4). A draw by simultaneous elimination removes both squads (`Draw`, `ghosts.move:642`). A stalemate removes only those already killed.

What the winner keeps. The winner keeps its survivors and gains 2 XP each (`experience`, `:593`); the recruits it lost during the game stay lost and their XP with them, so a win can also cost recruits. Nothing in the code scales what the winner earns with what it risked or with the opponent's squad.

What the rating system assumes. Glicko treats a rating as the strength of a player that changes slowly from game to game; the deviation widens only through inactivity. Here the strength is a state that one loss can destroy (all deployed recruits, replaced for free with Rookies of 0 XP, section 6) and that a win raises slowly (2 XP per survivor, 2 to 45 wins per rank in section 5; the first promotion is 2 wins). After the loss the rating has moved by a few points while the squad has dropped by the spread of 9.1; the next pairing draws from the same rating neighbourhood as before. Asymmetry: building is slow and bounded per game, destruction is instant and complete per game. Whether the account's rating then converges to the rating of its current squad rather than its past one is not determined here (depends on how often it deploys a degraded squad and on the pairings; not simulated).

There is no insurance in the code: no roster minimum, no revive, no loss cap per game, no transfer of XP or rank to a replacement (the dog tag keeps rank and looks only).

### 9.3 Incentives the current rules create

(a) Abandoning to save recruits. Cost of abandoning (`S/ghosts.move:287-292`, `complete_game`, section 4): the same rating step as a loss (3.4), the same score entry (a loss), `SUSPENSION_MS` 60_000 ms of not searching, 0 XP for its own survivors, and the opponent receives a win and, if `turn >= 2`, 1 XP per survivor (not 2). Cost of dying instead: if the game is lost by elimination, every deployed recruit and the same rating step. The recruits not yet killed at the time of leaving are kept. So the difference between leaving and playing on to a lost elimination is 60 seconds of suspension against the XP of every surviving recruit (3 XP is 2 won games, 15 XP is 8, 25 XP is 13, 90 XP is 45; section 5). Abandoning is possible in `Deploying` too: the second side to deploy can read the first side's squad on chain (derived, 7), and leaving costs the same rating step and 60 s with zero recruits at risk and 0 XP to the opponent (`turn < 2`). Only a game that ends at a kill cannot be left (it is `Over` at once, `count_losses`; and the killed recruit is already lost, `bury_fallen`, 4 note 2).
Forfeit by going silent costs the same for the leaver, but takes the opponent at least `MAX_MISSED_TURNS` 3 x `TURN_LIMIT_MS` 90_000 = 270 s of waiting (its own turns can be passed at once). Not deploying (`NoShow`) costs the opponent `DEPLOY_LIMIT_MS` 120_000 ms.

(b) Avoiding contact and stalling. Kills come only from attacks and grenades (mechanics.md sections 5-6), and the only other end is `MAX_TURNS` 60 (`ghosts.move:90`, `next_turn` `:477-482`): a draw, no blame, 1 XP per survivor, a rating step towards the opponent's rating (1900 / 60 vs 1500 / 60 drawn: 1892 / 1508, 3.4). A pair of units that stay apart takes no risk and earns more than a loss. Each turn can be ended at once by its side (`next_turn`, `:449-487`), so a stalemate needs 60 transactions, 30 per side, not 60 x 90 s. Whether a side can avoid contact on `black_rain` against a side that wants it was not analysed (mobility 7, spawn distances in mechanics.md 1.4).

(c) Not deploying. `NoShow(P)`: P loses the rating step and 60 s; the recruits stay home (`begin_match`, `:564-571`); the other side earns no XP (`experience`, `:591`).

(d) Sandbagging. `deploy_squad` accepts one unarmed rookie (`:362-363`; section 6); losing deliberately with it costs one free recruit and a loss step, and abandoning at deployment costs a loss step and 60 s with nothing lost. A rating can be lowered at no cost to the real squad (floor 0, `GL/:225`) and the real squad then fielded against the lower-rated pool. Deviation shrinks with games (3.5), so the effect on a seasoned account is a few points per game, on a new account up to 162.

(e) Two-account win trading and XP farming. What the code does against it: `MIN_TURNS_TO_EARN` 2 makes a walkover before turn 2 pay nothing (`:590`); the walkover pays `SURVIVAL_XP` 1 and not the 2 of a win (`:94-97`); `NoShow` and `NobodyShowed` pay nothing; the leaver is suspended 60 s (the constant's comment: "kept short while the game is in testing", `:84-86`). What it does not: (i) a `Stalemate` between two accounts pays 1 XP to every survivor of both sides and a draw, with no one at risk (sets of 60 `next_turn` transactions); (ii) a win by elimination of a throwaway squad pays 2 XP per survivor with no minimum turn count (`experience` checks `MIN_TURNS_TO_EARN` only for walkovers, `:590`), while the throwaway's replacement is free (`hire_recruits`), so two accounts can alternate a one-rookie squad for a three-recruit winner; (iii) alternating walkovers pay 1 XP per survivor (3 for a three-recruit side) per game to the non-leaver and 60 s to the leaver. Per recruit: 45 games at 2 XP, or 90 at 1 XP, to Colonel (section 5). Rating trading is slow: an established account (1500 / 50) gains 5 points for a win against a fresh default account (3.4), and a fresh pair swaps 162 points in the first game. Not determined: how many such games the testnet fleet and players have played.

(f) Free new accounts. `new_account` and `hire_recruits` cost only gas (`account.move:133-162`); every new account is 1500 / 350 with three free Rookies. A lost rating, a lost roster and a 60 s suspension (per Account, `account.move:457`) are all escaped by registering another address. Nothing in the code links accounts.

### 9.4 The new player against the default rating and deviation

A new account is `1500 / 350` (`GL/:68-71`, `:101-103`), window 350 at its first search; it is compatible at once with anything within `350 + window_other`, including an established account at 1500 / 50 (limit 400), whose recruits can be Colonels. Rating swing in the first game: 162 against a default opponent, 175 against an established one that moves 5 (3.4). The window stays above 100 for about 15 games of mirror play (3.5), so the newcomer keeps meeting a wide band of ratings while their rating is still moving most. From the app path a new account gets four unarmed Rookies (`APP/chain/matchmaking.ts:181-207` hires, does not requisition): unarmed units have no `Attack` (mechanics.md 1.5). Whether the Headquarters screen arms them before the first search is outside what I read. Newcomers have 0 XP on every recruit (rank 0) at the start, so the power gap to an established opponent is the table's full spread. Not determined: how many games a typical new player has before they hold recruits of rank 2 or more (depends on survival rate, which no code or run here gives).

### 9.5 What a leaderboard would rank today

The data an Account holds: `rating` (`rating`, `deviation` as stored, `games`, `last_played_ms`) and `score` (`wins`, `losses`, `draws`). Reading it: (i) rating does not decay, only the deviation grows with inactivity, and `deviation()` returns the stored value without that growth (`GL/:125`, `:136-156`), so an inactive account keeps its place and a list needs `current_deviation(now)` to show uncertainty; (ii) the rating of an account is the rating of the account, not of its roster; (iii) a win by walkover, `NoShow` or by a stronger squad counts the same; (iv) abandoning counts as a loss like any other, so a list does not tell who left; (v) there is no per-account count of recruits lost, kills or survivals; the only record of the dead is the dog tags owned by the Account address, which the owner may delete (`throw_away`), so deaths cannot be reconstructed reliably from the chain; (vi) rank and XP are on the recruits and disappear with them. The main menu row exists as "Leaderboard / soon / disabled" (`APP/screens/MainMenu.tsx:90`); no query for it exists in the app (searched).

## 10. Design questions

Neutral; each option family on one line; no recommendation.

1. What is the rated entity: the account, the squad, or the roster?
   Options: account rating as today; a rating attached to a squad or roster composition; separate rated and unrated queues.
2. Should matchmaking consider squad strength, and measured how?
   Options: not at all (rating only, as today); a squad-strength value (ranks, gear, size) entering the window or the bucket; limits on what may be deployed instead of matching on it.
3. Is a recruit lost on every death, in every mode?
   Options: permadeath everywhere, as today; permadeath only in some modes; a death that costs part of the recruit (XP, gear, time) rather than all of it.
4. What should leaving a match cost relative to losing the squad?
   Options: a loss step plus a short suspension, as today; leaving is treated as the loss of the recruits at the time; a leaving penalty that scales (suspension, rating) with what was saved.
5. What should a loss do to the rating when it also destroys a squad?
   Options: the Glicko step on ratings alone, as today; an expectation that includes the squad gap; a smaller or larger step when the squad was outmatched.
6. How should a game nobody wins be rated and rewarded?
   Options: a draw with 1 XP per survivor, as today; no XP or rating for a stalemate; an additional ending condition (not designed here).
7. Which earns progression: survival, winning, or both, and over which minimum play?
   Options: `SURVIVAL_XP` and `WIN_XP` as today, with a minimum only for walkovers; a minimum turn count for every ending; XP tied to the opponent's strength.
8. What does a new account start with, and how easily can it be remade?
   Options: free accounts and a free squad, as today; a cost or limit to registering; a provisional status or separate list until a number of games.
9. What does the ranking list, and does it age?
   Options: rating with its current deviation; a record (wins/losses) with a minimum of games; roster figures (living recruits' ranks, fallen); with or without decay for inactive accounts.
10. Should a side choose its squad before it can see the opponent's?
    Options: whoever deploys second sees the first, as today; a simultaneous or hidden choice; a fixed order.

## 11. Undetermined, and notes on mechanics.md

- Survival rate of recruits per game, time per game, and the number of games played so far: no code or run gives them.
- Whether any game sequence reaches `MIN_DEVIATION` 30 (the mirror run stopped at 50, 3.5); the queue bound is stated for the worst case 30 and could be tighter in play.
- Whether the second side to deploy can read the first side's squad: derived from `Game` being a shared object with the map and its units, not run.
- `glicko` source: the build copy under `move/packages/ghosts/build/...` was read and run; the lock pins rev `a890a52...`, not fetched separately.
- Expected-damage table of 9.1: a Python script over mechanics.md 5.1-5.2, not Move; Move runs were Glicko (3.4, 3.5) and the queue (2.6).
- Contradictions with mechanics.md: none found in the shared facts (constants, XP rows, ending table, hiring). Its header names commit `80498e7`; the working commit here is `812f46c`, whose Move sources match (no Move file changed).
