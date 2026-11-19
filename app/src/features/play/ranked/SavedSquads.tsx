// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The player's saved squads for the current size: a list that loads one on
 * a press, a row that saves the squad on the stands, and a small manage view
 * (load, overwrite, rename, delete) for one saved squad.
 */

import { useLayoutEffect } from "react";

import { ActionRow, Eyebrow, FocusScope, List, ListRow, useFocusState } from "../../../ui";
import type { Mode } from "../economy";
import { cr, savedSquadRefusal, type Stand } from "./model";
import { isSquad, squadPrice, SQUAD_SLOTS, type SavedSquad } from "./presets";

const GROUP = "sb-squads";
export const SAVE_SQUAD = "sb-save-squad";
export const squadRowId = (id: string) => `sb-squad-${id}`;

type Limits = { rating: number; mode: Mode; budget: number | null };

type ListProps = {
    saved: SavedSquad[];
    stands: Stand[];
    limits: Limits;
    saveRefusal: string | null;
    onLoad: (squad: SavedSquad) => void;
    onManage: (squad: SavedSquad) => void;
    onSave: () => void;
};

export function SavedSquadList({
    saved,
    stands,
    limits,
    saveRefusal,
    onLoad,
    onManage,
    onSave,
}: ListProps) {
    return (
        <div className="grk-squads">
            <Eyebrow meta={`${saved.length} / ${SQUAD_SLOTS}`}>Saved {limits.mode} squads</Eyebrow>
            <List label={`Saved ${limits.mode} squads`}>
                {saved.map((squad) => {
                    const refusal = savedSquadRefusal(
                        squad.units,
                        limits.rating,
                        limits.mode,
                        limits.budget,
                    );
                    const here = isSquad(squad, stands);
                    return (
                        <ListRow
                            key={squad.id}
                            id={squadRowId(squad.id)}
                            group={GROUP}
                            instant
                            name={squad.name}
                            kind={
                                refusal ?? (here ? "On the stands" : `${squad.units.length} units`)
                            }
                            tag={cr(squadPrice(squad))}
                            tagTone={refusal ? "warn" : here ? "accent" : "default"}
                            selected={here}
                            locked={!!refusal && /unlocks at/i.test(refusal)}
                            title={`${squad.name} · ${cr(squadPrice(squad))}`}
                            hint={refusal ?? "Put this squad on the stands"}
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Load",
                                    tone: "primary",
                                    deny: refusal ?? undefined,
                                    run: () => onLoad(squad),
                                },
                                {
                                    action: "reset",
                                    label: "Manage",
                                    short: "Manage",
                                    run: () => onManage(squad),
                                },
                            ]}
                        />
                    );
                })}
                <ActionRow
                    id={SAVE_SQUAD}
                    group={GROUP}
                    instant
                    label="Save this squad"
                    title="Save this squad"
                    hint={saveRefusal ?? "Name the squad on the stands and keep it"}
                    commands={[
                        {
                            action: "confirm",
                            label: "Save squad",
                            tone: "primary",
                            deny: saveRefusal ?? undefined,
                            run: onSave,
                        },
                    ]}
                />
            </List>
        </div>
    );
}

type ManageProps = {
    squad: SavedSquad;
    stands: Stand[];
    limits: Limits;
    onLoad: () => void;
    onOverwrite: () => void;
    onRename: () => void;
    onDelete: () => void;
    onClose: () => void;
};

function StartOn({ id }: { id: string }) {
    const store = useFocusState();
    useLayoutEffect(() => {
        store.focus(id, false);
        // Once, on open.
    }, []);
    return null;
}

export function ManageSquad({
    squad,
    stands,
    limits,
    onLoad,
    onOverwrite,
    onRename,
    onDelete,
    onClose,
}: ManageProps) {
    const back = { action: "back" as const, label: "Saved squads", run: onClose };
    const refusal = savedSquadRefusal(squad.units, limits.rating, limits.mode, limits.budget);
    const here = isSquad(squad, stands);
    const incomplete = stands.some((s) => !s);
    return (
        <FocusScope id="sb-manage" back={back}>
            <StartOn id="sb-manage-load" />
            <div className="grk-manage">
                <Eyebrow meta={cr(squadPrice(squad))}>{squad.name}</Eyebrow>
                <p className="grk-quiet" data-tone={refusal ? "warn" : undefined}>
                    {refusal ?? (here ? "On the stands" : `${squad.units.length} units`)}
                </p>
                <ActionRow
                    id="sb-manage-load"
                    group="sb-manage"
                    instant
                    label="Load"
                    title={`Load ${squad.name}`}
                    hint={refusal ?? "Put this squad on the stands"}
                    commands={[
                        {
                            action: "confirm",
                            label: "Load",
                            tone: "primary",
                            deny: refusal ?? undefined,
                            run: onLoad,
                        },
                        back,
                    ]}
                />
                <ActionRow
                    id="sb-manage-overwrite"
                    group="sb-manage"
                    label="Overwrite with the stands"
                    title={`Overwrite ${squad.name}`}
                    hint={
                        incomplete
                            ? "Every unit needs a type first"
                            : here
                              ? "It is the same as the squad on the stands"
                              : "Replace it with the squad on the stands"
                    }
                    commands={[
                        {
                            action: "confirm",
                            label: "Overwrite",
                            tone: "primary",
                            deny: incomplete
                                ? "Every unit needs a type first"
                                : here
                                  ? "It is the same as the squad on the stands"
                                  : undefined,
                            run: onOverwrite,
                        },
                        back,
                    ]}
                />
                <ActionRow
                    id="sb-manage-rename"
                    group="sb-manage"
                    instant
                    label="Rename"
                    title={`Rename ${squad.name}`}
                    hint="Give it another name"
                    commands={[
                        { action: "confirm", label: "Rename", tone: "primary", run: onRename },
                        back,
                    ]}
                />
                <ActionRow
                    id="sb-manage-delete"
                    group="sb-manage"
                    tone="danger"
                    label="Delete"
                    title={`Delete ${squad.name}`}
                    hint="Removes the saved squad; the stands keep what they have"
                    commands={[
                        { action: "confirm", label: "Delete", tone: "danger", run: onDelete },
                        back,
                    ]}
                />
            </div>
        </FocusScope>
    );
}
