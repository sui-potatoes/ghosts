// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { CSSProperties } from "react";

import { VOICES, type ChainRecruit } from "../../../chain";

interface Props {
    /** The slot's recruit; null shows the card face down. */
    recruit: ChainRecruit | null;
    /** Slot number, also the roster flip's stagger (the deck paces its own). */
    index: number;
    variant: "deck" | "roster";
    portrait?: string;
    selected?: boolean;
    /** A hire is in flight: face-down cards pulse. */
    pending?: boolean;
    /** Unsaved changes on this recruit. */
    dirty?: boolean;
    disabled?: boolean;
    /** For a focus-walked menu of cards. */
    buttonRef?(el: HTMLButtonElement | null): void;
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
    buttonRef,
    onClick,
}: Props) {
    const down = !recruit;
    const slot = String(index + 1).padStart(2, "0");
    return (
        <button
            ref={buttonRef}
            className={`hq-card hq-card-${variant} ${down ? "is-down" : ""} ${pending && down ? "is-pending" : ""} ${selected ? "selected" : ""}`}
            style={
                {
                    "--hq-flip-delay": variant === "roster" ? `${index * 160}ms` : "0ms",
                    "--hq-slot": index,
                } as CSSProperties
            }
            aria-pressed={!down && selected !== undefined ? selected : undefined}
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
                        {!pending && <span>Free hire</span>}
                    </span>
                </span>
            </span>
        </button>
    );
}
