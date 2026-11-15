// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Armory at `/headquarters/armory`, Headquarters' second section, in the
 * shared interface language. This file feeds `ArmoryView`
 * (`src/features/headquarters/armory/`) from the account and turns its
 * commands into transactions: requisition (free on testnet), a weapon's mods
 * as one `fittingsTx`, issue and return, and the one-slot utility swap. The
 * screen before it survives at `/headquarters/armory-classic`
 * (`ArmoryClassic.tsx`). See `src/features/headquarters/README.md`.
 */

import type { Transaction } from "@mysten/sui/transactions";
import { useSearchParams } from "react-router-dom";

import {
    equipUtilityTx,
    fittingsTx,
    issueTx,
    moveUtilityTx,
    requisitionTx,
    requisitionUtilityTx,
    unequipArmorTx,
    unequipUtilityTx,
    unequipWeaponTx,
    useMatchSearch,
    useSaving,
    type Step,
} from "../chain";
import {
    ArmoryView,
    type ArmoryData,
    type ArmoryOps,
} from "../features/headquarters/armory/ArmoryView";
import { useHeadquarters } from "../features/headquarters/useHeadquarters";
import { requestSignIn } from "../signIn";

export default function Armory() {
    const [params] = useSearchParams();
    const { accountId, armory, action, recruits, gateKind } = useHeadquarters();
    const saving = useSaving();
    const search = useMatchSearch();
    const id = accountId.data ?? null;

    const run = (...builds: ((accountId: string) => Transaction)[]) =>
        id
            ? action.run(
                  builds.map(
                      (build): Step =>
                          () =>
                              build(id),
                  ),
              )
            : Promise.resolve(false);

    const ops: ArmoryOps = {
        requisition: (order) =>
            run((acc) =>
                "utility" in order
                    ? requisitionUtilityTx(acc, order.utility as 0)
                    : requisitionTx(acc, order),
            ),
        applyFittings: (weapon, carrier, desired) =>
            run((acc) => fittingsTx(acc, weapon, armory.upgrades ?? [], desired, carrier)),
        // One transaction per weapon; each reads the storage the one before it left.
        applyAll: (list) =>
            id
                ? action.run(
                      list.map(
                          ({ weapon, carrier, desired }, i): Step =>
                              () =>
                                  fittingsTx(
                                      id,
                                      weapon,
                                      i === 0 ? (armory.upgrades ?? []) : [],
                                      desired,
                                      carrier,
                                  ),
                      ),
                  )
                : Promise.resolve(false),
        issue: (kind, itemId, from, to) => run((acc) => issueTx(acc, kind, itemId, from, to)),
        unequip: (kind, recruitId) =>
            run((acc) =>
                kind === "weapon"
                    ? unequipWeaponTx(acc, recruitId)
                    : unequipArmorTx(acc, recruitId),
            ),
        issueUtility: (utilityId, from, to, replaceId) =>
            run((acc) =>
                from
                    ? moveUtilityTx(acc, from, to, utilityId, replaceId)
                    : equipUtilityTx(acc, to, utilityId, replaceId),
            ),
        unequipUtility: (recruitId, utilityId) =>
            run((acc) => unequipUtilityTx(acc, recruitId, utilityId)),
        signIn: requestSignIn,
    };

    const data: ArmoryData = {
        gate: gateKind,
        accountId: id,
        recruits,
        storage: {
            weapons: armory.weapons,
            armors: armory.armors,
            utilities: armory.utilities,
            upgrades: armory.upgrades,
        },
        busy: action.busy,
        error: action.error,
        clearError: action.clearError,
        saving,
        match: {
            searchingSince: search.searching ? Number(search.searching.sinceMs) : null,
            playing: !!search.playing,
            busy: search.busy,
            cancel: search.cancel,
        },
        initialItem: params.get("item"),
    };

    return <ArmoryView data={data} ops={ops} />;
}
