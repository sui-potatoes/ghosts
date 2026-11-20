// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/play/demo`: the single-player operations, each deploying to its own route.
 * No sign-in, no account. Back returns to Play; leaving an operation returns here.
 */

import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useGoUp } from "../../../hooks/useGoUp";
import {
    FocusCommandBar,
    FocusRoot,
    List,
    ListRow,
    Panel,
    ScreenFrame,
    useFocusStore,
    useGlyphSet,
    type Command,
} from "../../../ui";
import { DEMO_SCENARIOS } from "../model";

export function DemoScreen() {
    const leave = useGoUp();
    const glyphs = useGlyphSet();
    const back: Command = { action: "back", label: "Back", run: leave };
    return (
        <FocusRoot back={back}>
            <ScreenFrame
                location={["Play", "Demo"]}
                onLocation={leave}
                columns="minmax(0, 480px)"
                commands={<FocusCommandBar glyphs={glyphs} />}
            >
                <Scenarios />
            </ScreenFrame>
        </FocusRoot>
    );
}

function Scenarios() {
    const navigate = useNavigate();
    const store = useFocusStore();
    useLayoutEffect(() => {
        store.focus(`demo-${DEMO_SCENARIOS[0].id}`, false);
    }, [store]);
    return (
        <Panel label="Demo">
            <List label="Operations">
                {DEMO_SCENARIOS.map((scenario) => (
                    <ListRow
                        key={scenario.id}
                        id={`demo-${scenario.id}`}
                        group="demo"
                        instant
                        name={scenario.name}
                        kind={scenario.place}
                        tag="Single player"
                        title={scenario.name}
                        hint={scenario.place}
                        commands={[
                            {
                                action: "confirm",
                                label: "Deploy",
                                tone: "primary",
                                run: () => navigate(scenario.route),
                            },
                        ]}
                    />
                ))}
            </List>
        </Panel>
    );
}
