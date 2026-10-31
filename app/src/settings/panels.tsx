// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { formatAddress, MIST_PER_SUI } from "@mysten/sui/utils";
import { useState, useSyncExternalStore } from "react";

import { retireSessionKey, useBalance, useSessionRows, type SessionTermination } from "../chain";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NETWORK } from "../constants";
import { usePlayerName } from "../hooks/usePlayerName";
import { useSignInMethod } from "../hooks/useSignInMethod";
import { NameDialog } from "../NameDialog";
import { requestSignIn } from "../signIn";
import { Keys } from "./controls";
import { previewDialogue, previewEffect } from "../audio";
import { COMBAT_ACTIONS, COMBAT_LABELS } from "@ghosts/engine/keys";
import { ACTION_LABELS, ACTIONS } from "./keys";
import { SettingList, type SettingRow } from "./SettingList";
import { DEFAULTS, useSettingsSection } from "./store";

/*
 * The settings panels, each a list of rows for `SettingList`. Shared by the
 * Settings screen and the in-game pause menu, so a change made mid-encounter
 * is the same change. Every row carries the description shown in the panel
 * under the list while it is focused.
 */

/** Format MIST as SUI with four decimals, trimming nothing so columns align. */
function formatSui(mist: bigint): string {
    const whole = mist / MIST_PER_SUI;
    const frac = ((mist % MIST_PER_SUI) * 10_000n) / MIST_PER_SUI;
    return `${whole}.${frac.toString().padStart(4, "0")}`;
}

/** Visitors get this row in place of anything tied to an account. */
function signedOutRow(what: string): SettingRow {
    return {
        kind: "action",
        id: "sign-in",
        label: "Log in",
        value: <span className="text-warn">not signed in</span>,
        description: `Not signed in. Identify with a passkey or a provider to see ${what}.`,
        onConfirm: requestSignIn,
    };
}

/** An on/off setting: Left is off, Right is on, Confirm flips it. */
function switchRow(args: {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    defaultValue: boolean;
    set: (next: boolean) => void;
    /** Value texts when "On"/"Off" would read wrong next to the label. */
    values?: { on: string; off: string };
}): SettingRow {
    const { id, label, description, checked, defaultValue, set, values } = args;
    return {
        kind: "choice",
        id,
        label,
        description,
        value: checked ? (values?.on ?? "On") : (values?.off ?? "Off"),
        onPrev: () => set(false),
        onNext: () => set(true),
        onConfirm: () => set(!checked),
        onReset: () => set(defaultValue),
    };
}

export function PlayerPanel() {
    const account = useCurrentAccount();
    const player = usePlayerName();
    const [nameOpen, setNameOpen] = useState(false);

    if (!account) return <SettingList rows={[signedOutRow("your name")]} />;

    const rows: SettingRow[] = [
        {
            kind: "action",
            id: "name",
            label: "Name",
            value: (
                <>
                    {player.name}
                    {player.source === null && <span className="set-note">generated</span>}
                </>
            ),
            description:
                "Your call sign, shown to other players. Follows SuiNS rules, so it can become your SuiNS name unchanged.",
            onConfirm: () => setNameOpen(true),
        },
    ];

    return (
        <>
            <SettingList rows={rows} />
            <NameDialog open={nameOpen} onClose={() => setNameOpen(false)} />
        </>
    );
}

