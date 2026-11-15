// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The match's squad selection: the side's deploy positions as podiums in one
 * scene, an operative on each as a figurine on a lit plinth with an engraved
 * base plate (name, rank, kit, what matters in a fight), and the roster
 * recruits who are on no podium on the bench beside it. Confirm on a podium
 * sets who stands there: None, or a recruit on no podium yet (the figure
 * previews the row under the cursor). Nobody moves between podiums. Deploy, the screen's primary, asks once and sends the squad.
 *
 * Takes its data as props (`Match.tsx` feeds it from the `Game`), so a
 * fixture can drive it. Rules in `rules.ts`.
 */

import type { Recruit } from "@ghosts/squad/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ChainRecruit } from "../../chain";
import {
    FocusRoot,
    FocusScope,
    Icon,
    List,
    ListRow,
    Prompt,
    ScreenFrame,
    StatusChip,
    useFocusable,
    useFocusState,
    useGlyphSet,
    type Command,
} from "../../ui";
import { HqCommandBar } from "../headquarters/frame";
import { toLocalRecruits } from "../headquarters/mapping";
import { Offstage, Portrait } from "../headquarters/squad/parts";
import { rankIcon } from "../headquarters/squad/ranks";
import { useRecruitPortraits } from "../squad/useRecruitPortraits";
import type { Anchor } from "./podium-scene";
import { Podium, PodiumCanvas } from "./podiums";
import {
    benchOf,
    defaultSquad,
    deployRefusal,
    formatClock,
    kitOf,
    LOW_TIME_MS,
    place,
    readLastSquad,
    squadOf,
    weaponLabel,
    writeLastSquad,
    type Kit,
    type Podiums,
} from "./rules";

export type SquadSelectProps = {
    /** The side's deploy positions: one podium each. */
    podiums: number;
    /** The account's recruits, in roster order. */
    roster: ChainRecruit[];
    /** The side's squad on the map once it deployed (the game holds them then); null before. */
    deployed: ChainRecruit[] | null;
    /** When the deployment ends (ms since the epoch, the chain's clock). */
    deadline: number;
    /** The other side has units on the map. */
    opponentDeployed: boolean;
    /** The match's seat is not accepted yet: deploying waits for it. */
    joining: boolean;
    /** A transaction is in flight. */
    busy: boolean;
    /** The last transaction's failure, for the amber line. */
    error: string;
    clearError: () => void;
    /** Send `deploy_squad` with these recruits, in podium order; resolves true once it landed. */
    onDeploy: (ids: string[]) => Promise<boolean>;
    /** Past the deadline: `next_turn` ends the deployment. */
    onTimeUp: () => void;
    /** Abandon the match (asked here first). */
    onAbandon: () => void;
    /** Studio-detail figures, for comparing the scene's cost. */
    full?: boolean;
};

/** One inspect step: a quarter turn of the figure. */
const TURN_STEP = Math.PI / 4;
const ROMAN = ["", "I", "II", "III"];

type PromptKind = "deploy" | "abandon" | null;

function safeStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

/** The wall clock, once a second. */
function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

export function SquadSelect(props: SquadSelectProps) {
    const [prompt, setPrompt] = useState<PromptKind>(null);
    return (
        <FocusRoot back={{ action: "back", label: "Abandon", run: () => setPrompt("abandon") }}>
            <Screen {...props} prompt={prompt} setPrompt={setPrompt} />
        </FocusRoot>
    );
}

