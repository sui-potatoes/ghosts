// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

let shared: Promise<Record<string, string>> | null = null;

/**
 * Catalog thumbnails (weapons, armor, attachments) for screens without a
 * character stage: rendered once per session by a short-lived studio in an
 * offscreen host, then shared.
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
        return await studio.equipmentImages();
    } finally {
        studio.dispose();
        host.remove();
    }
}
