// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Loadout tab: the recruit's rifle, armor and utility as slots, the
 * rifle's mods read-only with the way to the Armory bench, and the picker of
 * what storage holds for a slot (the stage wears the item under the cursor).
 */

import { ATTACHMENT_SLOT_NAMES } from "@ghosts/squad/catalog";
import type { Recruit as LocalRecruit } from "@ghosts/squad/types";

import type { ChainRecruit } from "../../../chain";
import {
    ActionRow,
    EmptyState,
    Eyebrow,
    FocusScope,
    List,
    ListRow,
    ReadoutLine,
    SLOT_ICON,
    SlotRow,
    Thumb,
    type Command,
} from "../../../ui";
import { UTILITY_SLOTS } from "../../squad/utilities";
import { armorModel, upgradeModel, utilityModel, weaponModel } from "../mapping";
import { effectOf, modsOf, packed, SLOT_NAMES, usesOf, utilityStats, weaponName } from "./gear";
import { issuePlan, type GearSlot } from "./rules";
import { fieldStats, StatChanges } from "./parts";
import type { HqData, HqOps } from "./types";

export type Write = (label: string, run: () => unknown, extra?: Partial<Command>) => Command;

export function LoadoutRows({
    recruit,
    local,
    images,
    write,
    ops,
    toRoster,
    openPicker,
    toArmory,
}: {
    recruit: ChainRecruit;
    local: LocalRecruit;
    images: Record<string, string>;
    write: Write;
    ops: HqOps;
    toRoster: Command;
    openPicker: (slot: GearSlot) => void;
    toArmory: (itemId?: string) => void;
}) {
    const rid = recruit.objectId;
    const weapon = recruit.weapon;
    const armor = recruit.armor;
    const utility = recruit.utilities[0];
    const change = (slot: GearSlot): Command => ({
        action: "confirm",
        label: "Change",
        tone: "primary",
        run: () => openPicker(slot),
    });
    /** Unequip: off the recruit, back into the armory. */
    const remove = (run: () => unknown): Command =>
        write("Unequip", run, { action: "reset", tone: undefined });
    const utilityImage = utility && utilityModel(utility);
    return (
        <>
            <SlotRow
                id="slot-primary"
                instant
                group="inspector"
                slot={SLOT_NAMES.primary}
                icon={SLOT_ICON.primary}
                image={images[local.equipment.primary ?? ""]}
                item={weapon ? weaponName(weapon) : undefined}
                title={weapon ? weaponName(weapon) : SLOT_NAMES.primary}
                hint={weapon ? modsOf(weapon) : "Unarmed: no attack in the field"}
                commands={[
                    ...(weapon ? [remove(() => ops.unequip("weapon", rid))] : []),
                    change("primary"),
                    toRoster,
                ]}
            />
            <SlotRow
                id="slot-armor"
                instant
                group="inspector"
                slot={SLOT_NAMES.armor}
                icon={SLOT_ICON.armor}
                image={armor ? images[armorModel(armor)] : undefined}
                item={armor?.name}
                title={armor?.name ?? SLOT_NAMES.armor}
                hint={armor ? effectOf(armor.stats) : "Nothing equipped"}
                commands={[
                    ...(armor ? [remove(() => ops.unequip("armor", rid))] : []),
                    change("armor"),
                    toRoster,
                ]}
            />
            {Array.from({ length: UTILITY_SLOTS }, (_, i) => {
                const u = recruit.utilities[i];
                return (
                    <SlotRow
                        key={i}
                        id={`slot-utility-${i}`}
                        instant
                        group="inspector"
                        slot={SLOT_NAMES.utility}
                        icon={SLOT_ICON.utility}
                        image={u && utilityImage ? images[utilityImage] : undefined}
                        item={u?.name}
                        title={u?.name ?? SLOT_NAMES.utility}
                        hint={u ? usesOf(u) : "Nothing equipped"}
                        commands={[
                            ...(u ? [remove(() => ops.unequipUtility(rid, u.id))] : []),
                            change("utility"),
                            toRoster,
                        ]}
                    />
                );
            })}
            {weapon && (
                <>
                    <div className="hqs-gap" />
                    <Eyebrow meta={`${weapon.upgrades.length} / 3`}>Mods</Eyebrow>
                    {weapon.upgrades.map((u) => {
                        const m = upgradeModel(u);
                        return (
                            <ReadoutLine
                                key={u.id}
                                label={m ? ATTACHMENT_SLOT_NAMES[m.slot] : "Mod"}
                            >
                                {u.name} · {effectOf(u.modifier)}
                            </ReadoutLine>
                        );
                    })}
                    <ActionRow
                        id="slot-mods"
                        instant
                        group="inspector"
                        label="Fit in the Armory"
                        title={weaponName(weapon)}
                        hint="Mods are fitted on the Armory bench"
                        commands={[
                            {
                                action: "confirm",
                                label: "Armory",
                                tone: "primary",
                                run: () => toArmory(weapon.id),
                            },
                            toRoster,
                        ]}
                    />
                </>
            )}
        </>
    );
}

type StoredItem = { objectId: string; name: string; image?: string; kind?: string };

/**
 * The loadout picker: the inspector turns into what storage holds for the
 * slot. The cursor is held in it; the stage wears the item under the cursor;
 * Confirm equips it (or swaps, the slot's own piece going back to storage).
 */
