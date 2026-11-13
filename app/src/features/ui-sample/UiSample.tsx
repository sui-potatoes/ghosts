// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/ui-sample` — a fictional armory requisition screen built only from the
 * candidate shared parts (frame, command bar, panels, rows, stats, meters,
 * prompt, focus cursor), so the visual language can be judged before any
 * real screen moves onto it. Nothing here touches the chain or an account.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { uiTick } from "../../audio";
import { FocusCommandBar } from "./CommandBar";
import {
    credit,
    FITTED,
    ISSUED,
    SECTIONS,
    SPARE_MOD,
    START_BALANCE,
    STATS,
    STOCK,
    type Item,
    type Section,
} from "./data";
import { FocusRoot, useFocusState, type Command } from "./focus";
import { ScreenFrame, StatusChip, Tabs } from "./frame";
import { useGlyphSet, type GlyphSet } from "./glyphs";
import { EmptyState, Eyebrow, ListRow, Meter, Panel, ReadoutLine, SlotRow, StatRow } from "./parts";
import { Prompt } from "./Prompt";
import "./ui-sample.css";

const CARRY_LIMIT = 12;
const RACK_SIZE = 12;

type PromptState = { kind: "requisition" | "scrap"; item: Item } | null;

export default function UiSample() {
    const navigate = useNavigate();
    const [section, setSection] = useState<Section>("weapons");
    const leave = () => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate("/", { replace: true });
    };
    const step = (dir: 1 | -1) => {
        const i = SECTIONS.findIndex((s) => s.id === section);
        const next = SECTIONS[(i + dir + SECTIONS.length) % SECTIONS.length];
        uiTick(null);
        setSection(next.id);
    };
    return (
        <FocusRoot back={{ action: "back", label: "Leave", run: leave }} onTab={step}>
            <Requisition section={section} onSection={setSection} onLeave={leave} />
        </FocusRoot>
    );
}

