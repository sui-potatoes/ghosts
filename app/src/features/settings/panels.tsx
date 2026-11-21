// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The seven categories, each a panel of rows from the shared parts, bound to
 * the same store keys as the classic panels (`src/settings/panels.tsx`), so a
 * value set here is the value the classic screen shows. Every row's
 * explanation is its command-bar hint; nothing on screen is help text.
 */

import { formatAddress, MIST_PER_SUI } from "@mysten/sui/utils";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
    heldPadButtons,
    observePad,
    onPad,
    padGlyph,
    padName,
    type PadButton,
} from "@ghosts/engine/gamepad";
import {
    COMBAT_ACTIONS,
    COMBAT_LABELS,
    DEFAULT_COMBAT_BINDINGS,
    DEFAULT_PAD_COMBAT_BINDINGS,
    keyCap,
    PAD_BINDABLE,
    PAD_COMBAT_ACTIONS,
    PAD_COMBAT_LABELS,
    type CombatAction,
    type PadBindable,
    type PadCombatAction,
} from "@ghosts/engine/keys";

import { economyRules as economyRulesNow, sizeOpen } from "../play/economy";
import { DEFAULT_RATING } from "../play/rating";
import { useRatingRecord, type RatingRecord } from "./rating-qa";
import { previewDialogue, previewEffect } from "../../audio";
import type { SessionTermination } from "../../chain";
import { usePad } from "../../components/PadHints";
import { validateRpcUrl } from "../../rpcUrl";
import { NameField, readDraft } from "../name-step/NameField";
import { ControllerDiagram, fieldActions } from "../../settings/ControllerDiagram";
import { useFullscreen } from "../../settings/fullscreen";
import { ACTION_LABELS, ACTIONS, type Action } from "../../settings/keys";
import { DEFAULTS, updateSettings, useSettings, useSettingsSection } from "../../settings/store";
import {
    ActionRow,
    EmptyState,
    Eyebrow,
    FocusScope,
    List,
    ListRow,
    Panel,
    Prompt,
    ReadoutLine,
    Rolling,
    Slider,
    StatusChip,
    Stepper,
    TextField,
    useFocusable,
    type Command,
} from "../../ui";
import {
    endpointHost,
    FLAG_ROWS,
    LEVEL_ROWS,
    LEVEL_SEGMENTS,
    levelToSlider,
    onOff,
    panelChanges,
    panelReset,
    sliderToLevel,
    switchOptions,
    type PANEL_KEYS,
} from "./model";
import { KeyCaps, PadCaps, ValueRow } from "./parts";
import { SettingsFrame, useSettingsContext, type Line } from "./frame";

const CHANGE: Command = { action: "nav", label: "Change", glyph: "lr" };

/** The reset slot of a row whose value is not its default. */
const toDefault = (differs: boolean, run: () => void): Command[] =>
    differs ? [{ action: "reset", label: "Default", run }] : [];

// === Shared bits ============================================================

type Panelled = keyof typeof PANEL_KEYS;

/** A panel's last row: put its own settings back, behind a prompt. */
function RestoreRow({ panel, open }: { panel: Panelled; open: () => void }) {
    const [settings] = useSettings();
    const changes = panelChanges(panel, settings, DEFAULTS);
    return (
        <ActionRow
            id={`${panel}-restore`}
            group="rows"
            label="Restore defaults"
            title="Restore defaults"
            hint={
                changes
                    ? `${changes} ${changes === 1 ? "setting differs" : "settings differ"} from the default`
                    : undefined
            }
            instant
            commands={[
                {
                    action: "confirm",
                    label: "Restore",
                    tone: "primary",
                    deny: changes ? undefined : "Already at the defaults",
                    run: open,
                },
            ]}
        />
    );
}

function RestorePrompt({
    panel,
    what,
    close,
}: {
    panel: Panelled;
    what: string;
    close: () => void;
}) {
    const { glyphs } = useSettingsContext();
    const [settings] = useSettings();
    const changes = panelChanges(panel, settings, DEFAULTS);
    return (
        <Prompt
            id={`prompt-restore-${panel}`}
            eyebrow={what}
            title="Restore the defaults?"
            lines={[["Changed", String(changes)]]}
            confirm={{
                label: "Restore",
                run: () => {
                    updateSettings((s) => panelReset(panel, s, DEFAULTS));
                    close();
                },
            }}
            cancel={{ label: "Keep", run: close }}
            glyphs={glyphs}
        >
            Every {what.toLowerCase()} setting returns to its default
        </Prompt>
    );
}

/** The signed-out plate for the account categories: the one way in. */
function SignInGate({ what }: { what: string }) {
    const { account } = useSettingsContext();
    return (
        <SettingsFrame>
            <Panel className="gset-c2 gset-fit">
                <EmptyState
                    id="gate-sign-in"
                    group="rows"
                    instant
                    headline="Identification required"
                    action="Sign in"
                    title="Sign in"
                    hint="With a passkey or a provider"
                    commands={[
                        {
                            action: "confirm",
                            label: "Sign in",
                            tone: "primary",
                            run: account.signIn,
                        },
                    ]}
                >
                    Sign in to see {what}
                </EmptyState>
            </Panel>
        </SettingsFrame>
    );
}

// === Player =================================================================

