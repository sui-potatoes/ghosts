# Local squad management

`/squad` integrates the existing MPFB character editor into Ghosts. It is a frontend
preview, available without signing in. It does not read or mutate GameAccount,
wallet, inventory objects, Move modules, or remote services.

## Boundaries

The domain lives in the `@ghosts/squad` package (`packages/squad/`): roster
model, catalog and types, stats, armor colors, appearance helpers, the studio
and motion. This folder is the screen:

- `useSquad.ts`: versioned local storage, validated on restore. Storage failure
  leaves a usable in-memory session and a visible notice.
- `components/`: roster inspector, appearance controls, stats panel, personnel
  form, viewport.
- `squad.css`: scoped screen styles; no changes to global UI tokens.

The studio (`@ghosts/squad/studio/recruit-studio`) is one on-demand Three.js
context: shared texture/model caches, captured pose and optional motion
drills, native rig and calibrated weapon attachment. Portraits and item
thumbnails use the same renderer. Resources are released on route unmount.

Appearance is a draft until Apply; switching recruits prompts to apply/discard.
Loadout and personnel edits save immediately. The saved appearance also drives
its portrait. `localStorage` key: `ghosts:squad-preview:v1`.

## Rendering budget

The route and renderer are dynamically imported. No animation/render loop runs
while the viewport is idle. Motion drills use a 30 FPS preview loop only during
playback, suspended when the document is hidden. Controls render on change; resizing and appearance
changes render on demand. Pixel ratio is capped at 1.5 and 1.4 million pixels.
No dynamic shadows or postprocessing. Morph deltas are baked on edit, not every
frame. The entire asset library is not eagerly loaded: body, style, texture and
armor files are requested when used (including the initial four portraits).

Assets are under `public/squad/`; see `CREDITS.txt`. The original Spectre carrier is retained alongside the separate NYX armor pack. Rifle and
sniper share a base model, with a separate optic/barrel configuration. Equipment
stats are local catalog descriptions, not an implementation of combat rules.

## Checks

`pnpm test` in `packages/squad` (Node 22+) exercises stock limits, immutable equipment swaps,
slot validation, callsign validation, recruitment capacity, untrusted storage,
stats packing and combination against the Move presets, and face randomization. Also run `pnpm build` and `pnpm lint`.

Field equipment is authored offline in `scripts/build-field-kit.py`. Boots and
utility belts have separate male/female native-bind assets and are always worn;
the Spectre carrier adds fitted shoulder caps. Boot uppers use a subdivided quad
cage; the upper, tongue and laces share a smooth foot-to-calf weight transition.
Lacing follows the front tongue with spacing measured along its surface.
Grounding includes the
outsole rather than the hidden barefoot mesh. Runtime renders the base kit in
three material batches with no extra texture maps.

To regenerate, run Blender in background mode with `--python-exit-code 1 --python scripts/build-field-kit.py`.
Raw exports go to `/tmp/ghosts-field-kit` (`GEAR_BUILD_DIR` overrides this).
Run `node scripts/pack-field-kit.mjs <toolchain-project>` next; the supplied toolchain
project must have `@gltf-transform/core`, `@gltf-transform/extensions`, and
`@gltf-transform/functions` installed. This keeps offline authoring dependencies
out of the game bundle. The packer preserves native inverse bind matrices,
merges by material and writes the asset budget next to the GLBs.
`node --test tests/field-kit.test.mjs` checks both body types' skeleton bindings,
weights, geometry budgets and boot ground contact in the studio pose.

## NYX armor pack

Veil (`nyx`, light), Shade (`nyx-mid`, medium), and Wraith (`nyx-heavy`, heavy)
are separate inventory choices. Each has a male and female native-bind export.
All include fitted chest/back plates, abdominal articulation, shoulder shells,
gauntlets, gloves, thigh shields, knees and greaves. Shade adds wrapped rib,
rear thigh and calf protection; Wraith adds upper-arm shells and another shoulder
layer, continuous breach cuirass, reinforced shoulder arches, twin dorsal power
housings with six louvers each, lateral thigh/gauntlet shields and calf housings.
Headwear is not part of this pack. Hair and facial customization remain
independent of equipment.

