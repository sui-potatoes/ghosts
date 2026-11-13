// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Headquarters at `/headquarters`: the player's squad, in the shared
 * interface language. This file feeds `HeadquartersView`
 * (`src/features/headquarters/squad/`) from the account and turns its
 * commands into transactions, the same ones the classic screen
 * (`/headquarters-classic`, `HeadquartersClassic.tsx`) sends: gear moves at
 * once, looks and voice save as one `edit_recruit` per recruit. See
 * `src/features/headquarters/README.md`.
 */

import type { Transaction } from "@mysten/sui/transactions";

import {
    createAccountTx,
    dismissRecruitTx,
    editRecruitsTx,
    equipUtilityTx,
    fetchAccountId,
    hireRecruitsTx,
    issueTx,
    unequipArmorTx,
    unequipUtilityTx,
    unequipWeaponTx,
    useMatchSearch,
    useSaving,
    type Step,
} from "../chain";
import {
    HeadquartersView,
    type HqData,
    type HqOps,
} from "../features/headquarters/squad/HeadquartersView";
import { useHeadquarters } from "../features/headquarters/useHeadquarters";
import { requestSignIn } from "../signIn";

export default function Headquarters() {
    const { connected, accountId, account, armory, action, slots, onFile, gateKind } =
        useHeadquarters();
    const saving = useSaving();
    const search = useMatchSearch();
    const id = accountId.data ?? null;

    const run = (build: (accountId: string) => Transaction) =>
        id ? action.run([() => build(id)]) : Promise.resolve(false);

    const ops: HqOps = {
        async hireSquad() {
            const owner = connected?.address;
            if (!owner) {
                requestSignIn();
                return false;
            }
            const steps: Step[] = [];
            if (!id) steps.push(createAccountTx);
            steps.push(async () => {
                const known = id ?? (await fetchAccountId(action.client, owner, true));
                if (!known) throw new Error("No account on file for this address.");
                return hireRecruitsTx(known);
            });
            return action.run(steps);
        },
        issue: (kind, itemId, recruitId) =>
            run((acc) => issueTx(acc, kind, itemId, null, recruitId)),
        unequip: (kind, recruitId) =>
            run((acc) =>
                kind === "weapon"
                    ? unequipWeaponTx(acc, recruitId)
                    : unequipArmorTx(acc, recruitId),
            ),
        equipUtility: (recruitId, utilityId, replaceId) =>
            run((acc) => equipUtilityTx(acc, recruitId, utilityId, replaceId)),
        unequipUtility: (recruitId, utilityId) =>
            run((acc) => unequipUtilityTx(acc, recruitId, utilityId)),
        dismiss: (recruitId) => run((acc) => dismissRecruitTx(acc, recruitId)),
        saveLooks: (edits) => run((acc) => editRecruitsTx(acc, edits)),
        signIn: requestSignIn,
    };

    const data: HqData = {
        gate: gateKind,
        accountId: id,
        rating: account.data?.rating.rating,
        slots,
        onFile,
        storage: { weapons: armory.weapons, armors: armory.armors, utilities: armory.utilities },
        busy: action.busy,
        error: action.error,
        clearError: action.clearError,
        saving,
        match: {
            searchingSince: search.searching ? Number(search.searching.sinceMs) : null,
            playing: !!search.playing,
            cancel: search.cancel,
        },
    };

    return <HeadquartersView data={data} ops={ops} />;
}
