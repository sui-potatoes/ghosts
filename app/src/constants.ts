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
    package: "0x4f8185ac8635183a930bb6f0e03066a101da08226bb4d007167def4755019669",
    registry: "0xcf4f9f6db6633a75bd2a300a3fc446bbc9ff765bc75dbb9b9124a48035b7b9ec",
    matchmaker: "0xb5cea6ea414f22709ff12a5ec428439edf9a6e38e837844bb073aa29b5817fb2",
    preset: "0x44fa50392011fe2419a7a7ffa18dee9fc4797ff95697f352c8fe574524220a9e",
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