export function PlayerPanel() {
    const { account, inMatch } = useSettingsContext();
    const [renaming, setRenaming] = useState(false);
    const [resetting, setResetting] = useState(false);
    const record = useRatingRecord(!!inMatch);
    const signedIn = record.signedIn;
    const label = signedIn ? "Player" : "Rating";
    return (
        <SettingsFrame
            status={
                <>
                    {account.namePending && <StatusChip label="Name" value="Saving" state="busy" />}
                    {record.busy && <StatusChip label="Rating" value="Resetting" state="busy" />}
                </>
            }
            overlay={
                renaming ? (
                    <NamePrompt close={() => setRenaming(false)} />
                ) : (
                    resetting &&
                    !record.deny && (
                        <ResetPrompt record={record} close={() => setResetting(false)} />
                    )
                )
            }
        >
            <Panel label={label} className="gset-c2 gset-fit">
                <List label={label}>
                    {signedIn && account.address && (
                        <ValueRow
                            id="player-name"
                            group="rows"
                            label="Name"
                            value={
                                <>
                                    {account.name}
                                    {account.generated && (
                                        <span className="gset-note">generated</span>
                                    )}
                                </>
                            }
                            title="Name"
                            hint="Your call sign, shown to other players"
                            instant
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Rename",
                                    tone: "primary",
                                    deny: account.namePending ? "Saving" : undefined,
                                    run: () => setRenaming(true),
                                },
                            ]}
                        />
                    )}
                    {signedIn && (
                        <RatingResetRow deny={record.deny} open={() => setResetting(true)} />
                    )}
                </List>
            </Panel>
            <RankedBlock record={record} />
        </SettingsFrame>
    );
}

/**
 * A one-press row that opens the reset prompt; inactive at or below the default,
 * during a match or a search, and inside the cooldown, with the reason.
 */
function RatingResetRow({ deny, open }: { deny: string | undefined; open: () => void }) {
    return (
        <ActionRow
            id="rating-reset"
            group="rows"
            label={`Reset rating to ${DEFAULT_RATING}`}
            tone="danger"
            title={`Reset rating to ${DEFAULT_RATING}`}
            hint={deny ?? `Your rating goes back to ${DEFAULT_RATING}; your record stays`}
            instant
            commands={[{ action: "confirm", label: "Reset", tone: "danger", deny, run: open }]}
        />
    );
}

/** The reset question; Reset sends it and closes once it is taken. */
function ResetPrompt({ record, close }: { record: RatingRecord; close: () => void }) {
    const { glyphs } = useSettingsContext();
    const days = Math.round(economyDays());
    return (
        <Prompt
            id="prompt-rating-reset"
            tone="danger"
            eyebrow="Rating"
            title="Reset your rating?"
            hint={`Rating ${record.standing.rating} returns to ${DEFAULT_RATING}`}
            lines={
                record.error
                    ? [["Refused", <span className="gset-warn">{record.error}</span>]]
                    : undefined
            }
            confirm={{
                label: "Reset",
                deny: record.busy ? "Saving" : undefined,
                hold: true,
                run: () => {
                    void record.reset().then((done) => done && close());
                },
            }}
            cancel={{ label: "Keep rating", run: close }}
            glyphs={glyphs}
        >
            {`Your rating returns to ${DEFAULT_RATING}. Your record stays. The next reset is possible in ${days} ${days === 1 ? "day" : "days"}`}
        </Prompt>
    );
}

/** Days between rating resets, as the rules have it. */
const economyDays = () => economyRulesNow().resetCooldownMs / 86_400_000;

/**
 * The ranked record from the player's `Account`: tier, rating, ranked games, what
 * each size builds to, placement and resets. The contract keeps no peak.
 */
function RankedBlock({ record }: { record: RatingRecord }) {
    const r = record.standing;
    const rate = r.games ? `${Math.round((r.wins / r.games) * 100)}%` : "-";
    return (
        <Panel variant="ghost" label="Ranked" className="gset-c3 gset-fit">
            <>
                <ReadoutLine label="Rank">{r.tier.name}</ReadoutLine>
                <ReadoutLine label="Rating">
                    <Rolling value={r.rating} />
                </ReadoutLine>
                <ReadoutLine label="Ranked matches">{r.games}</ReadoutLine>
                <ReadoutLine label="Record" empty={!r.games}>
                    {`${r.wins} won · ${r.losses} lost · ${r.draws} drawn`}
                </ReadoutLine>
                <ReadoutLine label="Win rate" empty={!r.games}>
                    {rate}
                </ReadoutLine>
                <ReadoutLine label="Budget 3x3">{`${r.budgets["3x3"]} cr`}</ReadoutLine>
                <ReadoutLine label="Budget 4x4" empty={!sizeOpen("4x4")}>
                    {sizeOpen("4x4") ? `${r.budgets["4x4"]} cr` : "No level yet"}
                </ReadoutLine>
                {r.placementLeft > 0 && (
                    <ReadoutLine label="Placement left">
                        {`${r.placementLeft} ${r.placementLeft === 1 ? "match" : "matches"}`}
                    </ReadoutLine>
                )}
                <ReadoutLine label="Resets">{r.resets}</ReadoutLine>
            </>
        </Panel>
    );
}

/** The rename: the classic name dialog's rules and write, as a prompt. */
function NamePrompt({ close }: { close: () => void }) {
    const { account, glyphs } = useSettingsContext();
    const [draft, setDraft] = useState(account.name);
    const [error, setError] = useState<string | null>(null);
    const { normalized, problem } = readDraft(draft);
    const deny = account.namePending
        ? "Saving"
        : normalized === account.name
          ? "Unchanged"
          : (problem ?? undefined);

    const save = () => {
        if (deny) return;
        setError(null);
        account.submitName(normalized).then(close, (e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
        });
    };

    return (
        <Prompt
            id="prompt-name"
            eyebrow="Player name"
            title="Change your name?"
            hint={problem && draft && normalized !== account.name ? problem : undefined}
            lines={error ? [["Refused", <span className="gset-warn">{error}</span>]] : undefined}
            confirm={{ label: "Save", deny, run: save }}
            cancel={{ label: "Cancel", run: close }}
            glyphs={glyphs}
        >
            What other players see: lowercase letters, digits and hyphens
            <NameField
                value={draft}
                onChange={(v) => {
                    setDraft(v);
                    setError(null);
                }}
                onSubmit={save}
            />
        </Prompt>
    );
}

