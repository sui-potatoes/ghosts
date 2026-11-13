// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * `/ui-sample` — HQ in the candidate shared language: two sibling sections,
 * Squad (roster, the operative on the game's character stage, an inspector
 * with Loadout, Stats, Appearance and Dossier) and Armory (requisition list,
 * the item on the game's gear stage, its specification). Built only from the
 * sample's parts (frame, command bar, panels, rows, stats, choosers, stage,
 * prompt, focus cursor) so the language can be judged before any real screen
 * moves onto it. Nothing here touches the chain or an account; the squad is
 * the local showcase roster /demo plays with, read and never written.
 *
 * `?area=armory|deploy|debrief` opens on that section (`?debrief=win|costly|wipe`
 * picks the debrief's sample result); `?pad=xbox|ps` pins pad glyphs; `?long=1`
 * pads the roster to 40 rows (the scrolling list).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { uiTick } from "../../audio";
import { Armory, useArmoryState } from "./armory";
import { Debrief, useDebriefState } from "./debrief-screen";
import { Deploy, useDeployState } from "./deploy";
import { SECTIONS, type Section } from "./data";
import { FocusRoot, Prompt, StatusChip, useGlyphSet } from "../../ui";
import { Squad, SQUAD_TABS, useSquadState, type SquadTab } from "./squad";
import "./ui-sample.css";

type Area = "squad" | "armory" | "deploy" | "debrief";

const AREAS: { id: Area; label: string }[] = [
    { id: "squad", label: "Squad" },
    { id: "armory", label: "Armory" },
    { id: "deploy", label: "Deploy" },
    { id: "debrief", label: "Debrief" },
];

function useSearchClock(start: number): string {
    const [s, setS] = useState(start);
    useEffect(() => {
        const t = setInterval(() => setS((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, []);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function cycle<T extends { id: string }>(list: T[], current: string, step: 1 | -1): T {
    const i = list.findIndex((x) => x.id === current);
    return list[(i + step + list.length) % list.length];
}

export default function UiSample() {
    const navigate = useNavigate();
    const glyphs = useGlyphSet();
    const clock = useSearchClock(84);
    const [area, setArea] = useState<Area>(() => {
        const asked = new URLSearchParams(window.location.search).get("area");
        return AREAS.some((a) => a.id === asked) ? (asked as Area) : "squad";
    });
    const [armoryTab, setArmoryTab] = useState<Section>("weapons");
    const [squadTab, setSquadTab] = useState<SquadTab>("loadout");
    const squad = useSquadState();
    const armory = useArmoryState();
    const deploy = useDeployState(squad.roster);
    const debrief = useDebriefState();
    const [saving, setSaving] = useState(0);
    /** What to do once the unsaved-changes prompt is answered. */
    const [pending, setPending] = useState<{ go: () => void } | null>(null);

    useEffect(() => {
        if (!saving) return;
        const t = setTimeout(() => setSaving(0), 1400);
        return () => clearTimeout(t);
    }, [saving]);
    const save = () => setSaving((n) => n + 1);

    /** Run `go`, unless an appearance draft would be lost: then ask first. */
    const guard = (go: () => void) => {
        if (squad.dirty) setPending({ go });
        else go();
    };

    const leave = () => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate("/", { replace: true });
    };

    const switchArea = (next: Area) => {
        if (next === area) return;
        guard(() => {
            uiTick(null);
            setArea(next);
        });
    };

    const onTab = (step: 1 | -1) => {
        uiTick(null);
        if (area === "deploy" || area === "debrief") return;
        if (area === "armory") setArmoryTab(cycle(SECTIONS, armoryTab, step).id);
        else setSquadTab(cycle(SQUAD_TABS, squadTab, step).id as SquadTab);
    };

    // Only what is true right now: a quiet record says nothing.
    const status = (
        <>
            <StatusChip label="Match" value={`Searching ${clock}`} state="live" />
            {squad.dirty ? (
                <StatusChip label="Appearance" value="Unsaved" tone="warn" />
            ) : (
                saving > 0 && <StatusChip label="Records" value="Saving" state="busy" />
            )}
        </>
    );

    const callsign = squad.recruit?.callsign ?? "";
    const overlay = pending && (
        <Prompt
            id="prompt-unsaved"
            eyebrow="Unsaved changes"
            title={`Keep ${callsign}'s new look?`}
            hint="Discard restores the last saved look"
            confirm={{
                label: "Save",
                run: () => {
                    squad.save();
                    save();
                    setPending(null);
                    pending.go();
                },
            }}
            alternate={{
                label: "Discard",
                run: () => {
                    squad.discard();
                    setPending(null);
                    pending.go();
                },
            }}
            cancel={{ label: "Keep editing", run: () => setPending(null) }}
            glyphs={glyphs}
        >
            Leaving now loses the appearance edits unless they are saved.
        </Prompt>
    );

    const frame = {
        siblings: {
            sections: AREAS,
            active: area,
            onSelect: (id: string) => switchArea(id as Area),
            glyphs,
        },
        status,
        onLeave: () => guard(leave),
        overlay,
    };

    return (
        <FocusRoot
            back={{ action: "back", label: "Leave", run: () => guard(leave) }}
            onTab={onTab}
            onSection={(step) => switchArea(cycle(AREAS, area, step).id)}
        >
            {area === "squad" ? (
                <Squad
                    squad={squad}
                    tab={squadTab}
                    onTab={(tab) => {
                        uiTick(null);
                        setSquadTab(tab);
                    }}
                    glyphs={glyphs}
                    frame={frame}
                    guard={guard}
                    save={save}
                />
            ) : area === "armory" ? (
                <Armory
                    armory={armory}
                    tab={armoryTab}
                    onTab={setArmoryTab}
                    wearer={squad.roster[0]}
                    glyphs={glyphs}
                    frame={frame}
                    save={save}
                />
            ) : area === "debrief" ? (
                <Debrief
                    state={debrief}
                    roster={squad.roster}
                    podiums={deploy.podiums}
                    rank={squad.rank}
                    glyphs={glyphs}
                    frame={frame}
                    onContinue={() => switchArea("deploy")}
                />
            ) : (
                <Deploy
                    deploy={deploy}
                    roster={squad.roster}
                    rank={squad.rank}
                    glyphs={glyphs}
                    frame={frame}
                    owned={armory.owned}
                    setLoadout={squad.setLoadout}
                    onEditLoadout={(id) =>
                        guard(() => {
                            squad.select(id);
                            setSquadTab("loadout");
                            setArea("squad");
                        })
                    }
                />
            )}
        </FocusRoot>
    );
}
