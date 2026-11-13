// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { ATTACHMENTS, ATTACHMENT_SLOTS, ATTACHMENT_SLOT_NAMES } from "@ghosts/squad/catalog";
import {
    add,
    formatStat,
    RECRUIT_DEFAULT,
    unpack,
    VISIBLE,
    type Stats,
    type StatRow,
} from "@ghosts/squad/stats";
import type { AttachmentSlot } from "@ghosts/squad/types";
import type { WeaponSkin } from "@ghosts/squad/weapon-skins";

import {
    rankAllows,
    rankFor,
    type ChainRecruit,
    type ChainUtility,
    type Requisition,
} from "../../../chain";
import {
    attachmentFor,
    modifierSummary,
    fitCount,
    MAX_FITTINGS,
    sameFit,
    type Fit,
    type Gear,
    type Held,
} from "../armory";
import { StatLine } from "../../squad/components/StatLine";
import { modifierParts, signed, type FittingLine, type WeaponProfile } from "../fittings";
import {
    catalogFor,
    MAX_UTILITIES,
    utilityActions,
    utilityModifiers,
    type UtilityCatalogEntry,
    type UtilityKind,
} from "../utilities";

const TIERS = [1, 2, 3];
const WEAPON_ROWS: StatRow[] = [
    ...VISIBLE.filter((r) => r.group === "weapon"),
    VISIBLE.find((r) => r.key === "aim")!,
];
const ARMOR_ROWS = VISIBLE.filter((r) => r.group === "operative");

/** A modifier as chips: "+10% Aim" in accent, "−1 Mobility" in amber. */
function Chips({ modifier }: { modifier: Stats }) {
    return (
        <span className="hq-chips">
            {modifierParts(modifier).map((m) => (
                <b key={m.key} className={m.sign > 0 ? "up" : "down"}>
                    {m.text} {m.label.toUpperCase()}
                </b>
            ))}
        </span>
    );
}

const STATE_TAG = { fitted: "Fitted", drafted: "Draft", removed: "Off" } as const;

/** Which upgrade gives what: one line per fitted, drafted and removed mod. */
function FittingLines({ lines }: { lines: FittingLine<AttachmentSlot>[] }) {
    if (lines.length === 0) return <p className="sq-footnote">No mods fitted.</p>;
    return (
        <ul className="hq-fitting-lines">
            {lines.map((l, i) => (
                <li key={`${l.name}-${i}`} className={l.state}>
                    <span className="hq-fitting-tag">{STATE_TAG[l.state]}</span>
                    <span className="hq-fitting-label">
                        <strong>{l.name}</strong>
                        {l.slot && <small>{ATTACHMENT_SLOT_NAMES[l.slot]}</small>}
                    </span>
                    <Chips modifier={l.modifier} />
                </li>
            ))}
        </ul>
    );
}

/** The sentence a delta tooltip says: "Basic Stock (fitted): +2 range". */
const explain = (row: StatRow, lines: FittingLine[]) =>
    lines
        .filter((l) => l.modifier[row.key] !== 0)
        .map(
            (l) => `${l.name}: ${signed(l.modifier[row.key], row.unit)} ${row.label.toLowerCase()}`,
        )
        .join("\n");

/**
 * A weapon's stats in the Stats tab's look: total, what fitted mods add or
 * take (base is the white part of the bar), and, when something is drafted,
 * the total the draft would give.
 */
function WeaponStats({ profile, drafting }: { profile: WeaponProfile; drafting: boolean }) {
    const { base, now, next, lines } = profile;
    const applied = lines.filter((l) => l.state !== "drafted");
    return (
        <section className="stats-group" aria-label="Weapon stats">
            {WEAPON_ROWS.map((row) => {
                // aim is the wielder's, so it reads as a modifier
                const show = (s: Stats) =>
                    row.group === "weapon"
                        ? formatStat(row, s)
                        : s[row.key]
                          ? signed(s[row.key], row.unit)
                          : "0%";
                const text = show(now);
                const tip = explain(row, applied);
                const nextText = show(next);
                const changed = drafting && (next[row.key] !== now[row.key] || nextText !== text);
                return (
                    <StatLine
                        key={row.key}
                        row={row}
                        base={base[row.key]}
                        value={now[row.key]}
                        text={text}
                        delta={now[row.key] - base[row.key]}
                        tip={tip || undefined}
                        draft={changed ? { value: next[row.key], text: nextText } : undefined}
                    />
                );
            })}
        </section>
    );
}

