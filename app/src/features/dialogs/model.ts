// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shell dialogs' pure rules, tested in `tests/main-menu.test.ts`: the
 * sign-in options in each state (a passkey on the device or not, Google
 * configured or not, extension wallets, a ceremony in progress) and the pause
 * menu's entries. No React, no wallets.
 */

export type SignInOption = {
    /** `passkey`, `recover`, `google`, or `wallet:<name>`. */
    id: string;
    label: string;
    /** A second line, only where it tells the options apart. */
    kind?: string;
    /** The command bar's line. */
    hint: string;
    verb: string;
    /** Right-hand state: the ceremony in progress. */
    tag?: string;
    /** Shown, selectable, refused: the reason. */
    locked?: string;
};

export type SignInState = {
    /** A passkey is already stored on this device. */
    hasPasskey: boolean;
    /** The remembered passkey's player name (or the short form for an unnamed one). */
    passkeyName?: string;
    /** zkLogin is configured for this build. */
    canGoogle: boolean;
    /** Extension wallets, by name (only behind the feature flag). */
    wallets: string[];
    /** The option whose ceremony is running. */
    busy: string | null;
};

const BUSY_TAG: Record<string, string> = {
    passkey: "Waiting",
    recover: "Sign twice",
    google: "Opening",
};

export function signInOptions(state: SignInState): SignInOption[] {
    const { hasPasskey, passkeyName, canGoogle, wallets, busy } = state;
    const options: SignInOption[] = [
        hasPasskey
            ? {
                  id: "passkey",
                  label: `Continue as ${passkeyName ?? "this passkey"}`,
                  kind: "Passkey",
                  hint: "Sign in with the passkey this device remembers",
                  verb: "Sign in",
              }
            : {
                  id: "passkey",
                  label: "Create a Passkey",
                  kind: "New",
                  hint: "Touch ID, a phone or a security key signs. No extension, no seed phrase",
                  verb: "Sign in",
              },
        // Another passkey is an alternative to the remembered one: with none on
        // the device there is nothing to be different from.
        ...(hasPasskey
            ? [
                  {
                      id: "recover",
                      label: "Use a Different Passkey",
                      kind: "Passkey",
                      hint: "Sign twice with another passkey to find its account",
                      verb: "Sign in",
                  },
              ]
            : []),
        {
            id: "google",
            label: "Google",
            kind: "zkLogin",
            hint: "Your Google account becomes the squad's address. Nothing to back up",
            verb: "Sign in",
            locked: canGoogle ? undefined : "Not configured in this build",
        },
        ...wallets.map((name) => ({
            id: `wallet:${name}`,
            label: name,
            kind: "Wallet",
            hint: "A wallet you already use",
            verb: "Connect",
        })),
    ];
    return options.map((option) => {
        if (busy === null) return option;
        const tag = option.id === busy ? (BUSY_TAG[option.id] ?? "Connecting") : undefined;
        // One ceremony at a time: the others wait for it.
        const locked =
            option.locked ?? (option.id === busy ? "In progress" : "Finish the other first");
        return { ...option, tag, locked };
    });
}

export type PauseEntry = {
    id: "resume" | "briefing" | "options" | "restart" | "quit" | (string & {});
    label: string;
    danger?: boolean;
};

/** The pause menu's entries, top to bottom; briefing and restart only where they make sense. */
export function pauseEntries(opts: {
    briefing: boolean;
    restart: boolean;
    quitLabel: string;
    /** The briefing entry's words; "Briefing" by default. */
    briefingLabel?: string;
    /** Further entries of the host's own, between Options and the way out. */
    extra?: readonly PauseEntry[];
}): PauseEntry[] {
    return [
        { id: "resume", label: "Resume" },
        ...(opts.briefing
            ? [{ id: "briefing", label: opts.briefingLabel ?? "Briefing" } as const]
            : []),
        { id: "options", label: "Options" },
        ...(opts.restart ? [{ id: "restart", label: "Restart encounter" } as const] : []),
        ...(opts.extra ?? []),
        { id: "quit", label: opts.quitLabel },
    ];
}
