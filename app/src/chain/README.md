# src/chain

The app's Sui access layer: everything that reads from or writes to the chain
goes through here. The wallet/sign-in stack stays in `src/sui.ts`; this folder
is what the screens and the future encounter driver import.

## Today

- `objects.ts` — `useBcsObject`: object reads decoded
  straight from BCS content with a schema, returned with their
  `objectId`/`version`/`digest` so the next transaction can reference them.
  `useBcsObject` reads the alias set today. It notes the newest version of each object
  seen: a read from a node a moment behind keeps what is on screen, and
  `absorbWrites` puts what a write left into the reads without one.
- `sender.tsx` — the one sign-and-send path: `<TransactionSender />` (mounted
  once in the shell) serves `sendTransaction(tx)`, callable from anywhere
  without React context; it returns `null` while signed out
  (`canSendTransactions` tells beforehand) so on-chain work stays optional.
  Every transaction sends AS the connected account and signs with the
  device's session key whenever one is authorized in the on-chain alias set
  (`alias.ts` answers, cached half a minute) — no passkey ceremony — falling
  back to the wallet otherwise. `{ passkey: true }` forces the wallet: all
  session management does, so a session key cannot mint or remove sessions.
  Sends are serialized behind one queue (gas-coin equivocation).
- `session-key.ts` — this device's ephemeral ed25519 key: a NON-EXTRACTABLE
  WebCrypto `CryptoKey` in IndexedDB (its bytes never exist in JavaScript, so
  a compromised page can use it while open but never steal it; no export or
  backup path exists). `SessionSigner` signs Sui transactions with it. Keys
  live `SESSION_TTL_MS` (7 days) from creation: past that, the key signs its
  own alias `remove` — dropping authority is the one management action a
  session may sign — and is wiped once the alias is gone (`expireSessionKey`,
  swept on connect and in the panel). Renewal is the ordinary auto-authorize.
- `alias.ts` — the `sui::address_alias` plumbing: the owner's derived
  `AddressAliases` object id, the party-owned (shared-style, consensus
  `startVersion`) transaction reference it needs, and `activeSessionSigner`,
  the question the sender asks before every transaction.
- `sessions.tsx` — device sessions over `sui::address_alias`: one
  passkey-signed transaction adds the session key's address to the owner's
  on-chain `AddressAliases` set, after which the sender signs everything
  with it. `useSessionRows` feeds the settings Account panel: every
  authorized key with its last action (attributed from recent transactions
  by the public key inside each signature, so stale sessions read as old on
  any device) and one-confirm termination. The owner's own entry is never
  offered for removal.
- `names.tsx` — the player name on chain, through the `commander-names`
  instance holding `demo.ghosts.sui` (ids in `src/constants.ts`).
  `useSubmitNameChange` turns a committed rename into one transaction shaped
  by the registry state — take back an own earlier leaf, `rename` the current
  one, or `register` the first — always ending in `set_default`; the dialog
  waits on it and the local copy is written only once the chain accepted.
  `useAssignedName` reads the default name back as the cross-device source of
  truth for `usePlayerName`.

- `bcs.ts` — the BCS schemas mirroring the on-chain types of the ghosts Move
  package (`Registry`, `Account`, `Recruit` with its `Metadata`/`Visuals`,
  gear and the table wrapper). Field order mirrors the Move structs.
- `ghosts.ts` — the ghosts package frontend behind Headquarters: the
  `Registry` and the player's `Account` id (a derived dynamic-field read of
  `Registry.accounts`), the recruits, armory and upgrade stock sent to the account (listed
  as objects it owns, re-listed until the recruits match the account's count
  and no object is older than one already seen, or than where it has gone
  since), and the transactions — account, hire, `edit_recruit` with the
  appearance codec's five areas, unequip, `issueTx` (hand gear from carrier
  to recruit in one PTB), `fittingsTx` (bring a rifle to a whole draft of
  fittings in one PTB — take it out, strip into the stock, fit from the stock
  by id, requisition the missing, put it back),
  testnet requisition. A recruit is changed between `borrow_recruit` and
  `return_recruit`, once per PTB; recruits and gear go in by id alone, and the
  fast lane passes each by the newest reference this client has seen — from a
  read or its own effects — as a `Receiving` input. `useGhostsAction` sends
  each step on the fast lane and reads what it wrote straight into the reads on
  screen: the objects `useBcsObject` holds, and what the account holds,
  changed, dropped, or new by its owner and type. Only a step with another after it is waited
  for, as that one may read the chain. About 0.7s a write against 3.6–4.5s
  when every read was refreshed afterwards. Ids live in `GHOSTS`
  (`src/constants.ts`); `ghostsEnabled` gates every consumer.
- `matchmaking.ts` — Find Match over `ghosts::find_game`, `accept_seat` and
  `cancel_search`. Players are their `Account` IDs throughout; the owner address
  only authorizes. Whoever finds someone waiting starts the game in the same
  transaction and is `Playing` it. The player who waited can't be in that
  transaction (nobody knows their `Account` beforehand), so they are sent a
  `Seat` to their `Account` ID, from the match until it is accepted: accepting
  puts them in the game, and nothing in it happens before. Their client accepts
  as soon as the seat shows up, their one transaction; anyone can accept, so
  wrapping up a game (`completeGameTx`, `abandonGameTx`) accepts a seat its
  player never did, which also hands the storage back. The queue never drops a
  search itself, so a `Searching` `Account` is either queued (it can cancel) or
  has its seat waiting. State is `Account.state` (`Idle`, `Searching`,
  `Playing`, `Suspended`) and that seat; there are no events to follow. `useCurrentGame`
  answers which game the player is in, by either; `useMatchSearch` reads it and
  sends the player's transactions; `useMatchmakingDriver` (called once, by the
  shell's `MatchStatus`) polls the `Account` and its seat while it waits, accepts
  the seat, and opens `/match` when a game starts.
- `game.ts` — a game on chain: reading it, and the transactions for every action
  a player can take, each authorized by their `Account`. A finished game is
  deleted by `complete_game`, so its last read is all there is to show the result.
- `fast-lane.ts` — how the game's writes go out, through `sendOrder`: every
  input resolved up front (the gas coin tracked from each order's effects, a
  fixed budget; `GameRefs` for orders, and for any other transaction shared and
  frozen objects and Move signatures looked up once a session, as they never
  change), so a write is one network call, and what it wrote comes back in the
  response, so nothing is waited for or read afterwards. About 0.7s against
  1.6s the ordinary way. A write the chain refuses is charged its gas, as
  nothing simulates it first. Session management and names send the ordinary
  way (`sendTransaction`), in the same line.
- `match-rules.ts` — the same questions the contract answers (whose turn, is it
  over, the odds of a shot, the cover, the line of sight, where a unit can stand,
  what a finished game pays),
  and `Game.history` read as engine events. Pure, tested on its own. The driver
  hands these to the engine as `Encounter.authority`, so the odds on screen and the
  paths on offer are the contract's. The line and cover functions were compared
  with the contract on every tile pair of Black Rain; a new map deserves the same.
- `driver.ts` — the `EncounterDriver` of a match. What the rules can work out
  plays at once and settles behind the scene: moves, reloads, ending a turn. Shots
  and grenades go out at once too, and the scene starts on them; only what the dice
  decide waits for the answer. If the chain refuses something already played, the
  queue behind it is dropped and the field walks back to what is true. The
  opponent's turn is `Game.history`, polled. Imported by `screens/Match.tsx` only,
  as it brings the engine.