/** An armor's modifiers on a standard recruit, as the Stats tab would show them. */
function ArmorStats({ name, modifier }: { name: string; modifier: Stats }) {
    const total = add(RECRUIT_DEFAULT, modifier);
    return (
        <section className="stats-group" aria-label="Armor stats">
            <div className="stats-group-heading">
                <span>On a standard recruit</span>
                <span>{name}</span>
            </div>
            {ARMOR_ROWS.filter((row) => modifier[row.key] !== 0).map((row) => (
                <StatLine
                    key={row.key}
                    row={row}
                    base={RECRUIT_DEFAULT[row.key]}
                    value={total[row.key]}
                    text={formatStat(row, total)}
                    delta={modifier[row.key]}
                    tip={`${name}: ${signed(modifier[row.key], row.unit)} ${row.label.toLowerCase()}`}
                />
            ))}
        </section>
    );
}

/** Who carries the item, and handing it to someone else. */
function Issue({
    kind,
    gear,
    carrier,
    recruits,
    busy,
    onIssue,
    onReturn,
}: {
    kind: "weapon" | "armor";
    gear: Gear;
    carrier: ChainRecruit | null;
    recruits: ChainRecruit[];
    busy: boolean;
    onIssue(to: ChainRecruit): void;
    onReturn(): void;
}) {
    return (
        <section className="hq-issue" aria-label="Issue">
            <div className="inventory-heading">
                <h4>{kind === "weapon" ? "Issued to" : "Worn by"}</h4>
                <span>{carrier ? carrier.metadata.name : "In armory"}</span>
            </div>
            <div className="hq-issue-list">
                {recruits.map((r) => {
                    const current = r.objectId === carrier?.objectId;
                    const holding = kind === "weapon" ? r.weapon : r.armor;
                    // a looted weapon stays with whoever carries it, whatever their rank
                    const allowed = current || rankAllows(r, gear);
                    return (
                        <button
                            key={r.objectId}
                            aria-pressed={current}
                            disabled={busy || current || !allowed}
                            onClick={() => onIssue(r)}
                        >
                            <strong>{r.metadata.name}</strong>
                            <small>
                                {current
                                    ? "Carrying"
                                    : !allowed
                                      ? `Needs ${gear.requiredRank?.$kind}`
                                      : holding
                                        ? `Swap for ${holding.name}`
                                        : kind === "weapon"
                                          ? "Standard issue"
                                          : "No armor"}
                            </small>
                        </button>
                    );
                })}
            </div>
            {carrier && (
                <button className="btn sq-equipped" disabled={busy} onClick={onReturn}>
                    Return to armory
                </button>
            )}
        </section>
    );
}

