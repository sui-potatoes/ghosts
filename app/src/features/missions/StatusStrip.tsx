// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

export type Readout = {
    label: string;
    value: string;
    /** `accent` for the one live value, `warn` for what needs attention. */
    tone?: "accent" | "warn";
    /** Dropped first on a narrow console. */
    minor?: boolean;
};

/**
 * The console's instrument strip: a row of labelled readouts (file code,
 * sector, coordinates, ground). Built only from
 * what the caller passes; a readout it has no value for is simply absent.
 */
export function StatusStrip({ readouts }: { readouts: Readout[] }) {
    return (
        <div className="gui-ops-strip" role="status">
            {readouts.map((r) => (
                <ReadoutCell key={r.label} {...r} />
            ))}
        </div>
    );
}

function ReadoutCell({ label, value, tone, minor }: Readout) {
    return (
        <span className="gui-ops-readout" data-tone={tone} data-minor={minor || undefined}>
            <span className="gui-ops-readout-label">{label}</span>
            <span className="gui-ops-readout-value">{value}</span>
        </span>
    );
}
