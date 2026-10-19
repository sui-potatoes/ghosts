// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useWallets } from "@mysten/dapp-kit-react";
import { isEnokiWallet, isGoogleWallet } from "@mysten/enoki";

import { PASSKEY_WALLET_NAME } from "../wallets/passkey";

export type SignInMethod = {
    /** Short label for the UI, e.g. "Passkey" or "Google · zkLogin". */
    label: string;
    /** Wallet-standard wallet name. */
    wallet: string;
};

/**
 * Which wallet the current account belongs to. Wallet-standard accounts do not
 * carry a back-reference, so this scans the registered wallets for the address.
 */
export function useSignInMethod(): SignInMethod | null {
    const account = useCurrentAccount();
    const wallets = useWallets();
    if (!account) return null;

    const wallet = wallets.find((w) => w.accounts.some((a) => a.address === account.address));
    if (!wallet) return { label: "Unknown", wallet: "?" };
    if (wallet.name === PASSKEY_WALLET_NAME) return { label: "Passkey", wallet: wallet.name };
    if (isGoogleWallet(wallet)) return { label: "Google · zkLogin", wallet: wallet.name };
    if (isEnokiWallet(wallet)) return { label: `${wallet.name} · zkLogin`, wallet: wallet.name };
    return { label: `${wallet.name} · wallet`, wallet: wallet.name };
}
