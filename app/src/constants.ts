// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

export const NETWORK = "testnet";

/**
 * The `commander-names` registry on testnet: the package (published from
 * `potatoes/packages/commander-names`), the shared SuiNS object its records
 * live in, and the Ghosts instance, which locks `demo.ghosts.sui` and serves
 * player names as leaf records under it.
 */
export const NAMES = {
    package: "0x6f2a13d8d3eba4e606b542d3c8b5cb5b69376a271f08c979c107ee89d9345c56",
    suins: "0x300369e8909b9a6464da265b9a5a9ab6fe2158a040e84e808628cde7a07ee5a3",
    instance: "0xbf2ddab4c8c7deabf1461cc0c8fdb7dc2b12c2fd55b65782080a516e7cd7263b",
    /** The name the instance holds; a player name is `<name>.<domain>`. */
    domain: "demo.ghosts.sui",
} as const;

/**
 * Testnet IDs for the published ghosts Move package and what its initializer
 * creates: the Registry, the queue for owned recruits (`Matchmaker<Ghosts>`), the
 * frozen map preset it starts with (Black Rain, the level stakes games start on),
 * the shared friendly-lobbies object and the shared ranked `Rules` (which name the
 * ranked queues and their levels).
 */
export const GHOSTS: {
    package: string;
    registry: string;
    matchmaker: string;
    preset: string;
    lobbies: string;
    rules: string;
} = {
    package: "0x856ab8a78fae01fb7eb1cc2ca47eb0e95900f300489bacf1ca06d30b2de081f0",
    registry: "0x77b6c9ac252b820fc7415ede00d388b56fa9f7851e7b6eb345a0a5e8c0f2dc3b",
    matchmaker: "0x3030458a71901bf5706e91b43520a41ea3dda0d031b1195f2601dc781f039776",
    preset: "0xf58f2397b910eaa735e7d0675e7f148ee466f549d462e13dab8e379bc3b45153",
    lobbies: "0x9f1db66b7d7b587f81d943245a349d4c7aaf885e96ef6dba71f96fae81b11f1a",
    rules: "0xd08bf87e9ae0c50680088ecdec506ad02e5588eec66b288db1e8aa4832fdc40f",
};

/**
 * Levels frozen on chain after publish, by `ghosts::new_level`, besides the one
 * `init` freezes (Black Rain, `GHOSTS.preset`): each level's `Preset` object ID,
 * which is also the ID every game on that level carries in its map (`Map.id`),
 * so a match shows its own level's scene (`chain/levels.ts`); a game on a
 * level this build does not list is shown in Black Rain's scene. Night Shift is
 * the level of friendly games (`chain/lobby.ts`) and, as `Rules` name it, of
 * ranked games of both sizes. `retired` lists the presets of earlier revisions of
 * a level whose scene this build no longer has: their matches show a plate
 * saying the map is unavailable, never another revision's scene. Re-creating a
 * level (`packages/agent/src/bin/level.ts`) moves its old ID there.
 */
export const LEVELS: { nightShift: string; retired: readonly string[] } = {
    nightShift: "0xa22f157c02881b8308e22a81528e7dbb2c906cd7d8b8f8ca330663e9b5b4b9df",
    retired: ["0x95a7813aed0edf3ca2d421471cec34e5766e2a22e43fd3862db0f300b10cfbb5"],
};

/** Same Google OAuth client as `app/`; both origins are registered on it. */
export const GOOGLE_CLIENT_ID =
    "591411088609-6kbt6b07a6np6mq2mnlq97i150amussh.apps.googleusercontent.com";

/**
 * The block explorer links open in (DevXplorer): the base page and the network
 * its `network` parameter names. `explorerUrl` builds every link from these two.
 */
export const EXPLORER = {
    base: "https://devxplorer.io/",
    network: NETWORK,
} as const;

/**
 * The explorer's page for anything it can search: an object id, a transaction
 * digest, an address, a name. The query is encoded.
 */
export function explorerUrl(query: string, explorer: { base: string; network: string } = EXPLORER) {
    const url = new URL(explorer.base);
    url.searchParams.set("search", query);
    url.searchParams.set("network", explorer.network);
    return url.toString();
}

/**
 * Feature switches for the scaffold. Each flips a part of the shell on
 * without touching the components themselves.
 */
export const FEATURES = {
    /** Offer browser-extension wallets in the sign-in dialog. */
    externalWallets: false,
} as const;
