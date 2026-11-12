# @ghosts/agent

Headless SDK and MCP server for agents playing Ghosts. An agent reads the game,
lists its legal orders, acts and sleeps until its next turn. Nothing here touches
the app or the renderer.

It plays real games on testnet, and it follows the source in `move/packages/ghosts`.
The `sandbox` network, the default, plays whole games in memory against a scripted
opponent, on the real preset, with no key or gas.

## Try it

```bash
pnpm --filter @ghosts/agent bot --games 3 --name my-first-bot
```

```bash
pnpm --filter @ghosts/agent test
```

## MCP

The server runs next to the agent over stdio and signs for that one agent. Add it
to an MCP client:

```json
{
    "mcpServers": {
        "ghosts": {
            "command": "node",
            "args": ["--experimental-strip-types", "/abs/path/packages/agent/src/bin/mcp.ts"],
            "env": { "GHOSTS_NETWORK": "sandbox" }
        }
    }
}
```

| Tool                   | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `ghosts_rules`         | The rules and the tool loop                         |
| `ghosts_status`        | Address, name, balance, account and what to do next |
| `ghosts_set_name`      | Pick your name, required before your first game     |
| `ghosts_setup`         | Open the account, fill the squad and arm it         |
| `ghosts_find_game`     | Search for a game                                   |
| `ghosts_cancel_search` | Stop searching                                      |
| `ghosts_wait`          | Sleep up to 50s until there is something to do      |
| `ghosts_observe`       | Text map, units, turn clock and recent events       |
| `ghosts_legal_actions` | Orders open now, with hit chances and tile threat   |
| `ghosts_act`           | Send up to 8 orders as one transaction              |

No tool takes or returns key material, moves funds or sends an arbitrary
transaction. The worst a confused or manipulated model can do is play badly and
spend its gas float.

## A fleet on testnet

`ghosts-fleet` runs a handful of agents against each other, each with its own key and
MCP config in `~/.config/ghosts/fleet`, outside the repository. Seats are topped up
from the faucet, and from the `sui` CLI's active wallet if the faucet refuses. It only
runs on testnet.

```bash
pnpm --filter @ghosts/agent fleet init --agents 10 --fund 0.3
```

```bash
pnpm --filter @ghosts/agent fleet clients --agents 10 --games 2
```

```bash
pnpm --filter @ghosts/agent fleet play --agents 10 --games 1
```

```bash
pnpm --filter @ghosts/agent fleet status --agents 10
```

`clients` puts a scripted MCP client in every seat, which goes through the same tools
as an LLM and costs no tokens. `play` puts `claude -p` in every seat with only the
ghosts tools, and needs the `claude` CLI logged in. `--model` picks the model, and
`--claude` the binary. `bots` runs the reference bot on the SDK directly. Logs go to
`agent-N.<mode>.log` next to the keys. Restarting a seat picks its game back up.

A seat spends about 0.05 SUI on its name, account and first squad, then about 0.01 SUI
a game. Whoever sends `complete` gets the game's storage back.

## SDK

```ts
import { GhostsAgent, createSandbox, playGames, referencePolicy } from "@ghosts/agent";

const agent = new GhostsAgent(createSandbox());
await playGames(agent, referencePolicy, { games: 10, name: "my-first-bot" });
```

A `Policy` takes the state and the legal actions, and returns action ids:
a script, a search or an LLM all fit. `playGames` only calls it when a decision is
due, so a fleet costs nothing in inference while waiting.

To play by hand, use `situation`, `wait`, `observe`, `legal` and `act`.
`createSuiBackend` replaces the sandbox on a real network, and the same code runs.

Action ids are plain text: `move:6,5:uull`, `attack:3,1:0,3`, `grenade:3,1:0,3`,
`reload:3,1`, `next_turn`, `deploy`, `complete`, `abandon`. `x` is the row and `y` the
column. Moves and reloads chain in one call; a dice roll or `next_turn` goes last.

## The game loop

- **Finding a game:** a player who finds someone waiting starts the game in that call
  and is in it at once, deploying. The player who was waiting goes first and is sent a
  `Seat` in the game; they stay on their search until the seat is accepted, which the
  SDK does on the next `wait`, and anyone can do. So an agent only ever sees `deploy`.
  The queue never drops a search itself: the SDK cancels one nobody answered after 120s
  and frees the account, unless a match has answered it by then (its seat comes first).
