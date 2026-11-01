# Headquarters

Two sections behind one header (`components/Chrome.tsx`): **Squad** at
`/headquarters` and **Armory** at `/headquarters/armory`. Both read through
`useHeadquarters.tsx` (account, recruits in stable card slots, armory,
transaction runner, gate), so switching costs nothing.

`/headquarters` is the squad on chain: the player's `ghosts::ghosts::Account`
(`move/packages/ghosts`) read and written through `src/chain/ghosts.ts`. It
merges the former local Squad screen and the Barracks: the studio, stats and
character editor from `src/features/squad/components/`, backed by chain data.

## Flow

- **Gates**: package ids unset (`GHOSTS` in `src/constants.ts`), signed out,
  reading, or an account whose records do not decode (a stale package id
  after a Move change).
- **Recruitment**: with nothing on file the screen is the hire deck, four
  face-down cards. One press opens the account if needed and hires every
  vacancy (`new_account`, then `hire_recruits` — names, looks and voices are
  rolled on chain from the `Registry` presets). Cards turn over as the
  recruits arrive; the studio is already mounted behind the deck, so
  portraits develop on the cards. Vacancies come from the account's own
  recruit count, never from what decoded.
- **Workspace**: roster of cards (vacant slots stay face down and hire on
  click), the 3D stage, and four tabs — Loadout, Stats, Appearance, Dossier.

## Armory (`src/screens/Armory.tsx`)

Every weapon and armor the account holds — on the racks or issued — in an
inventory (Weapons / Armor / Upgrades), a full-size 3D stage and a bench.
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
- **Upgrades**: stock and where each is fitted; "Try it on" opens a rifle's
  bench with the upgrade drafted.
- **Requisition** (testnet, free): the supply catalog — rifles, armor, all
  twelve upgrades — previewed on the stage, minted with ＋.

The chain enforces the same rule: `weapon::add_upgrade` takes at most three
upgrades, one of each `kind` (set by the `ghosts::items` mint functions).

Thumbnails come from `equipmentImages.ts`: a short-lived studio in an
offscreen host (themed via `.squad-screen`) renders the catalog once per
session.

## Writes

`useGhostsAction` runs each change as signed, executed and awaited
transactions, then refreshes every ghosts read; `TxOverlay` shows the step
and the workspace is `inert` meanwhile.

- **Gear moves immediately**: the unit's Loadout tab shows what the recruit
  carries (with its fittings), issues from the racks (a swap is one PTB) and
  returns gear; fitting and requisition live in the Armory.
- **Looks and voice are a draft per recruit**: the character editor, the
  armor finish and the voice edit a draft that saves as one `edit_recruit`
  (the codec's five areas + voice). "Unsaved" compares encodings, so a
  slider nudge below one quantization step is not a change. Names never
  change.

## Mapping (`mapping.ts`)

- Looks decode with `@ghosts/squad/appearance/codec`; unset visuals fall back
  to a preset matching the voice.
- Gear maps onto catalog models by the names `ghosts::items` mints. A recruit
  without a weapon object carries the chain's default rifle (`mx4` model).
- Card slots are stable: recruits keep the slot they were first seen in.
- The squad is mirrored into the local roster key so `/demo` plays with it
  (plus the demo's own sidearm and grenade, which the chain does not mint).