// === Account ================================================================

/** MIST as SUI with four decimals. */
function formatSui(mist: bigint): string {
    const whole = mist / MIST_PER_SUI;
    const frac = ((mist % MIST_PER_SUI) * 10_000n) / MIST_PER_SUI;
    return `${whole}.${frac.toString().padStart(4, "0")}`;
}

type AccountPrompt =
    | { kind: "sign-out" }
    | { kind: "forget" }
    | { kind: "terminate"; termination: SessionTermination };

export function AccountPanel() {
    const { account, glyphs } = useSettingsContext();
    const [prompt, setPrompt] = useState<AccountPrompt | null>(null);
    const [copied, setCopied] = useState(false);
    const [line, setLine] = useState<Line>(null);
    const sessions = account.sessions;

    useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
    }, [copied]);

    if (!account.address) return <SignInGate what="your account and sessions" />;
    const address = account.address;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
        } catch (e) {
            console.warn("clipboard write failed:", e);
            setLine({ text: "The clipboard refused the copy", tone: "warn" });
        }
    };

    const close = () => setPrompt(null);
    const overlay =
        prompt?.kind === "sign-out" ? (
            <Prompt
                id="prompt-sign-out"
                tone="danger"
                eyebrow="Account"
                title="Sign out?"
                hint="Signing in again authorizes this device anew"
                confirm={{
                    label: "Sign out",
                    run: () => {
                        close();
                        void account.signOut();
                    },
                }}
                cancel={{ label: "Stay", run: close }}
                glyphs={glyphs}
            >
                Disconnects this wallet from the device; this browser's session key loses access and
                is wiped. Local preferences stay
            </Prompt>
        ) : prompt?.kind === "forget" ? (
            <Prompt
                id="prompt-forget-device"
                tone="danger"
                eyebrow="Account"
                title="Forget this passkey on this device?"
                confirm={{
                    label: "Forget",
                    run: () => {
                        close();
                        void account.forgetDevice?.();
                    },
                }}
                cancel={{ label: "Keep", run: close }}
                glyphs={glyphs}
            >
                You will need your passkey to sign in here again. Your account is not affected
            </Prompt>
        ) : prompt?.kind === "terminate" ? (
            <Prompt
                id="prompt-terminate"
                tone="danger"
                eyebrow="Device session"
                title={`Terminate ${prompt.termination.label}?`}
                confirm={{
                    label: "Terminate",
                    run: () => {
                        prompt.termination.run();
                        close();
                    },
                }}
                cancel={{ label: "Keep", run: close }}
                glyphs={glyphs}
            >
                {prompt.termination.label} loses access and can no longer sign for this account
                {prompt.termination.local ? "; the key stored in this browser is wiped" : ""}. One
                passkey signature confirms the removal
            </Prompt>
        ) : null;

    const fault = sessions.fault
        ? ({ text: `Last attempt failed: ${sessions.fault.slice(0, 110)}`, tone: "warn" } as const)
        : null;

    return (
        <SettingsFrame
            status={sessions.busy && <StatusChip label="Sessions" value="Working" state="busy" />}
            overlay={overlay}
            line={line ?? fault}
        >
            <Panel label="Account" className="gset-c2 gset-fit">
                <List label="Account">
                    <ValueRow
                        id="account-held"
                        group="rows"
                        label="Held by"
                        value={account.method ?? "—"}
                        title="Held by"
                        hint="A passkey bound to this site, or a sign-in provider"
                    />
                    <ValueRow
                        id="account-address"
                        group="rows"
                        label="Address"
                        value={copied ? "Copied" : formatAddress(address)}
                        tone={copied ? "accent" : undefined}
                        title="Address"
                        hint="The account's Sui address"
                        instant
                        commands={[
                            {
                                action: "confirm",
                                label: "Copy",
                                tone: "primary",
                                run: () => void copy(),
                            },
                        ]}
                    />
                    <ValueRow
                        id="account-balance"
                        group="rows"
                        label="Balance"
                        value={
                            account.balance.state === "ok" ? (
                                <>
                                    {formatSui(account.balance.mist)}
                                    <span className="gset-note">SUI</span>
                                </>
                            ) : account.balance.state === "pending" ? (
                                "…"
                            ) : (
                                "Unavailable"
                            )
                        }
                        tone={account.balance.state === "error" ? "warn" : undefined}
                        title="Balance"
                        hint="Pays the network fee when your squad saves"
                    />
                    <ValueRow
                        id="account-network"
                        group="rows"
                        label="Network"
                        value={account.network}
                        title="Network"
                        hint="The Sui network this build plays on"
                    />
                    <ValueRow
                        id="account-recovery"
                        group="rows"
                        label="Recovery"
                        value="Not available"
                        tone="dim"
                        title="Recovery wallet"
                        hint="A second authorizer for a lost passkey or provider"
                        commands={[
                            {
                                action: "confirm",
                                label: "Set up",
                                deny: "Arrives in a later update",
                            },
                        ]}
                    />
                    <ActionRow
                        id="account-sign-out"
                        group="rows"
                        label="Sign out"
                        tone="danger"
                        title="Sign out"
                        hint="Disconnects this wallet from the device"
                        commands={[
                            {
                                action: "confirm",
                                label: "Sign out",
                                tone: "danger",
                                run: () => setPrompt({ kind: "sign-out" }),
                            },
                        ]}
                    />
                    {account.method === "Passkey" && account.forgetDevice && (
                        <ActionRow
                            id="account-forget-device"
                            group="rows"
                            label="Forget this device"
                            tone="danger"
                            title="Forget this device"
                            hint="Signs out and removes the passkey this device remembers"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Forget",
                                    tone: "danger",
                                    run: () => setPrompt({ kind: "forget" }),
                                },
                            ]}
                        />
                    )}
                </List>
            </Panel>
            <Panel
                label="Sessions"
                meta={sessions.items.length || undefined}
                className="gset-c3 gset-fit"
            >
                <List label="Sessions">
                    {sessions.supported === false ? (
                        <ValueRow
                            id="session-unsupported"
                            group="sessions"
                            label="Device sessions"
                            value="Unavailable here"
                            tone="warn"
                            title="Device sessions"
                            hint="This browser cannot hold a session key safely; play signs with the passkey"
                        />
                    ) : (
                        <>
                            {sessions.items.map((item) => (
                                <ListRow
                                    key={item.id}
                                    id={`session-${item.id}`}
                                    group="sessions"
                                    name={item.label}
                                    kind={item.left !== null ? `${item.left}d left` : undefined}
                                    tag={item.last ?? "No action seen"}
                                    tagTone={item.old ? "warn" : "default"}
                                    selected={item.local}
                                    title={item.label}
                                    hint="Last action on this account"
                                    commands={[
                                        {
                                            action: "confirm",
                                            label: "Terminate",
                                            tone: "danger",
                                            deny: sessions.busy ? "Working" : undefined,
                                            run: () =>
                                                setPrompt({
                                                    kind: "terminate",
                                                    termination: item.termination,
                                                }),
                                        },
                                    ]}
                                />
                            ))}
                            {sessions.authorize && (
                                <ActionRow
                                    id="session-authorize"
                                    group="sessions"
                                    label="Authorize this device"
                                    title="Authorize this device"
                                    hint={
                                        sessions.authorize.firstTime
                                            ? "Two passkey prompts the first time; then play needs none"
                                            : "One passkey prompt; then play needs none"
                                    }
                                    commands={[
                                        {
                                            action: "confirm",
                                            label: sessions.fault ? "Retry" : "Authorize",
                                            tone: "primary",
                                            deny: sessions.busy ? "Working" : undefined,
                                            run: sessions.authorize.run,
                                        },
                                    ]}
                                />
                            )}
                        </>
                    )}
                </List>
            </Panel>
        </SettingsFrame>
    );
}

