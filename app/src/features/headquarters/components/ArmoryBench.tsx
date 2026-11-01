// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { ATTACHMENTS, ATTACHMENT_SLOTS, ATTACHMENT_SLOT_NAMES } from "@ghosts/squad/catalog";
import { formatStat, VISIBLE, type Stats, type StatRow } from "@ghosts/squad/stats";
import type { AttachmentSlot } from "@ghosts/squad/types";

import type { ChainRecruit, Requisition } from "../../../chain";
import {
    attachmentFor,
    fitCount,
    MAX_FITTINGS,
    sameFit,
    type Fit,
    type Gear,
    type Held,
} from "../armory";

const TIERS = [1, 2, 3];
const WEAPON_ROWS: StatRow[] = [
    ...VISIBLE.filter((r) => r.group === "weapon"),
    VISIBLE.find((r) => r.key === "aim")!,
];
const ARMOR_ROWS = VISIBLE.filter((r) => r.group === "operative");

/** Stats side by side: what the item does now, and with the draft. */
function StatCompare({ rows, now, next }: { rows: StatRow[]; now: Stats; next?: Stats }) {
    return (
        <dl className="hq-stat-compare">
            {rows.map((row) => {
                const delta = next ? next[row.key] - now[row.key] : 0;
                return (
                    <div key={row.key} className={delta > 0 ? "up" : delta < 0 ? "down" : ""}>
                        <dt>{row.label}</dt>
                        <dd>
                            {formatStat(row, now)}
                            {next && delta !== 0 && (
                                <>
                                    <span aria-hidden="true">→</span>
                                    <b>{formatStat(row, next)}</b>
                                </>
                            )}
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}

/** Who carries the item, and handing it to someone else. */
function Issue({
    kind,
    carrier,
    recruits,
    busy,
    onIssue,
    onReturn,
}: {
    kind: "weapon" | "armor";
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
                    return (
                        <button
                            key={r.objectId}
                            aria-pressed={current}
                            disabled={busy || current}
                            onClick={() => onIssue(r)}
                        >
                            <strong>{r.metadata.name}</strong>
                            <small>
                                {current
                                    ? "Carrying"
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
    now: Stats;
    next: Stats;
    stock: Record<string, number>;
    images: Record<string, string>;
    recruits: ChainRecruit[];
    busy: boolean;
    notice: string;
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
            <StatCompare
                rows={WEAPON_ROWS}
                now={props.now}
                next={changed ? props.next : undefined}
            />

            <div className="inventory-heading">
                <h4>Fittings</h4>
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
                                            title={`${a.name} · ${a.stat}`}
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
                                                {on ? "fitted" : count ? `×${count}` : "mint"}
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
                        ? `${changes} change${changes === 1 ? "" : "s"}${minted ? ` · ${minted} minted (testnet)` : ""}`
                        : "Fittings as issued"}
                </span>
                <button disabled={!changed || busy} onClick={() => props.onDraft(fit)}>
                    Reset
                </button>
                <button
                    className="btn sq-primary"
                    disabled={!changed || busy}
                    onClick={props.onApply}
                >
                    Apply fittings <span>↗</span>
                </button>
            </div>

            <Issue
                kind="weapon"
                carrier={held.carrier}
                recruits={props.recruits}
                busy={busy || changed}
                onIssue={props.onIssue}
                onReturn={props.onReturn}
            />
            {changed && (
                <p className="sq-footnote">
                    Apply or reset the fittings before issuing this rifle.
                </p>
            )}
        </div>
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
            <StatCompare
                rows={ARMOR_ROWS.filter((r) => props.stats[r.key] !== 0)}
                now={props.stats}
            />
            <p className="sq-footnote">
                Modifiers apply on top of the wearer's own stats. Plate finish is set per recruit in
                their loadout.
            </p>
            <Issue
                kind="armor"
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
            <p className="hq-upgrade-stat">{a.stat}</p>
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
    requisition: Requisition;
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
                    <span className="sq-eyebrow">REQUISITION · TESTNET</span>
                    <h3>Supply catalog</h3>
                </div>
            </div>
            <p className="sq-footnote">
                Requisitions mint gear straight into your account, free until the economy lands.
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
