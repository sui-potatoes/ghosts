// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { Component, type ErrorInfo, type ReactNode } from "react";

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
 * page: the message, the stack, a report to copy, Reload and Back to menu.
 * Nothing is sent anywhere; the details stay on the device unless copied.
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

function CrashScreen(props: {
    scope: string;
    fullScreen: boolean;
    error: Error;
    componentStack: string;
}) {
    const { scope, fullScreen, error, componentStack } = props;
    const text = report(scope, error, componentStack);

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
                    <summary className="label cursor-pointer px-3 py-2 text-secondary hover:text-accent">
                        Details
                    </summary>
                    <pre className="max-h-64 overflow-auto px-3 pb-3 font-mono text-[11px] whitespace-pre-wrap text-secondary">
                        {`${error.stack ?? ""}\n\nComponent stack:${componentStack || " (none)"}`}
                    </pre>
                </details>
                <div className="flex flex-wrap gap-3">
                    <button type="button" className="btn" onClick={() => location.reload()}>
                        Reload
                    </button>
                    <button
                        type="button"
                        className="btn"
                        onClick={(e) => void copy(e.currentTarget)}
                    >
                        Copy details
                    </button>
                    <button type="button" className="btn" onClick={() => location.assign("/")}>
                        Back to menu
                    </button>
                </div>
            </div>
        </main>
    );
}