// === Audio ==================================================================

/** Drags step through many levels at once; one preview per beat is enough. */
function usePreview() {
    const last = useRef({ effect: 0, dialogue: 0 });
    return (kind?: "effect" | "dialogue") => {
        if (!kind) return;
        const now = performance.now();
        if (now - last.current[kind] < 160) return;
        last.current[kind] = now;
        if (kind === "effect") previewEffect();
        else previewDialogue();
    };
}

export function AudioPanel() {
    const [audio, setAudio] = useSettingsSection("audio");
    const [restore, setRestore] = useState(false);
    const preview = usePreview();
    return (
        <SettingsFrame
            overlay={
                restore && (
                    <RestorePrompt panel="audio" what="Audio" close={() => setRestore(false)} />
                )
            }
        >
            <Panel label="Audio" className="gset-c2 gset-fit">
                <List label="Audio">
                    <Stepper
                        id="audio-muted"
                        group="rows"
                        label="Sound"
                        options={switchOptions("Muted", "On")}
                        value={onOff(!audio.muted)}
                        onChange={(id) => setAudio({ muted: id === "off" })}
                        title="Sound"
                        hint="Silence every channel without touching the mix"
                        commands={[
                            CHANGE,
                            ...toDefault(audio.muted !== DEFAULTS.audio.muted, () =>
                                setAudio({ muted: DEFAULTS.audio.muted }),
                            ),
                        ]}
                    />
                    {LEVEL_ROWS.map((row) => (
                        <Slider
                            key={row.key}
                            id={`audio-${row.key}`}
                            group="rows"
                            label={row.label}
                            min={0}
                            max={1}
                            segments={LEVEL_SEGMENTS}
                            value={levelToSlider(audio[row.key])}
                            onChange={(v) => {
                                // The store settles synchronously: the preview plays at the new level.
                                setAudio({ [row.key]: sliderToLevel(v) });
                                preview(row.preview);
                            }}
                            title={row.label}
                            hint={audio.muted ? "Sound is muted" : row.hint}
                            commands={[
                                { action: "nav", label: "Level", glyph: "lr" },
                                ...toDefault(audio[row.key] !== DEFAULTS.audio[row.key], () => {
                                    setAudio({ [row.key]: DEFAULTS.audio[row.key] });
                                    preview(row.preview);
                                }),
                            ]}
                        />
                    ))}
                    <RestoreRow panel="audio" open={() => setRestore(true)} />
                </List>
            </Panel>
        </SettingsFrame>
    );
}

// === Display ================================================================