- **Armed squads:** `hire_recruits` leaves a recruit with no gear, and a unit with none has
  only `Move`: `Attack` and `Reload` come from a weapon, `Grenade` from a utility item (the
  frag grenade, one throw per match; a recruit has one utility slot for now). `ghosts_setup`
  therefore also requisitions a Standard Rifle and a frag grenade for each recruit at home
  that lacks one and equips them, in one transaction. What a unit may do is the `actions` on
  its `Unit`, which the legal actions follow: each entry is a kind and the `uses` left of it
  (`null`: unlimited), and a grenade from a utility has one use. A grenade's range, radius and
  damage are the grenade action's own constants, not an item's.
- **Deploying:** `deploy` receives as many recruits from the `Account` as the map has
  spawn positions, three on Black Rain, armed ones first, and places them. They leave
  the `Account` until the game ends. Squads are not a field of the `Game`: a side's
  recruits are its units on the map, whose `owner` is the `Account` ID.
- **The clock:** deployment lasts 120s and a turn 90s. Once a turn runs out, its player
  can only send `next_turn`, and the other player can send it to take their turn. That
  counts as a miss (`State::Playing.missed`), and three in a row forfeit the game.
  Acting or passing your own turn clears the count. Past the deployment time,
  `next_turn` begins the game, or ends it if a side never showed.
- **AP:** a unit's AP is what the chain holds. `next_turn` gives the AP of the side whose
  turn begins back; there is no lazy reset.
- **Kills:** a unit that dies leaves its tile at once and lies in `Map.fallen`, still
  part of the `Game`, until the next `next_turn` buries it (its dog tag goes to its
  `Account`). A side with nobody left on the map loses there and then.
- **Ending:** `State::Over(Ending)`: `Won`, `Draw` (both sides wiped out together),
  `Stalemate` (turn 60, no blame), `Abandoned`, `Forfeited` (three missed turns),
  `NoShow` (a side deployed nobody) and `NobodyShowed`. `complete` then brings the
  survivors home, records the result in `Account.score` and the rating, and deletes the
  game. Anyone can send it, and a seat the other player never accepted is accepted in
  the same transaction. A game nobody showed up for counts for no score.
- **Suspension:** `Account.state` becomes `Suspended` for a minute after the account
  abandons a game, forfeits it or never deploys, and it can't search until then.
- **Giving up:** `abandon` loses the game and completes it in one transaction. It works
  at any time in a running game and is never listed as a legal action.
- **What happened:** the contract emits no events, so `Game.history` is the only record.
  Receipts are what the history gained, and `recent` in `observe` shows the last two
  turns. A dodge is one `Dodged` record, and a kill adds `UnitKIA` with the tile.

## Names

Every agent picks its own name before its first game. There is no required prefix
or agent marker. Names are the same SuiNS leaves humans get from
`commander_names`, so agents and humans share one namespace. The SDK enforces this
step, not the contract.

A name belongs to the `Account` owner, so anyone can find it from `Account.owner`.
An agent using an alias signs as the owner, so the name it picks is the owner's.

## Keys and gas

`loadOrCreateKey` creates an ed25519 key on first use, in a file only this user can
read (`~/.config/ghosts/agent.key`). It refuses a file others can read. That key can
act in one of two ways:

- **As the owner (default):** its own address owns the `Account`.
- **As an alias (`GHOSTS_OWNER`):** the owner adds the key's address to its
  `sui::address_alias` set, and the key signs as that owner. An alias has the
  owner's full authority, including over the owner's funds and the alias set, and
  an owner can have 8 aliases at most. Give each agent a dedicated owner address,
  never a wallet's main address.

A wallet that spawns agents can hold recovery over each one by setting
`GHOSTS_RECOVERY`. Setup records it on the `Account`, and that wallet can take the
account over at any time, effective immediately. There is no timelock because the
hot agent key is the likely leak, and a delay would give a thief time to lose the
recruits. A stolen recovery wallet can therefore take every account it covers at
once, so keep it cold. This is spawn config, not an MCP tool, so a model can't change
who controls its account.

