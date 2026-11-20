// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Sign-in in the shared interface language: the same ceremonies as the classic
 * `SignInModal.tsx` (a passkey, recovering one, Google zkLogin when an Enoki
 * key is configured, extension wallets behind `FEATURES.externalWallets`), as
 * rows under one cursor. Confirm (or a click) starts the focused option's
 * ceremony; Back closes. Closes itself once an account is connected.
 */

import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { isEnokiWallet } from "@mysten/enoki";
import { useEffect, useState, type ReactNode } from "react";

import { useAssignedName } from "../../chain";
import { FEATURES } from "../../constants";
import { useGoogleSignIn } from "../../hooks/useGoogleSignIn";
import { defaultName, getPlayerName } from "../../player/name";
import { ListRow, type Command } from "../../ui";
import {
    createPasskey,
    loadStoredPasskey,
    storedPasskeyAddress,
    PASSKEY_WALLET_NAME,
    recoverPasskey,
} from "../../wallets/passkey";
import { DialogHost } from "./DialogHost";
import { signInOptions } from "./model";

function describe(e: unknown): string {
    if (e instanceof DOMException && e.name === "NotAllowedError")
        return "Cancelled by the authenticator";
    return e instanceof Error ? e.message : String(e);
}

const NAV: Command = { action: "nav", label: "Move", glyph: "ud" };

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    if (!open) return null;
    return <SignIn onClose={onClose} />;
}

function SignIn({ onClose }: { onClose: () => void }) {
    const dAppKit = useDAppKit();
    const wallets = useWallets();
    const account = useCurrentAccount();
    const { canSignIn: canGoogle, signIn: signInWithGoogle } = useGoogleSignIn();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (account) onClose();
    }, [account, onClose]);

    const passkeyWallet = wallets.find((w) => w.name === PASSKEY_WALLET_NAME);
    const externalWallets = FEATURES.externalWallets
        ? wallets.filter((w) => !isEnokiWallet(w) && w.name !== PASSKEY_WALLET_NAME)
        : [];
    const hasPasskey = loadStoredPasskey() !== null;
    // The remembered passkey's address comes from its stored public key, so its
    // name resolves while signed out: this device's copy, then the assigned
    // name, then the short generated form (also while the lookup loads).
    const passkeyAddress = hasPasskey ? storedPasskeyAddress() : null;
    const assigned = useAssignedName(passkeyAddress ?? undefined);
    const passkeyName = passkeyAddress
        ? (getPlayerName(passkeyAddress).source === "local"
              ? getPlayerName(passkeyAddress).name
              : assigned) || defaultName(passkeyAddress)
        : undefined;

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

    function activate(id: string) {
        if (id === "passkey")
            void run("passkey", async () => {
                if (!hasPasskey) await createPasskey("any");
                await connectPasskey();
            });
        else if (id === "recover")
            void run("recover", async () => {
                await recoverPasskey();
                await connectPasskey();
            });
        else if (id === "google") void run("google", signInWithGoogle);
        else {
            const wallet = externalWallets.find((w) => `wallet:${w.name}` === id);
            if (wallet) void run(id, () => dAppKit.connectWallet({ wallet }));
        }
    }

    const options = signInOptions({
        hasPasskey,
        passkeyName,
        canGoogle,
        wallets: externalWallets.map((w) => w.name),
        busy,
    });
    const icons: Record<string, ReactNode> = {
        passkey: GLYPHS.passkey,
        recover: GLYPHS.passkey,
        google: GLYPHS.google,
    };

    return (
        <DialogHost
            back={{ action: "back", label: "Close", run: onClose }}
            eyebrow="Identify"
            title="Sign in"
            lead="This becomes the main wallet of your squad"
            foot={
                error && (
                    <p className="gui-dialog-error" role="status">
                        <i className="gui-warn-mark" aria-hidden />
                        {error}
                    </p>
                )
            }
        >
            {options.map((option) => {
                const wallet = externalWallets.find((w) => `wallet:${w.name}` === option.id);
                return (
                    <ListRow
                        key={option.id}
                        id={`sign-in-${option.id}`}
                        group="sign-in"
                        name={option.label}
                        kind={option.kind}
                        tag={option.tag}
                        tagTone="accent"
                        locked={!!option.locked && !option.tag}
                        title={option.label}
                        hint={option.hint}
                        instant
                        thumb={
                            <span className="gui-dialog-glyph">
                                {wallet?.icon ? (
                                    <img src={wallet.icon} alt="" width={18} height={18} />
                                ) : (
                                    <Pictogram>{icons[option.id] ?? GLYPHS.wallet}</Pictogram>
                                )}
                            </span>
                        }
                        commands={[
                            NAV,
                            {
                                action: "confirm",
                                label: option.verb,
                                tone: "primary",
                                deny: option.locked,
                                run: () => activate(option.id),
                            },
                        ]}
                    />
                );
            })}
        </DialogHost>
    );
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
            <rect x="3" y="6" width="18" height="13" />
            <path d="M15 12.5h6" />
        </>
    ),
};

/** The options' pictograms, in the module's stroke style. */
function Pictogram({ children }: { children: ReactNode }) {
    return (
        <svg
            className="gui-icon"
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="square"
            aria-hidden
        >
            {children}
        </svg>
    );
}
