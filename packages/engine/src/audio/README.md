# Sound

Every sound the game plays is a slot in `manifest.ts`. A slot names its
source, either files in `app/public/sounds/` or a procedural generator, and
its gain, pitch variance, looping, spatial fall-off, bus and whether it is
still a placeholder. No other code names a sound file.

Hear every slot at `/sounds` (dev server, or a build with `VITE_SOUNDS_QA=1`).
Placeholders are marked there. The screen also has the soundscape switch,
which turns spatial sound, ambience and the reactive mix on or off for A/B.

## Replacing a sound

1. Drop the file in `app/public/sounds/` (for example `rain-bed-a.opus`).
2. Point the slot at the file in `manifest.ts` (one line), and mark it
   final:

   ```ts
   // before
   "ambience.rain.bed.a": bed("bed.rain.a", 0.16, "Rain bed, first layer (left)"),
   // after
   "ambience.rain.bed.a": { ...bed("bed.rain.a", 0.16, "Rain bed, first layer (left)"), source: { file: ["rain-bed-a.opus"] }, placeholder: false },
   ```

   A slot written out in full just gets `source: { file: [...] }` and
   `placeholder: false`.

   Several files are takes, varied without an immediate repeat. A looping
   slot loops the whole file, or between `loop: { start, end }` in seconds.
3. Run `pnpm --dir app test:gui`. `tests/sound-manifest.test.ts` fails if a
   file is missing or a shipped file is not in the manifest.
4. Listen to it at `/sounds`, then in the field.

## Adding a slot

Add a line to `SLOTS`, then play it by id: `audio.scape.play("ambience.city.oneshot.dog", { at })`
in the engine. An ambience bed or one-shot also needs a place in
`ambiencePlan` (`ambience-model.ts`). A new generator gets a name in
`GENERATORS` and an implementation in `generators.ts` (engine) or
`app/src/audio/app-generators.ts` (shell); the type checker and the tests
catch a name with no implementation.

## Files

- Formats: Opus (`.opus`) or MP3 for anything long, WAV for short interface
  clicks. Offer an `.m4a` `fallback` beside Opus for Safari.
- 44.1 or 48 kHz. Mono for anything positioned in the scene (the panner
  places it); stereo is fine for beds.
- Loudness: beds around −30 LUFS integrated with no audible loop point (cut
  on zero crossings, or crossfade the ends); one-shots peaking at −6 dBFS;
  weapons as recorded. Levels are then set by the slot's `gain`, not by
  re-rendering the file.
- Beds should be long (15 s or more), so the loop is not heard.

## Buses

`ambience` (Ambience slider), `combat` (Effects), `voice` (Dialogue),
`interface` (Interface), `music` (Music). The reactive mix ducks ambience
and music while aiming, dips them almost to silence while a shot is on its
way, and low-passes and narrows everything but the interface while the held
unit is dazed. Constants are in `mix-model.ts`, spatial ones in
`spatial-model.ts`.
