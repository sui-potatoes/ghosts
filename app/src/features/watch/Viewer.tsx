// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match viewer: the encounter mounted with no seat (`<Encounter
 * observer>`), and over it the transport in the shared interface language.
 * The field plays a record source; the controls drive its playback: play and
 * pause, four speeds, previous and next turn, the scrubber's turns, restart,
 * and Live for a match still being played. `/watch/<game>` (`ChainWatch.tsx`)
 * opens a match on chain, live or finished, in this `Viewer`.
 *
 * Input: the cursor runs over the transport (arrows, d-pad, mouse, touch);
 * the bumpers step turns and the triggers the speed; the keyboard's own keys
 * are in `model.ts` (`WATCH_KEYS`). The camera keeps every binding it has in
 * a game: the engine takes those keys first.
 */

import {
    Encounter,
    openMatchCard,
    type IntelSource,
    type Playback,
    type PlaybackState,
    type RecordSource,
    type WatchOutcome,
} from "@ghosts/engine";
import type { Recruit } from "@ghosts/squad/types";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { engineSettings } from "../../engineSettings";
import { onAction, onKeys } from "../../input";
import { PauseMenu } from "../../PauseMenu";
import {
    ContextMenu,
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    Glyph,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
    type GlyphSet,
} from "../../ui";
import type { Action } from "../../settings/keys";
import {
    banner,
    bannerAction,
    cycleSpeed,
    JUMP_TURNS,
    jumpTarget,
    keyCap,
    liveChip,
    matchCard,
    readoutNote,
    sceneEnding,
    type CardFacts,
    pipHint,
    pipsOf,
    pipTitle,
    scrubWindow,
    speedLabel,
    spectatorEntries,
    transportKeys,
    turnReadout,
    WATCH_KEYS,
    type Pip,
    type WatchKey,
} from "./model";
import "./watch.css";

/** What the viewer can do besides playing: share the match, open its replay once it is over. */
export interface ViewerExtras {
    /** The link to share (`/watch/<game>`): a Copy link control. */
    link?: string;
    /** The match's page on the block explorer: an Explorer entry in the menu. */
    explorer?: string;
    /** What the match card says beyond the events: mode, level, when it was played. */
    facts?: CardFacts;
    /** The turns in a row each side had let run out as each turn ended, by turn (a replay's). */
    missed?: readonly number[];
    /** Open on the match card and hold the replay until Play (a finished match opened as a replay). */
    hold?: boolean;
    /** Open the game's replay, offered once a live game is over. */
    onReplay?: () => void;
}

const NO_SUBSCRIBE = () => () => {};

/** The field playing a record source, and the transport over it. */
export function Viewer({
    source,
    start,
    squad,
    intel,
    leave,
    extras = {},
}: {
    source: RecordSource;
    start: "start" | "live";
    /** Side 0's recruits, for their faces, names and armor. */
    squad: readonly Recruit[] | null;
    intel: IntelSource;
    leave: () => void;
    extras?: ViewerExtras;
}) {
    const [playback, setPlayback] = useState<Playback | null>(null);
    const playbackRef = useRef<Playback | null>(null);
    /** The match card is up: the transport's keys stand still behind it, as behind the menu. */
    const [cardOpen, setCardOpen] = useState(!!extras.hold);
    const latest = useRef({ extras, leave, source });
    latest.current = { extras, leave, source };
    const observer = useMemo(
        () => ({
            source,
            start,
            hold: !!extras.hold,
            onPlayback: (next: Playback) => {
                playbackRef.current = next;
                setPlayback(next);
            },
            // Read each time the card opens: who played, how it ended, as the match stands.
            card: () => {
                const state = playbackRef.current?.getState();
                return matchCard({
                    live: !!state?.growing,
                    sides: source.sides,
                    turns: state?.turns ?? [],
                    outcome: source.outcome?.() ?? state?.outcome ?? null,
                    over: !state?.growing,
                    facts: latest.current.extras.facts,
                    now: Date.now(),
                });
            },
            // The playback at its end: the header says who won, and the status line why.
            ending: (state: PlaybackState) =>
                sceneEnding(
                    {
                        finished: state.finished,
                        outcome: state.outcome ?? source.outcome?.() ?? null,
                    },
                    source.sides,
                ),
            onPlay: () => playbackRef.current?.play(),
            onExit: () => latest.current.leave(),
            onCardClose: () => setCardOpen(false),
        }),
        // The extras and `leave` are read through `latest`: the encounter is built once per source.
        [source, start],
    );
    // The card is a native dialog: while it is up the transport's cursor behind it takes no action,
    // and Enter or Space presses the card's focused button.
    useEffect(() => {
        if (!cardOpen) return;
        return onAction((action) => {
            if (action !== "confirm") return true;
            const el = document.activeElement;
            if (el instanceof HTMLElement && el.closest("dialog[open]")) el.click();
            return true;
        });
    }, [cardOpen]);
    const growing = useSyncExternalStore(
        playback?.subscribe ?? NO_SUBSCRIBE,
        () => playback?.getState().growing ?? false,
    );
    /** The menu over the field. The playback is not touched: it plays on as it was. */
    const [menu, setMenu] = useState(false);
    const copy = useCopyLink(extras.link);
    const { explorer } = extras;
    return (
        <div className="watch-screen">
            <Encounter
                observer={observer}
                squad={squad}
                intel={intel}
                settings={engineSettings}
                paused={menu}
                onPause={() => setMenu(true)}
            />
            <FocusRoot
                back={{ action: "back", label: "Menu", run: () => setMenu(true) }}
                onTab={(step) => (step > 0 ? playback?.nextTurn() : playback?.prevTurn())}
                onSection={(step) => playback?.stepSpeed(step)}
            >
                {playback && (
                    <Controls
                        playback={playback}
                        sides={source.sides}
                        outcome={() => source.outcome?.() ?? null}
                        leave={leave}
                        extras={extras}
                        copy={copy}
                        menuOpen={menu || cardOpen}
                        openMenu={() => setMenu(true)}
                    />
                )}
            </FocusRoot>
            <PauseMenu
                open={menu}
                onResume={() => setMenu(false)}
                quitLabel="Leave"
                onQuit={leave}
                eyebrow={growing ? "Live" : "Replay"}
                title="Spectating"
                briefingLabel="Match details"
                onBriefing={() => {
                    openMatchCard();
                    setMenu(false);
                    setCardOpen(true);
                }}
                extra={spectatorEntries({
                    link: !!extras.link,
                    explorer: !!explorer,
                    copied: copy.copied,
                }).map((entry) => ({
                    ...entry,
                    run:
                        entry.id === "link"
                            ? copy.run
                            : () => window.open(explorer, "_blank", "noopener,noreferrer"),
                }))}
            />
        </div>
    );
}

/** A transport glyph: the keyboard's fixed key, or the pad's menu button for the same command. */
function Shortcut({ keyName, pad, glyphs }: { keyName: WatchKey; pad?: Action; glyphs: GlyphSet }) {
    if (glyphs !== "keys") return pad ? <Glyph action={pad} set={glyphs} /> : null;
    return (
        <kbd className="gui-glyph" data-shape="key">
            {keyCap(WATCH_KEYS[keyName])}
        </kbd>
    );
}

/** Stroke pictograms for the transport, in the kit's 16-unit box. */
const PATHS = {
    play: "M5 3.5l7.5 4.5-7.5 4.5z",
    pause: "M5 3.5v9M11 3.5v9",
    prev: "M3.5 3.5v9M12.5 3.5l-6.5 4.5 6.5 4.5z",
    next: "M12.5 3.5v9M3.5 3.5l6.5 4.5-6.5 4.5z",
    again: "M3 8a5 5 0 1 0 1.5-3.5M3 2.5v3h3",
    menu: "M3 4.5h10M3 8h10M3 11.5h10",
    link: "M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.6 3.6L10.6 8M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.6-3.6L5.4 8",
};

function Pictogram({ name }: { name: keyof typeof PATHS }) {
    return (
        <svg className="watch-icon" viewBox="0 0 16 16" aria-hidden>
            <path d={PATHS[name]} />
        </svg>
    );
}

type ButtonProps = {
    id: string;
    group: string;
    title: string;
    hint?: string;
    commands: Command[];
    children: ReactNode;
    tone?: "live" | "following";
};

/** One transport control: a cursor target whose click runs it at once. */
function TransportButton({ id, group, title, hint, commands, children, tone }: ButtonProps) {
    const { props } = useFocusable<HTMLButtonElement>({
        id,
        group,
        title,
        hint,
        commands,
        instant: true,
    });
    return (
        <button
            type="button"
            tabIndex={-1}
            className="watch-button"
            data-tone={tone}
            aria-label={title}
            {...props}
        >
            {children}
        </button>
    );
}

function PipButton({
    pip,
    title,
    hint,
    run,
}: {
    pip: Pip;
    title: string;
    hint: string;
    run: () => void;
}) {
    const { props, focused } = useFocusable<HTMLButtonElement>({
        id: `watch-pip-${pip.index}`,
        group: "scrubber",
        title,
        hint,
        instant: true,
        commands: [{ action: "confirm", label: "Go to turn", tone: "primary", run }],
    });
    const ref = props.ref;
    useEffect(() => {
        if (focused || pip.current)
            ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [focused, pip.current, ref]);
    return (
        <button
            type="button"
            tabIndex={-1}
            className="watch-pip"
            data-side={pip.side}
            data-here={pip.current || undefined}
            data-past={pip.past || undefined}
            data-edge={pip.edge || undefined}
            data-kill={pip.kills > 0 || undefined}
            aria-label={title}
            {...props}
        >
            <span>{pip.number}</span>
        </button>
    );
}

/** Copy link: whether the last copy landed on the clipboard (refused, the link is shown to copy by hand). */
function useCopyLink(link: string | undefined) {
    const [copied, setCopied] = useState<"idle" | "copied" | "refused">("idle");
    useEffect(() => {
        if (copied !== "copied") return;
        const timer = window.setTimeout(() => setCopied("idle"), 2000);
        return () => window.clearTimeout(timer);
    }, [copied]);
    const run = () => {
        if (!link) return;
        const done = () => setCopied("copied");
        const refused = () => setCopied(copyByHand(link) ? "copied" : "refused");
        if (navigator.clipboard) void navigator.clipboard.writeText(link).then(done, refused);
        else refused();
    };
    return { copied, run };
}

function Controls({
    playback,
    sides,
    outcome,
    leave,
    extras,
    copy,
    menuOpen,
    openMenu,
}: {
    playback: Playback;
    sides: RecordSource["sides"];
    /** How the match ended as its source tells it (null while it goes on). */
    outcome: () => WatchOutcome | null;
    leave: () => void;
    extras: ViewerExtras;
    copy: ReturnType<typeof useCopyLink>;
    /** The menu (or the settings over it) is up: the transport's keys stand still. */
    menuOpen: boolean;
    openMenu: () => void;
}) {
    const state = useSyncExternalStore(playback.subscribe, playback.getState);
    const glyphs = useGlyphSet();
    const store = useFocusStore();
    const root = useRef<HTMLElement | null>(null);
    const readout = turnReadout(state, sides);
    const chip = liveChip(state);
    const end = banner(state, sides);
    const again = bannerAction(!!extras.onReplay);
    const note = readoutNote(state, sides, outcome(), extras.missed);
    const strip = scrubWindow(pipsOf(state), state.turn);
    const { copied, run: copyLink } = copy;
    const link = extras.link;

    // The keyboard's transport keys, above the menu actions (Space plays and pauses from anywhere).
    useEffect(() => onKeys(transportKeys(playback, menuOpen)), [playback, menuOpen]);

    // The match over: the cursor goes to the banner's first choice.
    useEffect(() => {
        if (state.finished) store.focus("watch-replay", false);
    }, [state.finished, store]);

    const restart: Command = { action: "reset", label: "Restart", run: () => playback.restart() };
    return (
        <main ref={root} className="gui ui-zoom watch-hud">
            {end && (
                <section className="watch-banner" aria-live="polite">
                    <span className="watch-banner-eyebrow">Match over</span>
                    <strong className="watch-banner-title">{end.title}</strong>
                    <span className="watch-banner-reason">{end.reason}</span>
                    <span className="watch-banner-line">{end.line}</span>
                    <div className="watch-banner-actions">
                        <TransportButton
                            id="watch-replay"
                            group="banner"
                            title={again}
                            commands={[
                                {
                                    action: "confirm",
                                    label: again,
                                    tone: "primary",
                                    // A live match that ended opens its recording; a replay starts over.
                                    run: extras.onReplay ?? (() => playback.restart()),
                                },
                            ]}
                        >
                            <Pictogram name="again" />
                            <span>{again}</span>
                        </TransportButton>
                        <TransportButton
                            id="watch-leave"
                            group="banner"
                            title="Leave"
                            commands={[{ action: "confirm", label: "Leave", run: leave }]}
                        >
                            <span>Leave</span>
                        </TransportButton>
                    </div>
                </section>
            )}
            {note && (
                <p className="watch-note" role="status">
                    {note}
                </p>
            )}
            <section className="watch-transport" aria-label="Playback">
                <div className="watch-buttons">
                    <TransportButton
                        id="watch-prev"
                        group="transport"
                        title="Previous turn"
                        commands={[
                            {
                                action: "confirm",
                                label: "Previous turn",
                                run: () => playback.prevTurn(),
                            },
                        ]}
                    >
                        <Pictogram name="prev" />
                        <Shortcut keyName="prev" pad="prev-tab" glyphs={glyphs} />
                    </TransportButton>
                    <TransportButton
                        id="watch-play"
                        group="transport"
                        title={state.playing ? "Pause" : state.growing ? "Watch" : "Play"}
                        commands={[
                            restart,
                            {
                                action: "confirm",
                                label: state.playing ? "Pause" : state.growing ? "Watch" : "Play",
                                tone: "primary",
                                run: () => playback.toggle(),
                            },
                        ]}
                    >
                        <Pictogram name={state.playing ? "pause" : "play"} />
                        <Shortcut keyName="toggle" glyphs={glyphs} />
                    </TransportButton>
                    <TransportButton
                        id="watch-next"
                        group="transport"
                        title="Next turn"
                        commands={[
                            {
                                action: "confirm",
                                label: "Next turn",
                                run: () => playback.nextTurn(),
                            },
                        ]}
                    >
                        <Pictogram name="next" />
                        <Shortcut keyName="next" pad="next-tab" glyphs={glyphs} />
                    </TransportButton>
                    <TransportButton
                        id="watch-speed"
                        group="transport"
                        title={`Speed ${speedLabel(state.speed)}`}
                        commands={[
                            { action: "reset", label: "1x", run: () => playback.setSpeed(1) },
                            {
                                action: "confirm",
                                label: `Speed ${speedLabel(cycleSpeed(state.speed))}`,
                                run: () => playback.setSpeed(cycleSpeed(state.speed)),
                            },
                        ]}
                    >
                        <span className="watch-speed">{speedLabel(state.speed)}</span>
                        <Shortcut keyName="faster" pad="next-section" glyphs={glyphs} />
                    </TransportButton>
                </div>
                <div className="watch-readout">
                    <span className="watch-readout-turn">{readout.turn}</span>
                    <span className="watch-readout-side">{readout.side}</span>
                </div>
                <div className="watch-scrubber" role="group" aria-label="Turns">
                    {strip.earlier > 0 && (
                        <TransportButton
                            id="watch-back"
                            group="scrubber"
                            title={`Back ${JUMP_TURNS} turns`}
                            commands={[
                                {
                                    action: "confirm",
                                    label: `Back ${JUMP_TURNS} turns`,
                                    run: () =>
                                        playback.jump(jumpTarget(state.turns, state.turn, -1)),
                                },
                            ]}
                        >
                            <span className="watch-jump">−{JUMP_TURNS}</span>
                        </TransportButton>
                    )}
                    {strip.pips.map((pip) => (
                        <PipButton
                            key={pip.index}
                            pip={pip}
                            title={pipTitle(pip, sides)}
                            hint={pipHint(pip)}
                            run={() => playback.jump(pip.index)}
                        />
                    ))}
                    {strip.later > 0 && (
                        <TransportButton
                            id="watch-ahead"
                            group="scrubber"
                            title={`Ahead ${JUMP_TURNS} turns`}
                            commands={[
                                {
                                    action: "confirm",
                                    label: `Ahead ${JUMP_TURNS} turns`,
                                    run: () =>
                                        playback.jump(jumpTarget(state.turns, state.turn, 1)),
                                },
                            ]}
                        >
                            <span className="watch-jump">+{JUMP_TURNS}</span>
                        </TransportButton>
                    )}
                </div>
                {!chip && (
                    <span className="watch-button watch-mode" data-tone="replay">
                        Replay
                    </span>
                )}
                {chip && (
                    <TransportButton
                        id="watch-live"
                        group="live"
                        title={chip.following ? "Following the match" : "Back to live"}
                        tone={chip.following ? "following" : "live"}
                        commands={[
                            chip.following
                                ? {
                                      action: "confirm",
                                      label: "Live",
                                      deny: "Already following the match",
                                  }
                                : {
                                      action: "confirm",
                                      label: "Back to live",
                                      tone: "primary",
                                      run: () => playback.goLive(),
                                  },
                        ]}
                    >
                        <i className="watch-live-dot" aria-hidden />
                        <span>{chip.label}</span>
                        {!chip.following && <Shortcut keyName="live" glyphs={glyphs} />}
                    </TransportButton>
                )}
                {link && (
                    <TransportButton
                        id="watch-link"
                        group="share"
                        title={copied === "copied" ? "Link copied" : "Copy link"}
                        hint={copied === "refused" ? link : undefined}
                        tone={copied === "copied" ? "following" : undefined}
                        commands={[{ action: "confirm", label: "Copy link", run: copyLink }]}
                    >
                        <Pictogram name="link" />
                        <span className="watch-link-label">
                            {copied === "copied" ? "Copied" : "Link"}
                        </span>
                    </TransportButton>
                )}
                <TransportButton
                    id="watch-menu"
                    group="share"
                    title="Menu"
                    commands={[{ action: "confirm", label: "Menu", run: openMenu }]}
                >
                    <Pictogram name="menu" />
                    <span className="watch-link-label">Menu</span>
                </TransportButton>
            </section>
            <FocusCommandBar glyphs={glyphs} />
            <ContextMenu root={root} />
            <FocusCursor root={root} />
        </main>
    );
}

/** The older way to copy, for a browser that refuses the clipboard API: true when it took. */
function copyByHand(text: string): boolean {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        field.remove();
    }
}