export function DisplayPanel() {
    const [display, setDisplay] = useSettingsSection("display");
    const [fullscreen, setFullscreen] = useFullscreen();
    const [restore, setRestore] = useState(false);
    return (
        <SettingsFrame
            overlay={
                restore && (
                    <RestorePrompt panel="display" what="Display" close={() => setRestore(false)} />
                )
            }
        >
            <Panel label="Display" className="gset-c2 gset-fit">
                <List label="Display">
                    <Stepper
                        id="display-fullscreen"
                        group="rows"
                        label="Fullscreen"
                        options={switchOptions()}
                        value={onOff(fullscreen)}
                        onChange={(id) => setFullscreen(id === "on")}
                        title="Fullscreen"
                        hint="Take the whole display; the browser forgets it between sessions"
                        commands={[CHANGE]}
                    />
                    {FLAG_ROWS.map((row) => (
                        <Stepper
                            key={row.key}
                            id={`display-${row.key}`}
                            group="rows"
                            label={row.label}
                            options={switchOptions()}
                            value={onOff(display[row.key])}
                            onChange={(id) => setDisplay({ [row.key]: id === "on" })}
                            title={row.label}
                            hint={row.hint}
                            commands={[
                                CHANGE,
                                ...toDefault(display[row.key] !== DEFAULTS.display[row.key], () =>
                                    setDisplay({ [row.key]: DEFAULTS.display[row.key] }),
                                ),
                            ]}
                        />
                    ))}
                    <RestoreRow panel="display" open={() => setRestore(true)} />
                </List>
            </Panel>
        </SettingsFrame>
    );
}

// === Controls ===============================================================

const MENU_LABELS: Record<Action, string> = {
    back: "Back",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    confirm: "Confirm",
    "prev-tab": "Previous tab",
    "next-tab": "Next tab",
    "prev-section": "Previous section",
    "next-section": "Next section",
    reset: "Default",
};

/** Hand `keys` to `action`; an action already holding one takes the old keys: a swap. */
function swapKeys(
    combat: Record<CombatAction, string[]>,
    action: CombatAction,
    keys: string[],
): Record<CombatAction, string[]> {
    const next = { ...combat };
    const prev = next[action];
    for (const other of COMBAT_ACTIONS) {
        if (other !== action && next[other].some((k) => keys.includes(k))) next[other] = prev;
    }
    next[action] = keys;
    return next;
}

export function ControlsPanel() {
    const [controls, setControls] = useSettingsSection("controls");
    const [capturing, setCapturing] = useState<CombatAction | null>(null);
    const [restore, setRestore] = useState(false);
    const assign = (action: CombatAction, keys: string[]) =>
        setControls({ combat: swapKeys(controls.combat, action, keys) });

    const overlay = capturing ? (
        <KeyCapturePrompt
            action={capturing}
            assign={(keys) => {
                assign(capturing, keys);
                setCapturing(null);
            }}
            close={() => setCapturing(null)}
        />
    ) : restore ? (
        <RestorePrompt panel="controls" what="Combat key" close={() => setRestore(false)} />
    ) : null;

    return (
        <SettingsFrame overlay={overlay}>
            <Panel label="Menus" className="gset-c2 gset-fit">
                <List label="Menu bindings">
                    {ACTIONS.map((action) => (
                        <ValueRow
                            key={action}
                            id={`menu-${action}`}
                            group="menus"
                            label={MENU_LABELS[action]}
                            value={<KeyCaps keys={controls.bindings[action]} />}
                            title={MENU_LABELS[action]}
                            hint={`${ACTION_LABELS[action]}. Menu keys are fixed`}
                        />
                    ))}
                </List>
            </Panel>
            <Panel label="Combat" className="gset-c3 gset-fit">
                <List label="Combat bindings">
                    {COMBAT_ACTIONS.map((action) => (
                        <ValueRow
                            key={action}
                            id={`combat-${action}`}
                            group="combat"
                            label={COMBAT_LABELS[action]}
                            value={<KeyCaps keys={controls.combat[action]} cap={keyCap} />}
                            title={COMBAT_LABELS[action]}
                            hint="Rebind: the next key pressed takes it; a key in use swaps over"
                            instant
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Rebind",
                                    tone: "primary",
                                    run: () => setCapturing(action),
                                },
                                ...toDefault(
                                    JSON.stringify(controls.combat[action]) !==
                                        JSON.stringify(DEFAULT_COMBAT_BINDINGS[action]),
                                    () => assign(action, DEFAULT_COMBAT_BINDINGS[action]),
                                ),
                            ]}
                        />
                    ))}
                    <ValueRow
                        id="combat-operator"
                        group="combat"
                        label="Select operator"
                        value={<KeyCaps keys={["1", "–", "9"]} cap={(k) => k} />}
                        title="Select operator"
                        hint="Operators answer to their squad number, one through nine"
                    />
                    <RestoreRow panel="controls" open={() => setRestore(true)} />
                </List>
            </Panel>
        </SettingsFrame>
    );
}

/**
 * Rebinding a combat key: while the prompt is up, the next key pressed is
 * taken before the input bus sees it (Escape still reaches the bus and backs
 * out). A chord, a lone modifier or a digit (the squad numbers) is ignored.
 */
function KeyCapturePrompt({
    action,
    assign,
    close,
}: {
    action: CombatAction;
    assign: (keys: string[]) => void;
    close: () => void;
}) {
    const { glyphs } = useSettingsContext();
    const take = useRef(assign);
    take.current = assign;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if (/^[1-9]$/.test(key)) return;
            take.current([key]);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
    return (
        <Prompt
            id="prompt-capture-key"
            eyebrow="Combat binding"
            title={`Press a key for ${COMBAT_LABELS[action]}`}
            hint="A key already in use swaps over; digits stay the squad numbers"
            confirm={{ label: "Default", run: () => assign(DEFAULT_COMBAT_BINDINGS[action]) }}
            cancel={{ label: "Cancel", run: close }}
            glyphs={glyphs}
        >
            Default: <KeyCaps keys={DEFAULT_COMBAT_BINDINGS[action]} cap={keyCap} />.
        </Prompt>
    );
}

