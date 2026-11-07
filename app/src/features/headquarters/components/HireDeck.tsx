// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { uiTick } from "../../../audio";
import type { ChainRecruit } from "../../../chain";
import { RecruitCard } from "./RecruitCard";

/** The beat between two cards turning over. */
const REVEAL_GAP_MS = 650;
/** How long a hired card waits for its portrait before it turns over anyway. */
const PORTRAIT_WAIT_MS = 3500;

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
 * Recruitment: the squad as a row of large cards, face down until hired. One
 * press hires every vacancy. Hired cards turn over one at a time, left to
 * right, each once its portrait is drawn (or after a short wait), so every
 * card lands with its face already on it. Any revealed card leads into
 * headquarters with that recruit selected.
 */
export function HireDeck({ slots, portraits, pending, error, onHire, onEnter }: Props) {
    // Cards hired before the deck mounted are already face up — unless a hire
    // is still settling, in which case they turn over like any fresh hire.
    const [revealed, setRevealed] = useState(() => (pending ? 0 : slots.filter(Boolean).length));
    const nextId = slots[revealed]?.objectId;
    const nextReady = !!nextId && !!portraits[nextId];
    useEffect(() => {
        if (!nextId) return;
        const timer = window.setTimeout(
            () => {
                setRevealed((r) => r + 1);
                uiTick();
            },
            nextReady ? REVEAL_GAP_MS : PORTRAIT_WAIT_MS,
        );
        return () => window.clearTimeout(timer);
    }, [nextId, nextReady]);

    const shown = slots.map((s, i) => (i < revealed ? s : null));
    const vacant = shown.filter((s) => !s).length;
    const arriving = slots.some((s, i) => s && i >= revealed);
    const first = shown.find((s): s is ChainRecruit => !!s);
    return (
        <section className="hq-deck" aria-label="Recruitment">
            <header className="hq-deck-heading">
                <span className="sq-eyebrow">RECRUITMENT</span>
                <h2>{vacant ? "Your squad is waiting" : "Squad assembled"}</h2>
            </header>
            <div className="hq-deck-cards">
                {shown.map((recruit, i) => (
                    <RecruitCard
                        key={i}
                        index={i}
                        variant="deck"
                        recruit={recruit}
                        portrait={recruit ? portraits[recruit.objectId] : undefined}
                        pending={pending || arriving}
                        disabled={pending || arriving}
                        onClick={() => (recruit ? onEnter(recruit.objectId) : onHire())}
                    />
                ))}
            </div>
            <div className="hq-deck-actions">
                {vacant ? (
                    <button
                        className="btn sq-primary"
                        disabled={pending || arriving}
                        onClick={onHire}
                    >
                        Hire squad <span>↗</span>
                    </button>
                ) : (
                    <button
                        className="btn sq-primary"
                        disabled={!first}
                        onClick={() => first && onEnter(first.objectId)}
                    >
                        Enter headquarters <span>↗</span>
                    </button>
                )}
                <p role="alert" className="hq-deck-error">
                    {error}
                </p>
            </div>
        </section>
    );
}
