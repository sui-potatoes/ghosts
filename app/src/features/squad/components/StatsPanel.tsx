// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { CSSProperties } from "react";

import { Tooltip } from "../../../components/Tooltip";
import { attachmentById, itemById } from "@ghosts/squad/catalog";
import { contributions, formatStat, RECRUIT_DEFAULT, VISIBLE } from "@ghosts/squad/stats";
import type { Contribution, StatRow } from "@ghosts/squad/stats";
import type { Recruit } from "@ghosts/squad/types";

const SOURCE_NAMES = {
    weapon: "Primary weapon",
    attachment: "Attachment",
    armor: "Body armor",
} as const;

/** One line per gear piece: "Spectre Carrier (body armor): +10% dodge". */
function explain(row: StatRow, parts: Contribution[]): string {
    return parts
        .map((p) => {
            const name =
                itemById(p.item)?.name ?? attachmentById(p.item)?.name ?? SOURCE_NAMES[p.source];
            const unit = row.unit === "%" ? "%" : "";
            const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
            const note =
                p.applied === p.requested
                    ? ""
                    : p.applied === 0
                      ? ", nothing left to take"
                      : `, ${sign(p.applied)} after the cap`;
            return `${name} (${SOURCE_NAMES[p.source].toLowerCase()}): ${sign(p.requested)}${unit} ${row.label.toLowerCase()}${note}`;
        })
        .join("\n");
}

/** The operative's combat profile: field stats by source, field-only values classified. */
export function StatsPanel({ recruit, tag }: { recruit: Recruit; tag?: string }) {
    const { total, byStat } = contributions(recruit);
    const weapon = itemById(recruit.equipment.primary);
    const armor = itemById(recruit.equipment.armor);
    const groups = [
        {
            id: "operative",
            title: "Operative",
            source: armor ? armor.name : "No body armor",
            delta: true,
        },
        {
            id: "weapon",
            title: "Primary weapon",
            source: weapon ? weapon.name : "No primary weapon",
            delta: false,
        },
    ] as const;

    return (
        <div className="stats-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">COMBAT PROFILE</span>
                    <h3>Stats</h3>
                </div>
                <span className="sq-count">{tag ?? recruit.role}</span>
            </div>
            {groups.map((group) => (
                <section className="stats-group" key={group.id} aria-label={group.title}>
                    <div className="stats-group-heading">
                        <span>{group.title}</span>
                        <span>{group.source}</span>
                    </div>
                    {VISIBLE.filter((row) => row.group === group.id).map((row) => {
                        const value = total[row.key];
                        const delta = group.delta ? value - RECRUIT_DEFAULT[row.key] : 0;
                        const parts = group.delta ? byStat[row.key] : [];
                        const base = group.delta ? RECRUIT_DEFAULT[row.key] : value;
                        const pct = (n: number) =>
                            `${Math.max(0, Math.min(100, (n / row.max) * 100))}%`;
                        const bar = {
                            "--base": pct(Math.min(base, value)),
                            "--gain": pct(Math.max(0, value - base)),
                            "--loss": pct(Math.max(0, base - value)),
                        } as CSSProperties;
                        return (
                            <div className="stat-row" key={row.key}>
                                <span className="stat-label">{row.label}</span>
                                <span className="stat-bar" aria-hidden="true" style={bar}>
                                    <i className="stat-bar-base" />
                                    <i className="stat-bar-gain" />
                                    <i className="stat-bar-loss" />
                                </span>
                                <span className="stat-value">{formatStat(row, total)}</span>
                                <span className="stat-delta">
                                    {parts.length > 0 && (
                                        <Tooltip text={explain(row, parts)}>
                                            <span
                                                className={`stat-delta-value ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}
                                            >
                                                {delta > 0
                                                    ? `+${delta}`
                                                    : delta < 0
                                                      ? String(delta)
                                                      : "±0"}
                                            </span>
                                        </Tooltip>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}