// === Controller =============================================================

const g = (...buttons: (PadButton | "dpad" | "ls" | "rs")[]) => buttons.map(padGlyph).join("  ");

const PAD_MENU: [id: string, label: string, caps: () => string, hint: string][] = [
    ["nav", "Navigate", () => g("dpad", "ls"), "Walk the rows"],
    ["change", "Change value", () => "◀  ▶", "Step a choice or a level"],
    ["select", "Select", () => g("a"), "Run the highlighted command"],
    ["back", "Back", () => g("b", "start"), "Close the prompt, or leave the screen"],
    ["tab", "Tab", () => g("lb", "rb"), "Previous or next tab"],
    ["section", "Section", () => g("lt", "rt"), "Previous or next section"],
    ["reset", "Default", () => g("x"), "Return the highlighted setting to its default"],
];

const PAD_FIXED: [id: string, label: string, caps: () => string, hint: string][] = [
    ["cursor", "Cursor / aim", () => g("dpad", "ls"), "Tile cursor, throw nudge, target walk"],
    ["confirm", "Confirm", () => g("a"), "Move, shoot, throw"],
    ["cancel", "Cancel / deselect", () => g("b"), "Leave targeting, deselect, then pause"],
    ["camera", "Camera", () => g("rs"), "Turn and dolly the field"],
    ["pause", "Pause", () => g("start"), "The pause menu, any time"],
];

const PAD_HINTS: Record<PadCombatAction, string> = {
    wheel: "Orders on a ring: fire, grenade, overwatch, hunker, reload, extract",
    "prev-operator": "Select the previous operator",
    "next-operator": "Select the next operator",
    fire: "Raise the weapon at the best target",
    grenade: "Arm a grenade at the default landing point",
    reload: "Fresh magazine for the selected operator",
    grid: "Toggle the grid overlay",
    focus: "Center the camera on the selected operator",
};

/** Hand `button` to `action`; an action already holding it takes the old one: a swap. */
function swapButton(
    binds: Record<PadCombatAction, PadBindable | "">,
    action: PadCombatAction,
    button: PadBindable,
) {
    const next = { ...binds };
    const prev = next[action];
    for (const other of PAD_COMBAT_ACTIONS) {
        if (other !== action && next[other] === button) next[other] = prev;
    }
    next[action] = button;
    return next;
}

export function ControllerPanel() {
    const pad = usePad();
    const [controls, setControls] = useSettingsSection("controls");
    const binds = controls.padCombat;
    const [capturing, setCapturing] = useState<PadCombatAction | null>(null);
    const [testing, setTesting] = useState(false);
    const [restore, setRestore] = useState(false);

    // A disconnect mid-test or mid-capture leaves nothing to listen to.
    useEffect(() => {
        if (pad) return;
        setTesting(false);
        setCapturing(null);
    }, [pad]);

    const noPad = pad ? undefined : "Connect a controller first";
    const overlay = testing ? (
        <ButtonTest close={() => setTesting(false)} />
    ) : capturing ? (
        <PadCapturePrompt
            action={capturing}
            assign={(button) => {
                setControls({ padCombat: swapButton(binds, capturing, button) });
                setCapturing(null);
            }}
            close={() => setCapturing(null)}
        />
    ) : restore ? (
        <RestorePrompt panel="controller" what="Controller" close={() => setRestore(false)} />
    ) : null;

    const fixed = (rows: typeof PAD_FIXED, group: string) =>
        rows.map(([id, label, caps, hint]) => (
            <ValueRow
                key={id}
                id={`pad-${group}-${id}`}
                group="rows"
                label={label}
                value={<PadCaps text={caps()} />}
                title={label}
                hint={group === "fixed" ? `${hint}. Fixed` : hint}
            />
        ));

    return (
        <SettingsFrame overlay={overlay}>
            <Panel label="Controller" className="gset-c2 gset-fit">
                <List label="Controller">
                    <ValueRow
                        id="pad-device"
                        group="rows"
                        label="Device"
                        value={pad ? padName() || "Controller" : "Not connected"}
                        tone={pad ? undefined : "dim"}
                        title="Device"
                        hint={
                            pad
                                ? "Press buttons to see them on the diagram"
                                : "Connect a controller and press any button to wake it"
                        }
                    />
                    <ActionRow
                        id="pad-test"
                        group="rows"
                        label="Test buttons"
                        title="Test buttons"
                        hint="Every press lights the diagram and is named"
                        instant
                        commands={[
                            {
                                action: "confirm",
                                label: "Test",
                                tone: "primary",
                                deny: noPad,
                                run: () => setTesting(true),
                            },
                        ]}
                    />
                    <Stepper
                        id="pad-vibration"
                        group="rows"
                        label="Vibration"
                        options={switchOptions()}
                        value={onOff(controls.vibration)}
                        onChange={(id) => setControls({ vibration: id === "on" })}
                        title="Vibration"
                        commands={[
                            CHANGE,
                            ...toDefault(controls.vibration !== DEFAULTS.controls.vibration, () =>
                                setControls({ vibration: DEFAULTS.controls.vibration }),
                            ),
                        ]}
                    />
                    <Eyebrow>Menus</Eyebrow>
                    {fixed(PAD_MENU, "menu")}
                    <Eyebrow>Combat</Eyebrow>
                    {fixed(PAD_FIXED.slice(0, 3), "fixed")}
                    {PAD_COMBAT_ACTIONS.map((action) => (
                        <ValueRow
                            key={action}
                            id={`pad-bind-${action}`}
                            group="rows"
                            label={PAD_COMBAT_LABELS[action]}
                            value={
                                binds[action] ? (
                                    <PadCaps text={padGlyph(binds[action] as PadBindable)} />
                                ) : (
                                    "Unbound"
                                )
                            }
                            tone={binds[action] ? undefined : "dim"}
                            title={PAD_COMBAT_LABELS[action]}
                            hint={PAD_HINTS[action]}
                            instant
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Rebind",
                                    tone: "primary",
                                    deny: noPad,
                                    run: () => setCapturing(action),
                                },
                                ...toDefault(
                                    binds[action] !== DEFAULT_PAD_COMBAT_BINDINGS[action],
                                    () =>
                                        setControls({
                                            padCombat: {
                                                ...swapButton(
                                                    binds,
                                                    action,
                                                    DEFAULT_PAD_COMBAT_BINDINGS[
                                                        action
                                                    ] as PadBindable,
                                                ),
                                            },
                                        }),
                                ),
                            ]}
                        />
                    ))}
                    {fixed(PAD_FIXED.slice(3), "fixed")}
                    <RestoreRow panel="controller" open={() => setRestore(true)} />
                </List>
            </Panel>
            <Panel variant="ghost" className="gset-c3 gset-diagram-panel">
                <ControllerDiagram binds={binds} pad={pad} className="ctl-svg gset-diagram" />
            </Panel>
        </SettingsFrame>
    );
}

