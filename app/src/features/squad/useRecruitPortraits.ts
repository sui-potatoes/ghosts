// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from "react";

import { loadPortrait, savePortrait } from "./imageStore";

interface Portrayed {
    id: string;
    appearance: unknown;
}

/** Drawn this visit, by look; the image store only keeps them for a build with a manifest. */
const drawn = new Map<string, string>();

/**
 * Portraits of recruits away from the studio screen: from the browser's store
 * when drawn before, and otherwise by a studio of its own, which needs an element
 * to live in, off screen and inside `.squad-screen` for its theme. Assign the
 * returned `studioHost` to it. The studio goes as soon as the last one is drawn.
 */
export function useRecruitPortraits(recruits: Portrayed[]) {
    const studioHost = useRef<HTMLDivElement>(null);
    const [portraits, setPortraits] = useState<Record<string, string>>({});

    const looks = useMemo(
        () => recruits.map(({ id, appearance }) => ({ id, stamp: JSON.stringify(appearance) })),
        [recruits],
    );
    const appearances = useRef(new Map<string, unknown>());
    for (const { id, appearance } of recruits) appearances.current.set(id, appearance);
    const key = looks.map(({ id, stamp }) => `${id}:${stamp}`).join("|");

    useEffect(() => {
        let cancelled = false;
        let dispose: (() => void) | undefined;
        const show = (id: string, url: string) =>
            setPortraits((current) => (current[id] === url ? current : { ...current, [id]: url }));

        void (async () => {
            const missing = (
                await Promise.all(
                    looks.map(async (look) => {
                        const url = drawn.get(look.stamp) ?? (await loadPortrait(look.stamp));
                        if (url) {
                            drawn.set(look.stamp, url);
                            if (!cancelled) show(look.id, url);
                        }
                        return url ? null : look;
                    }),
                )
            ).filter((look) => look !== null);
            if (cancelled || !missing.length || !studioHost.current) return;

            const { createRecruitStudio } = await import("@ghosts/squad/studio/recruit-studio");
            if (cancelled || !studioHost.current) return;
            const studio = createRecruitStudio(studioHost.current, () => {});
            dispose = () => studio.dispose();
            for (const { id, stamp } of missing) {
                const url = await studio
                    .portrait(appearances.current.get(id) as Parameters<typeof studio.portrait>[0])
                    .catch(() => "");
                if (cancelled) return;
                if (!url) continue;
                drawn.set(stamp, url);
                show(id, url);
                void savePortrait(stamp, url);
            }
            dispose();
            dispose = undefined;
        })().catch((error) => console.warn("Portraits could not be drawn:", error));

        return () => {
            cancelled = true;
            dispose?.();
        };
        // `key` says when the looks changed; the arrays are new on every read of the chain.
    }, [key]);

    return { portraits, studioHost };
}
