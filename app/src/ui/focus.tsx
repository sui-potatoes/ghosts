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

import { observePad } from "@ghosts/engine/gamepad";
import { inputMode } from "@ghosts/engine/input-mode";

import { uiBack, uiConfirm, uiDeny, uiHoldCancel, uiHoldStep, uiTick } from "../audio";
import { haptic } from "../haptics";
import { onAction, onActionPinned } from "../input";
import type { Action } from "../settings/keys";
import { currentAction } from "../settings/store";
import { claimScreenBack } from "./back";
import {
    FocusStore,
    inactiveReason,
    inlineConfirm,
    secondaryCommands,
    type Command,
    type Dir,
    type FocusElement,
    type FocusSounds,
} from "./focus-store";
import { reducedMotion } from "./motion";
import { DETENT_MS, detentFrames, sameBox, type Box } from "./tactile-model";

export {
    clickCommand,
    FocusStore,
    inactiveReason,
    inlineConfirm,
    secondaryCommands,
} from "./focus-store";
export type { Command, CommandAction, Dir, Pulse } from "./focus-store";

const html = (el: FocusElement | null) => el as HTMLElement | null;

/** Feedback never stops a command: a sound or a buzz that throws is dropped. */
function safe(...steps: (() => void)[]) {
    for (const step of steps) {
        try {
            step();
        } catch {
            // No audio or no motors right now; the command still runs.
        }
    }
}

/** Every gesture's sound and buzz; the store calls these with the element it happened on. */
const SOUNDS: FocusSounds = {
    tick: (el) =>
        safe(
            () => uiTick(html(el)),
            () => haptic("move"),
        ),
    confirm: (el) =>
        safe(
            () => uiConfirm(html(el)),
            () => haptic("confirm"),
        ),
    back: (el) =>
        safe(
            () => uiBack(html(el)),
            () => haptic("back"),
        ),
    deny: (el) =>
        safe(
            () => uiDeny(html(el)),
            () => haptic("deny"),
        ),
    hold: (el, step, progress) =>
        safe(
            () => uiHoldStep(html(el), step),
            () => haptic("hold", progress),
        ),
    holdCancel: (el) => safe(() => uiHoldCancel(html(el))),
};

/**
 * Pressed under the pointer: the target sinks while the button or finger is
 * down (`data-held`), and its action runs on release (the click). A refused
 * target does not give; a slider's bar is a drag, not a press.
 */
function usePressedUnderPointer(store: FocusStore) {
    useEffect(() => {
        let held: HTMLElement | null = null;
        const lift = () => {
            held?.removeAttribute("data-held");
            held = null;
        };
        const down = (e: globalThis.PointerEvent) => {
            lift();
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (!(e.target instanceof Element) || e.target.closest(".gui-slider")) return;
            const hit = e.target.closest<HTMLElement>("[data-focus-id]");
            const id = hit?.dataset.focusId;
            if (!hit || !id || store.node(id)?.el !== hit || hit.hasAttribute("data-inactive"))
                return;
            held = hit;
            hit.setAttribute("data-held", "");
        };
        // Sliding off before the release springs it back; that press never clicks.
        const out = (e: globalThis.PointerEvent) => {
            if (held && !(e.relatedTarget instanceof Node && held.contains(e.relatedTarget)))
                lift();
        };
        document.addEventListener("pointerdown", down, { passive: true });
        document.addEventListener("pointerout", out, { passive: true });
        window.addEventListener("pointerup", lift, { passive: true });
        window.addEventListener("pointercancel", lift, { passive: true });
        window.addEventListener("blur", lift);
        return () => {
            lift();
            document.removeEventListener("pointerdown", down);
            document.removeEventListener("pointerout", out);
            window.removeEventListener("pointerup", lift);
            window.removeEventListener("pointercancel", lift);
            window.removeEventListener("blur", lift);
        };
    }, [store]);
}

/**
 * A hold to confirm, while one runs: the frame clock (no loop otherwise), the
 * fill on the held target (`--gui-hold`, `data-holding`) and the release,
 * whichever input started it: the confirm key coming up, the pointer
 * lifting, the pad's A let go, or the window losing focus.
 */
function useHoldDriver(store: FocusStore) {
    useEffect(() => {
        let raf = 0;
        let el: HTMLElement | null = null;
        let offPad: (() => void) | null = null;
        const stop = () => {
            cancelAnimationFrame(raf);
            raf = 0;
            el?.style.removeProperty("--gui-hold");
            el?.removeAttribute("data-holding");
            el = null;
            offPad?.();
            offPad = null;
        };
        const frame = () => {
            raf = 0;
            const progress = store.holdFrame();
            if (progress === null || progress >= 1) {
                stop();
                return;
            }
            el?.style.setProperty("--gui-hold", progress.toFixed(3));
            raf = requestAnimationFrame(frame);
        };
        const start = () => {
            const hold = store.hold;
            if (!hold) {
                if (raf || el) stop();
                return;
            }
            if (raf) return;
            el = (store.node(hold.id)?.el ?? null) as HTMLElement | null;
            el?.setAttribute("data-holding", "");
            el?.style.setProperty("--gui-hold", "0");
            // A pad hold ends when A comes up; other inputs end on their own events.
            if (inputMode() === "gamepad")
                offPad = observePad((snap) => {
                    if (!snap.buttons[0]) store.releaseHold();
                });
            raf = requestAnimationFrame(frame);
        };
        const release = () => store.releaseHold();
        const keyUp = (e: KeyboardEvent) => {
            if (currentAction(e) === "confirm") store.releaseHold();
        };
        const off = store.subscribe(start);
        window.addEventListener("keyup", keyUp);
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
        window.addEventListener("blur", release);
        return () => {
            off();
            stop();
            window.removeEventListener("keyup", keyUp);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            window.removeEventListener("blur", release);
        };
    }, [store]);
}

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
    /** Stays the top input consumer even when a screen mounts after it (first-visit intros). */
    pinned?: boolean;
    children: ReactNode;
};

