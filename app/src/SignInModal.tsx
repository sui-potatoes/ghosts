// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { isEnokiWallet } from "@mysten/enoki";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { uiConfirm, uiTick } from "./audio";
import { PadHints, usePad } from "./components/PadHints";
import { FEATURES } from "./constants";
import { useBack } from "./hooks/useBack";
import { useGoogleSignIn } from "./hooks/useGoogleSignIn";
import { onAction } from "./input";
import {
    createPasskey,
    loadStoredPasskey,
    PASSKEY_WALLET_NAME,
    recoverPasskey,
} from "./wallets/passkey";

type Props = { open: boolean; onClose: () => void };

function describe(e: unknown): string {
    if (e instanceof DOMException && e.name === "NotAllowedError")
        return "Cancelled by the authenticator.";
    return e instanceof Error ? e.message : String(e);
}

const GLYPHS = {
    google: (
        <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20a8 8 0 0 1 16 0" />
        </>
    ),
    passkey: (
        <>
            <circle cx="8" cy="12" r="4" />
            <path d="M12 12h9M18 12v3.5M21 12v2.5" />
        </>
    ),
    wallet: (
        <>
            <rect x="3" y="6" width="18" height="13" rx="2.5" />
            <path d="M15 12.5h6" />
        </>
    ),
};

function Glyph({ kind }: { kind: keyof typeof GLYPHS }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className="size-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
        >
            {GLYPHS[kind]}
        </svg>
    );
}

/**
 * One sign-in option: a full-width row in the settings-list voice, the Sifu
 * band on the selected one. `extra` is a secondary action rendered under the
 * description; it does not trigger the row.
 */
