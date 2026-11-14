// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Squad pieces in the shared interface language, used by Headquarters and the
 * `/ui-sample` reference alike: the roster portrait, the rank insignia and
 * progress, the stat block and the "if equipped" changes, and the off-screen
 * host the portrait studio draws in.
 */

import { attachmentById, itemById } from "@ghosts/squad/catalog";
import { add, contributions, formatStat, RECRUIT_DEFAULT, VISIBLE } from "@ghosts/squad/stats";
import type { Stats } from "@ghosts/squad/stats";
import type { Recruit } from "@ghosts/squad/types";
import type { Ref } from "react";

import { Eyebrow, Icon, Meter, ReadoutLine, STAT_ICON, StatRow, type Command } from "../../../ui";
import { rankIcon, rankProgress } from "./ranks";
import "./squad.css";

/** A roster row's portrait, with the rank insignia in its corner when given. */
export function Portrait({ src, rank }: { src?: string; rank?: string }) {
    return (
        <span className="hqs-portrait">
            {src && <img src={src} alt="" draggable={false} />}
            {rank && (
                <span className="hqs-portrait-rank" aria-hidden>
                    <Icon name={rankIcon(rank)} size={12} />
                </span>
            )}
        </span>
    );
}

/** The insignia and the rank's name. */
export function RankMark({ rank, size = 14 }: { rank: string; size?: number }) {
    return (
        <span className="hqs-rank">
            <Icon name={rankIcon(rank)} size={size} />
            {rank}
        </span>
    );
}

/** Rank, and the experience bar toward the next one (none at the top). */
export function RankProgress({ rank, xp }: { rank: string; xp: number }) {
    const { next } = rankProgress(rank, xp);
    return (
        <>
            <ReadoutLine label="Rank">
                <RankMark rank={rank} />
            </ReadoutLine>
            {next !== undefined && (
                <Meter label="Experience" value={xp} max={next} readout={`${xp} / ${next}`} />
            )}
        </>
    );
}

/** The stats a recruit takes into the field, plus what a utility adds to its carrier. */
export function fieldStats(recruit: Recruit, utility?: Stats): Stats {
    const total = contributions(recruit).total;
    return utility ? add(total, utility) : total;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

type SquadStatsProps = {
    recruit: Recruit;
    /** The weapon's name for the weapon block's eyebrow. */
    weaponName: string;
    /** False: no weapon, so no weapon block beyond its eyebrow. */
    armed?: boolean;
    /** The game's names for the catalog ids the recruit wears; the catalog's names otherwise. */
    names?: Record<string, string>;
    /** A carried utility's modifier and name, applied after the armor when non-zero. */
    utility?: { name: string; stats: Stats };
    commands: Command[];
};

/**
 * The Stats tab: the operative block against the recruit default (the delta
 * is gear; the hint names each piece's share) and the weapon block.
 */
export function SquadStats({
    recruit,
    weaponName,
    armed = true,
    names,
    utility,
    commands,
}: SquadStatsProps) {
    const { byStat } = contributions(recruit);
    const nameOf = (id: string | null) =>
        (id && (names?.[id] ?? itemById(id)?.name ?? attachmentById(id)?.name)) || "Gear";
    const total = fieldStats(recruit, utility?.stats);
    return (["operative", "weapon"] as const).map((group) => (
        <div key={group} className="hqs-stat-group">
            {group === "weapon" && <Eyebrow>{weaponName}</Eyebrow>}
            {VISIBLE.filter((row) => row.group === group && (armed || group !== "weapon")).map(
                (row) => {
                    const parts = byStat[row.key]
                        .filter((p) => p.applied)
                        .map((p) => `${nameOf(p.item)} ${signed(p.applied)}`);
                    const extra = utility?.stats[row.key];
                    if (extra) parts.push(`${utility!.name} ${signed(extra)}`);
                    return (
                        <StatRow
                            key={row.key}
                            id={`stat-${row.key}`}
                            group="inspector"
                            label={row.label}
                            icon={STAT_ICON[row.key]}
                            value={total[row.key]}
                            base={group === "operative" ? RECRUIT_DEFAULT[row.key] : undefined}
                            text={formatStat(row, total)}
                            max={row.max}
                            title={row.label}
                            hint={
                                group === "operative"
                                    ? [`Base ${RECRUIT_DEFAULT[row.key]}`, ...parts].join(" · ")
                                    : "From the rifle and its mods"
                            }
                            commands={commands}
                        />
                    );
                },
            )}
        </div>
    ));
}

/** What a pick would change, one line per stat that moves. */
export function StatChanges({
    before,
    after,
    label = "If equipped",
}: {
    before: Stats;
    after: Stats;
    label?: string;
}) {
    const changes = VISIBLE.filter((row) => after[row.key] !== before[row.key]);
    if (!changes.length) return null;
    return (
        <>
            <Eyebrow>{label}</Eyebrow>
            {changes.map((row) => {
                const delta = after[row.key] - before[row.key];
                return (
                    <ReadoutLine key={row.key} label={row.label}>
                        <span className="hqs-change" data-trend={delta > 0 ? "buff" : "nerf"}>
                            {formatStat(row, before)} → {formatStat(row, after)}
                            <b>{delta > 0 ? ` ▲ +${delta}` : ` ▼ −${-delta}`}</b>
                        </span>
                    </ReadoutLine>
                );
            })}
        </>
    );
}

/** Where the portrait studio draws, off screen; pass `useRecruitPortraits`' `studioHost`. */
export function Offstage({ ref }: { ref: Ref<HTMLDivElement> }) {
    return <div ref={ref} className="hqs-offstage" aria-hidden />;
}
