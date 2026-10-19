# Tokyo street playtest

Migrated from Commander / Black Rain published version 63, source commit
`bacb9668aee9f24f55f077e84e6d02ecca9a6ca1`. This is source code built by Ghosts'
Vite pipeline, not an embed of the externally hosted site.

`/demo` mounts `index.html` in a full-screen same-origin frame. This keeps the
legacy DOM, global shortcuts, WebGL renderer and audio lifecycle out of React's
Squad/menu. Leaving the route destroys the document and its rendering loop.
The wordmark returns to the Ghosts menu. Escape cancels targeting or closes a
dialog inside the encounter; otherwise the frame asks the shell to open its
pause menu over the frame (`src/shell-bridge.ts`: `ghosts:pause-request` up,
`ghosts:pause` / `ghosts:restart` down; same origin, source-checked). Paused,
`Battlefield.setPaused` freezes jobs, rigs and rain and suspends audio. Entry
and every redeploy open the deployment briefing: contract, rules of engagement
and the deployed squad with portraits, closed by Deploy or Escape.

- `src/game.ts`, `targeting.ts`: local encounter rules. No account or chain calls.
- `src/scene.ts`, `district*.ts`: original Tokyo district, cover and animation.
- `src/main.ts`: encounter UI and controls; Ghosts branding.
- `src/ghosts-theme.css`: host styling using the shared Ghosts palette in
  `../src/styles/theme-tokens.css`. Legacy styles remain scoped to this document.
- `src/voice.ts`: operative voice lines from `../public/sounds/<phrase>-<sex>-<NN>.mp3`.
  A voice is a sex plus index (`DeploymentLook.voice`, default 01); only voices
  listed in `RECORDED` play (male-01 and female-01 today), so a voice without
  recordings stays silent. Events:
  select, move, move into cover, fire, kill, grenade, hunker, overwatch
  reaction, taking a hit.
  One channel, no immediate repeats, level is master × dialogue from the
  shell's saved audio settings (`ghosts:settings`), paused with the encounter. `pnpm test:demo`.
- `src/sfx.ts`: recorded sound effects from `../public/sounds/<name>.mp3`, several
  takes per kind with no immediate repeat, level master × effects; a key may be
  weapon-specific such as
  `reload-pistol` (rifle, sniper and pistol shots and reloads, the pistol
  raise when fire mode opens, the grenade pin on the throw and the blast on
  impact; the sniper reload reuses the rifle takes). A recorded kind
  replaces the synthesized tone and follows the shell audio settings; kinds
  without recordings keep the synthesized tone behind the rail's speaker toggle,
  scaled by the same master × effects level.
- Squad/Armory/Settings overlays are retired. Navigation links open `/squad`
  (appearance and equipment) and `/settings` in the Ghosts shell. Leaving ends
  the local encounter; returning loads the saved roster into a fresh playtest.
  Briefing, field manual, after-action results and combat controls stay local.
- `../public/demo-assets/`: migrated models, animation data and textures; credits
  retained. KTX2 decoder lives in `../public/demo-assets/basis/`.

The encounter reads a validated snapshot of `ghosts:squad-preview:v1` on entry:
faces, names, equipped armor and its colors. With no valid save, a showcase squad
uses Veil, Shade and Wraith. Enemy gear is assigned separately. Playtest actions
do not overwrite the squad save or inventory. Editing in Squad and returning to
the demo starts a new encounter with the updated roster.

`src/mpfb-characters.js` adapts the shared `CharacterAssets` builder from Squad
to the existing combat skeleton and animation clips. Both routes now load the
same `public/squad` models, skins, morphs, accessories, field kit and armor.
`rest` construction skips the studio's frozen idle pose; combat owns animation.
Boot contact uses the actual field-kit sole geometry. The retained
`models/blackline-operative.glb` supplies the animation donor skeleton and weapon,
not visible body surfaces. `combat/{male,female}` contains only rig metadata and
animation clips. Retired face editors, duplicate body/armor models, facial-hair
assets, face textures and the stale `squad.zip` are no longer shipped.

The original procedural appearance pipeline is removed. Combat rules carry no
second appearance schema; `squad-bridge.ts` supplies the current Squad schema.

Run `pnpm test:demo`, `pnpm build`, and `pnpm lint` from `app/`. The build also
type-checks this migrated source using `tsconfig.json`; the legacy source is
excluded from the React ESLint rules. Tests cover movement/AP, cover, vaults,
turns, firing clip boundaries, aim blending, frame pacing and weather.

Deploy the whole `app/dist` directory. The host needs the same SPA fallback for
`/demo` as `/squad`, while serving real `demo-runtime/*.html` and `demo-assets/*`
files unchanged. No second server or external demo origin is required. On
Cloudflare, `wrangler.jsonc` sets single-page-application not-found handling
and `public/_headers` the cache policy.

## Encounter debrief

Encounter completion opens a sleeve/card reveal using the deployed recruit
portraits. Kill credit includes direct fire, overwatch and hostile grenade
casualties; friendly fire never earns XP. `src/aftermath/` owns the report and
self-contained presentation. Dead recruits keep their service record but receive
no progression or celebration.

Prototype balance is 100 XP per kill, 40 XP for returning, 100 XP per level.
Everyone starts at level 1 for each playtest. This is encounter-local presentation
only; it does not write to the Squad save or any on-chain state.

Reveal All / Escape skips the animation; reduced-motion preferences show the
settled cards immediately. The debrief opens once, after the final combat
animation. Redeploy resets it. Development-only visual fixtures are available at
`/demo-runtime/index.html?review=debrief`, `review=debrief-clean` and
`review=debrief-defeat`; they are excluded from production bundles.