export function WeaponBench(props: {
    held: Held<Gear>;
    fit: Fit;
    draft: Fit;
    profile: WeaponProfile<AttachmentSlot>;
    stock: Record<string, number>;
    images: Record<string, string>;
    recruits: ChainRecruit[];
    busy: boolean;
    notice: string;
    /** Finishes the gun can wear (Factory first) and the one shown. */
    skins: WeaponSkin[];
    skin: string;
    onSkin(skin: string): void;
    onDraft(fit: Fit): void;
    onApply(): void;
    onIssue(to: ChainRecruit): void;
    onReturn(): void;
}) {
    const { held, fit, draft, stock, busy } = props;
    const changed = !sameFit(fit, draft);
    const changes = ATTACHMENT_SLOTS.filter((s) => (fit[s] ?? 0) !== (draft[s] ?? 0)).length;
    const minted = ATTACHMENT_SLOTS.filter((s) => {
        const tier = draft[s];
        if (!tier || fit[s] === tier) return false;
        return !stock[attachmentFor(s, tier)?.id ?? ""];
    }).length;

    function pick(slot: AttachmentSlot, tier: number | null) {
        const next = { ...draft };
        if (tier) next[slot] = tier;
        else delete next[slot];
        props.onDraft(next);
    }

    return (
        <div className="hq-bench">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">WEAPON BENCH</span>
                    <h3>{held.item.name}</h3>
                </div>
                <span className="sq-count">
                    {fitCount(draft)} / {MAX_FITTINGS} FITTED
                </span>
            </div>
            <WeaponStats profile={props.profile} drafting={changed} />
            <div className="inventory-heading">
                <h4>From mods</h4>
                <span>{changed ? "Draft not applied" : "As fitted"}</span>
            </div>
            <FittingLines lines={props.profile.lines} />

            <div className="inventory-heading">
                <h4>Mods</h4>
                <span>One per type · three max</span>
            </div>
            <div className="hq-fittings">
                {ATTACHMENT_SLOTS.map((slot) => {
                    const full = fitCount(draft) >= MAX_FITTINGS && !draft[slot];
                    return (
                        <div key={slot} className="hq-fitting-row">
                            <span className="hq-fitting-name">
                                {ATTACHMENT_SLOT_NAMES[slot]}
                                {full && <small>Slots full</small>}
                            </span>
                            <div className="hq-fitting-options" role="radiogroup">
                                <button
                                    role="radio"
                                    aria-checked={!draft[slot]}
                                    disabled={busy}
                                    onClick={() => pick(slot, null)}
                                >
                                    —
                                </button>
                                {TIERS.map((tier) => {
                                    const a = attachmentFor(slot, tier)!;
                                    const on = fit[slot] === tier;
                                    const count = stock[a.id] ?? 0;
                                    return (
                                        <button
                                            key={tier}
                                            role="radio"
                                            aria-checked={draft[slot] === tier}
                                            title={`${a.name} · ${modifierSummary(unpack(a.packed))}`}
                                            disabled={busy || full}
                                            onClick={() => pick(slot, tier)}
                                            className={
                                                on ? "fitted" : count ? "stocked" : "unowned"
                                            }
                                        >
                                            {props.images[a.id] && (
                                                <img src={props.images[a.id]} alt="" />
                                            )}
                                            <b>T{tier}</b>
                                            <small>
                                                {on ? "fitted" : count ? `×${count}` : "new"}
                                            </small>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            {props.notice && <p className="sq-footnote hq-notice">{props.notice}</p>}
            <div className="hq-bench-actions">
                <span>
                    {changed
                        ? `${changes} change${changes === 1 ? "" : "s"}${minted ? ` · ${minted} requisitioned` : ""}`
                        : "Mods as issued"}
                </span>
                <button disabled={!changed || busy} onClick={() => props.onDraft(fit)}>
                    Reset
                </button>
                <button
                    className="btn sq-primary"
                    disabled={!changed || busy}
                    onClick={props.onApply}
                >
                    Apply mods <span>↗</span>
                </button>
            </div>

            <Finish skins={props.skins} skin={props.skin} onSkin={props.onSkin} />

            <Issue
                kind="weapon"
                gear={held.item}
                carrier={held.carrier}
                recruits={props.recruits}
                busy={busy || changed}
                onIssue={props.onIssue}
                onReturn={props.onReturn}
            />
            {changed && (
                <p className="sq-footnote">Apply or reset the mods before issuing this rifle.</p>
            )}
        </div>
    );
}

/** The weapon's finish: swatches, applied to the stage at once. */
function Finish({
    skins,
    skin,
    onSkin,
}: {
    skins: WeaponSkin[];
    skin: string;
    onSkin(skin: string): void;
}) {
    return (
        <section className="hq-finish" aria-label="Finish">
            <div className="inventory-heading">
                <h4>Finish</h4>
                <span>{skins.find((s) => s.id === skin)?.name ?? "Factory"}</span>
            </div>
            {skins.length > 1 ? (
                <div className="hq-finishes" role="radiogroup" aria-label="Weapon finish">
                    {skins.map((s) => (
                        <button
                            key={s.id}
                            role="radio"
                            aria-checked={s.id === skin}
                            onClick={() => onSkin(s.id)}
                        >
                            <span>
                                {s.swatch.map((color, i) => (
                                    <i key={i} style={{ backgroundColor: color }} />
                                ))}
                            </span>
                            {s.name}
                        </button>
                    ))}
                </div>
            ) : (
                <p className="sq-footnote">No finishes for this weapon yet.</p>
            )}
        </section>
    );
}

export function ArmorBench(props: {
    held: Held<Gear>;
    stats: Stats;
    recruits: ChainRecruit[];
    busy: boolean;
    onIssue(to: ChainRecruit): void;
    onReturn(): void;
}) {
    return (
        <div className="hq-bench">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">ARMOR</span>
                    <h3>{props.held.item.name}</h3>
                </div>
            </div>
            <ArmorStats name={props.held.item.name} modifier={props.stats} />
            <p className="sq-footnote">
                Modifiers apply on top of the wearer's own stats. Plate finish is set per recruit in
                their loadout.
            </p>
            <Issue
                kind="armor"
                gear={props.held.item}
                carrier={props.held.carrier}
                recruits={props.recruits}
                busy={props.busy}
                onIssue={props.onIssue}
                onReturn={props.onReturn}
            />
        </div>
    );
}

export function UpgradeBench(props: {
    attachment: string;
    /** What the mod does, from the object in stock or the catalog preset. */
    modifier: Stats;
    stock: number;
    fittedOn: Held<Gear>[];
    candidates: Held<Gear>[];
    busy: boolean;
    onOpen(weaponId: string, fitHere: boolean): void;
}) {
    const a = ATTACHMENTS.find((x) => x.id === props.attachment)!;
    return (
        <div className="hq-bench">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">
                        {ATTACHMENT_SLOT_NAMES[a.slot]} · TIER {String(a.tier).padStart(2, "0")}
                    </span>
                    <h3>{a.name}</h3>
                </div>
                <span className="sq-count">×{props.stock} IN STOCK</span>
            </div>
            <Chips modifier={props.modifier} />
            <div className="inventory-heading">
                <h4>Fitted on</h4>
                <span>{props.fittedOn.length}</span>
            </div>
            <div className="hq-issue-list">
                {props.fittedOn.map(({ item, carrier }) => (
                    <button key={item.id} onClick={() => props.onOpen(item.id, false)}>
                        <strong>{item.name}</strong>
                        <small>{carrier ? `Issued · ${carrier.metadata.name}` : "In armory"}</small>
                    </button>
                ))}
                {props.fittedOn.length === 0 && <p className="sq-footnote">Not fitted anywhere.</p>}
            </div>
            <div className="inventory-heading">
                <h4>Try it on</h4>
                <span>Opens the bench with it drafted</span>
            </div>
            <div className="hq-issue-list">
                {props.candidates.map(({ item, carrier }) => (
                    <button
                        key={item.id}
                        disabled={props.busy}
                        onClick={() => props.onOpen(item.id, true)}
                    >
                        <strong>{item.name}</strong>
                        <small>{carrier ? `Issued · ${carrier.metadata.name}` : "In armory"}</small>
                    </button>
                ))}
                {props.candidates.length === 0 && (
                    <p className="sq-footnote">
                        No rifle has room for a {ATTACHMENT_SLOT_NAMES[a.slot].toLowerCase()}.
                    </p>
                )}
            </div>
        </div>
    );
}

export interface CatalogEntry {
    key: string;
    label: string;
    detail: string;
    image?: string;
    requisition: Requisition | { utility: UtilityCatalogEntry & { kind: UtilityKind } };
}

const requiredRank = ({ requisition }: CatalogEntry) =>
    "utility" in requisition ? requisition.utility.rank : rankFor(requisition);

/** A utility: what it grants, who carries it, and handing it over. */
export function UtilityBench(props: {
    held: Held<ChainUtility>;
    recruits: ChainRecruit[];
    busy: boolean;
    onIssue(to: ChainRecruit): void;
    onReturn(): void;
}) {
    const { item, carrier } = props.held;
    const actions = utilityActions(item);
    const modifiers = utilityModifiers(item);
    return (
        <div className="hq-bench">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">UTILITY</span>
                    <h3>{item.name}</h3>
                </div>
            </div>
            {catalogFor(item)?.description && (
                <p className="sq-footnote">{catalogFor(item)!.description}</p>
            )}
            <div className="inventory-heading">
                <h4>Grants</h4>
                <span>{actions.length}</span>
            </div>
            <dl className="hq-stat-compare">
                {actions.map((a, i) => (
                    <div key={i}>
                        <dt>{a.name}</dt>
                        <dd>{a.uses}</dd>
                    </div>
                ))}
            </dl>
            {actions.map(
                (a, i) =>
                    a.description && (
                        <p key={i} className="sq-footnote">
                            {a.description}
                        </p>
                    ),
            )}
            {modifiers.length > 0 && (
                <dl className="hq-stat-compare">
                    {modifiers.map((m) => (
                        <div key={m.label}>
                            <dt>{m.label}</dt>
                            <dd>{m.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
            <section className="hq-issue" aria-label="Issue">
                <div className="inventory-heading">
                    <h4>Carried by</h4>
                    <span>{carrier ? carrier.metadata.name : "In armory"}</span>
                </div>
                <div className="hq-issue-list">
                    {props.recruits.map((r) => {
                        const current = r.objectId === carrier?.objectId;
                        const full = r.utilities.length >= MAX_UTILITIES;
                        return (
                            <button
                                key={r.objectId}
                                aria-pressed={current}
                                disabled={props.busy || current}
                                onClick={() => props.onIssue(r)}
                            >
                                <strong>{r.metadata.name}</strong>
                                <small>
                                    {current
                                        ? "Carrying"
                                        : full
                                          ? `Swap for ${r.utilities[0].name}`
                                          : "Free slot"}
                                </small>
                            </button>
                        );
                    })}
                </div>
                {carrier && (
                    <button
                        className="btn sq-equipped"
                        disabled={props.busy}
                        onClick={props.onReturn}
                    >
                        Return to armory
                    </button>
                )}
            </section>
        </div>
    );
}

export function RequisitionBench(props: {
    groups: { title: string; entries: CatalogEntry[] }[];
    preview: string | null;
    busy: boolean;
    onPreview(key: string): void;
    onRequisition(entry: CatalogEntry): void;
}) {
    return (
        <div className="hq-bench">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">REQUISITION</span>
                    <h3>Supply catalog</h3>
                </div>
            </div>
            <p className="sq-footnote">
                Gear goes straight to the racks. Better gear can only be issued to recruits of high
                enough rank.
            </p>
            {props.groups.map((group) => (
                <section key={group.title}>
                    <div className="inventory-heading">
                        <h4>{group.title}</h4>
                    </div>
                    <div className="hq-catalog">
                        {group.entries.map((entry) => (
                            <div
                                key={entry.key}
                                className={`hq-catalog-entry ${props.preview === entry.key ? "selected" : ""}`}
                            >
                                <button onClick={() => props.onPreview(entry.key)}>
                                    <span className="hq-gear-thumb">
                                        {entry.image && <img src={entry.image} alt="" />}
                                    </span>
                                    <span className="hq-gear-text">
                                        <strong>{entry.label}</strong>
                                        <small>{entry.detail}</small>
                                        <small>
                                            {requiredRank(entry) === "Rookie"
                                                ? "Any rank"
                                                : `${requiredRank(entry)} and above`}
                                        </small>
                                    </span>
                                </button>
                                <button
                                    className="hq-catalog-mint"
                                    disabled={props.busy}
                                    aria-label={`Requisition ${entry.label}`}
                                    onClick={() => props.onRequisition(entry)}
                                >
                                    ＋
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
