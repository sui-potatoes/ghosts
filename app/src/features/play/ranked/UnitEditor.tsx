// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * One unit's editor, in two steps. Unit type: the built-in types and the
 * player's own, each with its price; choosing one gives the unit that type's
 * kit and moves on. Equipment: weapon, armor and utility for that type, with
 * the type above them as a row that goes back to the first step.
 *
 * The detail panel beside the list always exists and only changes its
 * contents: what the row under the cursor costs, what it leaves, and every
 * stat now and after, in fixed rows. Nothing in the layout changes size when
 * the cursor or the pointer moves.
 */

import { useLayoutEffect } from "react";

import {
    ActionRow,
    Eyebrow,
    FocusScope,
    List,
    ListRow,
    SLOT_ICON,
    Thumb,
    useFocusState,
    type Command,
} from "../../../ui";
import { PRESETS, priceOf, type Loadout } from "../economy";
import {
    changeSummary,
    cr,
    crDelta,
    gearSections,
    gearText,
    leavesText,
    statChanges,
    typeName,
    typeSection,
    type Limits,
    type PickOption,
    type Stand,
} from "./model";
import type { SavedType } from "./presets";
import { unitNumber } from "./figures";

export type EditorStep = "type" | "gear";

const GROUP = "sb-editor";
export const optionId = (key: string) => `sb-opt-${key}`;
const TYPE_ROW = "sb-type-row";
const SAVE_TYPE = "sb-save-type";

const ICON = {
    preset: SLOT_ICON.armor,
    weapon: SLOT_ICON.primary,
    armor: "shield",
    utility: SLOT_ICON.utility,
} as const;

type Props = {
    stands: Stand[];
    index: number;
    step: EditorStep;
    limits: Limits;
    mine: SavedType[];
    onStep: (step: EditorStep) => void;
    /** A row was chosen. */
    onPick: (option: PickOption) => void;
    onClose: () => void;
    /** Why the unit cannot be saved as a type of its own, or null. */
    saveTypeRefusal: string | null;
    onSaveType: () => void;
    onDeleteType: (type: SavedType) => void;
};

/** Every option the editor shows, by focus id (for the detail panel and the stage preview). */
export function editorOptions(
    stands: Stand[],
    index: number,
    step: EditorStep,
    limits: Limits,
    mine: SavedType[],
): Map<string, PickOption> {
    const options =
        step === "type"
            ? typeSection(stands, index, limits, mine).options
            : gearSections(stands, index, limits).flatMap((s) => s.options);
    return new Map(options.map((o) => [optionId(o.key), o]));
}

/** Puts the cursor on `id` when `step` changes (and on open). */
function FocusOnStep({ id, step }: { id: string; step: EditorStep }) {
    const store = useFocusState();
    useLayoutEffect(() => {
        store.focus(id, false);
        // On each step, not on each id change.
    }, [store, step]);
    return null;
}

