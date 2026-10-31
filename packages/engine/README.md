# @ghosts/engine

The Ghosts encounter engine: headless turn-based rules, a three.js battlefield
that animates what the rules decide, and a React UI over both. The app mounts
`<Encounter>` at `/demo`; nothing here imports the app. How it got here and
what comes next: [`ENGINE.md`](ENGINE.md).

Migrated from Commander / Black Rain published version 63, source commit
`bacb9668aee9f24f55f077e84e6d02ecca9a6ca1`.

## Using it

```tsx
import { Encounter, openBriefing, restartEncounter } from "@ghosts/engine";

<Encounter
    scenario={blackRain}        // optional; Operation Black Rain by default
    driver={chainDriver}        // optional; what decides orders — the bundled rules by default
    squad={recruits}            // the player's recruits, or null for the showcase squad
    settings={engineSettings}   // audio levels, battery saver, combat keys, subscribe
    paused={paused}             // freeze field, rigs, rain and audio
    onPause={() => setPaused(true)}   // Escape with nothing to cancel
    onQuit={() => navigate("/")}      // Back to menu from the debrief
/>;
```

Levels are data: `scenarios` / `scenarioById` list what is playable. Orders
reach the rules through an `EncounterDriver` (async `resolve(command)`, a lazy
or async `hostilePhase()`); the default `localDriver` is the bundled rules,
and a host's driver may instead submit each order as a transaction, decode its
effects into `GameEvent`s and `ingest` them — the engine plays what comes back
and decides nothing itself.

Mount it to start an encounter and unmount it to end one: the renderer, audio
and listeners go with it. One encounter runs at a time. `restartEncounter()`
redeploys the same squad; `openBriefing()` shows the briefing over the field.
Subpaths carry the host-facing toolkits: `@ghosts/engine/keys` (combat
actions, default bindings, `sanitizeCombatBindings`), `/gamepad` (pad glyphs
and dialog cancel), `/sounds` (the effect and voice listings), `/demo-assets`
(base-URL-aware demo asset paths) and `/editor` (the level editor's engine
half).

The host provides:

- **Assets** at `/demo-assets/` (district, combat rigs, KTX2 decoder in
  `basis/`), `/squad/` (bodies, armor, motions; through `@ghosts/squad`) and
  `/sounds/` (voice lines and effects). Credits are kept with the files.
- **Theme tokens**: the Ghosts palette variables (`--accent-color`,
  `--text-secondary`, …) on the document, as the app's `index.css` sets them.
- **Settings** through `EngineSettings`, read live. Without them the engine
  plays with defaults.

Escape is layered: it cancels targeting or closes the engine's own dialog
first; only an Escape nothing in the encounter wants calls `onPause`. Keys are
ignored while `paused`, so the host's pause menu gets them. Every key the engine
uses calls `preventDefault()`.

## Layout

Rules (pure TypeScript, no DOM, no three; node-tested):

- `scenario.ts`: an encounter as data — map plan, roster, objective cell,
  briefing, contract, objectives, location and feed lines. `scenarios.ts` is
  the registry of playable levels: `blackRain` (the Kōra street) and
  `paperTrail` (the office extraction, Demo 2).
