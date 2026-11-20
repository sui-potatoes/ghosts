// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";

import { useAccountId, useGhostsAccount } from "../../chain";
import { useEconomy } from "./economy/useEconomy";
import { NEW_PLAYER, standingOf, type Standing } from "./rating";

/**
 * The player's ranked standing from their `Account` on chain, on the live rules.
 * `standing` is a new player's while signed out or without an `Account`;
 * `loading` while the account is being read.
 */
export function useStanding(): {
    standing: Standing;
    signedIn: boolean;
    loading: boolean;
    accountId: string | null;
} {
    useEconomy();
    const signedIn = !!useCurrentAccount();
    const accountId = useAccountId();
    const account = useGhostsAccount(accountId.data);
    return {
        standing: standingOf(account.data ?? NEW_PLAYER),
        signedIn,
        loading: accountId.isLoading || (!!accountId.data && account.isLoading),
        accountId: accountId.data ?? null,
    };
}