export function GearPicker({
    slot,
    recruit,
    local,
    onStage,
    candidate,
    storage,
    images,
    write,
    ops,
    toArmory,
    onClose,
}: {
    slot: GearSlot;
    recruit: ChainRecruit;
    local: LocalRecruit;
    onStage: LocalRecruit;
    /** The storage item under the cursor. */
    candidate?: string;
    storage: HqData["storage"];
    images: Record<string, string>;
    write: Write;
    ops: HqOps;
    toArmory: () => void;
    onClose: () => void;
}) {
    const rid = recruit.objectId;
    const close: Command = { action: "back", label: "Loadout", run: onClose };
    const done = (run: () => Promise<boolean>) => () => {
        onClose();
        return run();
    };
    const carried =
        slot === "primary"
            ? recruit.weapon
                ? [recruit.weapon]
                : []
            : slot === "armor"
              ? recruit.armor
                  ? [recruit.armor]
                  : []
              : recruit.utilities;
    const plan = issuePlan(slot, carried, UTILITY_SLOTS);
    const items: StoredItem[] =
        slot === "primary"
            ? storage.weapons.map((w) => ({
                  objectId: w.objectId,
                  name: weaponName(w),
                  image: images[weaponModel(w)],
                  kind: w.upgrades.length ? `${w.upgrades.length} mods` : undefined,
              }))
            : slot === "armor"
              ? storage.armors.map((a) => ({
                    objectId: a.objectId,
                    name: a.name,
                    image: images[armorModel(a)],
                    kind: effectOf(a.stats),
                }))
              : storage.utilities.map((u) => {
                    const model = utilityModel(u);
                    return {
                        objectId: u.objectId,
                        name: u.name,
                        image: model ? images[model] : undefined,
                        kind: usesOf(u),
                    };
                });
    const run = (id: string) =>
        slot === "utility"
            ? ops.equipUtility(rid, id, plan.replace)
            : ops.issue(slot === "primary" ? "weapon" : "armor", id, rid);
    const current =
        slot === "primary"
            ? recruit.weapon && weaponName(recruit.weapon)
            : slot === "armor"
              ? recruit.armor?.name
              : recruit.utilities[0]?.name;
    const removeCurrent = () =>
        slot === "utility"
            ? ops.unequipUtility(rid, recruit.utilities[0].id)
            : ops.unequip(slot === "primary" ? "weapon" : "armor", rid);
    const currentImage =
        slot === "primary"
            ? images[local.equipment.primary ?? ""]
            : slot === "armor"
              ? images[local.equipment.armor ?? ""]
              : images[local.equipment.utility ?? ""];
    const utility = utilityStats(recruit);
    const before = fieldStats(local, utility?.stats);
    const candidateUtility =
        slot === "utility" ? storage.utilities.find((u) => u.objectId === candidate) : undefined;
    const after = fieldStats(
        onStage,
        slot === "utility" && candidateUtility ? packed(candidateUtility.stats) : utility?.stats,
    );
    return (
        <FocusScope id="picker" back={close}>
            <div className="hqs-stack">
                <Eyebrow meta={`${items.length} in the armory`}>{SLOT_NAMES[slot]}</Eyebrow>
                <List label={SLOT_NAMES[slot]}>
                    {current && (
                        <ListRow
                            id="pick-none"
                            instant
                            group="picker"
                            thumb={<Thumb icon={SLOT_ICON[slot]} />}
                            name="None"
                            title="None"
                            hint={
                                slot === "primary"
                                    ? `${current} goes back to the armory; unarmed, no attack`
                                    : `${current} goes back to the armory`
                            }
                            commands={[write("Unequip", done(removeCurrent)), close]}
                        />
                    )}
                    {current && (
                        <ListRow
                            id="pick-current"
                            group="picker"
                            thumb={<Thumb src={currentImage} icon={SLOT_ICON[slot]} />}
                            name={current}
                            tag="Equipped"
                            tagTone="accent"
                            selected
                            title={current}
                            hint="Equipped now"
                            commands={[close]}
                        />
                    )}
                    {items.map((item) => (
                        <ListRow
                            key={item.objectId}
                            id={`pick-${item.objectId}`}
                            instant
                            group="picker"
                            thumb={<Thumb src={item.image} icon={SLOT_ICON[slot]} />}
                            name={item.name}
                            kind={item.kind}
                            title={item.name}
                            hint={
                                plan.verb === "Swap" && current
                                    ? `${current} goes back to the armory`
                                    : "From the armory"
                            }
                            commands={[
                                write(
                                    plan.verb,
                                    done(() => run(item.objectId)),
                                ),
                                close,
                            ]}
                        />
                    ))}
                </List>
                {items.length === 0 && (
                    <EmptyState
                        id="pick-empty"
                        instant
                        group="picker"
                        headline="Nothing in the armory"
                        action="Armory"
                        title="Armory"
                        hint="Requisition gear in the Armory"
                        commands={[
                            { action: "confirm", label: "Armory", tone: "primary", run: toArmory },
                            close,
                        ]}
                    >
                        Requisition gear in the Armory.
                    </EmptyState>
                )}
                <StatChanges
                    before={before}
                    after={after}
                    label={candidate === "none" ? "If unequipped" : "If equipped"}
                />
            </div>
        </FocusScope>
    );
}
