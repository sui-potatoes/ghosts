// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { clockOf } from "./model";

export type Readout = {
    label: string;
    value: string;
    /** `accent` for the one live value, `warn` for what needs attention. */
    tone?: "accent" | "warn";
    /** Dropped first on a narrow console. */
    minor?: boolean;
};

/** The UTC time, ticking once a second while mounted. */
function useUtcClock(): string {
    const [now, setNow] = useState(() => clockOf(new Date()));
    useEffect(() => {
        const timer = window.setInterval(() => setNow(clockOf(new Date())), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

/**
 * The console's instrument strip: a row of labelled readouts (file code,
 * sector, coordinates, ground) and, when asked, the UTC clock. Built only from
 * what the caller passes; a readout it has no value for is simply absent.
 */
export function StatusStrip({ readouts, clock }: { readouts: Readout[]; clock?: boolean }) {
    return (
        <div className="gui-ops-strip" role="status">
            {readouts.map((r) => (
                <ReadoutCell key={r.label} {...r} />
            ))}
            {clock && <Clock />}
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

function Clock() {
    const now = useUtcClock();
    return <ReadoutCell label="UTC" value={now} minor />;
}
