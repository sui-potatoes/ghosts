# Headquarters

Two sections behind one header (`components/Chrome.tsx`): **Squad** at
`/headquarters` and **Armory** at `/headquarters/armory`. Both read through
`useHeadquarters.tsx` (account, recruits in stable card slots, armory,
transaction runner, gate), so switching costs nothing.

`/headquarters` is the squad on chain: the player's `ghosts::account::Account`
(`move/packages/ghosts`) read and written through `src/chain/ghosts.ts`. It
merges the former local Squad screen and the Barracks: the studio, stats and
character editor from `src/features/squad/components/`, backed by chain data.

## Flow

- **Gates**: package ids unset (`GHOSTS` in `src/constants.ts`), signed out,
  or an account whose records do not decode (a stale package id after a
  Move change). The first read shows only a centred grey spinner — and
  rarely even that: the shell's `SquadPreload` reads the account, recruits
  and armory as soon as a wallet connects, and the screen code is fetched
  while the menu is idle. Portraits are kept across visits.
- **Recruitment**: with nothing on file the screen is the hire deck, four
  large face-down cards. One press opens the account if needed and hires
  every vacancy (`new_account`, then `hire_recruits` — names, looks and
  voices are rolled from the `Registry` presets). The studio is already
  mounted behind the deck and draws each recruit's portrait; cards turn over
  one at a time, left to right, each once its portrait is ready (or after a
  short wait). Vacancies come from the account's own recruit count, never
  from what decoded. Player-facing copy never mentions the chain.
- **Workspace**: roster of cards (vacant slots stay face down and hire on
  click), the 3D stage, and four tabs — Loadout, Stats, Appearance, Dossier.
  Picking a voice in the Dossier auditions it (the same line for every
  voice); Dismiss asks first, then `dismiss_recruit` returns the recruit's
  gear to the armory and frees the slot.

## Armory (`src/screens/Armory.tsx`)

Every weapon and armor the account holds — on the racks or issued — in an
inventory (Weapons / Armor / Mods), a full-size 3D stage and a bench.
`ArmoryView` takes its data as props; `Armory` feeds it from the chain.

- **Weapon bench**: stats side by side (now → with the draft) and a fitting
  grid, one row per attachment type with tiers 1–3. A fit is tier by type, so
  one-per-type holds by construction; three in all is enforced as the draft
  changes ("Slots full"). Chips say fitted / in stock (×n) / mint. The stage
  previews the draft live. **Apply fittings** is one `fittingsTx`: unequip an
  issued rifle, strip, fit from stock, mint what is missing (testnet),
  re-equip.
- **Issue**: hand a rifle or armor to any recruit (`issueTx`: off the current
  carrier, the target's own piece back to the racks, onto the target) or
  return it to the racks. Blocked while fittings are drafted.
- **Mods** (weapon upgrades on chain): stock and where each is fitted; "Try it on" opens a rifle's
  bench with the upgrade drafted.
- **Requisition** (testnet, free): the supply catalog — rifles, armor, all
  twelve mods — previewed on the stage, requisitioned with ＋.

The chain enforces the same rule: `weapon::add_upgrade` takes at most three
upgrades, one of each `kind` (set by the `ghosts::items` mint functions).

Thumbnails come from `equipmentImages.ts`, shared by both sections: a
short-lived studio in an offscreen host (themed via `.squad-screen`) renders
the catalog once, and `src/features/squad/imageStore.ts` keeps it in the
browser until the gear models change. Recruit portraits use the same store
(keyed by look), so a return visit builds only the character on the stage.
Character models are decoded once per session and shared by every 3D view
(`@ghosts/squad/studio/character-assets`); colour and tint edits restyle the
built character instead of rebuilding it. Loading never freezes the screen
for long: a build pauses between its steps (`studio/breather.ts`), textures
decode off the main thread, and a new character or capture compiles its
shaders and uploads its textures step by step before its first frame;
portraits encode asynchronously. Unsaved drafts are kept on the
device, so a reload brings them back still unsaved.

## Writes

`useGhostsAction` runs each change as signed, executed and awaited
transactions, then refreshes every ghosts read; the workspace is `inert`
meanwhile. There is no progress text: every send, wait and refresh counts
as saving (`src/chain/saving.ts`), and the shell's `SaveIndicator` shows a
corner spinner, the way a game saves progress. Known failures (no gas,
cancelled signature, lost connection) read in plain words.

- **Gear moves immediately**: the unit's Loadout tab shows what the recruit
  carries (with its fittings), issues from the racks (a swap is one PTB) and
  returns gear; fitting and requisition live in the Armory.
- **Looks and voice are a draft per recruit**: the character editor, the
  armor finish and the voice edit a draft that saves as one `edit_recruit`
  (the codec's five areas + voice). "Unsaved" compares encodings, so a
  slider nudge below one quantization step is not a change. Names never
  change.
- **Leaving with drafts**: Escape and the header links (Menu, Armory) ask
  Save or Discard. Save sends every changed recruit as one transaction
  (`editRecruitsTx`) and leaves at once; the corner spinner covers it. Any
  other way out (browser back) saves the same way unless Discard was
  chosen; closing or reloading the tab gets the browser's own warning.

## Mapping (`mapping.ts`)

- Looks decode with `@ghosts/squad/appearance/codec`; unset visuals fall back
  to a preset matching the voice.
- Gear maps onto catalog models by the names `ghosts::items` mints. A recruit
  without a weapon object carries the chain's default rifle (`mx4` model).
- Card slots are stable: recruits keep the slot they were first seen in.
- The squad is mirrored into the local roster key so `/demo` plays with it
  (plus the demo's own sidearm and grenade, which the chain does not mint).
