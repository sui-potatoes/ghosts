// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    Component,
    type ErrorInfo,
    type ReactNode,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";

import { bindInput } from "../input";
import { issueUrl } from "../reportIssue";
import {
    FocusCommandBar,
    FocusRoot,
    FocusScope,
    List,
    ListRow,
    Panel,
    ScreenFrame,
    useFocusable,
    useGlyphSet,
    type Command,
} from "../ui";
import { crashKeyAction, padStep, stepFocus } from "./crashKeys";
import "./error-boundary.css";

type Props = {
    children: ReactNode;
    /** Where it sits, for the log and the copied report. */
    scope: string;
    /** Fill the screen (the whole app) or just the area it guards. */
    fullScreen?: boolean;
};

type State = { error: Error | null; componentStack: string };

/**
 * Catches a render throw below it and shows what broke in place of a blank
 * page: the message, the details, Reload, Back to menu, a report to copy and a
 * prefilled GitHub issue link. Nothing is sent anywhere; the report link only
 * opens GitHub when followed.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null, componentStack: "" };

    static getDerivedStateFromError(error: unknown): Partial<State> {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[${this.props.scope}] render error:`, error, info.componentStack);
        this.setState({ componentStack: info.componentStack ?? "" });
    }

    render() {
        const { error, componentStack } = this.state;
        if (!error) return this.props.children;
        const fault: Fault = {
            scope: this.props.scope,
            fullScreen: this.props.fullScreen ?? true,
            error,
            componentStack,
        };
        return (
            <FaultGuard fallback={<PlainCrash {...fault} />}>
                <CrashScreen {...fault} />
            </FaultGuard>
        );
    }
}

type Fault = { scope: string; fullScreen: boolean; error: Error; componentStack: string };

/**
 * The crash screen guards itself: if the interface library is what broke (it
 * throws while drawing the fault), the plain screen below takes over.
 */
class FaultGuard extends Component<
    { fallback: ReactNode; children: ReactNode },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error) {
        console.error("[crash screen] fell back to the plain screen:", error);
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function report({ scope, error, componentStack }: Fault): string {
    return [
        `Ghosts crash report (${scope})`,
        `Route: ${location.pathname}${location.search}`,
        `User agent: ${navigator.userAgent}`,
        `Error: ${error.name}: ${error.message}`,
        `Stack:\n${error.stack ?? "(none)"}`,
        `Component stack:${componentStack || " (none)"}`,
    ].join("\n");
}

function issueLink({ error, componentStack }: Fault): string {
    return issueUrl({
        error,
        componentStack,
        pathname: location.pathname,
        commit: __COMMIT__,
        userAgent: navigator.userAgent,
        viewport: `${innerWidth}x${innerHeight}`,
    });
}

/** A full load of the menu: whatever broke is left behind. */
const goMenu = () => location.assign("/");
const reload = () => location.reload();

/** Copy the report; the answer is shown for a moment on the row. */
function useCopy(text: string): [string | null, () => void] {
    const [said, setSaid] = useState<string | null>(null);
    const timer = useRef(0);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const copy = () => {
        const done = (answer: string) => {
            setSaid(answer);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setSaid(null), 1500);
        };
        try {
            navigator.clipboard.writeText(text).then(
                () => done("Copied"),
                () => done("Copy failed"),
            );
        } catch {
            done("Copy failed");
        }
    };
    return [said, copy];
}

/**
 * The crash screen in the menus' own language: a screen frame, one cursor,
 * the commands in the bar. It owns its input: its own focus root, and the
 * keyboard and pad bound again here (counted, so a live shell is not bound
 * twice), because the shell that normally binds them may be what broke.
 * Back leaves for the menu; Reset reloads from any row.
 */
function CrashScreen(fault: Fault) {
    useEffect(() => bindInput(), []);
    const back: Command = { action: "back", label: "Menu", run: goMenu };
    return (
        <div role="alert" className="gui-fault" data-full={fault.fullScreen || undefined}>
            <FocusRoot back={back}>
                <FaultFrame {...fault} />
            </FocusRoot>
        </div>
    );
}

/**
 * Like the other menus' plates (Settings when signed out): one panel in the
 * middle of the frame with the message and the ways out as rows. The stack
 * opens beside it on Details, its own scope that Back closes.
 */