Authoring lives in `scripts/build-nyx.py`, `scripts/native_gear.py`, and
`scripts/nyx_details.py`, and `scripts/nyx_cuirass.py`. The helper
samples the complete body surface (a bone-filtered torso BVH can return the back
surface through gaps near the shoulder). Plates have dense projected faces,
finished rims, captive fasteners, channels and vents. Secondary geometry adds
raised collarbone spars, pectoral strike plates, shoulder crowns, recessed louvered
heat exchangers, keyed spine protection, gauntlet modules, knee impact bosses and
shin keels. The raised parts have mounting skirts embedded into their parent
shells; the curved faces are densely sampled and smoothed independently of the
crisp bevels. Two generated 128px normal
maps supply woven cloth and ceramic microtexture. These maps are embedded in the
GLBs; no external material service or runtime generation is required.

Run Blender with `--background --factory-startup --python-exit-code 1 --python
scripts/build-nyx.py`, then `node scripts/pack-field-kit.mjs <toolchain-project>
nyx nyx-mid nyx-heavy`. Set `GEAR_SAVE_BLEND=1` to save the editable authoring
scenes alongside the raw exports. `GEAR_VARIANT=nyx-heavy` rebuilds only Wraith. Packing restores the native inverse binds and
combines parts into five material batches. Current triangle counts per body:
Veil 39,994; Shade 46,348; Wraith 54,540. These detailed studio assets load on
selection, not with the main menu. `public/squad/armor/budget.json` records the
exported counts. `node --test tests/field-kit.test.mjs` checks both native rigs,
skin weights, bounds, texture coordinates and budgets.

## Armor finishes

Each recruit stores `armorColors: { primary, secondary, accent }` independently
of facial appearance and inventory. The loadout armor section offers three RGB
color pickers and Graphite, Bone, Oxblood, and Olive combinations. The existing
local save version migrates missing or invalid channels to defaults on restore.
`@ghosts/squad/armor-colors` owns the palette and validation; `studio/armor-materials.ts`
paints only owned material clones. Cloth, boots and NYX hardware retain their
finishes. Color-only changes update existing materials and redraw without
rebuilding geometry, reloading assets, or resetting the camera.

Limb bindings exclude the opposite side when transferring skin weights, so
rest-pose thigh proximity cannot attach a plate to the other leg. Heavy thigh
hardpoints mirror around the front axis onto each outer thigh. The asset checks
reject exported triangles below the hips that bridge opposite legs. Veil adds
thin angular chest/shoulder inlays and cut channels while retaining its light silhouette.

Boots use additional ankle control rings, a fitted rear heel counter and a
foot-to-calf blend centered nearer the ankle pivot. Their 9,752-triangle base kit
retains three material batches and the existing sole ground-contact checks.

Shade and Wraith use one continuous chest shell, authored by `nyx_cuirass.py`.
A common transverse arc bridges the chest; a flatter central face and short
upper/lower bevels replace the independently offset pectoral/clavicle layers.
Thickness grows inward from the detailing surface. Flush channels, fasteners
and indicators follow the same surface and upper-torso attachment, so their
depths cannot stack or separate vertically in the pose. Wraith retains its
shoulder arches, back housings and limb reinforcements. Veil is unchanged.

For Shade/Wraith shoulder caps, surface rays start at the joint and travel
outward, with a bounded radius. Starting an inward ray inside the torso could
return a point behind the joint, inverting the cap and producing protrusions
across the side of the chest. Authoring rejects nonpositive radial sections.

## Motion drills

`@ghosts/squad/motion/*` owns the captured action catalog, lazy per-body-type compressed clip loading,
centimetre/Z-up to metre/Y-up conversion, in-place root movement and boot contact.
`MotionPlayer` has no combat state. Pause/scrub/reset are local previews and never
save appearance/equipment. Changing the character stops the old player; closing
the controls restores its original studio pose and primary weapon. Pistol drills
preview the equipped sidearm. Playback uses the same meshes, skeleton and armor.
Run `pnpm test:motion` for animation conversion and lifecycle regression checks.

### Handgun attachment

`@ghosts/squad/studio/sidearm` is the single pistol model used by Squad, inventory and the
encounter. `held-equipment.ts` restores inventory-centred clones to the hand
socket, including the pistol-specific grip offset. Combat imports the same model
and offset. The rifle calibration is unchanged. `pnpm test:equipment` samples
both native rigs through ready, idle, recoil and reload, checks palm contact,
reattachment stability and the geometry budget (2,832 triangles, four batches).
