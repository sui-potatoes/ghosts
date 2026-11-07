// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { loadGear, saveGear } from "../squad/imageStore";

let shared: Promise<Record<string, string>> | null = null;

/**
 * Catalog thumbnails (weapons, armor, mods) for Headquarters and the Armory:
 * kept in the browser between visits (redrawn when the gear models change),
 * otherwise rendered once per session by a short-lived studio in an offscreen
 * host, then shared.
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
    const { createRecruitStudio } = await import("@ghosts/squad/studio/recruit-studio");
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    // The studio reads its theme (`--squad-studio-*`) off the host.
    host.className = "squad-screen";
    host.style.cssText =
        "position:fixed;left:-10000px;top:0;width:320px;height:320px;min-height:0;padding:0;pointer-events:none";
    document.body.append(host);
    const studio = createRecruitStudio(host, () => {});
    try {
        const images = await studio.equipmentImages();
        void saveGear(images);
        return images;
    } finally {
        studio.dispose();
        host.remove();
    }
}