export function AccountPanel() {
    const dAppKit = useDAppKit();
    const account = useCurrentAccount();
    const client = useCurrentClient();
    const method = useSignInMethod();
    const { data: mist, isPending, isError } = useBalance();
    const [copied, setCopied] = useState(false);
    // A termination waits here while its confirmation dialog is up.
    const [termination, setTermination] = useState<SessionTermination | null>(null);
    const [signingOut, setSigningOut] = useState(false);
    const sessionRows = useSessionRows(setTermination);

    if (!account) return <SettingList rows={[signedOutRow("your wallet and balance")]} />;

    async function signOut() {
        // Leave nothing signable behind: the session key removes its own alias
        // and is wiped (best effort — retireSessionKey never blocks sign-out).
        if (account) await retireSessionKey(client, account.address);
        await dAppKit.disconnectWallet();
    }

    async function copy() {
        if (!account) return;
        try {
            await navigator.clipboard.writeText(account.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            console.warn("clipboard write failed:", e);
        }
    }

    const rows: SettingRow[] = [
        {
            kind: "static",
            id: "held-by",
            label: "Held by",
            value: method?.label ?? "—",
            description:
                "How this account is authorized: a passkey bound to this site, or a zkLogin provider.",
        },
        {
            kind: "action",
            id: "address",
            label: "Address",
            value: copied ? "copied" : formatAddress(account.address),
            description: "The account's Sui address. Activate to copy it to the clipboard.",
            onConfirm: copy,
        },
        {
            kind: "static",
            id: "balance",
            label: "Balance",
            value: isPending ? (
                <span className="skeleton h-[14px] w-[88px] align-middle" />
            ) : isError || mist === undefined ? (
                <span className="text-warn">unavailable</span>
            ) : (
                <>
                    {formatSui(mist)} <span className="set-note">SUI</span>
                </>
            ),
            description: "SUI held by the address. Pays fees once the squad moves on chain.",
        },
        {
            kind: "static",
            id: "network",
            label: "Network",
            value: NETWORK,
            description: "The Sui network this build talks to. Testnet only for now.",
        },
        // Test networks hand out funds. The address rides in the query (the
        // faucet ignores it today but keeps it) and is copied for pasting.
        // faucet.sui.io would be the official choice; its proof-of-work flow
        // is heavier, so the SuiLearn faucet serves for now.
        ...(NETWORK === "testnet"
            ? [
                  {
                      kind: "action",
                      id: "faucet",
                      label: "Add test funds",
                      value: "faucet.suilearn.io ↗",
                      description:
                          "Opens a Sui testnet faucet in a new tab and copies this address, ready to paste there. Test SUI only; it has no real value.",
                      onConfirm: () => {
                          navigator.clipboard.writeText(account.address).catch(() => {});
                          window.open(
                              `https://faucet.suilearn.io/?address=${account.address}`,
                              "_blank",
                              "noopener",
                          );
                      },
                  } satisfies SettingRow,
              ]
            : []),
        { kind: "section", id: "security", label: "Security" },
        {
            kind: "static",
            id: "recovery",
            label: "Recovery wallet",
            value: (
                <span className="inline-flex items-center gap-2 text-warn">
                    <span className="dot dot-pulse" aria-hidden />
                    not set
                </span>
            ),
            description:
                "A second authorizer that can take over after a delay; without it, losing the passkey or provider means losing the squad. Setup arrives with the on-chain account.",
        },
        {
            kind: "action",
            id: "sign-out",
            label: "Sign out",
            value: "",
            description:
                "Disconnect this wallet from the device: a confirmation asks first, and this browser's session key is retired with it. Local preferences stay.",
            onConfirm: () => setSigningOut(true),
        },
        ...sessionRows,
    ];

    return (
        <>
            <SettingList rows={rows} />
            <ConfirmDialog
                open={termination !== null}
                title="Terminate session"
                confirmLabel="Terminate"
                danger
                onConfirm={() => {
                    termination?.run();
                    setTermination(null);
                }}
                onClose={() => setTermination(null)}
            >
                {termination && (
                    <>
                        <span className="font-mono text-warn">{termination.label}</span> is removed
                        from the on-chain alias set and can no longer sign for this account
                        {termination.local ? "; the key stored in this browser is wiped" : ""}. One
                        passkey signature confirms the removal.
                    </>
                )}
            </ConfirmDialog>
            <ConfirmDialog
                open={signingOut}
                title="Sign out"
                confirmLabel="Sign out"
                danger
                onConfirm={() => {
                    setSigningOut(false);
                    void signOut();
                }}
                onClose={() => setSigningOut(false)}
            >
                Disconnects this wallet from the device. This browser's session key is removed from
                the on-chain alias set and wiped; signing in again authorizes the device anew. Local
                preferences stay.
            </ConfirmDialog>
        </>
    );
}

export function AudioPanel() {
    const [audio, setAudio] = useSettingsSection("audio");

    const slider = (
        key: "master" | "music" | "sfx" | "voice" | "ui",
        label: string,
        description: string,
        preview?: () => void,
    ): SettingRow => ({
        kind: "slider",
        id: key,
        label,
        description,
        value: audio[key],
        disabled: audio.muted,
        // The store updates synchronously, so the preview plays at the new level.
        onChange: (v) => {
            setAudio({ [key]: v });
            preview?.();
        },
        onReset: () => {
            setAudio({ [key]: DEFAULTS.audio[key] });
            preview?.();
        },
    });

    const rows: SettingRow[] = [
        // Phrased as "Sound: On/Muted" — "Mute: Off" reads like "music off".
        switchRow({
            id: "muted",
            label: "Sound",
            description: "Silence every channel without touching the mix.",
            checked: !audio.muted,
            defaultValue: !DEFAULTS.audio.muted,
            set: (on) => setAudio({ muted: !on }),
            values: { on: "On", off: "Muted" },
        }),
        slider("master", "Master", "Overall output level. Every other channel scales under it."),
        slider("music", "Music", "Score and ambient music."),
        slider("sfx", "Effects", "Weapons and impacts.", previewEffect),
        slider("voice", "Dialogue", "Squad chatter and mission dialogue.", previewDialogue),
        // No preview callback: the list's own detent tick is the preview.
        slider("ui", "Interface", "Menu ticks and clicks."),
    ];

    return <SettingList rows={rows} />;
}

/**
 * The Keyboard Lock API, Chromium only (TS's DOM lib does not type it).
 * Locking Escape while fullscreen delivers a tapped Esc to the page — the
 * menu opens, fullscreen stays — while press-and-hold still exits: that
 * guarantee is the browser's own. Elsewhere this is null and Esc behaves
 * as it always did (exits fullscreen; the keydown still reaches the page).
 */
type KeyboardLock = { lock(keys?: string[]): Promise<void>; unlock(): void };

function keyboardLock(): KeyboardLock | null {
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    return keyboard && "lock" in keyboard ? keyboard : null;
}

// Release the Esc capture whenever fullscreen ends, however it was left.
if (typeof document !== "undefined") {
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) keyboardLock()?.unlock();
    });
}

