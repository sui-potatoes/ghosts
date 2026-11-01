// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ChainRecruit } from "../../../chain";
import { RecruitCard } from "./RecruitCard";

interface Props {
    slots: (ChainRecruit | null)[];
    portraits: Record<string, string>;
    /** A hire is in flight or its recruits are still arriving. */
    pending: boolean;
    error?: string;
    onHire(): void;
    onEnter(recruitId: string): void;
}

/**
 * Recruitment: the squad as a row of cards, face down until hired. One press
 * hires every vacancy; the cards turn over as the recruits arrive, portraits
 * filling in as the studio draws them. Any revealed card leads into
 * headquarters with that recruit selected.
 */
export function HireDeck({ slots, portraits, pending, error, onHire, onEnter }: Props) {
    const vacant = slots.filter((s) => !s).length;
    const first = slots.find((s): s is ChainRecruit => !!s);
    return (
        <section className="hq-deck" aria-label="Recruitment">
            <header className="hq-deck-heading">
                <span className="sq-eyebrow">RECRUITMENT</span>
                <h2>{vacant ? "Your squad is waiting" : "Squad assembled"}</h2>
                <p>
                    {vacant
                        ? "Four operatives, free of charge. Names, faces and voices are drawn on chain the moment you sign."
                        : "Pick an operative to fit their gear, adjust their look or change their voice."}
                </p>
            </header>
            <div className="hq-deck-cards">
                {slots.map((recruit, i) => (
                    <RecruitCard
                        key={i}
                        index={i}
                        variant="deck"
                        recruit={recruit}
                        portrait={recruit ? portraits[recruit.objectId] : undefined}
                        pending={pending}
                        disabled={pending}
                        onClick={() => (recruit ? onEnter(recruit.objectId) : onHire())}
                    />
                ))}
            </div>
            {error && (
                <p role="alert" className="sq-error">
                    {error}
                </p>
            )}
            <div className="hq-deck-actions">
                {vacant ? (
                    <button className="btn sq-primary" disabled={pending} onClick={onHire}>
                        {pending ? "Hiring…" : `Hire squad · ${vacant}`}
                        <span>↗</span>
                    </button>
                ) : (
                    <button
                        className="btn sq-primary"
                        disabled={pending || !first}
                        onClick={() => first && onEnter(first.objectId)}
                    >
                        Enter headquarters <span>↗</span>
                    </button>
                )}
            </div>
        </section>
    );
}