/**
 * Rebinding a pad combat action: a top-priority pad consumer takes the next
 * bindable button (B cancels; the fixed buttons are spent unheard). The
 * keyboard still answers the prompt: Back cancels.
 */
function PadCapturePrompt({
    action,
    assign,
    close,
}: {
    action: PadCombatAction;
    assign: (button: PadBindable) => void;
    close: () => void;
}) {
    const { glyphs } = useSettingsContext();
    const answers = useRef({ assign, close });
    answers.current = { assign, close };
    useEffect(
        () =>
            onPad((p) => {
                if (p.pressed("b")) {
                    answers.current.close();
                    return true;
                }
                for (const b of PAD_BINDABLE) {
                    if (p.pressed(b)) {
                        answers.current.assign(b);
                        return true;
                    }
                }
                return true;
            }, 50),
        [],
    );
    const def = DEFAULT_PAD_COMBAT_BINDINGS[action];
    return (
        <Prompt
            id="prompt-capture-pad"
            eyebrow="Controller binding"
            title={`Press a button for ${PAD_COMBAT_LABELS[action]}`}
            hint={`A button in use swaps over; ${padGlyph("b")} cancels`}
            confirm={{
                label: "Default",
                run: () => (def ? assign(def as PadBindable) : close()),
            }}
            cancel={{ label: "Cancel", run: close }}
            glyphs={glyphs}
        >
            Default: {def ? padGlyph(def as PadBindable) : "unbound"}
        </Prompt>
    );
}

const HOLD_EXIT_MS = 2000;
const STICK_MOVED = 0.5;

/**
 * Button test: every pad input stays here (a top-priority consumer eats each
 * frame; the diagram still lights, since observing is not consuming) and the
 * line names what is held. Exit: hold Start for two seconds, Back on the
 * keyboard, or the Exit command.
 */
function ButtonTest({ close }: { close: () => void }) {
    const [controls] = useSettingsSection("controls");
    const fields = useRef(fieldActions(controls.padCombat));
    const [held, setHeld] = useState<string[]>([]);
    const fill = useRef<HTMLElement | null>(null);
    const exit = useRef(close);
    exit.current = close;
    const back: Command = { action: "back", label: "Exit", run: close };

    useEffect(() => onPad(() => true, 50), []);
    useEffect(() => {
        const label = (control: PadButton | "ls" | "rs") => {
            if (control === "ls") return `${padGlyph("ls")} Cursor / aim`;
            if (control === "rs") return `${padGlyph("rs")} Camera`;
            const action = fields.current.get(control);
            return action ? `${padGlyph(control)} ${action}` : padGlyph(control);
        };
        let holdFrom = 0;
        let prevKey = "";
        // The fill width is written per frame outside React, not a CSS
        // animation, so reduce-motion still shows the progress.
        return observePad((snap) => {
            const active: (PadButton | "ls" | "rs")[] = heldPadButtons(snap);
            if (Math.hypot(snap.axes[0] ?? 0, snap.axes[1] ?? 0) > STICK_MOVED) active.push("ls");
            if (Math.hypot(snap.axes[2] ?? 0, snap.axes[3] ?? 0) > STICK_MOVED) active.push("rs");
            const key = active.join(" ");
            if (key !== prevKey) {
                prevKey = key;
                setHeld(active.map(label));
            }
            if (active.includes("start")) {
                const now = performance.now();
                if (!holdFrom) holdFrom = now;
                const t = Math.min(1, (now - holdFrom) / HOLD_EXIT_MS);
                if (fill.current) fill.current.style.width = `${t * 100}%`;
                if (t >= 1) exit.current();
            } else {
                holdFrom = 0;
                if (fill.current) fill.current.style.width = "0%";
            }
        });
    }, []);

    return (
        <FocusScope id="button-test" back={back} modal>
            <div className="gui-scrim" aria-hidden />
            <TestBlock held={held} fill={fill} back={back} />
        </FocusScope>
    );
}

