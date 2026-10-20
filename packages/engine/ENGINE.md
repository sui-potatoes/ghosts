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

## Next

- **Replays.** Events are journaled and the rules are seeded, but units are
  still mutated in place; a reducer from events to state would let a replay,
  a server or a chain drive the scene without re-running commands.
- **One encounter at a time.** The session, audio and settings provider are
  module singletons; a second mounted encounter needs them per instance.
- **More maps.** Only Kōra has scenery (`district.ts`), and the ground formula
  assumes its crossing ramps; a second map needs its own scenery and surface.
- **Legacy view code.** `humans.ts`, `district.ts`, `mpfb-characters.js` and
  `style.css` are still the migrated originals in their dense style; the
  debrief still renders HTML strings into its dialog.
- **Copy.** Static explanatory text is gone from the HUD; scenario prose
  (briefing, rules of engagement) remains as authored.
