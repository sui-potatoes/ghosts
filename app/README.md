# Ghosts

Frontend for Ghosts: a turn-based squad tactics game in a grim cyberpunk noir
setting, where you lead a mercenary squad working corporate contracts. Built on
Sui (testnet).

## Run

The repository is a pnpm workspace: this app plus `packages/engine`
(`@ghosts/engine`, the encounter) and `packages/squad` (`@ghosts/squad`, the
squad domain and character pipeline). Install from the repository root.

```bash
pnpm install
pnpm dev          # http://localhost:5174
pnpm build        # type-check + production build
pnpm lint
pnpm test         # every package's tests
```

Copy `.env.example` to `.env` and set `VITE_ENOKI_API_KEY` to enable Google
zkLogin. Passkey sign-in works without it.

## What is here

The main menu uses a lazy-loaded Three.js city with a poster while it loads or
when WebGL is unavailable. Animation runs at up to 30 fps, pauses when hidden or offscreen,
and stops for reduced motion. The patrol uses a compact copy of the shared rifle
idle: run `pnpm build:title-motion` after changing the motion captures, then
`pnpm test:title-motion` to check that both copies match their source clips.
The loading posters capture the first fully loaded frame at animation time zero.
Keep this exact timing when refreshing them: the live scene holds that pose through
the poster-to-canvas fade before advancing its animation clock.

Local squad management lives at `/squad`: appearance, armor, equipment, names,
and motion drills. It is available without a wallet. Motion previews cover the
whole captured action catalog with pause/scrub, loop, speed and reset; `pnpm test:motion` checks
native-rig conversion and playback lifecycle.

The playable Tokyo street encounter is at `/demo`, available from the main
menu without a wallet: the Lawson / 7-Eleven district, turn-based combat, cover
and weapons, with the squad saved in `/squad`. The screen mounts `<Encounter>`
from `@ghosts/engine` (see `packages/engine/README.md`) and owns the pause
menu. Ranked/Public modes remain disabled. A second, indoor encounter — the
office extraction — is at `/demo-2`, and the level editor that authors such
maps (flooring, props, markers, lights, export/import) lives at `/editor`.

Stack and conventions mirror the Sui Potatoes `app`. See `CLAUDE.md`.

## Deploying

The site is static: `pnpm build` writes `dist/`, including `_headers` from
`public/` (long cache on hashed bundles and asset folders, no-cache on
documents). It is served by Cloudflare as a Worker with static assets:
`wrangler.jsonc` names the Worker `ghosts`, points at `dist/` and serves
`index.html` for unknown paths so the React router works on direct loads.

Cloudflare builds and deploys from GitHub (Workers & Pages → Create →
Connect to Git). Project settings:

| Setting        | Value                 |
| -------------- | --------------------- |
| Root directory | `app`                 |
| Build command  | `pnpm build`          |
| Deploy command | `npx wrangler deploy` |

pnpm finds the workspace root above `app/`, so the install there also links
`packages/engine` and `packages/squad`.

Node comes from `.node-version` and pnpm from `packageManager`. Pushes to
`main` go to production; other branches get preview URLs when previews are
enabled on the project. CI on GitHub only lints, tests and builds.

Attach the custom domain before anyone creates a passkey account: passkeys are
bound to the origin they were made on. Unhashed assets under `public/squad`,
`public/demo-assets` and `public/sounds` are cached for thirty days, so a
changed file needs a new name or a version query (`?v=N`).
