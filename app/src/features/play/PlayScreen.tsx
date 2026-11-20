// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play`: the three ways to play as cards. Ranked and friendly open their
 * screens; faction wars is shown inactive with its reason. Everything here is
 * the shared interface language (`src/ui/`): the cards are cursor targets, the
 * bar names the focused card's command, Back returns to the title. No wallet is
 * needed to open it.
 */

import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useMatchSearch } from "../../chain";
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
import { modeCards, rankedFacts, type ModeCard } from "./model";
import { useRating } from "./rating";
import "./play.css";

export default function PlayScreen() {
    const leave = useGoUp();
    const glyphs = useGlyphSet();
    const rating = useRating();
    const { name } = usePlayerName();
    const { lobby } = useMatchSearch();
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
                            value={`${rating.rating} · ${rankedFacts(rating.rating).tier}`}
                        />
                    </>
                }
                columns="minmax(0, 1fr)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <Cards rating={rating.rating} lobby={!!lobby} />
            </ScreenFrame>
        </FocusRoot>
    );
}

const NAV: Command = { action: "nav", label: "Move", glyph: "lr" };

function Cards({ rating, lobby }: { rating: number; lobby: boolean }) {
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus(lobby ? "play-friendly" : "play-ranked", false);
        // Once, on arrival.
    }, [store]);
    return (
        <div className="gui-play">
            <div className="gui-play-cards" role="list">
                {modeCards(lobby).map((card) => (
                    <Card key={card.id} card={card} rating={rating} />
                ))}
            </div>
        </div>
    );
}

function Card({ card, rating }: { card: ModeCard; rating: number }) {
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
    const facts = card.id === "ranked" ? rankedFacts(rating) : null;
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
                        <span className="gui-play-fact-label">Rank</span>
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
                </span>
            )}
        </button>
    );
}
