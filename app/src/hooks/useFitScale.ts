// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, type RefObject } from "react";

/** The phone-landscape window the menu screens are scaled in (see `--fit` in index.css). */
const PHONE_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";

/**
 * Fits a menu screen to a phone held in landscape by scaling the desktop
 * layout down as one piece. Sets `--fit` on <html> (and `data-fit`, which sets
 * the root font size to follow it); the screen's root carries `.fit-root`,
 * which zooms by it (index.css).
 *
 * `fit = min(1, visible height / natural height, visible width / designWidth)`. The natural height is
 * `designHeight` for a screen that flexes to the viewport (settings: the
 * least height its frame, categories and a few rows need), or, left out, the
 * root's own content height measured at scale 1 (the title and the pause card,
 * whose natural height depends on the entries they show). Outside the phone
 * window nothing is set and the screen is untouched.
 */
export function useFitScale(
    ref: RefObject<HTMLElement | null>,
    opts: {
        designHeight?: number;
        designWidth?: number;
        extraHeight?: number;
        enabled?: boolean;
    } = {},
) {
    const { designHeight, designWidth, extraHeight = 0, enabled = true } = opts;
    useEffect(() => {
        if (!enabled) return;
        const root = document.documentElement;
        const media = window.matchMedia(PHONE_LANDSCAPE);

        const clear = () => {
            root.removeAttribute("data-fit");
            root.style.removeProperty("--fit");
        };

        const apply = () => {
            if (!media.matches) {
                clear();
                return;
            }
            root.setAttribute("data-fit", "");
            let natural = designHeight;
            if (natural === undefined) {
                // Measure unscaled; restored below before anything paints.
                root.style.setProperty("--fit", "1");
                const el = ref.current;
                natural = (el ? el.scrollHeight : 0) + extraHeight;
            }
            let fit = natural > 0 ? Math.min(1, window.innerHeight / natural) : 1;
            if (designWidth) fit = Math.min(fit, window.innerWidth / designWidth);
            root.style.setProperty("--fit", String(Math.round(fit * 1000) / 1000));
        };

        apply();
        const el = ref.current;
        // Content changes (entries appearing) re-measure. The scale lives on <html>,
        // outside the observed subtree, so applying it cannot retrigger this.
        const observer = designHeight === undefined && el ? new MutationObserver(apply) : null;
        if (el) observer?.observe(el, { childList: true, subtree: true, characterData: true });
        window.addEventListener("resize", apply);
        media.addEventListener("change", apply);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", apply);
            media.removeEventListener("change", apply);
            clear();
        };
    }, [ref, designHeight, designWidth, extraHeight, enabled]);
}
