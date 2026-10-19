// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { formatAddress, MIST_PER_SUI } from "@mysten/sui/utils";
import { useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { NETWORK } from "../constants";
import { useBalance } from "../hooks/useBalance";
import { usePlayerName } from "../hooks/usePlayerName";
import { useSignInMethod } from "../hooks/useSignInMethod";
import { Tooltip } from "../components/Tooltip";
import { NameDialog } from "../NameDialog";
import { Field, Hint, Keys } from "../settings/controls";
import { ACTION_LABELS, ACTIONS } from "../settings/keys";
import { Actions, AudioPanel, DisplayPanel } from "../settings/panels";
import { currentAction, DEFAULTS, useSettings } from "../settings/store";
import { requestSignIn } from "../signIn";
import "../settings/settings.css";

const CATEGORIES = [
    { id: "player", label: "Player", blurb: "Who you are to other players." },
    {
        id: "account",
        label: "Account & Security",
        blurb: "The wallet that owns your squad, and getting it back if that wallet is lost.",
    },
    { id: "audio", label: "Audio", blurb: "Levels." },
    { id: "display", label: "Display", blurb: "How the terminal looks." },
    { id: "controls", label: "Controls", blurb: "Keys. Rebinding comes later." },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

function isCategory(v: string | null): v is CategoryId {
    return CATEGORIES.some((c) => c.id === v);
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

// === Panels ===

function PlayerPanel() {
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

function AccountPanel() {
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

function ControlsPanel() {
    const [, update] = useSettings();
    return (
        <>
            {ACTIONS.map((action) => (
                <Field key={action} label={ACTION_LABELS[action]}>
                    <Keys action={action} />
                </Field>
            ))}
            <Actions>
                <button className="btn" disabled>
                    Rebind · soon
                </button>
                <button
                    className="btn"
                    onClick={() => update((s) => ({ ...s, controls: DEFAULTS.controls }))}
                >
                    Reset to defaults
                </button>
            </Actions>
        </>
    );
}

const PANELS: Record<CategoryId, () => ReactNode> = {
    player: PlayerPanel,
    account: AccountPanel,
    audio: AudioPanel,
    display: DisplayPanel,
    controls: ControlsPanel,
};

// === Screen ===

/**
 * Settings as a game screen: categories down the left (across the top on
 * phones), the chosen panel on the right, key hints at the bottom. The
 * category is kept in `?tab=` so it survives a reload and can be linked, but
 * tab changes replace the history entry so Escape still leaves the screen.
 */
export default function Settings() {
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab");
    const current: CategoryId = isCategory(tab) ? tab : "player";
    const navRefs = useRef<(HTMLButtonElement | null)[]>([]);

    function select(id: CategoryId) {
        setParams(id === "player" ? {} : { tab: id }, { replace: true });
    }

    function onNavKey(e: React.KeyboardEvent) {
        const action = currentAction(e);
        const dir = action === "down" ? 1 : action === "up" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const i = CATEGORIES.findIndex((c) => c.id === current);
        const next = (i + dir + CATEGORIES.length) % CATEGORIES.length;
        select(CATEGORIES[next].id);
        navRefs.current[next]?.focus();
    }

    const category = CATEGORIES.find((c) => c.id === current)!;
    const Panel = PANELS[current];

    return (
        <main className="flex min-h-screen flex-col px-6 py-10 md:px-16 md:py-16">
            <div className="flex w-full max-w-3xl flex-1 flex-col gap-10">
                <header className="flex items-baseline justify-between gap-6">
                    <Link to="/" className="label text-secondary hover:text-accent">
                        ‹ Menu
                    </Link>
                    <p className="label text-muted">System / Settings</p>
                </header>

                <div className="flex flex-col gap-8 md:flex-row md:gap-14">
                    <nav
                        aria-label="Settings categories"
                        className="flex shrink-0 overflow-x-auto border-t border-line md:w-56 md:flex-col md:overflow-visible"
                        onKeyDown={onNavKey}
                    >
                        {CATEGORIES.map((c, i) => (
                            <button
                                key={c.id}
                                ref={(el) => {
                                    navRefs.current[i] = el;
                                }}
                                className="settings-nav-item"
                                aria-current={c.id === current ? "true" : undefined}
                                tabIndex={c.id === current ? 0 : -1}
                                onClick={() => select(c.id)}
                            >
                                {c.label}
                            </button>
                        ))}
                    </nav>

                    <section
                        key={current}
                        aria-labelledby="settings-panel-title"
                        className="flex min-w-0 flex-1 flex-col border-t border-line pt-6"
                    >
                        <div className="mb-3 flex flex-col gap-1">
                            <h1
                                id="settings-panel-title"
                                className="font-mono text-2xl font-light tracking-[0.2em] uppercase text-foreground"
                            >
                                {category.label}
                            </h1>
                            <p className="text-[13px] text-secondary">{category.blurb}</p>
                        </div>
                        <Panel />
                    </section>
                </div>

                <footer className="mt-auto border-t border-line pt-5">
                    <Hint
                        items={[
                            ["back", "back"],
                            ["up", "category"],
                            ["left", "adjust"],
                            ["confirm", "activate"],
                        ]}
                    />
                </footer>
            </div>
        </main>
    );
}
