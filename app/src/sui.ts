// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { createDAppKit } from "@mysten/dapp-kit-react";
import { enokiWalletsInitializer } from "@mysten/enoki";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import { GOOGLE_CLIENT_ID, NETWORK } from "./constants";
import { passkeyWalletInitializer } from "./wallets/passkey";

const ENOKI_API_KEY: string | undefined = import.meta.env.VITE_ENOKI_API_KEY || undefined;

if (!ENOKI_API_KEY) {
    console.warn(
        "VITE_ENOKI_API_KEY is not set — zkLogin sign-in is disabled. " +
            "Copy game/.env.example to game/.env and restart the dev server.",
    );
}

/**
 * Central dApp Kit instance: one gRPC client per network, the passkey wallet
 * and, when an Enoki key is configured, the Google zkLogin wallet.
 */
export const dAppKit = createDAppKit({
    networks: [NETWORK],
    defaultNetwork: NETWORK,
    createClient: (network) =>
        new SuiGrpcClient({
            network,
            baseUrl: `https://fullnode.${network}.sui.io:443`,
        }),
    walletInitializers: [
        passkeyWalletInitializer(),
        ...(ENOKI_API_KEY
            ? [
                  enokiWalletsInitializer({
                      apiKey: ENOKI_API_KEY,
                      providers: {
                          google: {
                              clientId: GOOGLE_CLIENT_ID,
                              // Google only authorizes exact redirect URIs; the
                              // wallet's default (current page URL) breaks on
                              // sub-routes like /settings.
                              redirectUrl: `${window.location.origin}/`,
                          },
                      },
                  }),
              ]
            : []),
    ],
});

declare module "@mysten/dapp-kit-core" {
    interface Register {
        dAppKit: typeof dAppKit;
    }
}
