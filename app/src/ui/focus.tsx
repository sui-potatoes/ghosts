// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The focus cursor, React side: `<FocusRoot>` owns a screen's input,
 * `<FocusScope>` stacks a prompt or picker on it, `useFocusable` makes an
 * element a cursor target, `<FocusCursor>` draws the one bracket frame. The
 * model and the navigation rules are in `focus-store.ts`.
 *
 * Pointer model: the cursor follows the pointer. Moving the mouse onto a
 * target focuses it (one delegated listener on the document, resolved from the
 * `data-focus-id` of the event target, only on real movement); a finger
 * focuses on touch down. A click or tap then runs the target's primary at once
 * (`instant`) or arms it for a second click; right-click or a long-press lists
 * every command at the pointer.
 */

import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type MouseEvent,
    type PointerEvent,
    type ReactNode,
    type RefObject,
} from "react";

import { uiBack, uiConfirm, uiDeny, uiTick } from "../audio";
import { onAction } from "../input";
import type { Action } from "../settings/keys";
import { claimScreenBack } from "./back";
import {
    FocusStore,
    inactiveReason,
    secondaryCommands,
    type Command,
    type Dir,
} from "./focus-store";

export { clickCommand, FocusStore, inactiveReason, secondaryCommands } from "./focus-store";
export type { Command, CommandAction, Dir, Pulse } from "./focus-store";

const SOUNDS = {
    tick: (el: unknown) => uiTick(el as HTMLElement | null),
    confirm: uiConfirm,
    back: uiBack,
    deny: uiDeny,
};

/** How long a touch must rest on a target to open its command list. */
const LONG_PRESS_MS = 450;
/** A touch that travels further is a scroll or a drag, not a press. */
const LONG_PRESS_SLOP = 10;

const StoreContext = createContext<FocusStore | null>(null);
const ScopeContext = createContext("root");

export function useFocusStore(): FocusStore {
    const store = useContext(StoreContext);
    if (!store) throw new Error("useFocusStore outside <FocusRoot>");
    return store;
}

/** Re-render with the store; the whole screen is small enough to follow every change. */
export function useFocusState(): FocusStore {
    const store = useFocusStore();
    useSyncExternalStore(store.subscribe, store.getVersion);
    return store;
}

type RootProps = {
    /** Back with nothing above it: leaving the screen. */
    back: Command;
    /** Bumper / Q-E tab switching, while no prompt is open. */
    onTab?: (step: 1 | -1) => void;
    /** Trigger / PageUp-PageDown section switching (HQ / Squad ⇄ Armory). */
    onSection?: (step: 1 | -1) => void;
    children: ReactNode;
};

/**
 * The screen's input owner. It takes every menu action while mounted and
 * claims Back for the screen (`back.ts`), so the shell's EscapeBack stands
 * aside: the root back command is the way out, and dialogs registered with
 * `useBack` above the screen still close first.
 */
