// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** What `HeadquartersView` is fed, and the commands it hands back to the screen. */

import type {
    ChainArmor,
    ChainRecruit,
    ChainUtility,
    ChainWeapon,
    RecruitEdit,
} from "../../../chain";
import type { HqGate, MatchState } from "../frame";

export type { HqGate };

export interface HqData {
    gate: HqGate;
    /** The player's `Account` id; null before the first hire opens one. */
    accountId: string | null;
    rating?: number | string;
    /** Recruits in their stable roster slots (`useSlots`), vacancies as null. */
    slots: (ChainRecruit | null)[];
    /** Recruits on file by the account's own count, never by what decoded. */
    onFile: number;
    /** What the account holds in storage. */
    storage: { weapons: ChainWeapon[]; armors: ChainArmor[]; utilities: ChainUtility[] };
    /** A write is in flight. */
    busy: boolean;
    /** The last write's failure, in the player's words. */
    error: string;
    clearError(): void;
    /** Anything is saving (the shell's save signal). */
    saving: boolean;
    match: MatchState;
}

/** Each resolves true once the change is written and read back. */
export interface HqOps {
    /** Open the account if needed, then top the squad up to four, free. */
    hireSquad(): Promise<boolean>;
    issue(kind: "weapon" | "armor", itemId: string, recruitId: string): Promise<boolean>;
    unequip(kind: "weapon" | "armor", recruitId: string): Promise<boolean>;
    equipUtility(recruitId: string, utilityId: string, replaceId?: string): Promise<boolean>;
    unequipUtility(recruitId: string, utilityId: string): Promise<boolean>;
    dismiss(recruitId: string): Promise<boolean>;
    /** Looks and voice for any number of recruits, one transaction. */
    saveLooks(edits: RecruitEdit[]): Promise<boolean>;
    signIn(): void;
}