/**
 * Live browser fullscreen state. Not part of the settings store: browsers
 * only enter fullscreen from a user gesture, so it cannot be restored at
 * startup, and the system UI can flip it at any time.
 */
function useFullscreen(): [boolean, (on: boolean) => void] {
    const on = useSyncExternalStore(
        (onChange) => {
            document.addEventListener("fullscreenchange", onChange);
            return () => document.removeEventListener("fullscreenchange", onChange);
        },
        () => document.fullscreenElement !== null,
    );
    const set = (next: boolean) => {
        if (next === (document.fullscreenElement !== null)) return;
        if (next)
            document.documentElement
                .requestFullscreen()
                .then(() => keyboardLock()?.lock(["Escape"]))
                .catch(() => {});
        else document.exitFullscreen().catch(() => {});
    };
    return [on, set];
}

export function DisplayPanel() {
    const [display, setDisplay] = useSettingsSection("display");
    const [fullscreen, setFullscreen] = useFullscreen();

    const flag = (
        key: "batterySaver" | "scanlines" | "vignette" | "reduceMotion",
        label: string,
        description: string,
    ): SettingRow =>
        switchRow({
            id: key,
            label,
            description,
            checked: display[key],
            defaultValue: DEFAULTS.display[key],
            set: (v) => setDisplay({ [key]: v }),
        });

    const rows: SettingRow[] = [
        switchRow({
            id: "fullscreen",
            label: "Fullscreen",
            description:
                "Take the whole display. Hold Esc to leave fullscreen; the browser forgets the choice between sessions.",
            checked: fullscreen,
            defaultValue: false,
            set: setFullscreen,
        }),
        flag(
            "batterySaver",
            "Battery saver",
            "Lower the frame rate and scene detail to save power. Recommended on portable machines.",
        ),
        flag("scanlines", "Scanlines", "Faint CRT scanlines over the picture."),
        flag("vignette", "Vignette", "Darkened frame edges for a low-light read."),
        flag(
            "reduceMotion",
            "Reduce motion",
            "Cut interface animation and transitions to a minimum.",
        ),
    ];

    return <SettingList rows={rows} />;
}

export function ControlsPanel() {
    const [controls] = useSettingsSection("controls");

    const rows: SettingRow[] = [
        { kind: "section", id: "menus", label: "Menus" },
        ...ACTIONS.map((action): SettingRow => ({
            kind: "static",
            id: `menu-${action}`,
            label: ACTION_LABELS[action],
            value: <Keys action={action} />,
            description: "Menu binding. Rebinding arrives with a later update.",
        })),
        { kind: "section", id: "combat", label: "Combat" },
        ...COMBAT_ACTIONS.map((action): SettingRow => ({
            kind: "static",
            id: `combat-${action}`,
            label: COMBAT_LABELS[action],
            value: <Keys keys={controls.combat[action]} />,
            description:
                "Combat binding, defined by the engine. Rebinding arrives with a later update.",
        })),
        {
            kind: "static",
            id: "select-operator",
            label: "Select operator",
            value: <Keys keys={["1", "–", "9"]} />,
            description: "Operators answer to their squad number, one through nine.",
        },
    ];

    return <SettingList rows={rows} />;
}