export function FocusRoot({ back, onTab, onSection, children }: RootProps) {
    const [store] = useState(() => new FocusStore(back, SOUNDS));
    store.setRootBack(back);
    const tab = useRef(onTab);
    tab.current = onTab;
    const section = useRef(onSection);
    section.current = onSection;

    // Claimed before paint, so EscapeBack has stepped aside before any key.
    useLayoutEffect(() => claimScreenBack(), []);

    // The cursor follows the pointer: one listener, the target resolved from its
    // data attribute (no measuring). A drag in progress (a button held) and touch
    // are not hover.
    useEffect(() => {
        const move = (e: globalThis.PointerEvent) => {
            if (e.pointerType === "touch") return;
            const hit =
                e.buttons === 0 && e.target instanceof Element
                    ? e.target.closest<HTMLElement>("[data-focus-id]")
                    : null;
            const id = hit?.dataset.focusId ?? null;
            // The node's own element must be the hit: another screen's store is not ours.
            store.pointerMove(e.clientX, e.clientY, id && store.node(id)?.el === hit ? id : null);
        };
        document.addEventListener("pointermove", move, { passive: true });
        return () => document.removeEventListener("pointermove", move);
    }, [store]);

    useEffect(
        () =>
            onAction((action: Action) => {
                store.keyInput();
                switch (action) {
                    case "up":
                    case "down":
                    case "left":
                    case "right":
                        store.move(action);
                        return true;
                    case "confirm":
                    case "reset":
                    case "back":
                        store.invoke(action);
                        return true;
                    // A picker never swallows the header: it closes and the switch goes on.
                    case "prev-tab":
                    case "next-tab":
                        if (store.clearForHeader()) tab.current?.(action === "next-tab" ? 1 : -1);
                        return true;
                    case "prev-section":
                    case "next-section":
                        if (store.clearForHeader())
                            section.current?.(action === "next-section" ? 1 : -1);
                        return true;
                    default:
                        return true;
                }
            }),
        [store],
    );

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/**
 * A click on the header (a tab, a sibling section) is the mouse's tab key: it
 * waits while a modal scope (a prompt) is open, and closes a passing one (a
 * picker, the command list) first, so the switch lands on the screen itself.
 * Returns false when the click must be ignored.
 */
export function headerClick(store: FocusStore): boolean {
    return store.clearForHeader();
}

/**
 * A stacked scope: the cursor is trapped in it, Back runs `back`. `modal` (a
 * prompt) also holds the header's tabs and sections until it is answered.
 */
export function FocusScope({
    id,
    back,
    modal = false,
    start,
    children,
}: {
    id: string;
    back: Command;
    modal?: boolean;
    /** The node the cursor, and so the subject, starts on: what is chosen now, not the first row. */
    start?: string;
    children: ReactNode;
}) {
    const store = useFocusStore();
    const ref = useRef(back);
    ref.current = back;
    useLayoutEffect(() => {
        store.pushScope(
            id,
            {
                ...ref.current,
                run: () => ref.current.run?.(),
            },
            modal,
            start,
        );
        return () => store.popScope(id);
        // `start` is read once, on open.
    }, [store, id, modal]);
    return <ScopeContext.Provider value={id}>{children}</ScopeContext.Provider>;
}

type FocusableOptions = {
    id: string;
    group: string;
    title?: string;
    hint?: string;
    commands?: Command[];
    directions?: (dir: Dir) => boolean;
    /**
     * False for a target the pointer works inside of (the 3D stage): hovering
     * and clicking it never move the cursor, so dragging the model does not
     * steal focus from the panel being worked in.
     */
    pointer?: boolean;
    /**
     * A second click on the focused target runs its confirm (default). False
     * for choosers, whose clicks belong to their arrows and swatches.
     */
    clickConfirm?: boolean;
    /**
     * The first click or tap runs the primary too, for a cheap, undoable one
     * (select an operative, open a picker). Off, a click selects and a second
     * click on the selected target runs it (a purchase, an issue, a hire).
     */
    instant?: boolean;
    /** The primary is shown as a button on the row (`armedCommand`) without being armed. */
    offered?: boolean;
    /** The stage previews this target while the cursor is on it, hovered or not (`store.preview`). */
    previews?: boolean;
};

/**
 * Register an element as a cursor target. Spread `props` on it: the ref, the
 * focus attributes the CSS draws, click/tap to select, a second click or tap
 * to confirm, right-click or long-press for the command list.
 */
export function useFocusable<T extends HTMLElement>({
    id,
    group,
    title,
    hint,
    commands = [],
    directions,
    pointer = true,
    clickConfirm = true,
    instant = false,
    offered = false,
    previews = false,
}: FocusableOptions) {
    const store = useFocusState();
    const scope = useContext(ScopeContext);
    const ref = useRef<T | null>(null);
    const press = useRef<{ x: number; y: number; timer: number } | null>(null);
    /** A long-press just opened the list: the click its lift produces is not a tap. */
    const swallow = useRef(0);

    useLayoutEffect(() => {
        store.register({
            id,
            group,
            scope,
            el: ref.current,
            title,
            hint,
            commands,
            directions,
            pointer,
            previews,
        });
        return () => store.unregister(id);
        // Registered once per id; the data is refreshed below on every render.
    }, [store, id, group, scope]);

    useLayoutEffect(() => {
        store.update(id, {
            el: ref.current,
            title,
            hint,
            commands,
            directions,
            pointer,
            previews,
        });
    });

    useEffect(() => () => window.clearTimeout(press.current?.timer), []);

    const focused = store.focused === id;
    const pulse = store.pulse?.id === id ? store.pulse : null;
    // The panel's own place-keeper: where its cursor was, once the cursor left it.
    const current = !focused && store.remembered(group) === id;
    // Selected by a click and waiting for its confirm while the pointer rests elsewhere.
    const armed = !focused && store.armed === id;
    // The row commands act on while the pointer's cursor rests elsewhere.
    const subject = !focused && store.subject === id;
    // Chips and the command list carry the secondaries only; the primary is the click.
    const secondary = secondaryCommands(commands);
    const listable = secondary.length > 0;
    // The primary cannot run now: the target dims and nothing arms it.
    const inactive = inactiveReason(commands);
    // Armed by a click: the confirm waits for a second click, and the mouse is
    // offered it as a button on the row (never for a refused primary).
    const armedCommand =
        (store.armed === id || offered) && inactive === undefined
            ? commands.find((c) => c.action === "confirm")
            : undefined;

    const openList = (x: number, y: number) => {
        store.pointerInput();
        store.focus(id);
        if (listable) store.openMenu(id, x, y);
    };
    const cancelPress = () => {
        if (!press.current) return;
        window.clearTimeout(press.current.timer);
        press.current = null;
    };

    return {
        focused,
        /**
         * Show the secondary commands inline at the trailing edge: focused, the
         * mouse or touch in use, and something besides the primary to offer.
         */
        inline: (focused && store.pointer && listable) || armedCommand !== undefined,
        /** The primary, while the target is armed: shown as a button on the row. */
        armedCommand,
        commands,
        inactive,
        props: {
            ref,
            "data-focused": focused || undefined,
            "data-current": current || undefined,
            "data-armed": armed || undefined,
            "data-subject": subject || undefined,
            "data-pressed": pulse?.kind === "press" || undefined,
            "data-denied": pulse?.kind === "deny" || undefined,
            "data-inactive": inactive !== undefined || undefined,
            "aria-disabled": inactive !== undefined || undefined,
            "data-pointer": pointer || undefined,
            "data-focus-id": pointer ? id : undefined,
            onMouseDown: (e: MouseEvent) => {
                if (pointer) e.preventDefault();
            },
            // A finger down takes the cursor at once (the bar shows the hint while it
            // rests; the action waits for the lift). Resting in place opens the
            // command list: a phone's right-click.
            onPointerDown: (e: PointerEvent) => {
                if (e.pointerType !== "touch") return;
                if (pointer) store.touchDown(id);
                cancelPress();
                const { clientX: x, clientY: y } = e;
                press.current = {
                    x,
                    y,
                    timer: window.setTimeout(() => {
                        press.current = null;
                        swallow.current = performance.now();
                        openList(x, y);
                    }, LONG_PRESS_MS),
                };
            },
            onPointerMove: (e: PointerEvent) => {
                const p = press.current;
                if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP)
                    cancelPress();
            },
            onPointerUp: (e: PointerEvent) => {
                if (e.pointerType === "touch") store.touchEnd();
                cancelPress();
            },
            onPointerCancel: cancelPress,
            // A click or tap acts as Confirm would: the primary at once
            // (`instant`), else armed by this click and run by the next.
            onClick: () => {
                if (performance.now() - swallow.current < 800) return;
                if (!pointer) return;
                store.click(id, commands, { instant, clickConfirm });
            },
            // Right-click: every command of the target, as a list at the pointer.
            // Works on the stage too: the one way a mouse reaches its extra commands.
            onContextMenu: (e: MouseEvent) => {
                e.preventDefault();
                // A long-press already opened it (Android also fires contextmenu).
                if (performance.now() - swallow.current < 800) return;
                openList(e.clientX, e.clientY);
            },
        },
    };
}

