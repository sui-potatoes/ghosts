// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useFocusState } from "./focus";
import { followScroll, overflowEdges, railThumb, type ListView } from "./list-math";

type ListProps = {
    /** The accessible name: `Roster`, `Requisition list`. */
    label: string;
    /** `ListRow`s (or any focusables) in reading order. */
    children: ReactNode;
};

/**
 * A column of rows that may be longer than its panel. Nothing on a screen
 * page-scrolls: the list scrolls inside itself, following the cursor (the
 * next row always peeks in), with no scrollbar — only a hairline rail with
 * a thumb on the trailing edge and the rows fading out at an edge that has
 * more. The wheel and a swipe scroll it natively; the cursor hides while
 * its row is scrolled out of view and the next move brings it back.
 * A short list renders exactly like a plain column.
 */
export function List({ label, children }: ListProps) {
    const store = useFocusState();
    const ref = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<ListView | null>(null);

    const read = (el: HTMLElement): ListView => ({
        top: el.scrollTop,
        height: el.clientHeight,
        content: el.scrollHeight,
    });

    // Follow the cursor: its row, if it is in this list, is kept in view.
    const focused = store.node(store.focused)?.el as HTMLElement | null | undefined;
    useLayoutEffect(() => {
        const list = ref.current;
        if (!list || !focused || !list.contains(focused)) return;
        const v = list.getBoundingClientRect();
        const r = focused.getBoundingClientRect();
        const scale = v.height / list.clientHeight || 1;
        const item = { top: (r.top - v.top) / scale + list.scrollTop, height: r.height / scale };
        // Keys keep the next row in sight; a pointer only nudges a clipped row in.
        const margin = store.pointer ? 0 : item.height;
        const top = followScroll(read(list), item, margin);
        if (top !== list.scrollTop) list.scrollTop = top;
    }, [focused, store.pointer, store.version]);

    useEffect(() => {
        const list = ref.current;
        if (!list) return;
        const update = () => setView(read(list));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(list);
        for (const child of list.children) observer.observe(child);
        list.addEventListener("scroll", update, { passive: true });
        return () => {
            observer.disconnect();
            list.removeEventListener("scroll", update);
        };
    }, [children]);

    const thumb = view && railThumb(view);
    const edges = view ? overflowEdges(view) : { above: false, below: false };
    return (
        <div
            className="gui-list-wrap"
            data-above={edges.above || undefined}
            data-below={edges.below || undefined}
        >
            <div ref={ref} className="gui-list" role="listbox" aria-label={label} data-gui-scroll>
                {children}
            </div>
            {thumb && (
                <i className="gui-list-rail" aria-hidden>
                    <b style={{ top: `${thumb.start * 100}%`, height: `${thumb.size * 100}%` }} />
                </i>
            )}
        </div>
    );
}
