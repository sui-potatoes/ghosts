# src/chain

The app's Sui access layer: everything that reads from or writes to the chain
goes through here. The wallet/sign-in stack stays in `src/sui.ts`; this folder
is what the screens and the future encounter driver import.

## Today

- `executor.ts` — `useTransactionExecutor()`: a `SerialTransactionExecutor`
  over the connected account with measured (simulated) gas budgets, for rapid
  sequential transactions — one combat order after another. Ported from the
  Sui Potatoes `app`.
- `objects.ts` — `useBcsObject` / `useOwnedBcsObjects`: object reads decoded
  straight from BCS content with a schema, returned with their
  `objectId`/`version`/`digest` so the next transaction can reference them.
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

## When the ghosts Move package lands

- `bcs.ts` — the BCS schemas mirroring the on-chain types (the shape of
  `potatoes/app/src/apps/commander/types/bcs.ts`), plus the mapping from
  decoded objects and transaction events to `@ghosts/engine` types.
- `driver.ts` — an `EncounterDriver` (`@ghosts/engine`): `resolve(command)`
  builds the Move call for an order, simulates it (`client.core.simulateTransaction`)
  to surface a refusal before signing, executes it through
  `useTransactionExecutor`, decodes the resulting events into `GameEvent`s and
  `ingest`s them into the rules. The engine plays whatever comes back; it
  never rolls dice for a chain-driven encounter. Passed to
  `<Encounter driver={...}>`.
- Package ids and shared-object ids join `src/constants.ts` per network.