- `map.ts`: `TacticalMap` answers every geometry question from a `MapPlan`
  (bounds, standing room, low and high cover, corner peeks, shot lines, ground
  height — the street's curb cuts are plan data). `district-plan.ts` is the
  Kōra district plan.
- `game.ts`: `Encounter`, the rules. `apply(command)` decides an order, emits
  its `GameEvent`s and applies them through one reducer; `ingest(event)` takes
  in an event decided elsewhere (a replay, a server, the chain) through the
  same reducer, and `replayEncounter` rebuilds an encounter from its journal.
  `events` is the journal and the feed is written from it (`events.ts`).
- `ai.ts`: hostile decisions, and `hostilePhase(game)`, a generator that plays
  the whole hostile turn one event at a time.
- `driver.ts`: `EncounterDriver` — how orders reach the rules. `localDriver`
  wraps `apply` and `hostilePhase`; a chain driver resolves orders from
  transaction effects instead. Hosts pass theirs to `<Encounter>`.
- `targeting.ts`: shot and throw checks for the UI.
- `catalog.ts` and `environment.ts`: the placeable-asset roster (stable uids,
  seats, tactical footprints) and the street/office prop model with damage
  stages; `district-props.ts` dresses the street, `storefronts.ts` shapes the
  breakable shop fronts.
- `editor/`: the level editor's engine half — the level model, its twofold
  export (Move map grid + render placements), demo reconstruction and the
  editing viewport. The React screen lives in the app.
- `office/`: the indoor pack — catalog, plan, scenario, lighting and scene.

Scene (`scene/`, three.js; shows state and animates events, decides nothing):
`battlefield.ts` is the facade (camera, aim, render loop, `play(event)`), with
`units.ts` (rigs, markers, body animation, cover side-steps), `unit-picking.ts`
(pointer hits), `overlays.ts` (grid, ranges, paths, hover, selection ring),
`markers.ts`, `effects.ts`, `precipitation.ts` (one weather effect at a time
over `rain.ts` and `snow.ts`), `destruction.ts` with `prop-assets.ts`,
`prop-deformation.ts` and `surface-damage.ts` (fracture, damage stages,
cracks), `occlusion.ts`, `profiler.ts`, `props.ts` (barriers, relay) and
`space.ts` (cells ↔ world on one map). `maps.ts` maps a plan id to its scenery
(`district.ts` builds Kōra, `office/scene.ts` the office). `humans.ts` and
`mpfb-characters.js` build operatives from the shared `@ghosts/squad`
character pipeline; `squad-bridge.ts` turns recruits into deployment looks.

Session and UI:

- `session.ts`: the one owner of mutable encounter state and the UI's store.
- `actions.ts`: orders become commands; the returned events are played
  (`presenter.ts` voices and announces each, the scene animates it) with a
  redraw after each.
- `controls.ts`: combat keys through the player's bindings, squad numbers 1–9,
  field picks and hovers. `gamepad.ts` and `pad-combat.ts` map a controller
  onto the same orders (and `cancelDialog` closes native dialogs on pad back).
- `boot.ts`: loads the squad and map, builds and warms the scene, takes
  portraits, binds controls, opens the deployment briefing; returns the
  teardown.
- `ui/`: `Encounter.tsx` (root), `Field.tsx` (overlays on the field),
  `Panels.tsx` (intel panel, command deck), `Dialogs.tsx` (briefing, debrief
  host), `DestructionPreview.tsx` and `OfficePreview.tsx` (the Scene labs).
- `audio.ts`, `voice.ts`, `sfx.ts`: effects and voice lines from `/sounds/`,
  levelled master × effects and master × dialogue; kinds without a recording
  keep a synthesized tone at the effects level. Only voices listed in
  `RECORDED` play (male-01 and female-01 today). `sounds.ts` lists the files
  for hosts (the app's settings previews).
- `style.css`, `ghosts-theme.css` (with `fonts.css`), `host-reset.css`,
  `aftermath/reveal.css`: the sheets, scoped under `.encounter`, so they
  never reach the host page.

## Debrief

Encounter completion opens a sleeve/card reveal using the deployed recruit
portraits (`aftermath/`). Kill credit includes direct fire, overwatch and
hostile grenade casualties; friendly fire never earns XP. Prototype balance is
100 XP per kill, 40 XP for returning, 100 XP per level, everyone level 1 per
playtest. Encounter-local only: nothing is written to the squad save or chain.

## Map props and destruction

In the demo, open **Scene → Destruction preview** for an isolated test floor.
Choose any prop, shoot or blast it, orbit the camera, enable quarter-speed
playback, and reset. Windowed walls also let you shoot just the pane. The lab
pauses the encounter and uses its damage reducer and destruction renderer
without changing the encounter's map or event journal.

`district-props.ts` places 46 street props across 13 kinds: crates, cargo cases,
drums, smoking drums, concrete barriers, corrugated/chain-link/picket fences,
cones, signs, masonry, window walls and glazing. Detail varies with a local
seed. Solid cover uses the existing occupied tiles; perimeter dressing stays
outside the playable grid and building footprints.

`MapPlan.props` is optional. `Encounter` owns its mutable `TacticalMap`, so
damage never leaks into another encounter or redeployment. Shot and grenade
events carry `environment` outcomes. The reducer applies them on both local
play and replay. A destroyed cover prop releases its tile and stops providing
defense; the grenade HUD previews damage before committing.

The Three.js implementation uses
[three-pinata](https://github.com/dgreenheck/three-pinata) 2.0.1 for cached
Voronoi fractures (2.5D for glass and masonry) and
[Rapier](https://rapier.rs/docs/user_guides/javascript/rigid_body_sleeping/)
for convex fragment collisions. Boards, fence sections and curved drum strips
have authored break pieces. Fracture happens when templates are built, never
during a hit. Geometry and materials are shared, intact meshes are merged
per prop, and smoke uses one instanced draw. Rapier loads separately from the
menu bundle.

Nonfatal damage depends on the material. Concrete, masonry and glass use
`SurfaceDamage` on the actual triangles; cracks cannot span window openings.
Other props use three cached geometry stages: cargo cases lose a handle, crates shed
boards, and signs/cones can deform. Cargo cases, barrels and all fences stay rigid: drum lids
and shell sections detach, sheet fences lose panels, picket fences lose boards,
and chain fences lose actual wire sections. Surviving cargo, barrel and fence vertices
never bend. Trim and labels on deformable props share the same prop-space warp.
Stages build only on demand, with no per-frame mesh
updates or new fracture cutting. The preview's Light hit button exposes these
stages even on fragile signs and cones.

Detached pieces disappear from the standing model and enter the existing
bounded debris pool. They spawn only once and are excluded from the final
breakup. Reset/replay reconstructs the damaged shape from health without
replaying old debris. Shared templates stay intact. Partial deformation is
visual: cover and its collision approximation remain until health reaches zero.
Wooden crates have 100 HP: four standard 28-damage hits, with separate boards
detaching on hits two and three before the fourth destroys the crate.
Full-height solid and windowed masonry walls take structural damage only from
explosions, requiring two direct blasts. Gunfire cannot finish off a blast-damaged
wall; window glass can still be shot out independently. Low concrete cover keeps
its existing damage and fracture behavior.
The Lawson and 7–Eleven storefronts add 16 independently breakable glass panes,
including the sliding doors and avenue-facing windows. Their dimensions and
positions share the storefront frame layout. Missed rounds that are not stopped
by cover continue up to 12 metres beyond the target and shatter the first pane
they intersect; the exact impact is journaled and used by the tracer. Nearby
explosions also break exposed panes. Static frames, signage and the building
shell remain. Glass grants no cover, and broken windows never open movement or
line of sight through the building. Debris uses the existing capped physics pool.
Per-prop crack materials are released on reset/destruction; cached deformation
geometry is released with the asset library.

Physics advances at 60 Hz with interpolation and at most six catch-up steps.
Debris hits scenery but not actors or other debris. Sleeping bodies retire,
with a six-second lifetime as a backstop. The total rubble budget is 48 pieces
in battery mode or 96 in smooth mode; oldest pieces are reclaimed. Idle and
pause policies also apply to smoke. Physics is presentation only: rubble does
not silently change tactical pathfinding.

Scope: props and independent window panes are destructible; whole district
buildings remain solid. There is no structural collapse or explosive-barrel
chain damage. Glass retains its frame until the supporting wall falls.

Technology review (October 2026): the newer
[three-voxel-destruction / three-avbd demo](https://github.com/sbobyn/three-voxel-destruction)
is a useful WebGPU voxel reference, but adopting it would require a renderer
and asset representation migration. The current mesh-based WebGL game fits
prefractured meshes plus bounded Rapier bodies. See also the independent
[July 2026 convex Voronoi exploration](https://www.4rknova.com/blog/2026/07/27/voronoi-fracture)
for geometry-only fracture and its collision limitations.

## Weather

Scene → Weather selects Clear, Rain or Snow. Snow uses one `THREE.Points`
draw with 900 flakes in battery mode or 2,400 in smooth mode. Static seed
buffers total 67,200 bytes and allocate only on first selection. Falling,
wind and flutter run in the vertex shader; each rendered frame updates one
time uniform, with no CPU particle loop or buffer uploads. Soft flakes are
procedural, so there are no extra textures, dependencies or network requests.
Depth testing and fog integrate the flakes with the district; this is falling
snow, without surface accumulation or physics collisions.

Only the selected effect runs. Off/on switches retain the same buffers, and
teardown disposes them. Snow follows the existing cadence: battery mode freezes
ambient motion when idle, smooth mode continues at 30 FPS when idle, and hidden
or paused scenes do not advance it. Snow never keeps the full scene awake.

## Checks

`pnpm test` here (Node 22+): rules, events and the hostile planner, maps and
cover, scenarios and the driver, the asset catalog and environment, aim
blending, frame pacing, render policy, weather, destruction, unit picking,
the gamepad, the office and editor suites, voice and effects, squad mapping,
the debrief report. `pnpm typecheck` checks the package alone; the app's
build checks it together with the app.

Development-only fixtures at `/demo?review=corner`, `bishop-wall`,
`cover-axes`, `debrief`, `debrief-clean` and `debrief-defeat` place units or
end the encounter; they are stripped from production bundles.

### Office pack / Demo 2

The host exposes **Demo 2** at `/demo-2`, using the `paperTrail` scenario. Its
roofless office includes workstations, meeting furniture, an archive and two
open doorways. Movement footprints and cover come from `office/plan.ts`;
`Destruction` renders the same props with cached rigid fragments. Desks and
filing cabinets provide low cover; glass and chairs only block movement.
Missed shots and grenades damage furniture, while steel walls and security
doors require blasts. Their vision panes shatter independently. Destroyed
props release owned movement / cover cells; shared cells remain blocked until
all owners break. Desktop items and task lamps follow their supporting desk.
The tucked-chair desk shares one movement footprint and breaks as one assembly.
Desk and table blast damage is doubled, so one grenade within the two-tile
blast radius destroys them; rifle durability stays unchanged. Loose papers and
folders launch higher with reduced gravity and more drift, using the same debris cap.
Door leaves are propped open and PIN pads do not yet operate locks.

**Scene → Destruction preview** includes all 29 office specimens, with separate
window shots for steel fixtures. Small decorative pieces never become individual
physics bodies; each specimen contributes at most 18 rigid fragments and the
existing global debris budget still applies.

**Scene → Office asset pack** opens a paused specimen browser with 29 asset
kinds, sage/slate/sand finishes, a furnished workstation and door-open previews.
It renders on demand, with no animation loop or external asset downloads.

Demo 2 uses indoor lighting instead of the district sun and fog: eight ceiling
battens, three warm task lamps and two access lights. Electric lights remain on
across time-of-day changes; daytime adds window-side fill. Two 512px spot shadow
maps refresh during activity and are reused at rest. Fixtures and lights are
released with the encounter.

Floor finishes are zoned in `office/flooring.ts`: sage/slate carpet tiles at
workstations, charcoal carpet in the aisle, oak-look planks at reception and
the meeting table, speckled vinyl in records / service areas, and a ribbed
entrance mat. Small shared albedo and height/roughness maps are generated once;
world-space UVs preserve their physical scale across rooms. These surfaces do
not change movement or cover.

`OfficeAssets.create(kind, finish)` returns independent Three.js groups sharing
cached geometry and materials. Units are metres, +Z faces forward, and Y=0 is
the base (put desktop objects at desk height). Wall and door modules are 1.35m
wide and 2.7m high. Door leaves retain the `door-hinge` pivot. `officeCatalog`
exports the supported kinds. Remove instances before disposing their owning
`OfficeAssets` cache; do not dispose individual clones' shared buffers.

The office bin collection includes a wire wastebasket, slotted paper recycling bin,
stainless pedal bin and wheeled utility bin. All four are placeable in the editor,
appear in Demo 2 and use the existing rigid debris budget. Lids detach under damage.