function FaultFrame(fault: Fault) {
    const glyphs = useGlyphSet();
    const [said, copy] = useCopy(report(fault));
    const [details, setDetails] = useState(false);
    const again: Command = { action: "reset", label: "Reload", run: reload };
    const row = (label: string, run: () => void, primary = false): Command[] => [
        { action: "confirm", label, tone: primary ? "primary" : undefined, run },
        ...(primary ? [] : [again]),
    ];
    return (
        <ScreenFrame location={["System", "Fault"]} commands={<FocusCommandBar glyphs={glyphs} />}>
            <div className="gui-fault-stage" data-details={details || undefined}>
                <Panel label="Something broke" className="gui-fault-panel">
                    <p className="gui-fault-message">
                        {fault.error.message || String(fault.error)}
                    </p>
                    <List label="Fault">
                        <ListRow
                            id="fault-reload"
                            group="fault"
                            name="Reload"
                            title="Reload"
                            instant
                            commands={row("Reload", reload, true)}
                        />
                        <ListRow
                            id="fault-menu"
                            group="fault"
                            name="Back to menu"
                            title="Back to menu"
                            instant
                            commands={row("Menu", goMenu)}
                        />
                        <ListRow
                            id="fault-details"
                            group="fault"
                            name="Details"
                            title="Details"
                            selected={details}
                            instant
                            commands={row("Details", () => setDetails((open) => !open))}
                        />
                        <ListRow
                            id="fault-copy"
                            group="fault"
                            name="Copy details"
                            tag={said ?? undefined}
                            tagTone={said === "Copy failed" ? "warn" : "accent"}
                            title="Copy details"
                            instant
                            commands={row("Copy", copy)}
                        />
                        <ListRow
                            id="fault-report"
                            group="fault"
                            name="Report on GitHub"
                            title="Report on GitHub"
                            instant
                            commands={row("Report", () => {
                                window.open(issueLink(fault), "_blank", "noopener,noreferrer");
                            })}
                        />
                    </List>
                </Panel>
                {details && (
                    <FocusScope
                        id="fault-details-scope"
                        back={{ action: "back", label: "Close", run: () => setDetails(false) }}
                    >
                        <Panel label="Details" className="gui-fault-details">
                            <FaultLog text={readableStack(fault)} />
                        </Panel>
                    </FocusScope>
                )}
            </div>
        </ScreenFrame>
    );
}

/**
 * The stack as a person reads it: file and line, without the server's long
 * paths and cache stamps. The copied report keeps everything.
 */
function readableStack({ error, componentStack }: Fault): string {
    const tidy = (text: string) =>
        text.replace(/\(?https?:\/\/[^\s)]*\/([^/\s)?]+)(\?[^:\s)]*)?(:\d+:\d+)?\)?/g, "($1$3)");
    return `${tidy(error.stack ?? "")}\n\nComponent stack:${tidy(componentStack) || " (none)"}`;
}

/** The stack, scrolled by the directions while the cursor is on it (keys, pad), natively by wheel and finger. */
function FaultLog({ text }: { text: string }) {
    const scroller = useRef<HTMLPreElement | null>(null);
    const { props } = useFocusable<HTMLPreElement>({
        id: "fault-log",
        group: "log",
        title: "Details",
        clickConfirm: false,
        commands: [
            { action: "nav", label: "Scroll", glyph: "ud" },
            { action: "reset", label: "Reload", run: reload },
        ],
        directions: (dir) => {
            const el = scroller.current;
            if (!el || (dir !== "up" && dir !== "down")) return false;
            const before = el.scrollTop;
            el.scrollTop += dir === "down" ? 60 : -60;
            return el.scrollTop !== before;
        },
    });
    const { ref, ...rest } = props;
    return (
        <pre
            {...rest}
            ref={(el) => {
                scroller.current = el;
                (ref as RefObject<HTMLPreElement | null>).current = el;
            }}
            className="gui-fault-log"
        >
            {text}
        </pre>
    );
}

/**
 * The plain crash screen, for when even the interface library cannot draw:
 * native buttons on plain DOM focus, its own key and pad handling. Every
 * handler swallows its own errors.
 */
