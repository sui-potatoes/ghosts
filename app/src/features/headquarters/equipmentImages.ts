// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { loadGear, saveGear } from "../squad/imageStore";

let shared: Promise<Record<string, string>> | null = null;

/**
 * Catalog thumbnails (weapons, armor, mods, utilities) for Headquarters and
 * the Armory: kept in the browser between visits (redrawn when the gear
 * models change), otherwise drawn once per session (`gear-thumbnails.ts`:
 * product lighting, transparent, filling a 4:3 plate), then shared.
 */
export function useEquipmentImages(): Record<string, string> {
    const [images, setImages] = useState<Record<string, string>>({});
    useEffect(() => {
        let cancelled = false;
        shared ??= render().catch(() => {
            shared = null;
            return {};
        });
        void shared.then((result) => {
            if (!cancelled) setImages(result);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    return images;
}

async function render(): Promise<Record<string, string>> {
    const stored = await loadGear();
    if (stored) return stored;
    const { drawGearThumbnails } = await import("./gear-thumbnails");
    const images = await drawGearThumbnails();
    void saveGear(images);
    return images;
}
