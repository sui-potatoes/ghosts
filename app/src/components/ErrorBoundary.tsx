// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    Component,
    type ErrorInfo,
    type ReactNode,
    type RefObject,
    useEffect,
    useRef,
} from "react";

import { issueUrl } from "../reportIssue";
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
 * page: the message, the stack, a report to copy, Reload, Back to menu and a prefilled GitHub issue link.
 * Nothing is sent anywhere; the report link only opens GitHub when followed.
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
        return (
            <CrashScreen
                scope={this.props.scope}
                fullScreen={this.props.fullScreen ?? true}
                error={error}
                componentStack={componentStack}
            />
        );
    }
}

function report(scope: string, error: Error, componentStack: string): string {
    return [
        `Ghosts crash report (${scope})`,
        `Route: ${location.pathname}${location.search}`,
        `User agent: ${navigator.userAgent}`,
        `Error: ${error.name}: ${error.message}`,
        `Stack:\n${error.stack ?? "(none)"}`,
        `Component stack:${componentStack || " (none)"}`,
    ].join("\n");
}

const goBack = () => location.assign("/");

/**
 * Keyboard and pad for the crash screen, on plain DOM focus: the app's focus
 * system and input bus may be what broke. Every handler swallows its own errors.
 */
function useCrashNav(root: RefObject<HTMLElement | null>) {
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
        const move = (delta: 1 | -1) => {
            const list = items();
            const at = list.indexOf(document.activeElement as HTMLElement);
            list[stepFocus(at, list.length, delta)]?.focus();
        };
        const first = items().find((el) => el.dataset.faultItem === "first");
        try {
            first?.focus();
        } catch {
            /* nothing to do */
        }

        const onKey = (e: KeyboardEvent) => {
            try {
                const target = e.target as HTMLElement | null;
                const action = crashKeyAction(e);
                if (action === "none") return;
                // The open log scrolls with the arrows; left and right still move.
                if (
                    target?.dataset.faultScroll !== undefined &&
                    (e.key === "ArrowUp" || e.key === "ArrowDown")
                ) {
                    return;
                }
                e.preventDefault();
                if (e.repeat && (action === "back" || action === "reload")) return;
                if (action === "prev") move(-1);
                else if (action === "next") move(1);
                else if (action === "back") goBack();
                else if (action === "reload") location.reload();
            } catch {
                /* a second fault here would leave no screen at all */
            }
        };
        window.addEventListener("keydown", onKey);

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
                if (a && !wasA) (document.activeElement as HTMLElement | null)?.click();
                if (b && !wasB) goBack();
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
        return () => {
            window.removeEventListener("keydown", onKey);
            cancelAnimationFrame(raf);
        };
    }, [root]);
}

function CrashScreen(props: {
    scope: string;
    fullScreen: boolean;
    error: Error;
    componentStack: string;
}) {
    const { scope, fullScreen, error, componentStack } = props;
    const text = report(scope, error, componentStack);
    const root = useRef<HTMLElement>(null);
    useCrashNav(root);

    const issue = issueUrl({
        error,
        componentStack,
        pathname: location.pathname,
        commit: __COMMIT__,
        userAgent: navigator.userAgent,
        viewport: `${innerWidth}x${innerHeight}`,
    });

    async function copy(button: HTMLButtonElement) {
        const label = button.textContent;
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = "Copied";
        } catch {
            button.textContent = "Copy failed";
        }
        setTimeout(() => (button.textContent = label), 1500);
    }

    return (
        <main
            ref={root}
            role="alert"
            className={`flex items-center justify-center bg-background p-6 text-foreground ${
                fullScreen ? "fixed inset-0 z-[500]" : "absolute inset-0 z-[500]"
            }`}
        >
            <div className="flex max-h-full w-full max-w-2xl flex-col gap-5 overflow-y-auto border border-line bg-surface p-8">
                <p className="label text-warn">System / Fault</p>
                <h1 className="label text-lg text-foreground">Something broke</h1>
                <p className="break-words font-mono text-[13px] text-secondary">
                    {error.message || String(error)}
                </p>
                <details className="border border-line bg-raised">
                    <summary
                        data-fault-item
                        className="fault-summary label cursor-pointer px-3 py-2 text-secondary hover:text-accent"
                    >
                        Details
                    </summary>
                    <pre
                        tabIndex={0}
                        data-fault-scroll
                        className="fault-log max-h-64 overflow-auto px-3 pb-3 font-mono text-[11px] whitespace-pre-wrap text-secondary"
                    >
                        {`${error.stack ?? ""}\n\nComponent stack:${componentStack || " (none)"}`}
                    </pre>
                </details>
                <div className="fault-actions flex flex-wrap gap-3">
                    <button
                        type="button"
                        data-fault-item="first"
                        className="btn"
                        onClick={() => location.reload()}
                    >
                        Reload
                    </button>
                    <button
                        type="button"
                        data-fault-item
                        className="btn"
                        onClick={(e) => void copy(e.currentTarget)}
                    >
                        Copy details
                    </button>
                    <button type="button" data-fault-item className="btn" onClick={goBack}>
                        Back to menu
                    </button>
                    <a
                        data-fault-item
                        className="btn"
                        href={issue}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Report on GitHub
                    </a>
                </div>
            </div>
        </main>
    );
}
