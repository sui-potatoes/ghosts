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
  materials, held equipment and shared weapon models, and the Squad screen's
  recruit studio.
- `motion/`: the 38-action catalog, compressed clip loading, rig conversion,
  boot contact, clearance and weapon carry; `MotionPlayer` has no combat state.

Modules are imported by path, `@ghosts/squad/model`, `@ghosts/squad/studio/sidearm`;
`package.json` lists every one. Assets load from the host at `${BASE_URL}squad/`
(the app serves `app/public/squad/`).

`pnpm test` here checks the roster model, stats packing and face randomization.
The app's `test:motion` and `test:equipment` check this pipeline against the
shipped assets.

Eyewear arms sample both sides of the morphed head and keep tube-radius clearance
through the temples and ear transition. Fitting happens once when appearance
changes, with no frame-time raycasts. The eyewear tests check all styles against
both native heads and widened head geometry.

Spectre uses rigid segmented dorsal and chest plates and regular deltoid shells,
with flexible carrier webbing. Its four material batches include embedded 128px
weave and ceramic normal maps plus authored seals, fasteners and cooling slots.
Rebuild with `GEAR_VARIANT=spectre blender --background --python
app/scripts/build-field-kit.py`, then pack both sexes with
`node app/scripts/pack-field-kit.mjs <gltf-transform-tools-directory> spectre`.
All four armor sets and the base kit are checked for deformation through every
one of the 38 poses on both body types. The base kit uses three material
batches, embedded leather/webbing normals, and hip-bound pouch assemblies whose
flaps, closures and stitching follow the pouch orientation. Build and pack with
`field-kit` in place of `spectre` above.

`studio/long-guns.ts` authors MX-4 and SRS-9 in the shared native weapon socket.
Each model is merged into five finish batches (5,120 / 8,524 triangles). The
precision optic has two rail feet and rings; all barrel/muzzle components use
one bore axis. Squad, inventory and combat consume these same models, and combat
tracers start at their authored muzzle positions. The finishes use deterministic
64px micro-normal maps with no image requests or per-frame geometry work.
`studio/field-supplies.ts` builds the grenade and sewn trauma case in four batches.
Equipment tests check dimensions, finite geometry, muzzle/optic alignment, and
palm fit for both sexes through five weapon motions.

Equipment fitting is baked into `motions/{sex}-equipment.bin` and shared by the
frozen Squad idle, the motion preview, and combat. Loading no longer constructs a
second body skeleton to run a partial clearance solver. The grenade handoff is
prepared from the throw's own first frame. NYX forearm plates stop before the
wrist and use lower-profile housings to preserve the weapon's working space.
NYX rib shells and dorsal housings keep their fittings on a shared rigid joint;
Spectre's carrier hem follows the torso and its magazine pouches retain their shape.

From `app/`, `pnpm build:equipment-poses` rebuilds calibrated tracks and
`pnpm test:pose-audit` samples every one of the 38 poses at 30 Hz on both sexes,
with both rifles (and the actual pistol for its poses), against the body, all
four armor sets, and the field kit. See `app/scripts/equipment-fit/README.md`
for authoring inputs, report locations, and the audit's geometric limits.

### Standing smoking

`standing_smoking` is a five-second Mixamo motion-capture loop for both native rigs, available
in Squad → Motion drills → Ambient → Standing smoking and the engine motion
catalog. It draws on a lit cigarette, lowers the hand, exhales and returns for another drag.
The lighting and discard sections are excluded.
The shared `SmokingEffect` supplies the cigarette, dim ember light, continuous
tip smoke and timed breath; the existing player owns its clock and disposal.
Weapons are hidden during this ambient pose and restored when it ends. Combat
idles do not select it automatically. Demo scripts can use
`play(rig, "standing_smoking")` and the normal `updateHuman` loop.

The capture is retargeted offline, with hand/lip fitting, corrected foot/toe axes,
planted ankles and a 1.6-second return blend; no runtime IK is used. Rebuild both
`*-smoking.bin` assets with `pnpm --dir app build:smoking`; the authoring source
is `app/scripts/build-smoking.ts`. The reference mesh is excluded; each runtime
clip is about 86 KiB. Source provenance and extraction instructions are in
`app/scripts/smoking/README.md`. Smoke uses at most 96 instanced billboards
per active unit and pauses with animation playback.

### Office worker / extraction VIP look

Squad → **Office VIP** previews the selected identity in civilian clothing: an
ivory collared shirt, burgundy tie, clipped ID, navy trousers, leather belt and
Oxford shoes. Both native body types have their own fitted mesh. The look is a
preview and does not change the saved operative's loadout or mission rules.

`CharacterAssets.create(appearance, null, "idle", "office-worker")` builds the
unarmed-ready character; `"rest"` returns the native bind pose for animation
consumers. `idleClip` supplies a dedicated five-second civilian breathing loop:
upright hips, hip-width planted feet, a small stagger and arms folded across the chest.
The upper-body hold comes from Umplix's CC0 **Cross Arms** animation, fitted to the
native limb lengths and wrist angles. See `app/scripts/crossed-arms/README.md` for
the source and reproducible reference extraction. It does not load the combat idle, so the
default VIP pose never inherits its crouch or wide stance. The office look
replaces armor and field equipment. All six material batches share the existing
skeleton, footwear uses the shared contact sampler, and assets load on demand.
The studio offers six existing movement/cover/reaction clips for fit inspection.

Author with Blender: `--background --python-exit-code 1 --python
app/scripts/build-office-worker.py`. Then run `GEAR_BUILD_DIR=/tmp/ghosts-office-worker
node app/scripts/pack-field-kit.mjs <gltf-transform-tools-directory> office-worker`.
Outputs are `app/public/squad/armor/office-worker-{male,female}.glb`. No additional
image textures or external character downloads are required. The office-worker
test checks skin weights and deformation across six poses on both body types.

### Body proportions

Squad → Appearance → **Body** edits height, build, musculature, chest, waist and hips.
Apply appearance saves these alongside facial features; Discard changes restores the
saved character and Reset body proportions restores neutral anatomy. Face presets and
face shuffling preserve the body. Older saves acquire neutral values automatically.

`BodyDeformation` applies a continuous rest-space cross-section warp to owned skin,
field kit, armor and office clothing geometry before posing. Normals follow the warp;
cached assets, joints, facial features and footwear stay unchanged. Height scales the
assembled rig by ±9%, including attachments, and is carried into combat. This uses
procedural proportions rather than additional MakeHuman target assets. The body-shape
tests cover save migration, each control, both anatomies and every clothing/armor set
at the slider extremes through idle, running and crouching.
