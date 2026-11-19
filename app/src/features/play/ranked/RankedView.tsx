// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Ranked: pick 3x3 or 4x4, build the squad from presets and swaps within the
 * rank's credit budget, find a mock opponent. The builder's rules are in
 * `model.ts`; every preset, item, price and number comes from the economy.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    FocusCommandBar,
    FocusRoot,
    FocusScope,
    Icon,
    List,
    ListRow,
    Meter,
    Panel,
    Prompt,
    ReadoutLine,
    ScreenFrame,
    SLOT_ICON,
    StatusChip,
    STAT_ICON,
    Thumb,
    ActionRow,
    Eyebrow,
    useFocusState,
    useFocusStore,
    useFocusable,
    useGlyphSet,
    type Command,
} from "../../../ui";
import {
    budgetOf,
    changesFrom,
    changesText,
    itemOf,
    presetsFor,
    priceOf,
    squadSize,
    tierOf,
    unitStats,
    type Issue,
    type Loadout,
    type Mode,
} from "../economy";
import { stageMockMatch } from "../match";
import { useRating } from "../rating";
import {
    applyOption,
    budgetView,
    changeSummary,
    opponentFor,
    parseSaved,
    pickSections,
    presetOf,
    seenNow,
    serializeSaved,
    signed,
    SIZES,
    squadFor,
    startGate,
    statChanges,
    statLines,
    STORE_KEY,
    switchMode,
    tierNotice,
    unitIssues,
    type PickOption,
    type Saved,
} from "./model";
import "./ranked.css";

const SEARCH_MS = 2800;
const FOUND_MS = 1300;

type Search = { phase: "searching" } | { phase: "found"; name: string; rating: number };

function load(): Saved {
    try {
        return parseSaved(localStorage.getItem(STORE_KEY));
    } catch {
        return parseSaved(null);
    }
}

function save(saved: Saved) {
    try {
        localStorage.setItem(STORE_KEY, serializeSaved(saved));
    } catch {
        // Storage may be unavailable; the squad lasts for the visit.
    }
}

