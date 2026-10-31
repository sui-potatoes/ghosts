// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

import { keyLabel, type Action } from "./keys";
import { useSettings } from "./store";

/** A key cap in the controls table and the hints bar. */
export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="kbd">{children}</kbd>;
}

/** The keys bound to a menu `action`, or the given `keys`, as key caps. */
export function Keys(props: { action: Action } | { keys: string[] }) {
    const [settings] = useSettings();
    const keys = "keys" in props ? props.keys : settings.controls.bindings[props.action];
    return (
        <span className="inline-flex gap-1.5">
            {keys.map((key) => (
                <Kbd key={key}>{keyLabel(key)}</Kbd>
            ))}
        </span>
    );
}