function useSearchClock(start: number): string {
    const [s, setS] = useState(start);
    useEffect(() => {
        const t = setInterval(() => setS((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, []);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Props = { section: Section; onSection: (s: Section) => void; onLeave: () => void };

function Requisition({ section, onSection, onLeave }: Props) {
    const store = useFocusState();
    const glyphs = useGlyphSet();
    const clock = useSearchClock(84);
    const [balance, setBalance] = useState(START_BALANCE);
    const [owned, setOwned] = useState(
        () =>
            new Set(
                Object.values(STOCK).flatMap((items) =>
                    items.filter((i) => i.owned).map((i) => i.id),
                ),
            ),
    );
    const [issued, setIssued] = useState(ISSUED);
    const [fitted, setFitted] = useState(FITTED);
    const [prompt, setPrompt] = useState<PromptState>(null);
    const [saving, setSaving] = useState(0);

    useEffect(() => {
        if (!saving) return;
        const t = setTimeout(() => setSaving(0), 1400);
        return () => clearTimeout(t);
    }, [saving]);
    const save = () => setSaving((n) => n + 1);

    // A new section puts the cursor on its first row (after the rows registered).
    useLayoutEffect(() => {
        store.focusGroup("list");
    }, [store, section]);

    const items = STOCK[section];
    const listId = store.remembered("list");
    const preview = items.find((i) => `row-${i.id}` === listId) ?? items[0];
    const issuedItem = items.find((i) => i.id === issued[section]);

    const toList: Command = {
        action: "back",
        label: "Requisition list",
        run: () => store.focusGroup("list", true, true),
    };

    const rowCommands = (item: Item): Command[] => {
        if (item.id === issued[section]) {
            return [
                {
                    action: "confirm",
                    label: "Inspect",
                    tone: "primary",
                    run: () => store.focusGroup("detail", true, true),
                },
            ];
        }
        if (owned.has(item.id)) {
            return [
                {
                    action: "reset",
                    label: "Scrap",
                    tone: "danger",
                    run: () => setPrompt({ kind: "scrap", item }),
                },
                {
                    action: "confirm",
                    label: "Issue to Vex",
                    tone: "primary",
                    run: () => {
                        setIssued((s) => ({ ...s, [section]: item.id }));
                        save();
                    },
                },
            ];
        }
        const short = (item.cost ?? 0) - balance;
        return [
            {
                action: "confirm",
                label: `Requisition  ${credit(item.cost ?? 0)}`,
                tone: "primary",
                deny:
                    item.clearance ??
                    (short > 0
                        ? `Insufficient credit. ${credit(short)} short of the order.`
                        : undefined),
                run: () => setPrompt({ kind: "requisition", item }),
            },
        ];
    };

    const rowTag = (item: Item): [string, "default" | "accent" | "warn" | "dim"] => {
        if (item.id === issued[section]) return ["Issued", "accent"];
        if (owned.has(item.id)) return ["In rack", "default"];
        if (item.clearance) return ["Locked", "dim"];
        if ((item.cost ?? 0) > balance) return [credit(item.cost ?? 0), "warn"];
        return [credit(item.cost ?? 0), "default"];
    };

    const rowHint = (item: Item): string => {
        if (item.id === issued[section]) return "Carried by Vex into the next contract";
        if (owned.has(item.id))
            return "In the armory rack. Issuing it returns the current one to the rack";
        return "Delivered with the next supply drop, before the contract starts";
    };

    const confirmPrompt = () => {
        if (!prompt) return;
        const { kind, item } = prompt;
        if (kind === "requisition") {
            setBalance((b) => b - (item.cost ?? 0));
            setOwned((s) => new Set(s).add(item.id));
            setIssued((s) => ({ ...s, [section]: item.id }));
        } else {
            setBalance((b) => b + refund(item));
            setOwned((s) => {
                const next = new Set(s);
                next.delete(item.id);
                return next;
            });
            setFitted((f) => ({ ...f, [item.id]: {} }));
        }
        setPrompt(null);
        save();
    };

    const ownedCount = owned.size;
    const weightOf = (item?: Item) => item?.stats.find((s) => s.key === "weight")?.value ?? 0;
    const carried = (["weapons", "armor", "utility"] as Section[]).reduce(
        (sum, s) => sum + weightOf(STOCK[s].find((i) => i.id === issued[s])),
        0.9, // the sidearm
    );
    const swing = preview ? weightOf(preview) - weightOf(issuedItem) : 0;

    return (
        <ScreenFrame
            location={["HQ", "Armory"]}
            onLocation={onLeave}
            serial="OPS-NET · RACK 02 · NODE 7F-A2"
            tabs={
                <Tabs
                    tabs={SECTIONS.map((s) => ({ ...s, count: STOCK[s.id].length }))}
                    active={section}
                    onSelect={(id) => onSection(id as Section)}
                    glyphs={glyphs}
                />
            }
            status={
                <>
                    <StatusChip label="Match" value={`Searching ${clock}`} state="live" />
                    <StatusChip
                        label="Records"
                        value={saving ? "Saving" : "Synced"}
                        state={saving ? "busy" : "idle"}
                    />
                    <StatusChip label="Credit" value={credit(balance)} />
                </>
            }
            columns="minmax(300px, 340px) minmax(0, 1fr) 248px"
            commands={<FocusCommandBar glyphs={glyphs} />}
            overlay={
                prompt && (
                    <RequisitionPrompt
                        prompt={prompt}
                        balance={balance}
                        glyphs={glyphs}
                        onConfirm={confirmPrompt}
                        onCancel={() => setPrompt(null)}
                    />
                )
            }
        >
            <Panel
                label="Requisition"
                index="01"
                meta={items.length ? `${items.length} lines` : "—"}
                className="uis-list-panel"
                foot={
                    <Meter
                        label="Armory rack"
                        value={ownedCount}
                        max={RACK_SIZE}
                        segments={RACK_SIZE}
                    />
                }
            >
                {items.length ? (
                    <div className="uis-list" role="listbox" aria-label="Requisition list">
                        {items.map((item, i) => {
                            const [tag, tone] = rowTag(item);
                            const locked = !!item.clearance;
                            return (
                                <ListRow
                                    key={item.id}
                                    id={`row-${item.id}`}
                                    group="list"
                                    index={String(i + 1).padStart(2, "0")}
                                    name={item.name}
                                    kind={item.kind}
                                    tag={tag}
                                    tagTone={tone}
                                    selected={item.id === issued[section]}
                                    locked={locked}
                                    title={item.name}
                                    hint={rowHint(item)}
                                    commands={rowCommands(item)}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <EmptyState
                        id="empty-mods"
                        group="list"
                        headline="No stock"
                        action="Browse weapons"
                        title="Mods"
                        hint="Salvaged mods are fitted from a weapon's fitting slots"
                        commands={[
                            {
                                action: "confirm",
                                label: "Browse weapons",
                                tone: "primary",
                                run: () => onSection("weapons"),
                            },
                        ]}
                    >
                        Mods arrive with contract salvage. Finish a contract to fill this rack.
                    </EmptyState>
                )}
            </Panel>

            {preview ? (
                <Detail
                    item={preview}
                    issued={issuedItem}
                    owned={owned.has(preview.id)}
                    isIssued={preview.id === issued[section]}
                    fitted={fitted[preview.id] ?? {}}
                    toList={toList}
                    onFit={(slot, mod) => {
                        setFitted((f) => ({
                            ...f,
                            [preview.id]: { ...f[preview.id], [slot]: mod },
                        }));
                        save();
                    }}
                    onClear={(slot) => {
                        setFitted((f) => {
                            const next = { ...f[preview.id] };
                            delete next[slot];
                            return { ...f, [preview.id]: next };
                        });
                        save();
                    }}
                />
            ) : (
                <Panel label="Specification" index="02" className="uis-detail-panel">
                    <div className="uis-void">
                        <span className="uis-void-mark" aria-hidden />
                        <span>No line selected</span>
                    </div>
                </Panel>
            )}

            <Panel
                label="Operative"
                index="03"
                meta="VEX"
                variant="ghost"
                className="uis-side-panel"
            >
                <div className="uis-operative">
                    <span className="uis-operative-kind">Assault · Rank II</span>
                    <span className="uis-operative-name">Mara Vale</span>
                </div>
                <Eyebrow>Loadout</Eyebrow>
                <ReadoutLine label="Primary">
                    {STOCK.weapons.find((i) => i.id === issued.weapons)?.name ?? "—"}
                </ReadoutLine>
                <ReadoutLine label="Sidearm">K–12 Sidearm</ReadoutLine>
                <ReadoutLine label="Armor">
                    {STOCK.armor.find((i) => i.id === issued.armor)?.name ?? "—"}
                </ReadoutLine>
                <ReadoutLine label="Utility">
                    {STOCK.utility.find((i) => i.id === issued.utility)?.name ?? "—"}
                </ReadoutLine>
                <ReadoutLine label="Utility" empty>
                    Empty
                </ReadoutLine>
                <Eyebrow>Logistics</Eyebrow>
                <Meter
                    label="Carry"
                    value={Math.round(carried * 10) / 10}
                    max={CARRY_LIMIT}
                    pending={swing > 0 ? swing : 0}
                    readout={`${(Math.round(carried * 10) / 10).toFixed(1)} / ${CARRY_LIMIT} kg`}
                    tone={carried + swing > CARRY_LIMIT ? "warn" : "default"}
                />
                <Meter label="Supply drop" value={3} max={8} segments={8} readout="T−02:14" />
            </Panel>
        </ScreenFrame>
    );
}

function refund(item: Item): number {
    return Math.round((item.cost ?? 600) * 0.3);
}

type DetailProps = {
    item: Item;
    issued?: Item;
    owned: boolean;
    isIssued: boolean;
    fitted: Record<string, string>;
    toList: Command;
    onFit: (slot: string, mod: string) => void;
    onClear: (slot: string) => void;
};

function Detail({ item, issued, owned, isIssued, fitted, toList, onFit, onClear }: DetailProps) {
    const compare = issued && !isIssued ? issued : undefined;
    const state = isIssued
        ? "Issued"
        : owned
          ? "In rack"
          : item.clearance
            ? "Locked"
            : credit(item.cost ?? 0);
    const slots = item.slots ?? [];
    return (
        <Panel label="Specification" index="02" meta={item.serial} className="uis-detail-panel">
            <div className="uis-spec-head" key={item.id}>
                <span className="uis-spec-kind">{item.kind}</span>
                <h1 className="uis-spec-name">{item.name}</h1>
                <span
                    className="uis-spec-state"
                    data-state={isIssued ? "issued" : item.clearance ? "locked" : undefined}
                >
                    {state}
                </span>
                <p className="uis-spec-desc">{item.description}</p>
            </div>
            {/* The stage: where the model would stand, held by its stencilled serial. */}
            <div className="uis-stage" aria-hidden key={`stage-${item.id}`}>
                <svg viewBox="0 0 240 48" preserveAspectRatio="xMidYMid meet">
                    <text x="120" y="40" textAnchor="middle">
                        {item.serial}
                    </text>
                </svg>
            </div>
            <div className="uis-spec-cols">
                <div className="uis-spec-col">
                    <Eyebrow meta={compare ? `vs ${compare.serial}` : "issued"}>
                        Performance
                    </Eyebrow>
                    {item.stats.map((stat) => {
                        const def = STATS[stat.key];
                        const base = compare?.stats.find((s) => s.key === stat.key);
                        return (
                            <StatRow
                                key={stat.key}
                                id={`stat-${stat.key}`}
                                group="detail"
                                label={def.label}
                                value={stat.value}
                                text={stat.text}
                                base={base?.value}
                                max={def.max}
                                unit={def.unit}
                                lowerIsBetter={def.lowerIsBetter}
                                title={def.label}
                                hint={def.hint}
                                commands={[toList]}
                            />
                        );
                    })}
                </div>
                <div className="uis-spec-col">
                    <Eyebrow
                        meta={
                            slots.length
                                ? `${Object.keys(fitted).length} / ${slots.length}`
                                : undefined
                        }
                    >
                        Fittings
                    </Eyebrow>
                    {slots.length ? (
                        slots.map((slot) => {
                            const mod = fitted[slot];
                            const commands: Command[] = owned
                                ? mod
                                    ? [
                                          {
                                              action: "reset",
                                              label: "Remove",
                                              run: () => onClear(slot),
                                          },
                                          toList,
                                      ]
                                    : [
                                          {
                                              action: "confirm",
                                              label: `Fit ${SPARE_MOD[slot]}`,
                                              tone: "primary",
                                              run: () => onFit(slot, SPARE_MOD[slot]),
                                          },
                                          toList,
                                      ]
                                : [
                                      {
                                          action: "confirm",
                                          label: "Fit",
                                          tone: "primary",
                                          deny: "Requisition the weapon before fitting it",
                                      },
                                      toList,
                                  ];
                            return (
                                <SlotRow
                                    key={slot}
                                    id={`slot-${slot}`}
                                    group="detail"
                                    slot={slot}
                                    item={mod}
                                    title={`${slot} slot`}
                                    hint={mod ? `${mod} fitted` : "Takes one mod from the rack"}
                                    commands={commands}
                                />
                            );
                        })
                    ) : (
                        <p className="uis-note">Takes no fittings.</p>
                    )}
                </div>
            </div>
        </Panel>
    );
}

type RequisitionPromptProps = {
    prompt: NonNullable<PromptState>;
    balance: number;
    glyphs: GlyphSet;
    onConfirm: () => void;
    onCancel: () => void;
};

function RequisitionPrompt({
    prompt,
    balance,
    glyphs,
    onConfirm,
    onCancel,
}: RequisitionPromptProps) {
    const { kind, item } = prompt;
    if (kind === "requisition") {
        const cost = item.cost ?? 0;
        return (
            <Prompt
                id="prompt-requisition"
                eyebrow={`Requisition order · ${item.serial}`}
                title={`Requisition ${item.name}?`}
                lines={[
                    ["Cost", credit(cost)],
                    ["Balance after", credit(balance - cost)],
                    ["Issued to", "Vex"],
                ]}
                hint="Charged now; the order holds until the drop lands"
                confirm={{ label: "Requisition", run: onConfirm }}
                cancel={{ label: "Cancel", run: onCancel }}
                glyphs={glyphs}
            >
                Delivered with the next supply drop and issued to Vex on arrival. The current
                primary returns to the rack.
            </Prompt>
        );
    }
    return (
        <Prompt
            id="prompt-scrap"
            tone="danger"
            eyebrow={`Decommission · ${item.serial}`}
            title={`Scrap ${item.name}?`}
            lines={[
                ["Refund", credit(refund(item))],
                ["Fittings", "Lost"],
            ]}
            confirm={{ label: "Scrap", run: onConfirm }}
            cancel={{ label: "Keep", run: onCancel }}
            glyphs={glyphs}
        >
            The weapon is broken down for parts. Its fitted mods go with it.
        </Prompt>
    );
}
