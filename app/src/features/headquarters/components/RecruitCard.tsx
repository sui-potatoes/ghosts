// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { CSSProperties } from "react";

import { VOICES, type ChainRecruit } from "../../../chain";

interface Props {
    /** The slot's recruit; null shows the card face down. */
    recruit: ChainRecruit | null;
    /** Slot number, also the flip's stagger. */
    index: number;
    variant: "deck" | "roster";
    portrait?: string;
    selected?: boolean;
    /** A hire is in flight: face-down cards pulse. */
    pending?: boolean;
    /** Unsaved changes on this recruit. */
    dirty?: boolean;
    disabled?: boolean;
    onClick(): void;
}

/**
 * A recruit as a card: face down while the slot is vacant, turning over when
 * a hire fills it. The same element stays mounted per slot, so the flip is a
 * plain transition from one state to the other.
 */
export function RecruitCard({
    recruit,
    index,
    variant,
    portrait,
    selected,
    pending,
    dirty,
    disabled,
    onClick,
}: Props) {
    const down = !recruit;
    const slot = String(index + 1).padStart(2, "0");
    return (
        <button
            className={`hq-card hq-card-${variant} ${down ? "is-down" : ""} ${pending && down ? "is-pending" : ""} ${selected ? "selected" : ""}`}
            style={{ "--hq-flip-delay": `${index * 160}ms` } as CSSProperties}
            aria-pressed={variant === "roster" && !down ? !!selected : undefined}
            aria-label={recruit ? recruit.metadata.name : `Vacant slot ${slot}: hire recruits`}
            disabled={disabled}
            onClick={onClick}
        >
            <span className="hq-card-inner">
                <span className="hq-card-face hq-card-front" aria-hidden={down}>
                    {recruit && (
                        <>
                            <span className="hq-card-portrait">
                                {portrait ? (
                                    <img src={portrait} alt="" />
                                ) : (
                                    <span className="hq-card-monogram">
                                        {recruit.metadata.name.slice(0, 1)}
                                    </span>
                                )}
                                <small>{slot}</small>
                            </span>
                            <span className="hq-card-person">
                                <span className="hq-card-rank">{recruit.rank.$kind}</span>
                                <strong>{recruit.metadata.name}</strong>
                                <small>
                                    {VOICES[recruit.metadata.voice]?.label ?? "Voice —"}
                                    {dirty && <i aria-label="Unsaved changes" />}
                                </small>
                            </span>
                        </>
                    )}
                </span>
                <span className="hq-card-face hq-card-back" aria-hidden={!down}>
                    <span className="hq-card-emblem" aria-hidden="true">
                        G
                    </span>
                    <span className="hq-card-vacant">
                        <small>{slot}</small>
                        <strong>{pending ? "Incoming" : "Vacant"}</strong>
                        <span>{pending ? "Drawing on chain…" : "Free hire"}</span>
                    </span>
                </span>
            </span>
        </button>
    );
}
