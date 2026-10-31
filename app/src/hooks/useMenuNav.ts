// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react";

import { uiTick } from "../audio";
import { onAction } from "../input";
import { dialogAbove } from "../settings/SettingList";

/**
 * A focus-walked button menu on the input bus: Up/Down move the focus
 * through the registered items (skipping the disabled), Confirm presses the
 * focused one — whichever input produced the action. A press with nothing
 * focused recovers the top entry. Assign the returned ref array to the
 * buttons in order.
 */
export function useMenuNav(active: boolean) {
    const items = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (!active) return;
        return onAction((action) => {
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
            uiTick();
            const dir = action === "down" ? 1 : -1;
            els[i < 0 ? 0 : (i + dir + els.length) % els.length].focus();
            return true;
        });
    }, [active]);

    return items;
}
