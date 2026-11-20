// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The squad preset shelf: a short row of engraved plaques above the podiums
 * (name and cost against the cap; the rest when focused), a plaque to save
 * the squad as a new preset, the per-preset action list and the naming
 * prompt. UI only: presets live in this device's storage (`presets.ts`).
 */

import { useLayoutEffect, useRef, useState } from "react";

import {
    ActionRow,
    FocusScope,
    Icon,
    Prompt,
    TextField,
    useFocusable,
    useFocusState,
    type Command,
    type GlyphSet,
} from "../../ui";
import { followScroll } from "../../ui/list-math";
import { gearName, ITEMS } from "./data";
import { gaps, MAX_PRESETS, presetCost, type Inventory, type Preset } from "./presets";

const ROMAN = ["", "I", "II", "III"];

/** The names of what a preset lacks, for the bar. */
export function missingLine(preset: Preset, inventory: Inventory): string | null {
    const all = gaps(preset, inventory).flatMap((g) => g.items);
    if (!all.length) return null;
    return `Missing: ${[...new Set(all)].map((id) => gearName(id) ?? id).join(", ")}`;
}

type PlaqueProps = {
    preset: Preset;
    cap: number;
    applied: boolean;
    modified: boolean;
    inventory: Inventory;
    commands: Command[];
};