function Option({
    glyph,
    icon,
    title,
    description,
    state,
    disabled,
    selected,
    onHover,
    onClick,
    extra,
}: {
    glyph?: keyof typeof GLYPHS;
    icon?: string;
    title: string;
    description: string;
    state?: string;
    disabled?: boolean;
    selected: boolean;
    onHover: () => void;
    onClick: () => void;
    extra?: ReactNode;
}) {
    // Not a <button>: `extra` may hold one, and buttons cannot nest. Selection
    // is drawn state, never DOM focus; the input bus moves and activates it.
    return (
        <div
            role="button"
            tabIndex={-1}
            aria-disabled={disabled}
            data-selected={selected || undefined}
            data-disabled={disabled || undefined}
            onMouseEnter={onHover}
            onClick={() => !disabled && onClick()}
            className="sign-option flex w-full items-center gap-5 px-6 py-5 text-left"
        >
            {icon ? (
                <img src={icon} alt="" className="size-5 shrink-0 rounded-full" />
            ) : (
                glyph && <Glyph kind={glyph} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="label text-[14px]">{title}</span>
                <span className="font-mono text-[13px] leading-relaxed tracking-[0.02em]">
                    {description}
                </span>
                {extra && <span className="mt-1.5 font-mono text-[12px]">{extra}</span>}
            </div>
            <span className="label shrink-0 text-[14px]">{state ?? "→"}</span>
        </div>
    );
}

/**
 * Sign-in dialog. Passkey is the WebAuthn wallet in `wallets/passkey.ts`,
 * Google is zkLogin through Enoki (shown unavailable without an API key),
 * and browser-extension wallets appear only behind `FEATURES.externalWallets`.
 * Closes itself once an account is connected.
 *
 * Driven by the input bus like the settings lists: up/down move the band,
 * confirm activates, back (Escape, pad B) closes via the back stack, and every
 * other menu action is consumed while open so the screen behind holds still.
 */
export function SignInModal({ open, onClose }: Props) {
    const dAppKit = useDAppKit();
    const wallets = useWallets();
    const account = useCurrentAccount();
    const pad = usePad();
    const { canSignIn: canGoogle, signIn: signInWithGoogle } = useGoogleSignIn();

    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sel, setSel] = useState("passkey");

    const passkeyWallet = wallets.find((w) => w.name === PASSKEY_WALLET_NAME);
    const externalWallets = FEATURES.externalWallets
        ? wallets.filter((w) => !isEnokiWallet(w) && w.name !== PASSKEY_WALLET_NAME)
        : [];
    const hasPasskey = loadStoredPasskey() !== null;

    useEffect(() => {
        if (open && account) onClose();
    }, [open, account, onClose]);

    // Every open starts on the first option, like a fresh menu.
    useEffect(() => {
        if (open) setSel("passkey");
    }, [open]);

    useBack(open ? onClose : null);

    async function run(name: string, fn: () => Promise<unknown>) {
        if (busy) return;
        setBusy(name);
        setError(null);
        try {
            await fn();
        } catch (e) {
            console.warn(e);
            setError(describe(e));
        } finally {
            setBusy(null);
        }
    }

    async function connectPasskey() {
        if (!passkeyWallet) throw new Error("Passkey wallet is not registered");
        await dAppKit.connectWallet({ wallet: passkeyWallet });
    }

    // The selectable entries in render order; disabled ones are skipped over.
    const entries: { id: string; disabled?: boolean }[] = [
        { id: "passkey" },
        { id: "recover" },
        { id: "google", disabled: !canGoogle },
        ...externalWallets.map((w) => ({ id: `wallet:${w.name}` })),
    ];
    const usable = (id: string) => entries.some((e) => e.id === id && !e.disabled);
    const selected = usable(sel) ? sel : (entries.find((e) => !e.disabled)?.id ?? "passkey");

    function hover(id: string) {
        if (id === selected || !usable(id)) return;
        uiTick();
        setSel(id);
    }

    function move(dir: 1 | -1) {
        let i = entries.findIndex((e) => e.id === selected);
        for (let n = 0; n < entries.length; n++) {
            i = (i + dir + entries.length) % entries.length;
            if (!entries[i].disabled) break;
        }
        if (entries[i].id === selected) return;
        uiTick();
        setSel(entries[i].id);
    }

    function activate(id: string) {
        if (!usable(id) || busy) return;
        uiConfirm();
        if (id === "passkey") {
            void run("passkey", async () => {
                if (!hasPasskey) await createPasskey("any");
                await connectPasskey();
            });
        } else if (id === "recover") {
            void run("recover", async () => {
                await recoverPasskey();
                await connectPasskey();
            });
        } else if (id === "google") {
            void run("google", signInWithGoogle);
        } else {
            const wallet = externalWallets.find((w) => `wallet:${w.name}` === id);
            if (wallet) void run(wallet.name, () => dAppKit.connectWallet({ wallet }));
        }
    }

    const busRef = useRef({ move, activate, selected });
    busRef.current = { move, activate, selected };

    useEffect(() => {
        if (!open) return;
        return onAction((action) => {
            if (action === "back") return false; // falls to this dialog's back-stack entry
            if (action === "up") busRef.current.move(-1);
            else if (action === "down") busRef.current.move(1);
            else if (action === "confirm") busRef.current.activate(busRef.current.selected);
            return true; // modal: tabs and reset never reach the screen behind
        });
    }, [open]);

    if (!open) return null;

    const state = (name: string, text: string) => (busy === name ? text : undefined);

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay p-6 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex w-full max-w-lg flex-col border border-line bg-surface"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="sign-in-title"
            >
                <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                    <div className="flex flex-col gap-2">
                        <h2 id="sign-in-title" className="label text-[14px] text-foreground">
                            Identify
                        </h2>
                        <p className="font-mono text-[13px] leading-relaxed tracking-[0.02em] text-secondary">
                            Choose how your account is held. This becomes the main wallet of your
                            squad.
                        </p>
                    </div>
                    <button
                        className="label text-muted hover:text-foreground"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex flex-col divide-y divide-line border-t border-line">
                    <Option
                        glyph="passkey"
                        title="Passkey"
                        description="Touch ID, iCloud Keychain or an external authenticator signs for you. No extension, no seed phrase."
                        state={state("passkey", "Waiting…")}
                        selected={selected === "passkey"}
                        onHover={() => hover("passkey")}
                        onClick={() => activate("passkey")}
                        extra={
                            <button
                                type="button"
                                className="sign-link"
                                data-selected={selected === "recover" || undefined}
                                onMouseEnter={() => hover("recover")}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    activate("recover");
                                }}
                            >
                                {busy === "recover"
                                    ? "Sign twice to recover…"
                                    : hasPasskey
                                      ? "Use a different passkey"
                                      : "I already have one"}
                            </button>
                        }
                    />
                    <Option
                        glyph="google"
                        title="Google"
                        description={
                            canGoogle
                                ? "zkLogin: your Google account becomes a Sui address. Nothing to install or back up."
                                : "zkLogin is unavailable: no Enoki API key configured for this build."
                        }
                        disabled={!canGoogle}
                        state={state("google", "Opening…")}
                        selected={selected === "google"}
                        onHover={() => hover("google")}
                        onClick={() => activate("google")}
                    />
                    {externalWallets.map((w) => (
                        <Option
                            key={w.name}
                            icon={w.icon}
                            glyph="wallet"
                            title={w.name}
                            description="A wallet you already use."
                            state={state(w.name, "Connecting…")}
                            selected={selected === `wallet:${w.name}`}
                            onHover={() => hover(`wallet:${w.name}`)}
                            onClick={() => activate(`wallet:${w.name}`)}
                        />
                    ))}
                </div>

                {error && (
                    <p className="border-t border-line px-6 py-3 font-mono text-[13px] text-warn">
                        {error}
                    </p>
                )}

                {pad && (
                    <div className="flex justify-end border-t border-line px-6 py-3">
                        <PadHints
                            entries={[
                                ["dpad", "Navigate"],
                                ["a", "Select"],
                                ["b", "Back"],
                            ]}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
