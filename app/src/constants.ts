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
    package: "0x8e9ff560272d5777005f67c89228a26fa4252a28c80d58ce8c7582d2c4d14f63",
    registry: "0x61b6ecd3b955c82f4d5df4cd87a3165db6fa4332d2d87772414304cfea70b6c2",
    matchmaker: "0x3617bb15cb80ca7f487a7107e0131722d581f7895fdb2835a42f1cc373aaecf5",
    preset: "0x46042c3239fadfba22647540cef05cb04bc2db5f9a7258b7ca50fbe92485ddac",
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