export function RankedView() {
    const glyphs = useGlyphSet();
    const navigate = useNavigate();
    const { rating } = useRating();
    const tier = tierOf(rating);

    const [saved, setSaved] = useState<Saved>(load);
    const mode = saved.mode;
    const squad = useMemo(() => squadFor(saved, rating, mode), [saved, rating, mode]);
    const [editing, setEditing] = useState<number | null>(null);
    const [search, setSearch] = useState<Search | null>(null);
    const [notice] = useState(() => tierNotice(saved, rating, mode, squad));

    // Remember the squad of each size and the tier the player last saw.
    useEffect(() => {
        save({ ...saved, squads: { ...saved.squads, [mode]: squad }, seen: seenNow(rating, mode) });
    }, [saved, squad, mode, rating]);

    const setSquad = (next: Loadout[]) =>
        setSaved((s) => ({ ...s, squads: { ...s.squads, [mode]: next } }));
    const pickMode = (to: Mode) => {
        if (to === mode) return;
        setEditing(null);
        setSaved((s) => switchMode(s, rating, mode, squad, to));
    };

    const view = budgetView(squad, rating, mode);
    const gate = startGate(squad, rating, mode);
    const issues = unitIssues(squad, rating, mode);

    // The mock search: a few seconds, then an opponent, then the match.
    useEffect(() => {
        if (!search) return;
        if (search.phase === "searching") {
            const timer = window.setTimeout(
                () => setSearch({ phase: "found", ...opponentFor(rating) }),
                SEARCH_MS,
            );
            return () => window.clearTimeout(timer);
        }
        const timer = window.setTimeout(() => {
            const route = stageMockMatch({
                kind: "ranked",
                mode,
                squad,
                opponent: { name: search.name, rating: search.rating },
                returnTo: "/play/ranked",
            });
            navigate(route);
        }, FOUND_MS);
        return () => window.clearTimeout(timer);
        // The squad and mode cannot change while the search prompt holds the screen.
    }, [search?.phase]);

    const leave = () => navigate("/play", { replace: true });
    const back: Command = { action: "back", label: "Back", run: leave };
    const cancelSearch = () => setSearch(null);

    const prompt = search && (
        <Prompt
            id="prompt-search"
            eyebrow={`Ranked ${mode}`}
            title={search.phase === "searching" ? "Looking for an opponent" : "Opponent found"}
            lines={
                search.phase === "searching"
                    ? [
                          ["Your rating", rating],
                          ["Squad", `${squad.length} units, ${view.spent} credits`],
                      ]
                    : [
                          ["Opponent", search.name],
                          ["Rating", search.rating],
                      ]
            }
            hint={search.phase === "searching" ? "Searching" : "Starting the match"}
            confirm={{
                label: search.phase === "searching" ? "Searching" : "Starting",
                run: () => {},
                deny: search.phase === "searching" ? "Still searching" : "Starting the match",
            }}
            cancel={{ label: "Cancel search", run: cancelSearch }}
            glyphs={glyphs}
        >
            {search.phase === "searching"
                ? "A player near your rating, from the preview pool."
                : "Taking you to the field."}
        </Prompt>
    );

    const startCommand: Command = {
        action: "confirm",
        label: "Find ranked match",
        tone: "primary",
        deny: gate.ok ? undefined : gate.reason,
        run: () => setSearch({ phase: "searching" }),
    };

    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Ranked"]}
                onLocation={leave}
                status={
                    <>
                        {search && (
                            <StatusChip
                                label="Match"
                                value={search.phase === "searching" ? "Searching" : "Found"}
                                state="live"
                            />
                        )}
                        <StatusChip label="Tier" value={tier.name} />
                    </>
                }
                columns="minmax(260px, 310px) minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
                overlay={prompt}
            >
                <Panel label="Match" meta={`${tier.name} · ${rating}`} className="grk-side">
                    <div className="grk-sizes">
                        {SIZES.map((size) => (
                            <ListRow
                                key={size}
                                id={`size-${size}`}
                                group="side"
                                instant
                                name={size}
                                kind={`${squadSize(size)} units`}
                                tag={`${budgetOf(rating, size)} cr`}
                                selected={size === mode}
                                title={`Ranked ${size}`}
                                hint={`${squadSize(size)} units, ${budgetOf(rating, size)} credits at ${tier.name}`}
                                commands={[
                                    {
                                        action: "confirm",
                                        label: size === mode ? "Selected" : `Play ${size}`,
                                        tone: "primary",
                                        run: () => pickMode(size),
                                    },
                                ]}
                            />
                        ))}
                    </div>
                    <div className="grk-budget">
                        <Meter
                            label="Credits"
                            value={Math.min(view.spent, view.budget)}
                            max={view.budget}
                            tone={view.over ? "warn" : undefined}
                            readout={
                                <>
                                    {view.spent} / {view.budget}
                                    {" · "}
                                    {view.over ? `${-view.left} over` : `${view.left} left`}
                                </>
                            }
                        />
                    </div>
                    <div className="grk-readouts">
                        <ReadoutLine label="Tier">{tier.name}</ReadoutLine>
                        <ReadoutLine label="Rating">{rating}</ReadoutLine>
                    </div>
                    {notice && <p className="gui-note grk-notice">{notice}</p>}
                    <ActionRow
                        id="start"
                        group="side"
                        label="Find ranked match"
                        title="Find ranked match"
                        hint={gate.ok ? "Search for an opponent near your rating" : gate.reason}
                        commands={[startCommand]}
                    />
                    <p className="gui-note grk-preview">
                        Preview. Units exist for this match only and nothing is saved to your
                        account.
                    </p>
                </Panel>

                <Panel
                    label={
                        editing === null ? "Squad" : `Unit ${String(editing + 1).padStart(2, "0")}`
                    }
                    meta={editing === null ? `${squad.length} units` : undefined}
                    className="grk-main"
                >
                    {editing === null ? (
                        <SquadList
                            squad={squad}
                            rating={rating}
                            issues={issues}
                            onEdit={setEditing}
                        />
                    ) : (
                        <UnitPicker
                            squad={squad}
                            index={editing}
                            rating={rating}
                            mode={mode}
                            onChange={setSquad}
                            onClose={() => setEditing(null)}
                        />
                    )}
                </Panel>
                <StartOn id="unit-0" />
            </ScreenFrame>
        </FocusRoot>
    );
}

