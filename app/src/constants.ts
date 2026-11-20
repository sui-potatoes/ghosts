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
 * frozen map preset games start on, the shared friendly-lobbies object and the
 * shared ranked `Rules` (which name the ranked queues and their levels).
 */
export const GHOSTS: {
    package: string;
    registry: string;
    matchmaker: string;
    preset: string;
    lobbies: string;
    rules: string;
} = {
    package: "0xdbd205dbe67b44f721933e20b95010b8e01c7c1316ff32540d7af4cb46b4246e",
    registry: "0xaa4e35823c515cf91bbcb53311f10d6fccc2d4e4bc148fa8bb7d43f250d79589",
    matchmaker: "0x93791ca35a785341beff57c4d59647e26da06d923c8666e67d204e401dbd017e",
    preset: "0x5e37e87da2aca8ce31b0a2ac918ea76fa376ba9d8c02e61e976d5c9c7c2ebff1",
    lobbies: "0x81afce11aa84fc75c08ebee3565670961002122986396444c32333f7fb72185f",
    // Set by the publish agent: the `Rules` object the package's `init` shares. All zeros until then.
    rules: "0x0000000000000000000000000000000000000000000000000000000000000000",
};

/** Same Google OAuth client as `app/`; both origins are registered on it. */
export const GOOGLE_CLIENT_ID =
    "591411088609-6kbt6b07a6np6mq2mnlq97i150amussh.apps.googleusercontent.com";

/**
 * Feature switches for the scaffold. Each flips a part of the shell on
 * without touching the components themselves.
 */
export const FEATURES = {
    /** Offer browser-extension wallets in the sign-in dialog. */
    externalWallets: false,
} as const;