export function UnitEditor({
    stands,
    index,
    step,
    limits,
    mine,
    onStep,
    onPick,
    onClose,
    saveTypeRefusal,
    onSaveType,
    onDeleteType,
}: Props) {
    const store = useFocusState();
    const unit = stands[index];
    const isNew = !unit;
    const showing: EditorStep = isNew ? "type" : step;

    const back: Command =
        showing === "type" && !isNew
            ? { action: "back", label: "Equipment", run: () => onStep("gear") }
            : { action: "back", label: "Done", run: onClose };

    const types = typeSection(stands, index, limits, mine);
    const gear = showing === "gear" ? gearSections(stands, index, limits) : [];
    const options = showing === "type" ? types.options : gear.flatMap((s) => s.options);
    const byId = new Map(options.map((o) => [optionId(o.key), o]));
    const previewed = (store.preview && byId.get(store.preview)) || null;

    // What the unit is now: its exact type, else the built-in type it started from.
    const current =
        options.find((o) => o.current) ??
        (showing === "type" && unit
            ? options.find((o) => o.key === `preset:${unit.preset}` && !o.locked)
            : undefined);
    const firstOpen = options.find((o) => !o.locked);
    const weapon = gear[0]?.options.find((o) => o.current);
    const start =
        showing === "type"
            ? optionId((current ?? firstOpen ?? options[0]).key)
            : weapon
              ? optionId(weapon.key)
              : TYPE_ROW;

    const builtIn = types.options.filter((o) => !o.mine);
    const own = types.options.filter((o) => o.mine);

    return (
        <FocusScope id="sb-editor" back={back} start={start}>
            <div className="grk-editor">
                <div className="grk-editor-list">
                    {showing === "type" ? (
                        <List label={`Unit ${index + 1} type`}>
                            {!isNew && (
                                <p className="grk-warn-note">
                                    <i className="gui-warn-mark" aria-hidden />
                                    Choosing a type replaces this unit&apos;s equipment with that
                                    type&apos;s kit
                                </p>
                            )}
                            <Eyebrow>Built in</Eyebrow>
                            {builtIn.map((o) => (
                                <OptionRow
                                    key={o.key}
                                    option={o}
                                    unit={unit}
                                    back={back}
                                    onPick={onPick}
                                />
                            ))}
                            <Eyebrow meta={`${own.length} / ${8}`}>Yours</Eyebrow>
                            {own.length === 0 && (
                                <p className="grk-quiet">
                                    Change a unit&apos;s equipment, then save it as your own type
                                </p>
                            )}
                            {own.map((o) => (
                                <OptionRow
                                    key={o.key}
                                    option={o}
                                    unit={unit}
                                    back={back}
                                    onPick={onPick}
                                    onDelete={() => {
                                        const type = mine.find((t) => `mine:${t.id}` === o.key);
                                        if (type) onDeleteType(type);
                                    }}
                                />
                            ))}
                        </List>
                    ) : (
                        <List label={`Unit ${index + 1} equipment`}>
                            <TypeRow
                                unit={unit!}
                                limits={limits}
                                mine={mine}
                                back={back}
                                onChange={() => onStep("type")}
                            />
                            {gear.map((section) => (
                                <div key={section.group} className="grk-section">
                                    <Eyebrow meta={section.fixed}>{section.title}</Eyebrow>
                                    {section.options.map((o) => (
                                        <OptionRow
                                            key={o.key}
                                            option={o}
                                            unit={unit}
                                            back={back}
                                            fixed={section.fixed}
                                            onPick={onPick}
                                        />
                                    ))}
                                </div>
                            ))}
                            <ActionRow
                                id={SAVE_TYPE}
                                group={GROUP}
                                label="Save as my type"
                                title="Save as my type"
                                hint={
                                    saveTypeRefusal ??
                                    "Name this equipment and choose it for any unit"
                                }
                                instant
                                commands={[
                                    {
                                        action: "confirm",
                                        label: "Save type",
                                        short: "Save",
                                        tone: "primary",
                                        deny: saveTypeRefusal ?? undefined,
                                        run: onSaveType,
                                    },
                                    back,
                                ]}
                            />
                        </List>
                    )}
                </div>
                <Detail
                    unit={unit}
                    index={index}
                    option={previewed && !previewed.current ? previewed : null}
                    limits={limits}
                    stands={stands}
                    mine={mine}
                />
            </div>
            {/* After the rows, so the row it puts the cursor on is registered. */}
            <FocusOnStep id={start} step={showing} />
        </FocusScope>
    );
}

function TypeRow({
    unit,
    limits,
    mine,
    back,
    onChange,
}: {
    unit: Loadout;
    limits: Limits;
    mine: SavedType[];
    back: Command;
    onChange: () => void;
}) {
    return (
        <ListRow
            id={TYPE_ROW}
            group={GROUP}
            instant
            thumb={<Thumb icon={ICON.preset} />}
            name={typeName(unit, limits.rating, mine)}
            kind="Unit type"
            tag="Change"
            title={`Type · ${typeName(unit, limits.rating, mine)}`}
            hint="Change type: the equipment resets to the new type's kit"
            commands={[
                {
                    action: "confirm",
                    label: "Change type",
                    tone: "primary",
                    run: onChange,
                },
                back,
            ]}
        />
    );
}