/** The cursor starts on the first unit, where the work is, not on the size row. */
function StartOn({ id }: { id: string }) {
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus(id, false);
        // Once, on arrival.
    }, [store, id]);
    return null;
}

/* === Squad ============================================================ */

function itemName(id: string | null): string {
    return id ? (itemOf(id)?.name ?? id) : "None";
}

function presetName(unit: Loadout, rating: number): string {
    const name =
        presetOf(rating, unit.preset)?.name ??
        unit.preset.charAt(0).toUpperCase() + unit.preset.slice(1);
    return changesFrom(unit).length > 0 ? `${name} · modified` : name;
}

function StatCells({ unit }: { unit: Loadout }) {
    return (
        <span className="grk-stats">
            {statLines(unitStats(unit)).map((line) => (
                <span key={line.key} className="grk-stat" title={line.label}>
                    {STAT_ICON[line.key === "hp" ? "health" : line.key] ? (
                        <Icon name={STAT_ICON[line.key === "hp" ? "health" : line.key]} size={12} />
                    ) : (
                        <span className="grk-stat-short">{line.short}</span>
                    )}
                    {line.text}
                </span>
            ))}
        </span>
    );
}

function SquadList({
    squad,
    rating,
    issues,
    onEdit,
}: {
    squad: Loadout[];
    rating: number;
    issues: ReturnType<typeof unitIssues>;
    onEdit: (index: number) => void;
}) {
    return (
        <List label="Squad">
            {squad.map((unit, i) => (
                <UnitRow
                    key={i}
                    index={i}
                    unit={unit}
                    rating={rating}
                    problem={issues.get(i)?.[0]}
                    onEdit={() => onEdit(i)}
                />
            ))}
        </List>
    );
}

function UnitRow({
    index,
    unit,
    rating,
    problem,
    onEdit,
}: {
    index: number;
    unit: Loadout;
    rating: number;
    problem?: Issue;
    onEdit: () => void;
}) {
    const preset = presetOf(rating, unit.preset);
    const modified = changesFrom(unit).length > 0;
    const { props } = useFocusable<HTMLButtonElement>({
        id: `unit-${index}`,
        group: "squad",
        instant: true,
        title: `Unit ${index + 1} · ${presetName(unit, rating)}`,
        hint:
            problem?.message ??
            (modified ? changesText(unit) : preset?.role) ??
            "Change preset, weapon, armor or utility",
        commands: [{ action: "confirm", label: "Edit", tone: "primary", run: onEdit }],
    });
    return (
        <button type="button" tabIndex={-1} className="grk-unit" {...props}>
            <span className="grk-unit-no">{String(index + 1).padStart(2, "0")}</span>
            <span className="grk-unit-main">
                <span className="grk-unit-head">
                    <span className="grk-unit-name">{presetName(unit, rating)}</span>
                    <span className="grk-unit-price" data-tone={problem ? "warn" : undefined}>
                        {problem
                            ? problem.kind === "locked"
                                ? "Locked"
                                : "Check"
                            : `${priceOf(unit)} cr`}
                    </span>
                </span>
                {preset && (
                    <span className="grk-unit-role">
                        {modified ? changesText(unit) : preset.role}
                    </span>
                )}
                <span className="grk-unit-gear">
                    <span>
                        <Icon name={SLOT_ICON.primary} size={12} />
                        {itemName(unit.weapon)}
                    </span>
                    <span>
                        <Icon name={SLOT_ICON.armor} size={12} />
                        {itemName(unit.armor)}
                    </span>
                    <span>
                        <Icon name={SLOT_ICON.utility} size={12} />
                        {itemName(unit.utility)}
                    </span>
                </span>
                <StatCells unit={unit} />
            </span>
        </button>
    );
}

/* === Picker =========================================================== */

const GROUP_ICON = {
    preset: SLOT_ICON.primary,
    weapon: SLOT_ICON.primary,
    armor: SLOT_ICON.armor,
    utility: SLOT_ICON.utility,
};

