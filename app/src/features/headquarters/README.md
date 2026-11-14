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

## Armory in the shared interface language (`armory/`)

`/headquarters/armory` is `src/screens/Armory.tsx` feeding `armory/ArmoryView.tsx`
(`ArmoryData` / `ArmoryOps` in `armory/types.ts`, so fixtures can drive it). Both
sections draw the same frame (`frame.tsx`: breadcrumb with the Squad · Armory
switch, the command bar with a failed write on its amber line, the match chip,
the gates), so they read as one screen.

- Tabs Weapons / Armor / Mods / Utilities; the list holds what the account has,
  carried first (the carrier's first name as the row's tag), with Requisition
  at its foot: the supply catalog in the same list, free, into storage.
- The stage (`armory/GearCanvas.tsx` + `gear-stage.ts`, shared with `/ui-sample`):
  rifles with their fitted or drafted mods, laser trace and finish; mods on a
  rifle; the frag grenade. Armor is worn on the game's existing sets by its
  carrier, by the recruit the issue picker points at, or the first recruit.
- Bench: stats (the delta is the mods, or the draft while drafting), four mod
  slots each opening a picker of tiers (fitted, ×n in storage, or requisitioned
  free on Apply), the draft's Fitted / Draft / Off lines, Apply (one
  `fittingsTx`) and Discard, Finish (a grid of the gun's skins, kept on the
  device), and Carried by → Issue (a recruit picker: Issue or Swap; the one
  utility slot swaps in one transaction) or Return.
- Mods tab: storage count and where each is fitted; Try on drafts it on a rifle
  and opens that rifle's bench.
- `?item=<object id>` opens the item's tab with it selected.
- Pure rules in `armory/rules.ts`, tested in `tests/hq-armory.test.ts`.
- Leaving or switching to Squad with drafted mods asks: Apply / Discard / Keep fitting.

## Armory classic (`src/screens/ArmoryClassic.tsx`)

The screen before the shared language, at `/headquarters/armory-classic` until
the new one is signed off. Every weapon and armor the account holds — on the racks or issued — in an
inventory (Weapons / Armor / Mods), a full-size 3D stage and a bench.
`ArmoryView` takes its data as props; `Armory` feeds it from the chain.

- **Weapon bench**: stats in the Stats tab's look (`StatLine`: bar, total, and
  the delta fitted mods add or take, with a tooltip per mod), a "draft → value"
  line and striped bar segment for what the draft would change, a per-mod list
  (fitted / draft / off, with each mod's signed modifiers) and a fitting
  grid. Numbers come from the decoded objects (`weaponView` in `armory.ts`,
  maths in `fittings.ts`): the chain's `Weapon.stats` already include fitted
  upgrades, so the base is that total minus their modifiers (the catalog preset
  wins where flooring made that ambiguous); drafted mods use their catalog
  modifier. Armor shows its modifiers on a standard recruit the same way,
  nerfs in amber. Mod and supply entries list their modifiers too.
  The fitting grid is one row per attachment type with tiers 1–3. A fit is tier by type, so
  one-per-type holds by construction; three in all is enforced as the draft
  changes ("Slots full"). Chips say fitted / in stock (×n) / mint. The stage
  previews the draft live. **Apply fittings** is one `fittingsTx`: take the
  rifle off its carrier or out of the racks, strip, fit from stock, mint what
  is missing (testnet), put it back.
- **Issue**: hand a rifle or armor to any recruit (`issueTx`: off the current
  carrier or out of the racks, onto the target, whose own piece goes back to
  the racks) or
  return it to the racks. Blocked while fittings are drafted.
- **Utilities** (`utilities.ts`): what the account holds and who carries it, with
  the actions each grants and its uses per match, read from the decoded object;
  copy from `packages/catalog`. Issue and return like armor; a full slot
  (`MAX_UTILITIES`) shows "Swap for …" and the swap runs as ordered steps.
  The Frag Grenade shows on the stage (`utilityModel` in `mapping.ts` names its
  catalog model, `@ghosts/squad/studio/armory-utilities` builds it once, shared
  by reference count like the rifles; the stage frames it by its own bounds and
  scales the zoom limits to it). The band is plain: the builder only exports
  where the stencils go. A utility without a model shows a short placeholder.
- **Finish** (weapon skins, device only): Factory plus the gun's baked skins
  (`@ghosts/squad/weapon-skins`; only the Standard Rifle has any yet), applied
  to the stage at once and remembered per weapon object id in localStorage
  (`skins.ts`, key `ghosts:weapon-skins`). The skinned model is the gun's game
  mesh from `public/squad/weapons/skins/` (`@ghosts/squad/studio/armory-skins`),
  fetched the first time a skin is shown; upgraded clips and stocks, scopes and
  lasers stay in their own finish. Nothing about a skin is on chain.
- **Mods** (weapon upgrades on chain): stock and where each is fitted; "Try it on" opens a rifle's
  bench with the upgrade drafted.
- **Requisition** (testnet, free): the supply catalog — rifles, armor, all
  twelve mods — previewed on the stage, requisitioned with ＋.

The chain enforces the same rule: `weapon::add_upgrade` takes at most three
upgrades, one of each `kind` (set by the `ghosts::items` mint functions).

Thumbnails come from `equipmentImages.ts`, shared by both sections:
`gear-thumbnails.ts` draws the catalog once under product lighting, on a
transparent background that the row's lifted plate shows through (rows with a
thumbnail stand as tall as a roster row), and `src/features/squad/imageStore.ts` keeps it in the
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

## Squad in the shared interface language (`squad/`)

`/headquarters` is `src/screens/Headquarters.tsx` feeding `squad/HeadquartersView.tsx`
(FocusRoot + ScreenFrame, see `src/ui/README.md`); the screen above survives as
`/headquarters-classic` (`HeadquartersClassic.tsx`) until the new one is signed off.
The view takes `HqData` and `HqOps` (`squad/types.ts`), so fixtures can drive it;
the screen maps every op onto the same transaction builders as before.

- Pieces shared with `/ui-sample`: `AppearanceEditor`, `CharacterCanvas` (+ the
  stage's Wireframe action), `parts.tsx` (portrait with rank insignia, rank and
  XP, the stat block, "if issued" lines, the off-screen portrait host), `ranks.ts`.
- Pure rules, tested in `tests/hq-squad.test.ts`: `drafts.ts` (unsaved looks per
  recruit, kept on the device under the classic key) and `rules.ts` (issue or
  swap, the free top-up to four, the dismissal note).
- A recruit without a weapon object is shown unarmed (no attack in the field,
  `unit::from_recruit`); the demo mirror keeps its own default rifle.
- An owned weapon with a fitted upgrade is named with a trailing " +"
  (`weaponName` in `rules.ts`) wherever it is listed; drafts and catalog
  entries never take it.
- Appearance styles (hair, brows, skin texture, tattoo) are steppers; only the
  starting identity, which rewrites the face, is a grid.
- Every slot is symmetric: Remove (Reset) on a filled slot and a None row at the
  top of its picker send the item back to the armory.