/**
 * The cursor itself: one bracket frame for the whole screen that snaps to the
 * focused node's box. Measured against the screen root so the screen's zoom
 * (phone landscape, large displays) cancels out.
 */
export function FocusCursor({ root }: { root: RefObject<HTMLElement | null> }) {
    const store = useFocusState();
    const [box, setBox] = useState<{
        x: number;
        y: number;
        w: number;
        h: number;
        hidden: boolean;
    } | null>(null);
    const node = store.node(store.focused);
    const el = (node?.el ?? null) as HTMLElement | null;

    useLayoutEffect(() => {
        const host = root.current;
        if (!el || !host) return;
        // A target inside a scrolling list: the cursor hides while the list
        // has scrolled it out of view (a wheel or a swipe), never drawing
        // over the panels around the list.
        const scroller = el.closest<HTMLElement>("[data-gui-scroll]");
        const measure = () => {
            const r = el.getBoundingClientRect();
            const h = host.getBoundingClientRect();
            const scale = h.width / host.offsetWidth || 1;
            let hidden = false;
            if (scroller) {
                const v = scroller.getBoundingClientRect();
                hidden = r.bottom < v.top + 2 || r.top > v.bottom - 2;
            }
            setBox({
                x: (r.left - h.left) / scale,
                y: (r.top - h.top) / scale,
                w: r.width / scale,
                h: r.height / scale,
                hidden,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(host);
        scroller?.addEventListener("scroll", measure, { passive: true });
        return () => {
            observer.disconnect();
            scroller?.removeEventListener("scroll", measure);
        };
    }, [el, root, store.version]);

    if (!box || !el) return null;
    const motion = store.motion;
    return (
        <div
            className="gui-cursor"
            aria-hidden
            data-hidden={box.hidden || undefined}
            data-armed={(store.armed !== null && store.armed === store.focused) || undefined}
            data-inactive={(node && inactiveReason(node.commands) !== undefined) || undefined}
            // A destructive question turns the cursor amber with the frame it sits on.
            data-tone={
                node?.commands.some((c) => c.action === "confirm" && c.tone === "danger")
                    ? "danger"
                    : undefined
            }
            style={{
                transform: `translate(${box.x}px, ${box.y}px)`,
                width: box.w,
                height: box.h,
            }}
        >
            {/* Remounted per press or bump, so its one-shot motion replays. */}
            <div
                key={motion?.n ?? 0}
                className="gui-cursor-frame"
                data-motion={motion?.kind}
                data-dir={motion?.dir}
            >
                <i />
                <i />
                <i />
                <i />
            </div>
        </div>
    );
}