function UnitPicker({
    squad,
    index,
    rating,
    mode,
    onChange,
    onClose,
}: {
    squad: Loadout[];
    index: number;
    rating: number;
    mode: Mode;
    onChange: (next: Loadout[]) => void;
    onClose: () => void;
}) {
    const store = useFocusState();
    const unit = squad[index];
    const sections = pickSections(squad, index, rating, mode);
    const all = sections.flatMap((s) => s.options);
    const byId = new Map(all.map((o) => [`pick-${o.key}`, o]));
    const previewed = (store.preview && byId.get(store.preview)) || null;
    const current = presetsFor(rating).find((p) => p.id === unit.preset);
    const start = current ? `pick-preset:${current.id}` : undefined;

    const close: Command = { action: "back", label: "Done", run: onClose };
    const shown = previewed && !previewed.current && !previewed.locked ? previewed : null;
    const after = shown?.unit ?? unit;
    const changes = statChanges(unit, after).filter((c) => c.delta !== 0);

    return (
        <FocusScope id="picker" back={close} start={start}>
            <List label="Unit">
                {sections.map((section) => (
                    <PickSectionRows
                        key={section.group}
                        unit={unit}
                        section={section}
                        onPick={(option: PickOption) =>
                            onChange(applyOption(squad, index, option, rating))
                        }
                        close={close}
                    />
                ))}
            </List>
            <div className="grk-detail">
                <Eyebrow>
                    {shown
                        ? `If chosen · ${shown.leftAfter >= 0 ? `${shown.leftAfter} left` : `${-shown.leftAfter} over`}`
                        : `Now · ${priceOf(unit)} cr`}
                </Eyebrow>
                {changes.length > 0 && (
                    <div className="grk-detail-grid">
                        {changes.map((c) => (
                            <span
                                key={c.key}
                                className="grk-cell"
                                data-trend={c.delta > 0 ? "buff" : "nerf"}
                            >
                                <span className="grk-cell-label">{c.label}</span>
                                <span className="grk-cell-value">{c.text}</span>
                                <span className="grk-cell-delta">
                                    {c.delta > 0 ? "▲" : "▼"} {signed(c.delta)}
                                </span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </FocusScope>
    );
}

function PickSectionRows({
    unit,
    section,
    onPick,
    close,
}: {
    unit: Loadout;
    section: ReturnType<typeof pickSections>[number];
    onPick: (option: PickOption) => void;
    close: Command;
}) {
    const fixed = section.fixed;
    return (
        <>
            <div className="grk-section">
                <span>{section.title}</span>
                {fixed && <span>{fixed}</span>}
            </div>
            {section.options.map((option) => {
                const summary = changeSummary(statChanges(unit, option.unit));
                const line = option.locked
                    ? option.locked
                    : option.group === "preset"
                      ? `${option.leftAfter >= 0 ? `${option.leftAfter} left` : `${-option.leftAfter} over`} · ${option.role}`
                      : `${option.price} cr${summary ? ` · ${summary}` : ""}`;
                const deny = fixed ?? option.locked;
                return (
                    <ListRow
                        key={option.key}
                        id={`pick-${option.key}`}
                        group="picker"
                        instant
                        previews
                        thumb={<Thumb icon={GROUP_ICON[option.group]} />}
                        name={option.name}
                        kind={line}
                        tag={
                            option.current
                                ? "Equipped"
                                : option.group === "preset"
                                  ? `${option.price} cr`
                                  : `${signed(option.delta)} cr`
                        }
                        tagTone={
                            option.current ? "accent" : option.leftAfter < 0 ? "warn" : "default"
                        }
                        selected={option.current}
                        locked={!!option.locked}
                        title={option.name}
                        hint={
                            deny
                                ? deny
                                : `${option.leftAfter >= 0 ? `${option.leftAfter} credits left` : `${-option.leftAfter} credits over`} if chosen`
                        }
                        commands={[
                            {
                                action: "confirm",
                                label: option.current ? "Equipped" : "Choose",
                                tone: "primary",
                                deny,
                                run: () => onPick(option),
                            },
                            close,
                        ]}
                    />
                );
            })}
        </>
    );
}
