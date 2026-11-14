// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** What `ArmoryView` is fed, and the commands it hands back to the screen. */

import type {
    ChainArmor,
    ChainRecruit,
    ChainUpgrade,
    ChainUtility,
    ChainWeapon,
    Fitting,
    Requisition,
} from "../../../chain";
import type { HqGate, MatchState } from "../frame";

export interface ArmoryData {
    gate: HqGate;
    /** The player's `Account` id; null when the address has none yet. */
    accountId: string | null;
    /** Recruits in their stable roster slots. */
    recruits: ChainRecruit[];
    /** What the account holds in storage; upgrades undefined while unread. */
    storage: {
        weapons: ChainWeapon[];
        armors: ChainArmor[];
        utilities: ChainUtility[];
        upgrades: ChainUpgrade[] | undefined;
    };
    /** A write is in flight. */
    busy: boolean;
    /** The last write's failure, in the player's words. */
    error: string;
    clearError(): void;
    /** Anything is saving (the shell's save signal). */
    saving: boolean;
    match: MatchState;
    /** An object id to open on (`?item=`). */
    initialItem?: string | null;
}

/** A supply order: a rifle, armor or mod by kind and tier, or a utility kind. */
export type Order = Requisition | { utility: number };

/** Each resolves true once the change is written and read back. */
export interface ArmoryOps {
    /** Free on testnet; the item lands in storage. */
    requisition(order: Order): Promise<boolean>;
    /** One transaction: the weapon's mods brought to `desired` (`fittingsTx`). */
    applyFittings(
        weapon: { id: string; upgrades: { name: string }[] },
        carrier: string | null,
        desired: Fitting[],
    ): Promise<boolean>;
    /** Several weapons' drafts, one transaction each, in order (leaving with drafts). */
    applyAll(
        list: {
            weapon: { id: string; upgrades: { name: string }[] };
            carrier: string | null;
            desired: Fitting[];
        }[],
    ): Promise<boolean>;
    /** Off its carrier or out of storage onto `to`; their own piece goes to storage. */
    issue(
        kind: "weapon" | "armor",
        itemId: string,
        from: string | null,
        to: string,
    ): Promise<boolean>;
    unequip(kind: "weapon" | "armor", recruitId: string): Promise<boolean>;
    /** Onto `to`, swapping out `replaceId` in the same transaction. */
    issueUtility(
        utilityId: string,
        from: string | null,
        to: string,
        replaceId?: string,
    ): Promise<boolean>;
    unequipUtility(recruitId: string, utilityId: string): Promise<boolean>;
    signIn(): void;
}
