# @ghosts/squad

The squad domain shared by the app's Squad screen and the encounter engine:
the roster and its equipment, operative stats, and the character pipeline that
turns a recruit into a rigged, dressed, animated three.js character. No React,
no storage, no app imports.

- `model.ts`, `catalog.ts`, `types.ts`: pure roster and equipment domain. Stock
  is total owned; availability subtracts assignments; swaps return the previous
  item; callsigns are unique. `restoreSquad` validates untrusted saved data and
  `savedRecruits(raw)` reads a saved roster or returns null.
  `SQUAD_STORAGE_KEY` names the save; reading and writing it is the host's job.
- `armor-colors.ts`: the armor palette and its validation.
- `stats.ts`: mirror of `commander::stats` with the `commander::items` presets
  by catalog id.
- `appearance/`: the MPFB editor's normalization, randomization and cosmetic
  geometry/shader helpers (`schema.ts`: the 51 facial controls).
- `studio/`: the shared character builder (`character-assets.ts`), armor
  materials, held equipment and the one sidearm model, and the Squad screen's
  recruit studio.
- `motion/`: the 38-action catalog, compressed clip loading, rig conversion,
  boot contact, clearance and weapon carry; `MotionPlayer` has no combat state.

Modules are imported by path, `@ghosts/squad/model`, `@ghosts/squad/studio/sidearm`;
`package.json` lists every one. Assets load from the host at `${BASE_URL}squad/`
(the app serves `app/public/squad/`).

`pnpm test` here checks the roster model, stats packing and face randomization.
The app's `test:motion` and `test:equipment` check this pipeline against the
shipped assets.
