// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Recruitment in the shared language: four cards, face down until hired.
 * One press hires the free squad; hired cards turn over one at a time, left
 * to right, each once its portrait is drawn (`useReveal`), so every card
 * lands with its face on it. Each card is a cursor target: Hire on a face-down
 * card, Enter on a face-up one.
 */

import type { ChainRecruit } from "../../../chain";
import { useFocusable, type Command } from "../../../ui";
import { useReveal } from "../reveal";
import { RankMark } from "./parts";

type DeckProps = {
    slots: (ChainRecruit | null)[];
    portraits: Record<string, string>;
    /** A hire is in flight or its recruits are still arriving. */
    pending: boolean;
    onHire: () => void;
    onEnter: (recruitId: string) => void;
};

export function Deck({ slots, portraits, pending, onHire, onEnter }: DeckProps) {
    const revealed = useReveal(slots, portraits, pending);
    const shown = slots.map((s, i) => (i < revealed ? s : null));
    const arriving = pending || slots.some((s, i) => s && i >= revealed);
    const vacant = shown.some((s) => !s);
    return (
        <section className="hqs-deck" aria-label="Recruitment">
            <header className="hqs-deck-head">
                <span className="hqs-deck-eyebrow">Recruitment</span>
                <h2 className="hqs-deck-title">
                    {vacant ? "Your squad is waiting" : "Squad assembled"}
                </h2>
            </header>
            <div className="hqs-deck-cards">
                {shown.map((recruit, i) => (
                    <DeckCard
                        key={i}
                        index={i}
                        recruit={recruit}
                        portrait={recruit ? portraits[recruit.objectId] : undefined}
                        arriving={arriving}
                        onHire={onHire}
                        onEnter={onEnter}
                    />
                ))}
            </div>
        </section>
    );
}

function DeckCard({
    index,
    recruit,
    portrait,
    arriving,
    onHire,
    onEnter,
}: {
    index: number;
    recruit: ChainRecruit | null;
    portrait?: string;
    arriving: boolean;
    onHire: () => void;
    onEnter: (id: string) => void;
}) {
    const slot = String(index + 1).padStart(2, "0");
    const command: Command = recruit
        ? {
              action: "confirm",
              label: "Enter",
              tone: "primary",
              run: () => onEnter(recruit.objectId),
          }
        : {
              action: "confirm",
              label: "Hire squad",
              tone: "primary",
              deny: arriving ? "The squad is on its way" : undefined,
              run: onHire,
          };
    const { props } = useFocusable<HTMLButtonElement>({
        id: `deck-${index}`,
        group: "deck",
        title: recruit ? recruit.metadata.name : `Slot ${slot}`,
        hint: recruit ? "Into headquarters" : arriving ? undefined : "Four recruits, free",
        commands: [command],
        // One press hires the free squad (as the classic deck did) or walks in.
        instant: true,
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="hqs-card"
            data-down={!recruit || undefined}
            data-pending={(!recruit && arriving) || undefined}
            aria-label={recruit ? recruit.metadata.name : `Slot ${slot}`}
            {...props}
        >
            <span className="hqs-card-inner">
                <span className="hqs-card-face" aria-hidden={!recruit}>
                    {recruit && (
                        <>
                            <span className="hqs-card-photo">
                                {portrait && <img src={portrait} alt="" draggable={false} />}
                            </span>
                            <span className="hqs-card-plate">
                                <span className="hqs-card-sub">
                                    <RankMark rank={recruit.rank.$kind} size={12} />
                                </span>
                                <span className="hqs-card-name">{recruit.metadata.name}</span>
                            </span>
                        </>
                    )}
                    <span className="hqs-card-slot">{slot}</span>
                </span>
                <span className="hqs-card-face hqs-card-back" aria-hidden={!!recruit}>
                    <span className="hqs-card-slot">{slot}</span>
                    <span className="hqs-card-mark">G</span>
                </span>
            </span>
        </button>
    );
}
