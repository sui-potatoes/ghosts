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
 * creates: the Registry, the matchmaking queue and the frozen map preset games
 * start on.
 */
export const GHOSTS: {
    package: string;
    registry: string;
    matchmaker: string;
    preset: string;
} = {
    package: "0x94c1cb19df8160b586a3a9431afa52c1b84c5052ac85ee1d699b2615fbdff76d",
    registry: "0x2e7ee10f81543b23b2e37647815f3dd34c72e0b3940418d99167f140095df1bf",
    matchmaker: "0x95849bf329c842bb89de2ef9ee1b4eb8898cfc9af07ab318750eb0fe816fcf77",
    preset: "0x2fc191b8dce78d15a09e5331fb9fcfaab0a08c82d98d12b55e23aacfa972a42b",
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
