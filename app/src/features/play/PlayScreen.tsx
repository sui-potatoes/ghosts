// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play`: the ways to play as cards. Ranked, friendly and contract open their
 * screens; faction wars is shown inactive with its reason. A search, a lobby or a
 * game in progress leads its own card back to it and holds the others with a
 * reason. Everything here is the shared interface language (`src/ui/`): the
 * cards are cursor targets, the bar names the focused card's command, Back
 * returns to the title. No wallet is needed to open it.
 */

import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useMatchSearch } from "../../chain";
import { useGame } from "../../chain/game";
import { useGoUp } from "../../hooks/useGoUp";
import { usePlayerName } from "../../hooks/usePlayerName";
import {
    FocusCommandBar,
    FocusRoot,
    ScreenFrame,
    StatusChip,
    useFocusable,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../ui";
import { ModeArt } from "./icons";
import { modeCards, rankedFacts, type Busy, type ModeCard, type PlayMode } from "./model";
import type { Standing } from "./rating";
import { useStanding } from "./useStanding";
import "./play.css";

/** In `VITE_RANKED_QA=1` builds, `?busy=ranked|contract|lobby|playing` stands in for the account. */
function qaBusy(): Busy | undefined {
    if (!import.meta.env.VITE_RANKED_QA) return undefined;
    const busy = new URLSearchParams(window.location.search).get("busy");
    if (busy === "ranked" || busy === "contract") return { kind: "searching", mode: busy };
    if (busy === "lobby") return { kind: "lobby" };
    if (busy === "playing") return { kind: "playing", mode: "ranked" };
    return undefined;
}

/** What the player is busy with, from the search and the game they are in. */
function useBusy(): Busy {
    const { searching, lobby, playing } = useMatchSearch();
    const game = useGame(playing).data;
    const qa = qaBusy();
    if (qa !== undefined) return qa;
    if (playing) {
        const kind = game?.mode.$kind;
        const mode: PlayMode | null =
            kind === "Ranked"
                ? "ranked"
                : kind === "Friendly"
                  ? "friendly"
                  : kind === "Stakes"
                    ? "contract"
                    : null;
        return { kind: "playing", mode };
    }
    if (lobby) return { kind: "lobby" };
    if (searching)
        return { kind: "searching", mode: searching.kind === "ranked" ? "ranked" : "contract" };
    return null;
}

export default function PlayScreen() {
    const leave = useGoUp();
    const glyphs = useGlyphSet();
    const { standing } = useStanding();
    const { name } = usePlayerName();
    const busy = useBusy();
    const back: Command = { action: "back", label: "Menu", run: leave };
    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Menu", "Play"]}
                onLocation={leave}
                status={
                    <>
                        {name && <StatusChip label="Player" value={name} />}
                        <StatusChip
                            label="Rating"
                            value={`${standing.rating} · ${standing.tier.name}`}
                        />
                    </>
                }
                columns="minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <Cards standing={standing} busy={busy} />
            </ScreenFrame>
        </FocusRoot>
    );
}

const NAV: Command = { action: "nav", label: "Move", glyph: "lr" };

/** The card the cursor starts on: the mode the player is busy in, else ranked. */
function startCard(busy: Busy): string {
    if (busy?.kind === "lobby") return "play-friendly";
    if (busy?.kind === "searching") return `play-${busy.mode}`;
    if (busy?.kind === "playing" && busy.mode) return `play-${busy.mode}`;
    return "play-ranked";
}

function Cards({ standing, busy }: { standing: Standing; busy: Busy }) {
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus(startCard(busy), false);
        // Once, on arrival.
    }, [store]);
    return (
        <div className="gui-play">
            <div className="gui-play-cards" role="list">
                {modeCards(busy).map((card) => (
                    <Card key={card.id} card={card} standing={standing} />
                ))}
            </div>
        </div>
    );
}

function Card({ card, standing }: { card: ModeCard; standing: Standing }) {
    const navigate = useNavigate();
    const { props } = useFocusable<HTMLButtonElement>({
        id: `play-${card.id}`,
        group: "modes",
        title: card.name,
        hint: card.locked ?? card.hint,
        commands: [
            NAV,
            {
                action: "confirm",
                label: card.verb,
                tone: card.locked ? undefined : "primary",
                deny: card.locked,
                run: () => card.route && navigate(card.route),
            },
        ],
        instant: !card.locked,
    });
    const facts = card.id === "ranked" ? rankedFacts(standing) : null;
    return (
        <button
            type="button"
            tabIndex={-1}
            role="listitem"
            className="gui-play-card"
            data-mode={card.id}
            {...props}
        >
            <span className="gui-play-art">
                <ModeArt id={card.id} />
            </span>
            <span className="gui-play-text">
                <span className="gui-play-head">
                    <span className="gui-play-name">{card.name}</span>
                    <span className="gui-play-tag" data-open={card.locked ? undefined : ""}>
                        {card.locked && <i className="gui-lock" aria-hidden />}
                        {card.tag}
                    </span>
                </span>
                {card.lines.map((line, i) => (
                    <span key={line} className="gui-play-line" data-more={i > 0 ? "" : undefined}>
                        {line}
                    </span>
                ))}
            </span>
            {facts && (
                <span className="gui-play-facts">
                    <span className="gui-play-fact">
                        <span className="gui-play-fact-label">Tier</span>
                        <span className="gui-play-fact-value">{facts.tier}</span>
                    </span>
                    <span className="gui-play-fact">
                        <span className="gui-play-fact-label">Rating</span>
                        <span className="gui-play-fact-value">{facts.rating}</span>
                    </span>
                    {facts.budgets.map((b) => (
                        <span key={b.mode} className="gui-play-fact">
                            <span className="gui-play-fact-label">{b.mode} budget</span>
                            <span className="gui-play-fact-value">{b.budget} cr</span>
                        </span>
                    ))}
                    {facts.placementLeft > 0 && (
                        <span className="gui-play-fact">
                            <span className="gui-play-fact-label">Placement games left</span>
                            <span className="gui-play-fact-value">{facts.placementLeft}</span>
                        </span>
                    )}
                </span>
            )}
        </button>
    );
}