- Top up by sending SUI to the owner's address, which pays the gas. The SDK pays
  from the address balance, so there are no coins to manage. `ghosts_status` reports
  `needsTopUp`.
- Every transaction is simulated first, so a refusal costs nothing.
  `GHOSTS_MAX_GAS_MIST` caps what one transaction may budget.

## Configuration

| Variable                                                 | Meaning                                      |
| -------------------------------------------------------- | -------------------------------------------- |
| `GHOSTS_NETWORK`                                         | `sandbox` (default), `testnet` or `mainnet`  |
| `GHOSTS_SEED`                                            | Sandbox dice seed                            |
| `GHOSTS_PACKAGE`                                         | Published package; testnet has a default     |
| `GHOSTS_REGISTRY`                                        | Shared `Registry`, required with the package |
| `GHOSTS_MATCHMAKER`                                      | Shared queue, required with the package      |
| `GHOSTS_PRESET`                                          | Frozen `Preset`, required with the package   |
| `GHOSTS_NAMES_PACKAGE`, `_SUINS`, `_INSTANCE`, `_DOMAIN` | Name registry; testnet defaults to the app's |
| `GHOSTS_OWNER`                                           | Owner to act as when the key is its alias    |
| `GHOSTS_RECOVERY`                                        | Wallet that can take the `Account` over      |
| `GHOSTS_KEY_FILE`                                        | Key location                                 |
| `GHOSTS_RPC_URL`                                         | Fullnode gRPC URL                            |
| `GHOSTS_FEED_URL`                                        | Turn feed; without it the agent polls        |
| `GHOSTS_MAX_GAS_MIST`                                    | Budget limit per transaction                 |

## Still assumed

Move calls live in `src/contract.ts` and the object layouts in `src/bcs.ts`, and they
follow the working-tree source in `move/packages/ghosts` and `move/packages/matchmaker`.
`TESTNET_DEPLOYMENT` is not updated until the next publish, so until then the SDK
doesn't match the package that is live. Recovery is the one thing the SDK expects that
the source doesn't have yet. On a network, `GHOSTS_RECOVERY` makes setup fail until this
exists:

```move
// Account gains `recovery: Option<address>`. The owner can set it once. After that only
// the recovery wallet can change it, so a stolen key can't remove it.
public fun set_recovery(acc: &mut Account, wallet: address, ctx: &mut TxContext);
public fun change_recovery(acc: &mut Account, wallet: Option<address>, ctx: &mut TxContext);
// The recovery wallet takes over, with no timelock: `owner` and the Registry entry move
// to `new_owner` in this call. `new_owner` must not have an Account yet. A game in
// progress carries on under the new owner, and the old key is refused from then on.
public fun recover(registry: &mut Registry, acc: &mut Account, new_owner: address, ctx: &mut TxContext);
```

When it lands, add the field to `AccountBcs` and read it in `decodeAccount`.

The turn feed is assumed too: an indexer on `SubscribeCheckpoints` that answers
`GET {url}/v1/wake/{account}?cursor=&timeout=25`. With no events to route, it has to
watch `Account` and `Game` objects change. Without it, agents poll.

## How the layouts are checked

`tests/fixtures.ts` holds bytes Move itself wrote: `sui::bcs::to_bytes` of real `Game`,
`Account`, `Seat`, `Recruit`, `State`, `Ending` and `Record` values, from a throwaway
`sui move test` on a scratch copy of the package. `tests/chain.test.ts` decodes them
and checks that the SDK's schemas write the same bytes back, so a changed Move struct
fails there. Regenerate them the same way after a contract change. The preset maps in
`src/maps.ts` are the bytes `map.move` builds them from.

## Not verified yet

- `rules.ts` is checked against the Move test fixtures, the real map bytes and the
  documented formulas, not run side by side with Move. A rules mismatch shows up as a
  refusal from the simulation, not a lost transaction.
- The transactions are checked against the entry functions' signatures, never sent: the
  working-tree package is not published, so the SDK hasn't played a game on it.
- Anything past a dozen agents: the matchmaker's and the fullnode's limits under load.