function PlainCrash(fault: Fault) {
    const root = useRef<HTMLElement>(null);
    usePlainNav(root);
    const [said, copy] = useCopy(report(fault));
    return (
        <main
            ref={root}
            role="alert"
            className={`fault-plain ${fault.fullScreen ? "fault-plain-full" : ""}`}
        >
            <header className="fault-plain-strip">
                <span>System</span>
                <span className="fault-plain-sep">/</span>
                <span className="fault-plain-here">Fault</span>
            </header>
            <div className="fault-plain-body">
                <section className="fault-plain-panel">
                    <h1 className="fault-plain-label">Something broke</h1>
                    <p className="fault-plain-message">
                        {fault.error.message || String(fault.error)}
                    </p>
                    <div className="fault-plain-rows">
                        <button type="button" data-fault-item="first" onClick={reload}>
                            Reload
                        </button>
                        <button type="button" data-fault-item onClick={goMenu}>
                            Back to menu
                        </button>
                        <button type="button" data-fault-item onClick={copy}>
                            {said ?? "Copy details"}
                        </button>
                        <a
                            data-fault-item
                            href={issueLink(fault)}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Report on GitHub
                        </a>
                    </div>
                </section>
            </div>
            <footer className="fault-plain-strip fault-plain-bar" />
        </main>
    );
}

function usePlainNav(root: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const items = (): HTMLElement[] => {
            try {
                return Array.from(
                    root.current?.querySelectorAll<HTMLElement>("[data-fault-item]") ?? [],
                );
            } catch {
                return [];
            }
        };
        // The band is drawn from an attribute, not :focus: it shows even while
        // the window itself does not hold focus.
        const mark = (el: HTMLElement | undefined) => {
            for (const item of items()) item.toggleAttribute("data-current", item === el);
            el?.focus();
        };
        const move = (delta: 1 | -1) => {
            const list = items();
            const at = list.findIndex((el) => el.hasAttribute("data-current"));
            mark(list[stepFocus(at, list.length, delta)]);
        };
        try {
            mark(items().find((el) => el.dataset.faultItem === "first"));
        } catch {
            /* nothing to do */
        }
        const current = () => items().find((el) => el.hasAttribute("data-current"));
        const onKey = (e: KeyboardEvent) => {
            try {
                // Enter and Space press the row with the band, wherever DOM focus is.
                if ((e.key === "Enter" || e.key === " ") && !e.repeat && !e.altKey) {
                    const row = current();
                    if (row) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        row.click();
                        return;
                    }
                }
                const action = crashKeyAction(e);
                if (action === "none") return;
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.repeat && (action === "back" || action === "reload")) return;
                if (action === "prev") move(-1);
                else if (action === "next") move(1);
                else if (action === "back") goMenu();
                else if (action === "reload") reload();
            } catch {
                /* a second fault here would leave no screen at all */
            }
        };
        // The pointer moves the band, as the cursor follows it in the menus.
        const over = (e: PointerEvent) => {
            if (e.pointerType !== "mouse" || !(e.target instanceof Element)) return;
            const row = e.target.closest<HTMLElement>("[data-fault-item]");
            if (row && !row.hasAttribute("data-current")) mark(row);
        };
        root.current?.addEventListener("pointerover", over);
        // Capture: nothing the shell left behind sees these keys first.
        window.addEventListener("keydown", onKey, true);
        let raf = 0;
        let nextMove = 0;
        let held = false;
        let wasA = false;
        let wasB = false;
        const poll = (now: number) => {
            raf = requestAnimationFrame(poll);
            try {
                const pads = navigator.getGamepads?.();
                const pad = pads && Array.from(pads).find((g) => g?.connected);
                if (!pad) return;
                const step = padStep(
                    pad.buttons.map((b) => b.pressed),
                    pad.axes,
                );
                if (step === 0) held = false;
                else if (now >= nextMove) {
                    move(step);
                    nextMove = now + (held ? 140 : 400);
                    held = true;
                }
                const a = !!pad.buttons[0]?.pressed;
                const b = !!pad.buttons[1]?.pressed;
                if (a && !wasA) current()?.click();
                if (b && !wasB) goMenu();
                wasA = a;
                wasB = b;
            } catch {
                /* ignore */
            }
        };
        try {
            raf = requestAnimationFrame(poll);
        } catch {
            /* no rAF, no pad */
        }
        const host = root.current;
        return () => {
            host?.removeEventListener("pointerover", over);
            window.removeEventListener("keydown", onKey, true);
            cancelAnimationFrame(raf);
        };
    }, [root]);
}
