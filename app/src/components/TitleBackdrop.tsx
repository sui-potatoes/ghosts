// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import source from "../assets/title-scene-poster.webp";
import sourceSmall from "../assets/title-scene-poster-960.webp";
import type { TitleCity } from "./title-city";

/** A captured frame of this scene covers loading and unavailable WebGL contexts. */
export function TitleBackdrop() {
    const host = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let cancelled = false;
        let city: TitleCity | undefined;
        // The poster covers the wait, so the scene starts once the menu has
        // painted and the browser is idle: the menu answers input from the start.
        const start = () =>
            void import("./title-city")
                .then(({ createTitleCity }) => {
                    if (!cancelled && host.current) {
                        city = createTitleCity(
                            host.current,
                            () => setReady(true),
                            () => setReady(false),
                        );
                    }
                })
                .catch(() => {
                    if (!cancelled) setReady(false);
                });
        const idle = typeof window.requestIdleCallback === "function";
        const handle = idle
            ? window.requestIdleCallback(start, { timeout: 1200 })
            : window.setTimeout(start, 300);
        return () => {
            cancelled = true;
            if (idle) window.cancelIdleCallback(handle);
            else window.clearTimeout(handle);
            city?.dispose();
        };
    }, []);
    return (
        <>
            <img
                className="main-menu-backdrop main-menu-image"
                src={source}
                srcSet={`${sourceSmall} 960w, ${source} 1672w`}
                sizes="100vw"
                width={1672}
                height={941}
                alt=""
                aria-hidden="true"
                fetchPriority="high"
                decoding="async"
            />
            <div
                ref={host}
                className="main-menu-backdrop main-menu-scene"
                aria-hidden="true"
                data-ready={ready}
            />
        </>
    );
}