function Screen({
    podiums: count,
    roster,
    deployed,
    deadline,
    opponentDeployed,
    joining,
    busy,
    error,
    clearError,
    onDeploy,
    onTimeUp,
    onAbandon,
    full,
    prompt,
    setPrompt,
}: SquadSelectProps & { prompt: PromptKind; setPrompt: (p: PromptKind) => void }) {
    const glyphs = useGlyphSet();
    const store = useFocusState();
    const now = useNow();
    const remaining = Math.max(0, deadline - now);
    const expired = remaining === 0;

    const rosterIds = useMemo(() => roster.map((r) => r.objectId), [roster]);
    const [podiums, setPodiums] = useState<Podiums | null>(null);
    if (podiums === null && rosterIds.length)
        setPodiums(defaultSquad(rosterIds, count, readLastSquad(safeStorage())));
    const ids: Podiums = podiums ?? Array.from({ length: count }, () => null);

    /** The squad as sent, until the game shows it on the map. */
    const [sent, setSent] = useState<ChainRecruit[] | null>(null);
    const sending = useRef(false);
    const done = !!deployed?.length || !!sent;
    const squad = deployed?.length ? deployed : sent;

    const [picking, setPicking] = useState<number | null>(null);
    const [inspecting, setInspecting] = useState<number | null>(null);
    const [turn, setTurn] = useState(0);
    const [anchors, setAnchors] = useState<Anchor[]>([]);
    const [stage, setStage] = useState<{ loading: boolean; error?: string }>({ loading: true });

    // Everyone the screen may show: the roster, and the squad once it left it.
    const everyone = useMemo(() => {
        const list = [...roster];
        for (const r of squad ?? []) if (!list.some((o) => o.objectId === r.objectId)) list.push(r);
        return list;
    }, [roster, squad]);
    const chain = useMemo(() => new Map(everyone.map((r) => [r.objectId, r])), [everyone]);
    const locals = useMemo(
        () =>
            toLocalRecruits(everyone).map((local, i) =>
                // The mapping hands a recruit without a weapon the default rifle to look at;
                // here an unarmed recruit stands unarmed, as it will on the field.
                everyone[i].weapon
                    ? local
                    : {
                          ...local,
                          equipment: { ...local.equipment, primary: null },
                          attachments: {},
                      },
            ),
        [everyone],
    );
    const local = useMemo(() => new Map(locals.map((r) => [r.id, r])), [locals]);
    const kits = useMemo(() => new Map(everyone.map((r) => [r.objectId, kitOf(r)])), [everyone]);
    const { portraits, studioHost } = useRecruitPortraits(locals);

    const focusedId = store.node(store.focused)?.id ?? "";
    const podiumAt = (id: string) => (id.startsWith("podium-") ? Number(id.slice(7)) : null);

    // The cursor starts on Deploy: confirming twice deploys the squad as it stands.
    useLayoutEffect(() => {
        store.focus("deploy", false);
    }, [store]);
    // The podiums follow the scene's layout; the cursor follows them.
    useLayoutEffect(() => store.relayout(), [store, anchors]);
    useEffect(() => {
        const at = podiumAt(focusedId);
        // The cursor moving on ends the inspection (the command list it came from does not).
        if (inspecting !== null && at !== inspecting && !focusedId.startsWith("menu-")) {
            setInspecting(null);
            setTurn(0);
        }
    }, [focusedId, inspecting]);

    // Who stands where: the squad once deployed, else the picks, with the
    // picker's row under the cursor previewed on its podium.
    const candidate =
        picking !== null && store.preview?.startsWith("pick-")
            ? store.preview.slice("pick-".length)
            : undefined;
    const shown: Podiums = done
        ? Array.from({ length: count }, (_, i) => squad?.[i]?.objectId ?? null)
        : picking !== null && candidate !== undefined
          ? place(ids, picking, candidate === "none" ? null : candidate)
          : ids;
    const figures: (Recruit | null)[] = shown.map((id) => (id ? (local.get(id) ?? null) : null));
    const bench = done
        ? roster.filter((r) => !shown.includes(r.objectId)).map((r) => r.objectId)
        : benchOf(rosterIds, ids);
    const focusIndex = inspecting ?? picking ?? podiumAt(focusedId);

    const refusal = deployRefusal({
        podiums: ids,
        roster: rosterIds,
        expired,
        joining,
        busy: busy || sending.current,
        deployed: done,
    });
    const nameOf = (id: string | null) => (id ? (local.get(id)?.callsign ?? "") : "");
    const unarmed = (id: string) => !kits.get(id)?.weapon;

    const deploy = async () => {
        if (sending.current || refusal) return;
        setPrompt(null);
        const squadIds = squadOf(ids);
        const snapshot = squadIds.map((id) => chain.get(id)!);
        sending.current = true;
        try {
            if (await onDeploy(squadIds)) {
                writeLastSquad(safeStorage(), ids);
                setSent(snapshot);
                setPicking(null);
            }
        } finally {
            sending.current = false;
        }
    };

    const startInspect = (i: number) => {
        setTurn(0);
        setInspecting(i);
    };
    const turnBy = (dir: "up" | "down" | "left" | "right") => {
        if (dir === "left") setTurn((a) => a - TURN_STEP);
        else if (dir === "right") setTurn((a) => a + TURN_STEP);
        else return false;
        return true;
    };

    const podiumCommands = (i: number): Command[] => {
        const id = shown[i];
        if (inspecting === i)
            return [
                { action: "nav", label: "Turn", glyph: "lr" },
                {
                    action: "confirm",
                    label: "Turn",
                    tone: "primary",
                    run: () => setTurn((a) => a + TURN_STEP),
                },
                {
                    action: "back",
                    label: "Done",
                    run: () => {
                        setInspecting(null);
                        setTurn(0);
                    },
                },
            ];
        const inspect: Command = {
            action: done ? "confirm" : "reset",
            label: "Inspect",
            tone: done ? "primary" : undefined,
            run: () => startInspect(i),
        };
        if (done) return id ? [inspect] : [];
        if (!id)
            return [
                {
                    action: "confirm",
                    label: "Assign operative",
                    short: "Assign",
                    tone: "primary",
                    run: () => setPicking(i),
                },
            ];
        return [
            {
                action: "confirm",
                label: "Change operative",
                short: "Change",
                tone: "primary",
                run: () => setPicking(i),
            },
            inspect,
        ];
    };

    const podiumHint = (i: number) => {
        const id = shown[i];
        if (!id) return done ? "Nobody deployed here" : "None: this position stays empty";
        const kit = kits.get(id)!;
        return kitHint(kit);
    };

    const remainingText = formatClock(remaining);
    const status = (
        <>
            <StatusChip
                label="Deployment"
                value={remainingText}
                state={expired ? "idle" : "live"}
                tone={remaining < LOW_TIME_MS ? "warn" : "default"}
            />
            <StatusChip label="Opponent" value={opponentDeployed ? "Deployed" : "Choosing"} />
            {busy ? (
                <StatusChip label="Squad" value="Saving" state="busy" />
            ) : (
                done && <StatusChip label="Squad" value="Deployed" />
            )}
        </>
    );

    const squadNow = squadOf(ids);
    const overlay =
        prompt === "deploy" ? (
            <Prompt
                id="prompt-deploy"
                eyebrow="Deployment"
                title={`Deploy ${squadNow.length === 1 ? "one operative" : `${squadNow.length} operatives`}?`}
                lines={[
                    ["Squad", squadNow.map(nameOf).join(" · ")],
                    ["Stays home", bench.length ? bench.map(nameOf).join(" · ") : "Nobody"],
                    ...(squadNow.some(unarmed)
                        ? ([
                              [
                                  "Unarmed",
                                  `${squadNow.filter(unarmed).map(nameOf).join(" · ")}: cannot attack`,
                              ],
                          ] satisfies [string, string][])
                        : []),
                ]}
                confirm={{ label: "Deploy", run: () => void deploy(), deny: refusal ?? undefined }}
                cancel={{ label: "Not yet", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                {squadNow.length < count ? `${squadNow.length} of ${count} positions filled. ` : ""}
                Whoever falls is gone for good, with their gear.
            </Prompt>
        ) : prompt === "abandon" ? (
            <Prompt
                id="prompt-abandon"
                tone="danger"
                eyebrow="Match"
                title="Abandon the match?"
                confirm={{
                    label: "Abandon",
                    run: () => {
                        setPrompt(null);
                        onAbandon();
                    },
                }}
                cancel={{ label: "Stay", run: () => setPrompt(null) }}
                glyphs={glyphs}
            >
                Your opponent wins and your squad comes home, but you can't search for a match for a
                minute.
            </Prompt>
        ) : null;

    return (
        <ScreenFrame
            location={["Match", done ? "Deployed" : "Squad"]}
            onLocation={() => setPrompt("abandon")}
            status={status}
            columns="minmax(0, 1fr) minmax(190px, 240px)"
            commands={<HqCommandBar glyphs={glyphs} error={error} clearError={clearError} />}
            overlay={overlay}
        >
            <section className="sqv-diorama" data-picking={picking !== null || undefined}>
                <PodiumCanvas
                    key={count}
                    figures={figures}
                    full={full}
                    focus={focusIndex}
                    lit={shown.map(() => true)}
                    turn={inspecting !== null ? turn : undefined}
                    onAnchors={setAnchors}
                    onState={setStage}
                />
                {shown.map((id, i) => {
                    const r = id ? chain.get(id) : undefined;
                    return (
                        <Podium
                            key={i}
                            index={i}
                            anchor={anchors[i]}
                            dim={picking !== null && picking !== i}
                            title={
                                inspecting === i
                                    ? `Inspecting ${nameOf(id)}`
                                    : r
                                      ? `${r.metadata.name} · ${r.rank.$kind}`
                                      : `Position ${i + 1}`
                            }
                            hint={inspecting === i ? "Turn the figure" : podiumHint(i)}
                            commands={podiumCommands(i)}
                            directions={inspecting === i ? turnBy : undefined}
                        >
                            <Plate
                                recruit={r}
                                callsign={nameOf(id)}
                                kit={id ? kits.get(id) : undefined}
                                index={i}
                            />
                        </Podium>
                    );
                })}
                {expired ? (
                    <Plaque
                        label="Continue"
                        hint={
                            done
                                ? "Time is up: your opponent never deployed, the match is yours"
                                : "Time is up: your side has nobody on the field, the match is lost"
                        }
                        command={{
                            action: "confirm",
                            label: "Continue",
                            tone: "primary",
                            deny: busy ? "Moving the match on" : undefined,
                            run: onTimeUp,
                        }}
                    />
                ) : done ? (
                    <div className="sqv-stamp" role="status">
                        {opponentDeployed ? "Deployed · starting" : "Deployed · waiting"}
                    </div>
                ) : (
                    <Plaque
                        label="Deploy"
                        hint={
                            squadNow.length
                                ? `Take ${squadNow.map(nameOf).join(" · ")} into the match`
                                : "Take this squad into the match"
                        }
                        command={{
                            action: "confirm",
                            label: "Deploy",
                            tone: "primary",
                            deny: refusal ?? undefined,
                            run: () => setPrompt("deploy"),
                        }}
                    />
                )}
                {stage.loading && <div className="gui-stage-status">Bringing the squad in</div>}
                {stage.error && (
                    <div className="gui-stage-status" data-error>
                        The squad could not be shown
                    </div>
                )}
                {picking !== null && !done && (
                    <RecruitPicker
                        index={picking}
                        roster={roster}
                        podiums={ids}
                        names={nameOf}
                        portraits={portraits}
                        kits={kits}
                        onPick={(id) => {
                            setPodiums(place(ids, picking, id));
                            setPicking(null);
                        }}
                        onClose={() => setPicking(null)}
                    />
                )}
            </section>
            <aside
                className="sqv-bench"
                aria-label="Bench"
                data-compact={bench.length > 1 || undefined}
            >
                <span className="sqv-bench-label">
                    <span>Bench</span>
                    <span>{done ? "Stays home" : `${squadNow.length} / ${count} deploy`}</span>
                </span>
                {bench.map((id) => {
                    const r = chain.get(id)!;
                    return (
                        <BenchPlate
                            key={id}
                            recruit={r}
                            callsign={nameOf(id)}
                            kit={kits.get(id)!}
                            portrait={portraits[id]}
                            hint="Stays home this match"
                        />
                    );
                })}
                {!bench.length && <span className="sqv-bench-empty">Everyone deploys</span>}
            </aside>
            <Offstage ref={studioHost} />
        </ScreenFrame>
    );
}

/** The bar's line for a podium: the kit in words, and Unarmed spelled out. */
function kitHint(kit: Kit): string {
    const parts = [
        weaponLabel(kit),
        kit.armor?.name ?? "No armor",
        kit.utility
            ? `${kit.utility.name}${kit.utility.uses !== null ? ` ×${kit.utility.uses}` : ""}`
            : "No utility",
    ];
    return kit.weapon
        ? parts.join(" · ")
        : `Unarmed: cannot attack · ${parts.slice(1).join(" · ")}`;
}

/** The kit as pictograms: weapon (+ and pips when modded), armor class, utility uses. */
function KitLine({ kit }: { kit: Kit }) {
    return (
        <span className="sqv-plate-kit" aria-label="Loadout">
            <span title={weaponLabel(kit)} data-empty={!kit.weapon || undefined}>
                <Icon name="primary" size={14} />
                {kit.weapon?.modded && <b>+</b>}
                {kit.weapon && kit.weapon.mods.length > 0 && (
                    <span className="sqv-pips">
                        {kit.weapon.mods.map((tier, k) => (
                            <i key={k} data-tier={tier} />
                        ))}
                    </span>
                )}
            </span>
            <span title={kit.armor?.name ?? "No armor"} data-empty={!kit.armor || undefined}>
                <Icon name="armor" size={14} />
                {kit.armor && <b>{ROMAN[kit.armor.tier]}</b>}
            </span>
            <span title={kit.utility?.name ?? "No utility"} data-empty={!kit.utility || undefined}>
                <Icon name="utility" size={14} />
                {kit.utility && kit.utility.uses !== null && <b>×{kit.utility.uses}</b>}
            </span>
        </span>
    );
}

/** The plate's amber line: what changes the fight, in words. */
function Warning({ kit }: { kit: Kit }) {
    if (kit.weapon) return null;
    return (
        <span className="sqv-plate-warn">
            <i className="gui-warn-mark" aria-hidden />
            Unarmed · cannot attack
        </span>
    );
}

function Plate({
    recruit,
    callsign,
    kit,
    index,
}: {
    recruit?: ChainRecruit;
    callsign: string;
    kit?: Kit;
    index: number;
}) {
    if (!recruit || !kit)
        return (
            <div className="sqv-plate-engraved" data-vacant>
                <span className="sqv-plate-name">None</span>
                <span className="sqv-plate-line">Position {index + 1}</span>
            </div>
        );
    const rank = recruit.rank.$kind;
    return (
        <div className="sqv-plate-engraved">
            <span className="sqv-plate-head">
                <span className="sqv-plate-name">{callsign}</span>
            </span>
            <span className="sqv-plate-line">
                <Icon name={rankIcon(rank)} size={12} />
                {rank}
            </span>
            <KitLine kit={kit} />
            <Warning kit={kit} />
        </div>
    );
}

/** Deploy (or Continue once the time is up): the screen's primary, a plaque. */
function Plaque({ label, hint, command }: { label: string; hint: string; command: Command }) {
    const { props } = useFocusable<HTMLButtonElement>({
        id: "deploy",
        group: "deploy",
        title: label,
        hint,
        commands: [command],
        // The primary opens a prompt (or moves on past the deadline): one click.
        instant: true,
    });
    return (
        <button type="button" tabIndex={-1} className="sqv-plaque" {...props}>
            {label}
        </button>
    );
}

function BenchPlate({
    recruit,
    callsign,
    kit,
    portrait,
    hint,
}: {
    recruit: ChainRecruit;
    callsign: string;
    kit: Kit;
    portrait?: string;
    hint: string;
}) {
    const rank = recruit.rank.$kind;
    const { props } = useFocusable<HTMLDivElement>({
        id: `bench-${recruit.objectId}`,
        group: "bench",
        title: `${recruit.metadata.name} · ${rank} · Bench`,
        hint: kit.weapon ? hint : `${hint} · Unarmed: cannot attack`,
        commands: [],
    });
    return (
        <div className="sqv-bench-plate" {...props}>
            <Portrait src={portrait} rank={rank} />
            <span className="sqv-plate-name">{callsign}</span>
            <span className="sqv-plate-line">
                <Icon name={rankIcon(rank)} size={12} />
                {rank}
            </span>
            <KitLine kit={kit} />
            <Warning kit={kit} />
        </div>
    );
}

/** Puts the cursor on `id` once, when a scope opens (on the current choice). */
function StartOn({ id }: { id: string }) {
    const store = useFocusState();
    useLayoutEffect(() => {
        store.focus(id, false);
        // Once, on open.
    }, []);
    return null;
}

type PickerProps = {
    index: number;
    roster: ChainRecruit[];
    podiums: Podiums;
    names: (id: string) => string;
    portraits: Record<string, string>;
    kits: Map<string, Kit>;
    onPick: (id: string | null) => void;
    onClose: () => void;
};

/** Who stands on a podium: the roster, its own scope; the podium previews the row under the cursor. */
function RecruitPicker({
    index,
    roster,
    podiums,
    names,
    portraits,
    kits,
    onPick,
    onClose,
}: PickerProps) {
    const close: Command = { action: "back", label: "Cancel", run: onClose };
    const current = podiums[index];
    // Only recruits on no podium are on offer (the occupant of this podium is
    // on one, so not listed; the podium itself shows them), then None.
    const free = new Set(
        benchOf(
            roster.map((x) => x.objectId),
            podiums,
        ),
    );
    const unused = roster.filter((r) => free.has(r.objectId));
    return (
        <FocusScope id="squad-picker" back={close}>
            <StartOn id={unused.length ? `pick-${unused[0].objectId}` : "pick-none"} />
            <div
                className="sqv-picker gui-panel"
                // Opposite the podium it chooses for, so the preview stays in view.
                data-side={index >= podiums.length / 2 ? "left" : undefined}
            >
                <header className="gui-panel-head">
                    <span className="gui-panel-label">Position {index + 1}</span>
                </header>
                <div className="gui-panel-body">
                    <List label={`Position ${index + 1}`}>
                        {unused.map((r) => {
                            const armed = !!kits.get(r.objectId)?.weapon;
                            return (
                                <ListRow
                                    key={r.objectId}
                                    id={`pick-${r.objectId}`}
                                    instant
                                    previews
                                    group="squad-picker"
                                    thumb={
                                        <Portrait src={portraits[r.objectId]} rank={r.rank.$kind} />
                                    }
                                    name={names(r.objectId)}
                                    kind={armed ? r.rank.$kind : `${r.rank.$kind} · Unarmed`}
                                    title={`${r.metadata.name} · ${r.rank.$kind}`}
                                    hint={kitHint(kits.get(r.objectId)!)}
                                    commands={[
                                        {
                                            action: "confirm",
                                            label: "Place",
                                            tone: "primary",
                                            run: () => onPick(r.objectId),
                                        },
                                        close,
                                    ]}
                                />
                            );
                        })}
                        <ListRow
                            id="pick-none"
                            instant
                            previews
                            group="squad-picker"
                            name="None"
                            title="None"
                            hint={
                                current
                                    ? `${names(current)} stays home; fewer deploy`
                                    : "The position stays empty"
                            }
                            commands={[
                                {
                                    action: "confirm",
                                    label: current ? "Clear" : "Keep empty",
                                    tone: "primary",
                                    run: () => onPick(null),
                                },
                                close,
                            ]}
                        />
                    </List>
                </div>
            </div>
        </FocusScope>
    );
}
