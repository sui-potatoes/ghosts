// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react";

import { uiTick } from "../audio";
import { onAction } from "../input";
import { dialogAbove } from "../settings/SettingList";

/**
 * A focus-walked button menu on the input bus: entering the menu selects the
 * top entry, Up/Down move the focus through the registered items (skipping
 * the disabled), Confirm presses the focused one — whichever input produced
 * the action. A press with nothing focused recovers the top entry. The
 * pointer moves the same selection: hovering an entry focuses it, so there is
 * only ever one highlighted row. Assign the returned ref array to the buttons
 * in order.
 */
export function useMenuNav(active: boolean) {
    const items = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (!active) return;
        // Console-style: the top entry is selected on entry, so Confirm
        // always has a target and the first Down lands on the second row.
        const first = items.current.find((el) => el && !el.disabled);
        if (first && !dialogAbove(first)) first.focus();
        const hover = (e: PointerEvent) => {
            if (e.pointerType === "touch") return;
            const el = (e.target as Element | null)?.closest("button");
            if (!el || el.disabled || el === document.activeElement) return;
            if (!items.current.includes(el as HTMLButtonElement) || dialogAbove(el)) return;
            el.focus({ preventScroll: true });
        };
        document.addEventListener("pointerover", hover);
        const stop = onAction((action) => {
            if (action !== "up" && action !== "down" && action !== "confirm") return false;
            const els = items.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
            if (!els.length) return false;
            // A dialog stacked on top (sign-in, a name prompt) owns the nav.
            if (dialogAbove(els[0])) return false;
            const i = els.indexOf(document.activeElement as HTMLButtonElement);
            if (action === "confirm") {
                if (i < 0) return false;
                // The click knocks through the delegated listener (audio/ui.ts).
                els[i].click();
                return true;
            }
            const dir = action === "down" ? 1 : -1;
            const next = els[i < 0 ? 0 : (i + dir + els.length) % els.length];
            next.focus();
            uiTick(next);
            return true;
        });
        return () => {
            document.removeEventListener("pointerover", hover);
            stop();
        };
    }, [active]);

    return items;
}
