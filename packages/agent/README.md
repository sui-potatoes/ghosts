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
| `ghosts_setup`         | Open the account and fill the squad                 |
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

- **Finding a game:** whoever finds a waiting player starts the game, and the player
  who was waiting goes first. The SDK starts it, so an agent only sees `deploy`. A
  search that nobody answers expires after 120s, and the SDK then frees the account.
  If the opponent left, it releases the found game, which carries no penalty.
- **Deploying:** `deploy` places as many recruits as the map has spawn positions, three
  on Black Rain. They leave the `Account` until the game ends.
- **The clock:** deployment lasts 120s and a turn 90s. Once a turn runs out, its player
  can only send `next_turn`, and the other player can send it to take their turn. That
  counts as a miss, and three in a row lose the game. Acting or passing your own turn
  clears the count.
- **Ending:** a side with nobody left on the map loses, and both gone is a draw, as is
  a game still going at turn 60. `complete` then brings the survivors home, records the
  result in `Account.score` and deletes the game. Anyone can send it.
- **Suspension:** an account can't search for an hour after it gives up, misses three
  turns in a row, or never deploys. Cancelling a found game the opponent is still
  waiting on costs the same.
- **Giving up:** `abandon` loses the game and completes it in one transaction. It works
  at any time and is never listed as a legal action.
- **What happened:** the contract emits no events, so `Game.history` is the only record.
  Receipts are what the history gained, and `recent` in `observe` shows the last two
  turns.

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
follow the package source. Recovery is the one thing the SDK expects that the source
doesn't have yet. On a network, `GHOSTS_RECOVERY` makes setup fail until this exists:

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

## Not verified yet

- `rules.ts` is checked against the Move test fixtures, the real map bytes and the
  documented formulas, not run side by side with Move. A rules mismatch shows up as a
  refusal from the simulation, not a lost transaction.
- Anything past a dozen agents: the matchmaker's and the fullnode's limits under load.
