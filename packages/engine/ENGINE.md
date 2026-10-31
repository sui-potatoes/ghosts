# From playtest to engine

The Tokyo street playtest became a reusable, playable frontend engine: an
encounter is data, the rules run headless, the scene plays what the rules
decide, and the app mounts it as a component. Each step shipped on its own
with the tests, the build, lint and a play-through green.

## Layers

- **Rules** (`scenario.ts`, `map.ts`, `game.ts`, `events.ts`, `ai.ts`,
  `targeting.ts`): pure TypeScript, no DOM, no three, deterministic from a
  seed, tested under `node --test`. Mirrors the `commander` Move rules so an
  encounter can later be verified on chain.
- **Scene** (`scene/`, `district.ts`, `humans.ts`, …): three.js. Shows state and
  animates events; never decides an outcome.
- **Session** (`session.ts`, `actions.ts`, `presenter.ts`, `controls.ts`):
  input becomes commands, commands become events, events are played one at a
  time.
- **UI** (`ui/`): React components over the session store.

## Done

1. **Headless rules.** The scenario is data passed to `Encounter`; hostile
   decisions are pure functions in `ai.ts`; overwatch is a rule
   (`reactionFire`), not a phase toggle in the UI.
2. **Events.** `apply(command)` returns typed `GameEvent`s and journals them;
   the feed is written from events; `hostilePhase` is a lazy generator, so the
   scene and HUD stay in step with the rules as each event plays.
3. **Scene split.** `Battlefield` is a facade over units, overlays, effects,
   rain, occlusion and profiling, with `play(event)` as the way in. It reads
   state rather than taking a `show(state)` call: the session already owns it.
4. **Content as data.** `MapPlan` and `TacticalMap` carry bounds, buildings,
   cover and ground; the scenario carries the map, roster, objective, briefing,
   contract, objectives, location and feed lines; scenery is looked up by map id.
5. **React UI.** HUD, command deck, briefing and debrief host are components
   over the session store; combat keys are bindings the player's settings hold.
6. **No iframe.** The app mounts `<Encounter>`; its pause menu calls
   `restartEncounter` / `openBriefing` directly; the legacy sheets are scoped
   under `.encounter`; the frame, its document and the message bridge are gone.
7. **Packages.** `@ghosts/engine` and `@ghosts/squad` are pnpm workspace
   packages. The squad domain (roster model, catalog, stats, the character
   pipeline) moved out of the app because the Squad screen and the engine
   both build characters with it; the engine depends on it, the app on both,
   and nothing on the app. The host passes the saved roster in as `squad`.
8. **Events are the record.** Every state change the rules make is an event:
   each command handler decides (legality, paths, dice), emits, and a reducer
   (`applyEvent`) carries the outcome into the units. `ingest(event)` takes in
   an event decided elsewhere and `replayEncounter(scenario, events)` rebuilds
   a whole encounter from its journal — a replay, a server or the chain can
   drive the scene without re-running commands.
9. **The driver seam.** Orders reach the rules through an `EncounterDriver`
   (`driver.ts`): `resolve(command)` is async and `hostilePhase()` may be lazy
   or async. `localDriver` (the default) is the bundled rules; a chain driver
   submits the order as a transaction, decodes its effects into `GameEvent`s,
   ingests them and resolves — in-engine actions then follow what the
   transaction decided. Hosts pass theirs as `<Encounter driver={...}>`;
   `session.resolving` is up while an order is out.
10. **Levels as data.** `scenarios.ts` is the registry (`scenarios`,
    `scenarioById`); the session derives its opening selection from the
    scenario instead of fixed unit ids; the street's curb-cut geometry moved
    from the ground formula into the `MapPlan` (`street.cuts`); scenery is
    looked up per map id (the `views` table in `scene/maps.ts`). A new level
    is a `Scenario`, its scenery, and a registry entry.
11. **Asset catalog and level editor.** `catalog.ts` is the one roster of
    placeable assets — stable uids (saves never store kind names), display
    names, seats and tactical footprints (`cover`/`solid`/`obstacle`/`none`)
    and durability; `environment.ts` derives `propHealth`, `resistsGunfire`
    and `propBlastMultiplier` from it, and typed stand-in blocks (`block-*`,
    plain meshes) carry semantics without a model. Walls, glazing, doors,
    fences and low cover — the typed cover/high/weak blocks included — seat
    on cell EDGES (`place: "edge"`, one per edge, turn = side; `block-fill`
    is the cell-filling building stand-in); desktop clutter mounts on
    surfaces (`mount: "surface"` on a host with `top`), keypads on walls;
    `floorCatalog` paints per-cell finishes — the office textures and the
    street demo's own materials (KTX2 asphalt/concrete, pavement slabs,
    zebra-paint crosswalks; a `raise` lifts what stands there) — and
    lighting offers the outdoor presets, the office demo's `interior` rig
    and placed point lights (`Level.lights`: per-cell color, intensity,
    height). A model's `anchor` names where its authored origin sits in the
    footprint (the corner desk), `offset` carries the demo's workstation
    arrangement so desk clutter composes, and the street-life entourage
    (vending machine, bicycle, pallet stack, utility pole) is placeable.
    `editor/` holds the level model (placements, floors, unwalkable tiles,
    markers, lighting as a preset with deviations), same-seat redressing
    (`replacementsFor`/`swapAsset`), the twofold export — a Move-`Map`-shaped
    tile grid where edges become Cover sides (provisional until the ghosts
    package lands) plus render placements by uid — the shipped demos
    reconstructed as editable levels (`demoLevels`, `levelFromPlan`), and the
    three.js editing viewport; the React screen is the app's `/editor`.

## Next

- **Chain driver.** The app side of the seam: BCS schemas for the ghosts Move
  package, object reads (`app/src/chain/objects.ts`), the transaction executor
  (`app/src/chain/executor.ts`), and an `EncounterDriver` that maps
  transaction effects to `GameEvent`s (see `app/src/chain/README.md`).
- **One encounter at a time.** The session, audio and settings provider are
  module singletons; a second mounted encounter needs them per instance.
- **More maps.** Kōra (`district.ts`) and the office (`office/scene.ts`) have
  scenery; a further map needs its own entry in the `views` table, and a
  surface beyond the street grid's curbs and cuts if it is not a street.
- **Legacy view code.** `humans.ts`, `district.ts`, `mpfb-characters.js` and
  `style.css` are still the migrated originals in their dense style; the
  debrief still renders HTML strings into its dialog.
- **Copy.** Static explanatory text is gone from the HUD; scenario prose
  (briefing, rules of engagement) remains as authored.