function Plaque({ preset, cap, applied, modified, inventory, commands }: PlaqueProps) {
    const cost = presetCost(preset);
    const missing = missingLine(preset, inventory);
    const { props } = useFocusable<HTMLButtonElement>({
        id: `preset-${preset.id}`,
        group: "presets",
        title: `${preset.name}${applied ? (modified ? " · modified" : " · applied") : ""}`,
        hint: missing ?? (cost > cap ? `Over the cap by ${cost - cap}` : `Cost ${cost} of ${cap}`),
        commands,
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="uis-preset"
            data-applied={applied || undefined}
            data-gap={missing ? "" : undefined}
            {...props}
        >
            <span className="uis-preset-head">
                <span className="uis-preset-name">{preset.name}</span>
                <span className="uis-plate-marker" data-marker={preset.builtIn ? "base" : "custom"}>
                    {preset.builtIn ? "Base" : "Custom"}
                </span>
            </span>
            <span className="uis-preset-kit" aria-hidden>
                {preset.podiums.map((slot, i) => (
                    <span key={i} data-empty={!slot || undefined}>
                        <Icon name="primary" size={10} />
                        {slot?.loadout.primary
                            ? ROMAN[ITEMS[slot.loadout.primary]?.tier ?? 1]
                            : "–"}
                        <Icon name="armor" size={10} />
                        {slot?.loadout.armor ? ROMAN[ITEMS[slot.loadout.armor]?.tier ?? 1] : "–"}
                    </span>
                ))}
            </span>
            <span className="uis-preset-cost" data-over={cost > cap || undefined}>
                {cost} / {cap}
            </span>
        </button>
    );
}

/** The plaque that saves the podiums as a new preset. */
function SavePlaque({ full, onSave }: { full: boolean; onSave: () => void }) {
    const { props } = useFocusable<HTMLButtonElement>({
        id: "preset-new",
        group: "presets",
        title: "New preset",
        hint: "Save the squad on the podiums as a preset",
        commands: [
            {
                action: "confirm",
                label: "Save squad as preset",
                short: "Save",
                tone: "primary",
                deny: full ? `${MAX_PRESETS} presets at most. Delete one first` : undefined,
                run: onSave,
            },
        ],
    });
    return (
        <button type="button" tabIndex={-1} className="uis-preset" data-new {...props}>
            <span className="uis-preset-name">+ Save squad</span>
        </button>
    );
}

type RailProps = {
    presets: Preset[];
    cap: number;
    applied: string | null;
    modified: boolean;
    inventory: Inventory;
    full: boolean;
    commandsFor: (preset: Preset) => Command[];
    onSaveNew: () => void;
};

export function PresetRail({
    presets,
    cap,
    applied,
    modified,
    inventory,
    full,
    commandsFor,
    onSaveNew,
}: RailProps) {
    const store = useFocusState();
    const ref = useRef<HTMLDivElement>(null);
    // Follow the cursor along the shelf, the way <List> does down a column:
    // keys keep the next plaque peeking in, a pointer only nudges a clipped one.
    const focused = store.node(store.focused)?.el as HTMLElement | null | undefined;
    useLayoutEffect(() => {
        const rail = ref.current;
        if (!rail || !focused || !rail.contains(focused)) return;
        const v = rail.getBoundingClientRect();
        const r = focused.getBoundingClientRect();
        const scale = v.width / rail.clientWidth || 1;
        const item = { top: (r.left - v.left) / scale + rail.scrollLeft, height: r.width / scale };
        const view = { top: rail.scrollLeft, height: rail.clientWidth, content: rail.scrollWidth };
        const left = followScroll(view, item, store.pointer ? 0 : item.height / 2);
        if (left !== rail.scrollLeft) rail.scrollLeft = left;
    }, [focused, store.pointer, store.version]);
    return (
        <div ref={ref} className="uis-presets" role="listbox" aria-label="Squad presets">
            {presets.map((preset) => (
                <Plaque
                    key={preset.id}
                    preset={preset}
                    cap={cap}
                    applied={preset.id === applied}
                    modified={preset.id === applied && modified}
                    inventory={inventory}
                    commands={commandsFor(preset)}
                />
            ))}
            <SavePlaque full={full} onSave={onSaveNew} />
        </div>
    );
}

type ManageProps = {
    preset: Preset;
    modified: boolean;
    applied: boolean;
    full: boolean;
    onRevert: () => void;
    onOverwrite: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onClose: () => void;
};

/** A preset's actions, as a short list standing in for the shelf's corner. */
export function ManagePreset(p: ManageProps) {
    const close: Command = { action: "back", label: "Close", run: p.onClose };
    const fixed = p.preset.builtIn
        ? "Built-in presets don't change. Duplicate it first"
        : undefined;
    const row = (id: string, label: string, run: () => void, deny?: string, tone?: "danger") => (
        <ActionRow
            key={id}
            id={`manage-${id}`}
            group="manage"
            label={label}
            tone={tone === "danger" ? "danger" : "default"}
            title={label}
            hint={deny}
            commands={[{ action: "confirm", label, tone: tone ?? "primary", deny, run }, close]}
        />
    );
    return (
        <FocusScope id="manage-preset" back={close}>
            <div className="uis-manage gui-panel">
                <header className="gui-panel-head">
                    <span className="gui-panel-label">{p.preset.name}</span>
                </header>
                <div className="gui-panel-body">
                    {p.applied && p.modified && row("revert", "Revert the podiums", p.onRevert)}
                    {row("overwrite", "Overwrite with this squad", p.onOverwrite, fixed)}
                    {row("rename", "Rename", p.onRename, fixed)}
                    {row(
                        "duplicate",
                        "Duplicate",
                        p.onDuplicate,
                        p.full ? `${MAX_PRESETS} presets at most. Delete one first` : undefined,
                    )}
                    {row("delete", "Delete", p.onDelete, fixed, "danger")}
                </div>
            </div>
        </FocusScope>
    );
}

type NameProps = {
    title: string;
    initial: string;
    confirm: string;
    glyphs: GlyphSet;
    onDone: (name: string) => void;
    onCancel: () => void;
};

/** Names a preset: the keyboard types; a pad confirms the name it opens with. */
export function NamePrompt({ title, initial, confirm, glyphs, onDone, onCancel }: NameProps) {
    const [name, setName] = useState(initial);
    const submit = () => name.trim() && onDone(name.trim());
    return (
        <Prompt
            id="prompt-preset-name"
            eyebrow="Squad preset"
            title={title}
            confirm={{ label: confirm, run: submit }}
            cancel={{ label: "Cancel", run: onCancel }}
            glyphs={glyphs}
        >
            Saved on this device
            <TextField label="Name" value={name} onChange={setName} onSubmit={submit} />
        </Prompt>
    );
}