function TestBlock({
    held,
    fill,
    back,
}: {
    held: string[];
    fill: RefObject<HTMLElement | null>;
    back: Command;
}) {
    const { props } = useFocusable<HTMLDivElement>({
        id: "button-test-block",
        group: "prompt",
        title: "Button test",
        hint: `Hold ${padGlyph("start")} to exit`,
        commands: [back],
    });
    return (
        <div className="gui-prompt-wrap">
            <div
                role="alertdialog"
                aria-modal="true"
                aria-label="Button test"
                className="gui-prompt gset-test"
                {...props}
                onClick={undefined}
            >
                <span className="gui-prompt-eyebrow">Controller</span>
                <h2 className="gui-prompt-title">Button test</h2>
                <p className="gset-test-line" data-idle={held.length === 0 || undefined}>
                    {held.length ? held.join("  ·  ") : "Press any control"}
                </p>
                <span className="gset-test-hold" aria-hidden>
                    <i ref={fill} />
                </span>
            </div>
        </div>
    );
}

// === Network ================================================================

export function NetworkPanel() {
    const { rpc, glyphs, account } = useSettingsContext();
    const [editing, setEditing] = useState(false);
    const [reloadAsk, setReloadAsk] = useState(false);
    const { view } = rpc;
    const testing = view.busy;

    const askReload = () => setReloadAsk(true);
    const overlay = editing ? (
        <EndpointPrompt close={() => setEditing(false)} />
    ) : reloadAsk ? (
        <Prompt
            id="prompt-reload"
            eyebrow="Fullnode endpoint"
            title="Reload now?"
            hint="Later keeps the current endpoint until the next reload"
            confirm={{ label: "Reload", run: () => location.reload() }}
            cancel={{ label: "Later", run: () => setReloadAsk(false) }}
            glyphs={glyphs}
        >
            The saved endpoint applies after a reload
        </Prompt>
    ) : null;

    const status = testing ? (
        <StatusChip label="Endpoint" value="Testing" state="busy" />
    ) : view.unsaved ? (
        <StatusChip label="Endpoint" value="Unsaved" tone="warn" />
    ) : view.reload ? (
        <StatusChip label="Endpoint" value="Reload to apply" tone="warn" />
    ) : null;

    return (
        <SettingsFrame status={status} overlay={overlay} line={view.line}>
            <Panel label="Fullnode endpoint" className="gset-c2 gset-fit">
                <List label="Fullnode endpoint">
                    <ValueRow
                        id="net-endpoint"
                        group="rows"
                        label="Endpoint"
                        value={rpc.draft.trim() || "Default"}
                        tone={!view.check.ok ? "warn" : rpc.draft.trim() ? undefined : "dim"}
                        title="Fullnode RPC URL"
                        hint={`Optional; empty uses the public ${account.network} fullnode`}
                        instant
                        commands={[
                            {
                                action: "confirm",
                                label: "Edit",
                                tone: "primary",
                                deny: testing ? "Testing" : undefined,
                                run: () => setEditing(true),
                            },
                            ...(rpc.saved || rpc.draft
                                ? [
                                      {
                                          action: "reset",
                                          label: "Default",
                                          deny: view.resetDeny,
                                          run: () => {
                                              const wasSaved = !!rpc.saved;
                                              rpc.reset();
                                              if (wasSaved) askReload();
                                          },
                                      } satisfies Command,
                                  ]
                                : []),
                        ]}
                    />
                    <ActionRow
                        id="net-test"
                        group="rows"
                        label="Test"
                        title="Test"
                        hint={`Ask the endpoint which network it serves; it must be ${account.network}`}
                        instant
                        commands={[
                            {
                                action: "confirm",
                                label: "Test",
                                tone: "primary",
                                deny: view.testDeny,
                                run: () => void rpc.test(),
                            },
                        ]}
                    />
                    <ActionRow
                        id="net-save"
                        group="rows"
                        label="Save"
                        title="Save"
                        hint="Tested first; a different network is refused"
                        commands={[
                            {
                                action: "confirm",
                                label: "Save",
                                tone: "primary",
                                deny: view.saveDeny,
                                run: () =>
                                    void rpc.save().then((ok) => {
                                        if (ok) askReload();
                                    }),
                            },
                        ]}
                    />
                    {view.reload && (
                        <ActionRow
                            id="net-reload"
                            group="rows"
                            label="Reload"
                            title="Reload"
                            hint="Applies the saved endpoint"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Reload",
                                    tone: "primary",
                                    run: () => location.reload(),
                                },
                            ]}
                        />
                    )}
                </List>
            </Panel>
            <Panel variant="ghost" className="gset-c3 gset-fit">
                <ReadoutLine label="Network">{account.network}</ReadoutLine>
                <ReadoutLine label="In use">{endpointHost(rpc.active)}</ReadoutLine>
                <ReadoutLine label="Saved" empty={!rpc.saved}>
                    {rpc.saved ? endpointHost(rpc.saved) : "Default"}
                </ReadoutLine>
            </Panel>
        </SettingsFrame>
    );
}

/** Typing the URL: the keyboard types and pastes; a pad can only keep it or reset it. */
function EndpointPrompt({ close }: { close: () => void }) {
    const { rpc, glyphs, account } = useSettingsContext();
    const [value, setValue] = useState(rpc.draft);
    const check = validateRpcUrl(value);
    const done = () => {
        if (!check.ok) return;
        rpc.edit(value.trim());
        close();
    };
    return (
        <Prompt
            id="prompt-endpoint"
            eyebrow="Fullnode endpoint"
            title="Set the endpoint?"
            hint="Empty uses the public fullnode"
            confirm={{ label: "Done", deny: check.ok ? undefined : check.error, run: done }}
            cancel={{ label: "Cancel", run: close }}
            glyphs={glyphs}
        >
            https only (http for localhost); it must serve {account.network}.
            <TextField
                label="URL"
                value={value}
                maxLength={512}
                onChange={setValue}
                onSubmit={done}
            />
        </Prompt>
    );
}