function OptionRow({
    option,
    unit,
    back,
    fixed,
    onPick,
    onDelete,
}: {
    option: PickOption;
    unit: Stand;
    back: Command;
    fixed?: string;
    onPick: (option: PickOption) => void;
    onDelete?: () => void;
}) {
    const isType = option.group === "preset";
    const over = option.leftAfter !== null && option.leftAfter < 0;
    const summary = unit ? changeSummary(statChanges(unit, option.unit)) : "";
    const kind = option.locked
        ? option.locked
        : [
              over && !option.current ? leavesText(option.leftAfter) : "",
              isType ? gearText(option.unit) : option.current ? "" : summary,
          ]
              .filter(Boolean)
              .join(" · ");
    const deny = fixed ?? option.locked;
    const commands: Command[] = [
        {
            action: "confirm",
            label: option.current ? (isType ? "Choose again" : "Equipped") : "Choose",
            tone: "primary",
            deny,
            run: () => onPick(option),
        },
        ...(onDelete
            ? [{ action: "reset", label: "Delete type", short: "Delete", run: onDelete } as Command]
            : []),
        back,
    ];
    return (
        <ListRow
            id={optionId(option.key)}
            group={GROUP}
            instant
            previews
            thumb={<Thumb icon={ICON[option.group]} />}
            name={option.name}
            kind={kind || undefined}
            tag={
                option.current
                    ? isType
                        ? "Current"
                        : "Equipped"
                    : isType
                      ? cr(option.price)
                      : crDelta(option.delta)
            }
            tagTone={option.current ? "accent" : over ? "warn" : "default"}
            selected={option.current}
            locked={!!option.locked}
            title={isType ? `${option.name} · ${cr(option.price)}` : option.name}
            hint={
                deny
                    ? deny
                    : isType
                      ? `${gearText(option.unit)} · ${leavesText(option.leftAfter)}`
                      : `${cr(option.price)} · ${crDelta(option.delta)} on this unit · ${leavesText(option.leftAfter)}`
            }
            commands={commands}
        />
    );
}

/** The fixed detail panel: what the row under the cursor would do, or the unit as it is. */
function Detail({
    unit,
    index,
    option,
    limits,
    stands,
    mine,
}: {
    unit: Stand;
    index: number;
    option: PickOption | null;
    limits: Limits;
    stands: Stand[];
    mine: SavedType[];
}) {
    const after = option?.unit ?? unit;
    // The rows are always there: with nothing to show, a reference unit lends its labels.
    const changes = statChanges(unit ?? after ?? PRESETS[0].loadout, after ?? PRESETS[0].loadout);
    const spent = stands.reduce((n, u) => n + (u ? priceOf(u) : 0), 0);
    const leftNow = limits.budget === null ? null : limits.budget - spent;
    const left = option ? option.leftAfter : leftNow;
    const over = left !== null && left < 0;
    const title = option ? option.name : unit ? typeName(unit, limits.rating, mine) : "No type";
    const text = option
        ? (option.locked ?? (option.description || option.role || gearText(option.unit)))
        : unit
          ? gearText(unit)
          : `Unit ${unitNumber(index)} has no type. Choose one to give it a kit`;
    return (
        <aside className="grk-detail" aria-live="polite">
            <span className="grk-detail-eyebrow">{option ? "If chosen" : "Now"}</span>
            <span className="grk-detail-name">{title}</span>
            <span className="grk-detail-text" data-tone={option?.locked ? "warn" : undefined}>
                {text}
            </span>
            <dl className="grk-detail-lines">
                <div>
                    <dt>{option && option.group !== "preset" ? "Item price" : "Unit price"}</dt>
                    <dd>{option ? cr(option.price) : unit ? cr(priceOf(unit)) : "—"}</dd>
                </div>
                <div>
                    <dt>Change</dt>
                    <dd>{option ? crDelta(option.delta) : "—"}</dd>
                </div>
                <div data-tone={over ? "warn" : undefined}>
                    <dt>{option ? "After choice" : "Squad budget"}</dt>
                    <dd>
                        {left === null ? "No limit" : over ? `${-left} cr over` : `${left} cr left`}
                    </dd>
                </div>
            </dl>
            <div className="grk-detail-stats" role="table" aria-label="Stats">
                <div className="grk-stat-row" role="row" data-head>
                    <span role="columnheader">Stat</span>
                    <span role="columnheader">Now</span>
                    <span role="columnheader">{option ? "After" : ""}</span>
                    <span role="columnheader" aria-label="Change" />
                </div>
                {changes.map((c) => {
                    const was = unit ? statText(unit, c.key) : "—";
                    return (
                        <div
                            key={c.key}
                            className="grk-stat-row"
                            role="row"
                            data-trend={option ? trendOf(c.delta) : undefined}
                        >
                            <span role="rowheader">{c.label}</span>
                            <span role="cell">{was}</span>
                            <span role="cell">{option ? c.text : ""}</span>
                            <span role="cell">
                                {option && c.delta !== 0 ? signedDelta(c.delta) : ""}
                            </span>
                        </div>
                    );
                })}
            </div>
        </aside>
    );
}

const statText = (unit: Loadout, key: string): string =>
    statChanges(unit, unit).find((c) => c.key === key)?.text ?? "—";

/** Every stat the economy reports is better higher. */
const trendOf = (delta: number) => (delta > 0 ? "buff" : delta < 0 ? "nerf" : undefined);

const signedDelta = (n: number) => (n > 0 ? `▲ ${n}` : `▼ ${-n}`);