/**
 * The screen's input owner. It takes every menu action while mounted and
 * claims Back for the screen (`back.ts`), so the shell's EscapeBack stands
 * aside: the root back command is the way out, and dialogs registered with
 * `useBack` above the screen still close first.
 */
export function FocusRoot({ back, onTab, onSection, pinned, children }: RootProps) {
    const [store] = useState(() => new FocusStore(back, SOUNDS));
    store.setRootBack(back);
    const tab = useRef(onTab);
    tab.current = onTab;
    const section = useRef(onSection);
    section.current = onSection;

    // Claimed before paint, so EscapeBack has stepped aside before any key.
    useLayoutEffect(() => claimScreenBack(), []);

    usePressedUnderPointer(store);
    useHoldDriver(store);

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
            (pinned ? onActionPinned : onAction)((action: Action) => {
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
        [store, pinned],
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
    // The right-click list carries the secondaries; the primary is the click.
    const secondary = secondaryCommands(commands);
    const listable = secondary.length > 0;
    // The primary cannot run now: the target dims and nothing arms it.
    const inactive = inactiveReason(commands);
    // Armed by a click: the confirm waits for a second click, and the mouse is
    // offered it as a button on the row (never for a refused primary).
    const armedCommand = inlineConfirm(commands, { armed: store.armed === id, offered });

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
         * Show the inline confirm: only the target's own armed (or offered)
         * primary. Hover and the cursor never add a button to a row.
         */
        inline: armedCommand !== undefined,
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

/** A target's own press offset (`translate`, mid-spring included), so the cursor ignores it. */
function pressOffset(el: HTMLElement): number {
    const translate = getComputedStyle(el).translate;
    if (!translate || translate === "none") return 0;
    return parseFloat(translate.split(" ")[1] ?? "0") || 0;
}

/**
 * The cursor itself: one bracket frame for the whole screen that snaps to the
 * focused node's box. Measured against the screen root so the screen's zoom
 * (phone landscape, large displays) cancels out. Moving to another target it
 * travels with weight (`detentFrames`: a short run with a slight overshoot
 * into place); a re-measure of the same target (a scroll, a resize) follows
 * at once. The press of a target (it sinks a pixel or two) is its own
 * motion: the frame stays where the target rests.
 */
export function FocusCursor({ root }: { root: RefObject<HTMLElement | null> }) {
    const store = useFocusState();
    const [box, setBox] = useState<(Box & { hidden: boolean }) | null>(null);
    const node = store.node(store.focused);
    const el = (node?.el ?? null) as HTMLElement | null;
    const frame = useRef<HTMLDivElement>(null);
    const last = useRef<{ el: HTMLElement; box: Box & { hidden: boolean } } | null>(null);
    const travel = useRef<Animation | null>(null);

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
            const next = {
                x: (r.left - h.left) / scale,
                y: (r.top - h.top) / scale - pressOffset(el),
                w: r.width / scale,
                h: r.height / scale,
                hidden,
            };
            setBox((prev) =>
                prev && prev.hidden === next.hidden && sameBox(prev, next) ? prev : next,
            );
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

    // The travel: only when the cursor goes to another target, from where it was.
    useLayoutEffect(() => {
        if (!box || !el) return;
        const prev = last.current;
        // Nothing moved yet (the new target is measured on the next pass): keep where it was.
        if (prev && prev.box.hidden === box.hidden && sameBox(prev.box, box)) return;
        last.current = { el, box };
        const cursor = frame.current;
        if (!cursor || !prev) return;
        travel.current?.cancel();
        travel.current = null;
        if (prev.el === el || prev.box.hidden || box.hidden || !cursor.animate) return;
        const frames = detentFrames(prev.box, box, reducedMotion());
        if (!frames.length) return;
        travel.current = cursor.animate(
            frames.map((f) => ({
                offset: f.offset,
                easing: f.easing,
                transform: `translate(${f.x}px, ${f.y}px)`,
                width: `${f.w}px`,
                height: `${f.h}px`,
            })),
            { duration: DETENT_MS },
        );
    }, [box, el]);

    if (!box || !el) return null;
    const motion = store.motion;
    return (
        <div
            ref={frame}
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
