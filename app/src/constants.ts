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
    package: "0x55020cb734b77cec16c17fa216df136b1d2955f17606549f7d43fcbd461b76db",
    registry: "0x5e035047bc45e546d9bc6ff423fd71d84b544453036d2c346a451b392e5ee434",
    matchmaker: "0x11cb5f36c2d72deae4965c6029ecc854cf252774b0dc8c3c22ba64df7f180bd9",
    preset: "0xa29eaae6fd01e9e13d379ccf16ca7ac040f867edf072825e0722cc521efb2232",
    lobbies: "0x1a0e0cfebaaa1e9ca54b918fb22049b6fb1aaeb7bfe2ad61d63f15afaf806af5",
    rules: "0x5d37a13a7fd691e0fe52ba4bfb40b1999481dff80df0b4cb0cb92870116b6f00",
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
