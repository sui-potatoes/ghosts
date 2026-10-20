// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { formatAddress, MIST_PER_SUI } from "@mysten/sui/utils";
import { useState, type ReactNode } from "react";

import { Tooltip } from "../components/Tooltip";
import { NETWORK } from "../constants";
import { useBalance } from "../hooks/useBalance";
import { usePlayerName } from "../hooks/usePlayerName";
import { useSignInMethod } from "../hooks/useSignInMethod";
import { NameDialog } from "../NameDialog";
import { requestSignIn } from "../signIn";
import { Field, Keys, Slider, Switch } from "./controls";
import { COMBAT_ACTIONS, COMBAT_LABELS } from "@ghosts/engine/keys";
import { ACTION_LABELS, ACTIONS } from "./keys";
import { useSettingsSection } from "./store";

/*
 * The settings panels. Shared by the Settings screen and the in-game pause
 * menu, so a change made mid-encounter is the same change.
 */

/** Button row under a panel's fields. */
function Actions({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap gap-3 pt-4">{children}</div>;
}

function ResetButton({ onReset }: { onReset: () => void }) {
    return (
        <button className="btn" onClick={onReset}>
            Reset to defaults
        </button>
    );
}

/** Format MIST as SUI with four decimals, trimming nothing so columns align. */
function formatSui(mist: bigint): string {
    const whole = mist / MIST_PER_SUI;
    const frac = ((mist % MIST_PER_SUI) * 10_000n) / MIST_PER_SUI;
    return `${whole}.${frac.toString().padStart(4, "0")}`;
}

function CopyAddress({ address }: { address: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            console.warn("clipboard write failed:", e);
        }
    }

    return (
        <Tooltip text={address}>
            <button onClick={copy} className="font-mono text-sm">
                {copied ? "copied" : formatAddress(address)}
            </button>
        </Tooltip>
    );
}

/** Visitors see this in place of anything tied to an account. */
function SignedOut({ what }: { what: string }) {
    return (
        <div className="flex flex-col gap-4 pt-2">
            <p className="text-sm text-secondary">Not signed in. Identify to see {what}.</p>
            <div>
                <button className="btn" onClick={requestSignIn}>
                    Log in
                </button>
            </div>
        </div>
    );
}

export function PlayerPanel() {
    const account = useCurrentAccount();
    const player = usePlayerName();
    const [nameOpen, setNameOpen] = useState(false);

    if (!account) return <SignedOut what="your name" />;

    return (
        <>
            <Field
                label="Name"
                hint="Follows SuiNS rules, so it can become your SuiNS name unchanged."
            >
                {player.name}
                {player.source === null && (
                    <span className="ml-2 text-[11px] text-secondary">(generated)</span>
                )}
            </Field>
            <Actions>
                <button className="btn" onClick={() => setNameOpen(true)}>
                    Change
                </button>
            </Actions>
            <NameDialog open={nameOpen} onClose={() => setNameOpen(false)} />
        </>
    );
}

export function AccountPanel() {
    const dAppKit = useDAppKit();
    const account = useCurrentAccount();
    const method = useSignInMethod();
    const { data: mist, isPending, isError } = useBalance();

    if (!account) return <SignedOut what="your wallet and balance" />;

    return (
        <>
            <Field label="Held by">{method?.label ?? "—"}</Field>
            <Field label="Address">
                <CopyAddress address={account.address} />
            </Field>
            <Field label="Balance">
                {isPending ? (
                    <span className="skeleton h-[14px] w-[88px] align-middle" />
                ) : isError || mist === undefined ? (
                    <span className="text-warn">unavailable</span>
                ) : (
                    <>
                        {formatSui(mist)} <span className="text-secondary">SUI</span>
                    </>
                )}
            </Field>
            <Field label="Network">{NETWORK}</Field>
            <h3 className="label pt-8 pb-2 text-muted">Security</h3>
            <Field
                label="Recovery wallet"
                hint="A second authorizer that can take over after a delay. Passkeys are bound to this site and zkLogin to a provider; without it, losing either means losing the squad."
            >
                <span className="inline-flex items-center gap-2 text-warn">
                    <span className="dot dot-pulse" aria-hidden />
                    not set
                </span>
            </Field>
            <Actions>
                <button className="btn" disabled>
                    Set up recovery · soon
                </button>
                <button className="btn" onClick={() => dAppKit.disconnectWallet()}>
                    Sign out
                </button>
            </Actions>
        </>
    );
}

export function AudioPanel() {
    const [audio, setAudio, reset] = useSettingsSection("audio");

    return (
        <>
            <Switch label="Mute" checked={audio.muted} onChange={(muted) => setAudio({ muted })} />
            <Slider
                label="Master"
                value={audio.master}
                disabled={audio.muted}
                onChange={(master) => setAudio({ master })}
            />
            <Slider
                label="Music"
                value={audio.music}
                disabled={audio.muted}
                onChange={(music) => setAudio({ music })}
            />
            <Slider
                label="Effects"
                value={audio.sfx}
                disabled={audio.muted}
                onChange={(sfx) => setAudio({ sfx })}
            />
            <Slider
                label="Dialogue"
                value={audio.voice}
                disabled={audio.muted}
                onChange={(voice) => setAudio({ voice })}
            />
            <Actions>
                <ResetButton onReset={reset} />
            </Actions>
        </>
    );
}

export function DisplayPanel() {
    const [display, setDisplay, reset] = useSettingsSection("display");

    return (
        <>
            <Switch
                label="Battery saver"
                checked={display.batterySaver}
                onChange={(batterySaver) => setDisplay({ batterySaver })}
            />
            <Switch
                label="Scanlines"
                checked={display.scanlines}
                onChange={(scanlines) => setDisplay({ scanlines })}
            />
            <Switch
                label="Vignette"
                checked={display.vignette}
                onChange={(vignette) => setDisplay({ vignette })}
            />
            <Switch
                label="Reduce motion"
                checked={display.reduceMotion}
                onChange={(reduceMotion) => setDisplay({ reduceMotion })}
            />
            <Actions>
                <ResetButton onReset={reset} />
            </Actions>
        </>
    );
}

export function ControlsPanel() {
    const [controls, , reset] = useSettingsSection("controls");

    return (
        <>
            <h3 className="label pb-2 text-muted">Menus</h3>
            {ACTIONS.map((action) => (
                <Field key={action} label={ACTION_LABELS[action]}>
                    <Keys action={action} />
                </Field>
            ))}
            <h3 className="label pt-8 pb-2 text-muted">Combat</h3>
            {COMBAT_ACTIONS.map((action) => (
                <Field key={action} label={COMBAT_LABELS[action]}>
                    <Keys keys={controls.combat[action]} />
                </Field>
            ))}
            <Field label="Select operator">
                <Keys keys={["1", "–", "9"]} />
            </Field>
            <Actions>
                <button className="btn" disabled>
                    Rebind · soon
                </button>
                <ResetButton onReset={reset} />
            </Actions>
        </>
    );
}
