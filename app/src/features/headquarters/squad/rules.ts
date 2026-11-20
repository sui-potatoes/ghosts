// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The rules the Squad screen's commands follow, as plain functions: what a
 * pick from storage does to a slot, what hiring offers at each squad size,
 * and the dismissal's consequence in words true to the contract. Tested in
 * `tests/hq-squad.test.ts`.
 */

export type GearSlot = "primary" | "armor" | "utility";

/** What issuing a stored item into a slot does. */
export interface IssuePlan {
    /** `Equip` into an empty slot, `Swap` when the slot's own piece goes back to storage. */
    verb: "Equip" | "Swap";
    /** A utility carried in a full slot, returned in the same transaction. */
    replace?: string;
}

/**
 * `carried` is what the recruit holds in that slot as objects: a weapon or
 * armor object (a recruit without a weapon object fights with the chain's
 * default rifle, which is not stored anywhere), or the utilities in slot order.
 */
export function issuePlan(
    slot: GearSlot,
    carried: { id: string }[],
    utilitySlots: number,
): IssuePlan {
    if (slot !== "utility") return { verb: carried.length ? "Swap" : "Equip" };
    if (carried.length < utilitySlots) return { verb: "Equip" };
    return { verb: "Swap", replace: carried[0].id };
}

export type HireOffer =
    /** Below the squad's size: one free hire tops it up (`hire_recruits`). */
    | { kind: "free"; open: number }
    /** The squad is complete: nothing to hire. */
    | { kind: "full" };

/** The squad is `size` strong; `hire_recruits` refills it for free after any loss. */
export function hireOffer(count: number, size: number): HireOffer {
    return count < size ? { kind: "free", open: size - count } : { kind: "full" };
}

/** What happens to the squad after a dismissal, in the player's words. */
export function dismissalNote(size: number): string {
    return `The slot refills for free with the next hire, up to ${size}`;
}

/**
 * An owned weapon's name as the screens show it: " +" once at least one
 * upgrade is fitted ("Sharpshooter Rifle +"). Display only; what is fitted
 * on the object counts, never a draft, and catalog entries never take it.
 */
export function weaponName(weapon: { name: string; upgrades?: readonly unknown[] }): string {
    return weapon.upgrades?.length ? `${weapon.name} +` : weapon.name;
}

/**
 * A recruit holding another rifle (a picker's candidate): its model and
 * fittings, and the finish chosen for THAT weapon object — never the
 * holder's own. Finishes are kept per weapon id (`skins.ts`); a weapon with
 * none is drawn in its factory finish. `weapon` null empties the hands.
 */
export function holdingRifle<
    R extends { equipment: { primary: string | null }; attachments?: object; weaponSkin?: string },
>(
    recruit: R,
    weapon: { id: string; model: string; attachments: object } | null,
    skins: Record<string, string>,
): R {
    const { weaponSkin: _own, ...rest } = recruit;
    void _own;
    const skin = weapon ? skins[weapon.id] : undefined;
    return {
        ...rest,
        equipment: { ...recruit.equipment, primary: weapon?.model ?? null },
        attachments: weapon?.attachments ?? {},
        ...(skin ? { weaponSkin: skin } : {}),
    } as R;
}
