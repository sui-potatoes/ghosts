// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount } from "@mysten/dapp-kit-react";

import {
    FREE_RECRUITS,
    ghostsEnabled,
    useAccountId,
    useArmory,
    useChainRecruits,
    useGhostsAccount,
    useGhostsAction,
    type ChainRecruit,
} from "../../chain";
import { requestSignIn } from "../../signIn";
import { Gate } from "./components/Chrome";
import { useSlots } from "./mapping";

/**
 * Everything both Headquarters sections read: the account, its recruits in
 * stable card slots, the armory, the transaction runner, and the gate to show
 * instead of the workspace (null once the account is readable). Reads share
 * the query cache, so switching sections costs nothing.
 */
export function useHeadquarters() {
    const connected = useCurrentAccount();
    const accountId = useAccountId();
    const account = useGhostsAccount(accountId.data);
    const recruitsQuery = useChainRecruits(account.data);
    const armory = useArmory(account.data);
    const action = useGhostsAction();
    const slots = useSlots(recruitsQuery.data ?? [], FREE_RECRUITS);
    const recruits = slots.filter((s): s is ChainRecruit => !!s);

    const loading =
        ghostsEnabled &&
        !!connected &&
        (accountId.isPending ||
            (!!accountId.data && (account.isPending || recruitsQuery.isPending)));

    const gate = !ghostsEnabled ? (
        <Gate heading="AWAITING DEPLOYMENT">
            The ghosts package is not on chain yet. Publish <code>move/packages/ghosts</code> and
            set <code>GHOSTS.package</code> / <code>GHOSTS.registry</code> in{" "}
            <code>src/constants.ts</code>.
        </Gate>
    ) : !connected ? (
        <Gate heading="IDENTIFICATION REQUIRED" action="Sign in" onAction={requestSignIn}>
            Headquarters keeps your squad on chain. Sign in to raise one.
        </Gate>
    ) : loading ? (
        <Gate heading="SECURE LINE">Reading the chain…</Gate>
    ) : account.isError || recruitsQuery.isError ? (
        <Gate heading="SQUAD FILE UNREADABLE">
            Your account is on chain, but its records do not match this build — usually a{" "}
            <code>GHOSTS</code> package id from before a Move change. (
            {String((account.error ?? recruitsQuery.error)?.message ?? "decode failed")})
        </Gate>
    ) : null;

    return {
        connected,
        accountId,
        account,
        recruitsQuery,
        armory,
        action,
        slots,
        recruits,
        /** Recruits on file by the account's own count, never by what decoded. */
        onFile: Number(account.data?.recruits.size ?? 0),
        gate,
    };
}
