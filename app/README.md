# Ghosts

Frontend for Ghosts: a turn-based squad tactics game in a grim cyberpunk noir
setting, where you lead a mercenary squad working corporate contracts. Built on
Sui (testnet).

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5174
pnpm build        # type-check + production build
pnpm lint
```

Copy `.env.example` to `.env` and set `VITE_ENOKI_API_KEY` to enable Google
zkLogin. Passkey sign-in works without it.

## What is here

Local squad management lives at `/squad`: appearance, armor, equipment, names,
and motion drills. It is available without a wallet. Motion previews offer 38
captured actions, pause/scrub, loop, speed and reset; `pnpm test:motion` checks
native-rig conversion and playback lifecycle.

The playable Tokyo street encounter remains at `/demo`, available from the main
menu without a wallet. It includes the Lawson / 7-Eleven district, turn-based
combat, cover and weapons. Characters and armor use the shared Squad builder;
appearance editing lives in `/squad`.

The encounter lives in `demo-runtime/` with its own document lifecycle; Vite
builds it alongside Ghosts. See `demo-runtime/README.md` for boundaries.
`pnpm test:demo` checks encounter rules and animation transitions. Sign-in and
Settings retain their existing behavior. Ranked/Public modes remain disabled.

Stack and conventions mirror the Sui Potatoes `app`. See `CLAUDE.md`.

## Deploying

The site is static: `pnpm build` writes `dist/`, including `_headers` from
`public/` (long cache on hashed bundles and asset folders, no-cache on
documents). It is served by Cloudflare as a Worker with static assets:
`wrangler.jsonc` names the Worker `ghosts`, points at `dist/` and serves
`index.html` for unknown paths so the React router works on direct loads.

Cloudflare builds and deploys from GitHub (Workers & Pages → Create →
Connect to Git). Project settings:

| Setting | Value |
| --- | --- |
| Root directory | `app` |
| Build command | `pnpm build` |
| Deploy command | `npx wrangler deploy` |

Node comes from `.node-version` and pnpm from `packageManager`. Pushes to
`main` go to production; other branches get preview URLs when previews are
enabled on the project. CI on GitHub only lints, tests and builds.

Attach the custom domain before anyone creates a passkey account: passkeys are
bound to the origin they were made on. Unhashed assets under `public/squad`,
`public/demo-assets` and `public/sounds` are cached for thirty days, so a
changed file needs a new name or a version query (`?v=N`).
