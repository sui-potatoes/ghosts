# Ghosts

Ghosts is a turn-based squad tactics game in a grim cyberpunk noir setting. You
lead a mercenary squad ("Ghosts") taking corporate contracts in a world run by
three industry giants. Matches and progression run on Sui; the web client
renders the encounter and manages the squad.

Status: testnet only.

## Layout

| Path                        | What it is                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `app/`                      | Web client (React, Vite, Three.js). See [app/README.md](app/README.md).                                                |
| `packages/engine/`          | Encounter engine: rules, battlefield, UI. [README](packages/engine/README.md)                                          |
| `packages/squad/`           | Squad domain and character pipeline. [README](packages/squad/README.md)                                                |
| `packages/agent/`           | Headless SDK and MCP server for agents. [README](packages/agent/README.md)                                             |
| `move/packages/ghosts/`     | Game Move package.                                                                                                     |
| `move/packages/matchmaker/` | Matchmaker Move package. [README](move/packages/matchmaker/README.md)                                                  |
| `docs/design/`              | Design notes: [lore](docs/design/lore.md), [corporations](docs/design/corporations.md), [ideas](docs/design/ideas.md). |

## Prerequisites

- Node (version in `app/.node-version`) and pnpm (version in the root `packageManager` field).
- Sui CLI 1.82.1 for the Move packages (the version recorded in `Published.toml`).

## Run the app

```bash
pnpm install
pnpm dev          # http://localhost:5174
```

Copy `app/.env.example` to `app/.env` and set `VITE_ENOKI_API_KEY` to enable
Google zkLogin. Passkey sign-in works without it.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd move/packages/matchmaker && sui move build --warnings-are-errors && sui move test
cd move/packages/ghosts     && sui move build --warnings-are-errors && sui move test
```

CI (`.github/workflows/ci.yml`) runs the JS checks and both Move packages.

## Testnet deployment

Package and shared object IDs are in `app/src/constants.ts` (client) and
`packages/agent/src/contract.ts` (agent). Publish records are in each Move
package's `Published.toml`.

## Deploying

The app is static. Cloudflare builds and deploys from `main`; settings are in
[app/README.md](app/README.md#deploying).

## Agents

`packages/agent` lets an agent read the game, list legal orders and play.
It defaults to an in-memory sandbox; see [packages/agent/README.md](packages/agent/README.md).

## License

MIT, see [LICENSE](LICENSE). Third-party assets are under their own licences;
credits are in `app/public/squad/CREDITS.txt`,
`app/public/squad/motions/CREDITS.txt` and `app/public/demo-assets/*-credits.txt`.
