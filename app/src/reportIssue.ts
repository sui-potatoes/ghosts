// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The public repository, the one place its address is written. */
export const SOURCE_URL = "https://github.com/sui-potatoes/ghosts";

/** The studio behind the game, linked from the title's credit line. */
export const POTATOES_URL = "https://potatoes.app";

/** GitHub and browsers cut or refuse very long addresses. */
export const MAX_ISSUE_URL = 6000;

export type IssueInput = {
    error: { name: string; message: string; stack?: string };
    componentStack?: string;
    /** Path only; any query or hash is dropped. */
    pathname: string;
    commit: string | null;
    userAgent: string;
    viewport: string;
};

/** Every 0x-prefixed id or address (hex, 32 bytes or any long run) becomes a placeholder. */
export function redact(text: string): string {
    return text.replace(/0x[0-9a-fA-F]{40,}/g, "0x<redacted>");
}

function cleanPath(path: string): string {
    return redact(path.split(/[?#]/)[0] ?? "");
}

function build(input: IssueInput, stackLines: number): URL {
    const { error } = input;
    const stack = (error.stack ?? "").split("\n").slice(0, stackLines).join("\n");
    const component = (input.componentStack ?? "")
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, Math.min(stackLines, 12))
        .join("\n");
    const body = redact(
        [
            "## What happened",
            "",
            "",
            "## What I was doing",
            "",
            "",
            "## Details",
            "",
            `Error: ${error.name}: ${error.message}`,
            `Route: ${cleanPath(input.pathname)}`,
            `Build: ${input.commit ? input.commit.slice(0, 7) : "unknown"}`,
            `Browser: ${input.userAgent}`,
            `Viewport: ${input.viewport}`,
            "",
            "```",
            stack || "(no stack)",
            "```",
            ...(component ? ["", "Component stack:", "```", component, "```"] : []),
        ].join("\n"),
    );
    const url = new URL(`${SOURCE_URL}/issues/new`);
    url.searchParams.set("title", redact(`Crash: ${error.name}: ${error.message}`).slice(0, 120));
    url.searchParams.set("body", body);
    return url;
}

/** Prefilled new-issue address; the stack is trimmed until the whole URL fits. */
export function issueUrl(input: IssueInput): string {
    for (let lines = 25; lines >= 0; lines -= 1) {
        const href = build(input, lines).href;
        if (href.length <= MAX_ISSUE_URL) return href;
    }
    // Even the header is too long (huge message): cut the message itself.
    const short = {
        ...input,
        error: { ...input.error, message: input.error.message.slice(0, 300) },
    };
    return build(short, 0).href;
}
