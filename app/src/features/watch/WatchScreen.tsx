// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match viewer: the encounter mounted with no seat (`<Encounter
 * observer>`), and over it the transport in the shared interface language.
 * The field plays a record source; the controls drive its playback: play and
 * pause, four speeds, previous and next turn, the scrubber's turns, restart,
 * and Live for a game still being played. `/watch/local/:id` replays a game
 * recorded on the device; `/watch/qa/:id` (QA builds) plays one as if live.
 *
 * Input: the cursor runs over the transport (arrows, d-pad, mouse, touch);
 * the bumpers step turns and the triggers the speed; the keyboard's own keys
 * are in `model.ts` (`WATCH_KEYS`). The camera keeps every binding it has in
 * a game: the engine takes those keys first.
 */

import { deployedIntel, Encounter, type Playback, type RecordSource } from "@ghosts/engine";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { engineSettings } from "../../engineSettings";
import { useGoUp } from "../../hooks/useGoUp";
import { onKeys } from "../../input";
import {
    ContextMenu,
    EmptyState,
    FocusCommandBar,
    FocusCursor,
    FocusRoot,
    Glyph,
    ScreenFrame,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
    type GlyphSet,
} from "../../ui";
import type { Action } from "../../settings/keys";
import { paceOf } from "./drip";
import { deviceStorage, journalById, type LocalJournal } from "./journal";
import {
    banner,
    cycleSpeed,
    keyCap,
    liveChip,
    pipHint,
    pipsOf,
    pipTitle,
    speedLabel,
    turnReadout,
    WATCH_KEYS,
    type Pip,
    type WatchKey,
} from "./model";
import { growingSource, localSource, type GrowingSource } from "./sources";
import "./watch.css";

type Opened = { journal: LocalJournal; source: RecordSource | GrowingSource };

function open(id: string | undefined, live: boolean): Opened | null {
    const journal = id ? journalById(deviceStorage(), id) : null;
    if (!journal) return null;
    const pace = paceOf(new URLSearchParams(window.location.search).get("pace"));
    const source = live ? growingSource(journal, pace) : localSource(journal);
    return source && { journal, source };
}

export default function WatchScreen({ live = false }: { live?: boolean }) {
    const { id } = useParams();
    // Read once per mount: the recording as it was when the viewer opened.
    const [opened] = useState(() => open(id, live));
    const leave = useGoUp();

    // A growing source starts with the viewer's playback; it stops when the viewer goes.
    useEffect(() => {
        const source = opened?.source;
        if (source && "stop" in source) return () => source.stop();
    }, [opened]);

    if (!opened) return <Missing leave={leave} />;
    return <Viewer opened={opened} live={live} leave={leave} />;
}

function Viewer({ opened, live, leave }: { opened: Opened; live: boolean; leave: () => void }) {
    const [playback, setPlayback] = useState<Playback | null>(null);
    const observer = useMemo(
        () => ({
            source: opened.source,
            start: live ? ("live" as const) : ("start" as const),
            onPlayback: setPlayback,
        }),
        [opened, live],
    );
    return (
        <div className="watch-screen">
            <Encounter
                observer={observer}
                squad={opened.journal.squad}
                intel={deployedIntel}
                settings={engineSettings}
            />
            <FocusRoot
                back={{ action: "back", label: "Leave", run: leave }}
                onTab={(step) => (step > 0 ? playback?.nextTurn() : playback?.prevTurn())}
                onSection={(step) => playback?.stepSpeed(step)}
            >
                {playback && (
                    <Controls playback={playback} sides={opened.source.sides} leave={leave} />
                )}
            </FocusRoot>
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

function Controls({
    playback,
    sides,
    leave,
}: {
    playback: Playback;
    sides: RecordSource["sides"];
    leave: () => void;
}) {
    const state = useSyncExternalStore(playback.subscribe, playback.getState);
    const glyphs = useGlyphSet();
    const store = useFocusStore();
    const root = useRef<HTMLElement | null>(null);
    const readout = turnReadout(state, sides);
    const chip = liveChip(state);
    const end = banner(state, sides);
    const pips = pipsOf(state);

    // The keyboard's transport keys, above the menu actions (Space plays and pauses from anywhere).
    useEffect(
        () =>
            onKeys({
                [WATCH_KEYS.toggle]: () => playback.toggle(),
                [WATCH_KEYS.prev]: () => playback.prevTurn(),
                [WATCH_KEYS.next]: () => playback.nextTurn(),
                [WATCH_KEYS.slower]: () => playback.stepSpeed(-1),
                [WATCH_KEYS.faster]: () => playback.stepSpeed(1),
                "+": () => playback.stepSpeed(1),
                [WATCH_KEYS.live]: () => (playback.getState().growing ? playback.goLive() : false),
                [WATCH_KEYS.restart]: () => playback.restart(),
            }),
        [playback],
    );

    // The game over: the cursor goes to the banner's first choice.
    useEffect(() => {
        if (state.finished) store.focus("watch-again", false);
    }, [state.finished, store]);

    const restart: Command = { action: "reset", label: "Restart", run: () => playback.restart() };
    return (
        <main ref={root} className="gui ui-zoom watch-hud">
            {end && (
                <section className="watch-banner" aria-live="polite">
                    <span className="watch-banner-eyebrow">Game over</span>
                    <strong className="watch-banner-title">{end.title}</strong>
                    <span className="watch-banner-line">{end.line}</span>
                    <div className="watch-banner-actions">
                        <TransportButton
                            id="watch-again"
                            group="banner"
                            title="Watch again"
                            hint="From the first turn"
                            commands={[
                                {
                                    action: "confirm",
                                    label: "Watch again",
                                    tone: "primary",
                                    run: () => playback.restart(),
                                },
                            ]}
                        >
                            <Pictogram name="again" />
                            <span>Watch again</span>
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
            <section className="watch-transport" aria-label="Playback">
                <div className="watch-buttons">
                    <TransportButton
                        id="watch-prev"
                        group="transport"
                        title="Previous turn"
                        hint="The start of the turn before"
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
                        title={state.playing ? "Pause" : "Play"}
                        hint={
                            state.playing
                                ? "Holds the field; the camera stays free"
                                : "Plays from here"
                        }
                        commands={[
                            restart,
                            {
                                action: "confirm",
                                label: state.playing ? "Pause" : "Play",
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
                        hint="The start of the turn after"
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
                        hint={state.speed > 1 ? "Voices are off above 1x" : "0.5x, 1x, 2x or 4x"}
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
                    {pips.map((pip) => (
                        <PipButton
                            key={pip.index}
                            pip={pip}
                            title={pipTitle(pip, sides)}
                            hint={pipHint(pip)}
                            run={() => playback.jump(pip.index)}
                        />
                    ))}
                </div>
                {chip && (
                    <TransportButton
                        id="watch-live"
                        group="live"
                        title={chip.following ? "Following the game" : "Back to live"}
                        hint={chip.following ? "New events play as they happen" : chip.hint}
                        tone={chip.following ? "following" : "live"}
                        commands={[
                            chip.following
                                ? {
                                      action: "confirm",
                                      label: "Live",
                                      deny: "Already following the game",
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
            </section>
            <FocusCommandBar glyphs={glyphs} />
            <ContextMenu root={root} />
            <FocusCursor root={root} />
        </main>
    );
}

/** The recording asked for is not on this device (cleared, or a link from elsewhere). */
function Missing({ leave }: { leave: () => void }) {
    return (
        <FocusRoot back={{ action: "back", label: "Leave", run: leave }}>
            <MissingFrame leave={leave} />
        </FocusRoot>
    );
}

function MissingFrame({ leave }: { leave: () => void }) {
    const glyphs = useGlyphSet();
    return (
        <ScreenFrame
            location={["Watch", "Recording"]}
            onLocation={leave}
            commands={<FocusCommandBar glyphs={glyphs} />}
        >
            <EmptyState
                id="watch-missing"
                group="missing"
                headline="This recording is not on this device"
                action="Recorded games"
                commands={[
                    { action: "confirm", label: "Recorded games", tone: "primary", run: leave },
                ]}
            >
                Recordings stay on the device they were played on.
            </EmptyState>
        </ScreenFrame>
    );
}
