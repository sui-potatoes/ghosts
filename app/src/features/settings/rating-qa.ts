// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * QA only, in builds made with `VITE_RATING_QA=1`: `?rating=1720` on the settings
 * route seeds the mock rating once per page load, so the reset row can be tested
 * above, at and below the default. Does nothing in normal builds.
 */

import { useEffect } from "react";

import { readRating, writeRating } from "../play/rating";

let seeded = false;

export function useRatingQaSeed(): void {
    useEffect(() => {
        if (!import.meta.env.VITE_RATING_QA || seeded) return;
        seeded = true;
        const param = new URLSearchParams(window.location.search).get("rating");
        const value = param === null || param.trim() === "" ? NaN : Number(param);
        if (!Number.isFinite(value) || value < 0) return;
        const rating = Math.round(value);
        const state = readRating();
        writeRating({ ...state, rating, peak: Math.max(state.peak, rating) });
    }, []);
}
