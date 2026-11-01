// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The transaction in flight, pinned to the bottom of the screen while it lasts. */
export function TxOverlay({ label }: { label: string | null }) {
    if (!label) return null;
    return (
        <div className="hq-tx" role="status" aria-live="polite">
            <span className="hq-spinner" aria-hidden="true" />
            <span className="hq-tx-kind">Transmitting</span>
            <strong>{label}…</strong>
        </div>
    );
}
