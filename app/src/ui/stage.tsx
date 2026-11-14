// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The 3D stage as one cursor target. The frame is a panel like the others;
 * the canvas inside is a feature's own renderer (the recruit studio, the gear
 * turntable), with no buttons of its own. The canvas attaches a
 * `StageControl` through `useStageAttach()`.
 *
 * Focused, the stage offers Inspect (plus any `actions` the feature adds,
 * e.g. a feature's own). Inspect hands it the directions — left/right turn
 * the model, up/down zoom — until Back. The right stick turns it any time it
 * is on screen. The mouse drags and scrolls inside the canvas (a touch drags
 * and pinches) without ever moving the cursor.
 *
 * The host owns the turn: every input (keys, stick, drag) changes one angle
 * here and the canvas is handed that absolute angle, so a key after a drag
 * continues from where the drag left the model instead of jumping back.
 * The canvas's own camera controls never see the pointer.
 */

import { onPad } from "@ghosts/engine/gamepad";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

import { uiTick } from "../audio";
import { useWireframeShortcut } from "../features/squad/useWireframe";
import { useFocusable, useFocusStore, type Command, type Dir } from "./focus";

/** What a canvas gives the host. */
export type StageControl = {
    /**
     * Show the model at `angle` radians (absolute). Positive turns the model's
     * front to the viewer's right, the way a rightward drag does.
     */
    turn(angle: number): void;
    /** Step the view in (1) or out (−1); 0 only reports. Returns the readout label. */
    zoom(step: 1 | -1 | 0): string;
    /** Radians per stage height of drag; defaults to 2π. */
    dragRate?: number;
};

/** The angle a key press turns by. */
const STEP = Math.PI / 8;
/** Wheel travel per zoom step (px; a mouse notch is ~100, a trackpad sends many small ones). */
const WHEEL_STEP = 80;
/** Pinch spread per zoom step. */
const PINCH_STEP = 1.25;

type Attach = (control: StageControl) => () => void;

const StageContext = createContext<Attach | null>(null);

/** For a stage canvas: hand the host its control once the renderer is up. Returns the detach. */
export function useStageAttach(): Attach {
    const attach = useContext(StageContext);
    if (!attach) throw new Error("useStageAttach outside <StagePanel>");
    return attach;
}

type StagePanelProps = {
    id: string;
    group: string;
    /** What the command bar calls the stage. */
    label: string;
    /** The diegetic plate in the stage's top-left: `gui-stage-eyebrow`, `-title`, `-sub`, `-tag`. */
    caption?: ReactNode;
    /** Back while not inspecting (e.g. to the list); the screen's back otherwise. */
    back?: Command;
    /** More commands, offered idle and while inspecting (feature-specific). */
    actions?: Command[];
    /** Frame the subject close (a character's face) while true: an editor working on the head. */
    close?: boolean;
    /** Shown while the canvas is still bringing the model in. */
    loading?: boolean;
    error?: string;
    /** The canvas, or a plate for something without a model. */
    children: ReactNode;
};

export function StagePanel({
    id,
    group,
    label,
    caption,
    back,
    actions = [],
    close = false,
    loading,
    error,
    children,
}: StagePanelProps) {
    const [inspecting, setInspecting] = useState(false);
    const [angle, setAngle] = useState(0);
    const [zoomLabel, setZoomLabel] = useState("Full");
    const control = useRef<StageControl | null>(null);
    const angleRef = useRef(0);
    const body = useRef<HTMLDivElement>(null);
    const store = useFocusStore();
    // The hidden developer shortcut (Z); a stage on screen is what enables it.
    useWireframeShortcut();

    const turnTo = useCallback((next: number) => {
        angleRef.current = next;
        control.current?.turn(next);
        setAngle(next);
    }, []);
    const zoom = useCallback((step: 1 | -1) => {
        const text = control.current?.zoom(step);
        if (text) setZoomLabel(text);
    }, []);

    const closeRef = useRef(close);
    closeRef.current = close;
    const attach = useCallback<Attach>((c) => {
        control.current = c;
        // A new canvas starts where the stage is turned to, framed as asked.
        c.turn(angleRef.current);
        setZoomLabel(closeRef.current ? c.zoom(1) : c.zoom(0));
        return () => {
            if (control.current === c) control.current = null;
        };
    }, []);

    const directions = (dir: Dir) => {
        if (!inspecting) return false;
        if (dir === "left" || dir === "right")
            turnTo(angleRef.current + (dir === "left" ? -STEP : STEP));
        else zoom(dir === "up" ? 1 : -1);
        uiTick(null);
        return true;
    };

    const commands: Command[] = inspecting
        ? [
              { action: "nav", label: "Rotate", glyph: "lr" },
              { action: "nav", label: "Zoom", glyph: "ud" },
              ...actions,
              { action: "back", label: "Done", run: () => setInspecting(false) },
          ]
        : [
              {
                  action: "confirm",
                  label: "Inspect",
                  tone: "primary",
                  run: () => setInspecting(true),
              },
              ...actions,
              ...(back ? [back] : []),
          ];

    const { focused, props } = useFocusable<HTMLElement>({
        id,
        group,
        title: inspecting ? "Inspecting" : label,
        hint: inspecting
            ? "Turn and zoom; drag and scroll work too"
            : "Drag to turn, scroll to zoom",
        commands,
        directions,
        pointer: false,
    });

    const framed = useRef(close);
    useEffect(() => {
        if (framed.current === close) return;
        framed.current = close;
        if (control.current) setZoomLabel(control.current.zoom(close ? 1 : -1));
    }, [close]);

    // Leaving the stage (a hover elsewhere, a prompt) ends the inspection.
    useEffect(() => {
        if (!focused) setInspecting(false);
    }, [focused]);

    // The right stick turns the model whenever the stage is on screen.
    useEffect(
        () =>
            onPad((pad) => {
                const x = pad.axis(2);
                if (x) turnTo(angleRef.current + x * 0.06);
                return false;
            }, 1),
        [turnTo],
    );

    // Drag, wheel and pinch on the canvas, taken in the capture phase so the
    // renderer's own orbit controls never see them.
    useEffect(() => {
        const el = body.current;
        if (!el) return;
        const pointers = new Map<number, { x: number; y: number }>();
        let spread = 0;
        let wheel = 0;
        // A touch resting on the stage opens its command list (the touch right-click).
        let press: { x: number; y: number; timer: number } | null = null;
        const cancelPress = () => {
            if (press) window.clearTimeout(press.timer);
            press = null;
        };
        const span = () => {
            const [a, b] = [...pointers.values()];
            return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
        };
        const down = (e: PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            el.setPointerCapture?.(e.pointerId);
            spread = span();
            cancelPress();
            if (e.pointerType === "touch" && pointers.size === 1) {
                const { clientX: x, clientY: y } = e;
                press = {
                    x,
                    y,
                    timer: window.setTimeout(() => {
                        press = null;
                        store.pointerInput();
                        store.focus(id);
                        store.openMenu(id, x, y);
                    }, 450),
                };
            }
        };
        const move = (e: PointerEvent) => {
            const last = pointers.get(e.pointerId);
            if (!last) return;
            e.stopPropagation();
            if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
            const dx = e.clientX - last.x;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) {
                const height = el.getBoundingClientRect().height || 1;
                const rate = control.current?.dragRate ?? Math.PI * 2;
                turnTo(angleRef.current + (dx / height) * rate);
            } else if (pointers.size === 2 && spread) {
                const now = span();
                if (now / spread > PINCH_STEP || spread / now > PINCH_STEP) {
                    zoom(now > spread ? 1 : -1);
                    spread = now;
                }
            }
        };
        const up = (e: PointerEvent) => {
            if (!pointers.delete(e.pointerId)) return;
            e.stopPropagation();
            cancelPress();
            spread = span();
        };
        const onWheel = (e: WheelEvent) => {
            e.stopPropagation();
            e.preventDefault();
            wheel += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
            if (Math.abs(wheel) < WHEEL_STEP) return;
            zoom(wheel < 0 ? 1 : -1);
            wheel = 0;
        };
        el.addEventListener("pointerdown", down, true);
        el.addEventListener("pointermove", move, true);
        el.addEventListener("pointerup", up, true);
        el.addEventListener("pointercancel", up, true);
        el.addEventListener("wheel", onWheel, { capture: true, passive: false });
        return () => {
            cancelPress();
            el.removeEventListener("pointerdown", down, true);
            el.removeEventListener("pointermove", move, true);
            el.removeEventListener("pointerup", up, true);
            el.removeEventListener("pointercancel", up, true);
            el.removeEventListener("wheel", onWheel, true);
        };
    }, [turnTo, zoom, store, id]);

    const degrees = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
    return (
        <section
            className="gui-panel gui-stage-panel"
            data-inspecting={inspecting || undefined}
            {...props}
        >
            <StageContext.Provider value={attach}>
                <div ref={body} className="gui-stage-body">
                    {children}
                    <i className="gui-stage-reg" data-at="tl" aria-hidden />
                    <i className="gui-stage-reg" data-at="tr" aria-hidden />
                    <i className="gui-stage-reg" data-at="bl" aria-hidden />
                    <i className="gui-stage-reg" data-at="br" aria-hidden />
                    {caption && <div className="gui-stage-caption">{caption}</div>}
                    {/* The one diegetic readout on the screen, and only while it means something. */}
                    {inspecting && (
                        <div className="gui-stage-readout" aria-hidden>
                            <span>{String(Math.round(degrees)).padStart(3, "0")}°</span>
                            <span>{zoomLabel}</span>
                        </div>
                    )}
                    {(loading || error) && (
                        <div className="gui-stage-status" data-error={error ? "" : undefined}>
                            {error || "Bringing the model in"}
                        </div>
                    )}
                </div>
            </StageContext.Provider>
        </section>
    );
}
