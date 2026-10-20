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
    squad={recruits}            // the player's recruits, or null for the showcase squad
    settings={engineSettings}   // audio levels, battery saver, combat keys, subscribe
    paused={paused}             // freeze field, rigs, rain and audio
    onPause={() => setPaused(true)}   // Escape with nothing to cancel
    onQuit={() => navigate("/")}      // Back to menu from the debrief
/>;
```

Mount it to start an encounter and unmount it to end one: the renderer, audio
and listeners go with it. One encounter runs at a time. `restartEncounter()`
redeploys the same squad; `openBriefing()` shows the briefing over the field.
`@ghosts/engine/keys` has the combat actions, their default bindings and
`sanitizeCombatBindings` for a host that stores the player's keys.

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
  briefing, contract, objectives, location and feed lines. `blackRain` is the
  one scenario today.
- `map.ts`: `TacticalMap` answers every geometry question from a `MapPlan`
  (bounds, standing room, low and high cover, corner peeks, shot lines, ground
  height). `district-plan.ts` is the Kōra district plan.
- `game.ts`: `Encounter`, the rules. `apply(command)` carries out an order and
  returns its `GameEvent`s; `events` is the journal and the feed is written
  from it (`events.ts`).
- `ai.ts`: hostile decisions, and `hostilePhase(game)`, a generator that plays
  the whole hostile turn one event at a time.
- `targeting.ts`: shot and throw checks for the UI.

Scene (`scene/`, three.js; shows state and animates events, decides nothing):
`battlefield.ts` is the facade (camera, aim, render loop, `play(event)`), with
`units.ts` (rigs, markers, body animation, cover side-steps), `overlays.ts`
(grid, ranges, paths, hover, selection ring), `effects.ts`, `rain.ts`,
`occlusion.ts`, `profiler.ts`, `props.ts` (barriers, relay) and `space.ts`
(cells ↔ world on one map). `maps.ts` maps a plan id to its scenery
(`district.ts` builds Kōra). `humans.ts` and `mpfb-characters.js` build
operatives from the shared `@ghosts/squad` character pipeline;
`squad-bridge.ts` turns recruits into deployment looks.

Session and UI:

- `session.ts`: the one owner of mutable encounter state and the UI's store.
- `actions.ts`: orders become commands; the returned events are played
  (`presenter.ts` voices and announces each, the scene animates it) with a
  redraw after each.
- `controls.ts`: combat keys through the player's bindings, squad numbers 1–9,
  field picks and hovers.
- `boot.ts`: loads the squad and map, builds and warms the scene, takes
  portraits, binds controls, opens the deployment briefing; returns the
  teardown.
- `ui/`: `Encounter.tsx` (root), `Field.tsx` (overlays on the field),
  `Panels.tsx` (intel panel, command deck), `Dialogs.tsx` (briefing, debrief
  host).
- `audio.ts`, `voice.ts`, `sfx.ts`: effects and voice lines from `/sounds/`,
  levelled master × effects and master × dialogue; kinds without a recording
  keep a synthesized tone at the effects level. Only voices listed in
  `RECORDED` play (male-01 and female-01 today).
- `style.css`, `ghosts-theme.css`, `aftermath/reveal.css`: the legacy sheets,
  scoped under `.encounter`, so they never reach the host page.

## Debrief

Encounter completion opens a sleeve/card reveal using the deployed recruit
portraits (`aftermath/`). Kill credit includes direct fire, overwatch and
hostile grenade casualties; friendly fire never earns XP. Prototype balance is
100 XP per kill, 40 XP for returning, 100 XP per level, everyone level 1 per
playtest. Encounter-local only: nothing is written to the squad save or chain.

## Checks

`pnpm test` here (Node 22+): rules, events and the hostile planner, maps and
cover, aim blending, frame pacing, render policy, weather, voice and effects,
squad mapping, the debrief report. `pnpm typecheck` checks the package alone;
the app's build checks it together with the app.

Development-only fixtures at `/demo?review=corner`, `bishop-wall`,
`cover-axes`, `debrief`, `debrief-clean` and `debrief-defeat` place units or
end the encounter; they are stripped from production bundles.
