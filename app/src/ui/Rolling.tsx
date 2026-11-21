// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { uiCount } from "../audio";
import { reducedMotion } from "./motion";
import { counterSteps } from "./tactile-model";

type RollingProps = {
    value: number;
    /** How a value reads: `1,250 cr`. Plain digits by default. */
    format?: (value: number) => string;
};

/**
 * A number that rolls to a new value with a soft click per step instead of
 * appearing (`counterSteps`: whole steps, eased, under 600 ms). The first
 * value shows as it is; only a change rolls. With reduced motion the new
 * value is set at once, with one click.
 */
export function Rolling({ value, format = String }: RollingProps) {
    const [shown, setShown] = useState(value);
    const at = useRef(value);

    useEffect(() => {
        const from = at.current;
        if (from === value) return;
        if (reducedMotion()) {
            at.current = value;
            setShown(value);
            uiCount();
            return;
        }
        const timers = counterSteps(from, value).map(({ at: ms, value: step }) =>
            window.setTimeout(() => {
                at.current = step;
                setShown(step);
                uiCount();
            }, ms),
        );
        // A new value mid-roll rolls on from wherever it got to.
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [value]);

    return <span className="gui-rolling">{format(shown)}</span>;
}
