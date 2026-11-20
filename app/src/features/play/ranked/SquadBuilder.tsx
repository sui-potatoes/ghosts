// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The squad builder as a part other screens can mount: the ranked screen with
 * the player's tier budget, a friendly lobby with the budget its host set.
 * The props are a contract between screens: extend them, do not break them.
 *
 * Renders one block for the host's body grid (give it a single full-width
 * column): the squad on stage as figurines (or as rows on a phone and where
 * the scene cannot run), and a panel beside it with the credits, the host's
 * own rows, the saved squads, and the unit editor while a unit is open. Its
 * prompts (naming, deleting) open over the host's screen. It must be mounted
 * inside the host's `FocusRoot` / `ScreenFrame`.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useSettings } from "../../../settings/store";
import {
    Meter,
    Panel,
    Prompt,
    TextField,
    useFocusState,
    useGlyphSet,
    type Command,
} from "../../../ui";
import { priceOf, squadSize, type Issue, type Loadout, type Mode } from "../economy";
import { BuilderStage, listStandId, podiumId, StandList, type StandInfo } from "./BuilderStage";
import { standFigures, unitNumber } from "./figures";
import {
    applyOption,
    clearUnit,
    cr,
    emptySaved,
    gearText,
    parseSaved,
    serializeSaved,
    squadCost,
    squadFor,
    squadIssues,
    typeName,
    type Limits,
    type PickOption,
    type Saved,
    type Stand,
} from "./model";
import {
    deleteSquad,
    deleteType,
    hashText,
    nameRefusal,
    nextName,
    overwriteSquad,
    parseLibrary,
    PRESETS_KEY,
    renameSquad,
    saveSquad,
    saveSquadRefusal,
    saveType,
    saveTypeRefusal,
    serializeLibrary,
    squadsFor,
    type Library,
    type SavedSquad,
    type SavedType,
} from "./presets";
import { ManageSquad, SAVE_SQUAD, SavedSquadList, squadRowId } from "./SavedSquads";
import { editorOptions, UnitEditor, type EditorStep } from "./UnitEditor";
import "./ranked.css";

export type SquadBuilderProps = {
    mode: Mode;
    /** Credits the squad may cost; null for no limit. */
    budget: number | null;
    /** The rating whose tier decides which gear is unlocked. */
    rating: number;
    /** Where the squad being built is remembered on the device, per size. */
    storageKey: string;
    /**
     * Called with the squad and what is wrong with it, on mount and on every
     * change. A place with no type yet is left out of `squad`; every issue
     * that names a unit (`unit`) gives its place on the stands, empty ones
     * included, and an empty place is an issue itself. `labels` name each
     * unit in `squad` the way the builder does: the player's own saved unit
     * type, else the preset.
     */
    onChange: (squad: Loadout[], issues: Issue[], labels: string[]) => void;
    /**
     * Where the saved squads and unit types are kept; shared by every screen
     * that mounts the builder unless a host gives its own.
     */
    presetsKey?: string;
    /** The host's own rows above the saved squads (the ranked size choice). */
    aside?: ReactNode;
    /** The host's primary under the panel (Find ranked match, Ready). */
    action?: ReactNode;
    /** Something over the stage (the search in progress). */
    stageOverlay?: ReactNode;
    /** The search has started: the lamps strike on in turn, the editor is closed. */
    searching?: boolean;
    /** Put the cursor on the first unit on mount (default true). */
    autoFocus?: boolean;
};

type PromptState =
    | { kind: "save-squad"; name: string }
    | { kind: "rename-squad"; id: string; name: string }
    | { kind: "save-type"; name: string }
    | { kind: "delete-type"; type: SavedType }
    | null;

function read<T>(key: string, parse: (raw: string | null) => T): T {
    try {
        return parse(localStorage.getItem(key));
    } catch {
        return parse(null);
    }
}

function write(key: string, text: string) {
    try {
        localStorage.setItem(key, text);
    } catch {
        // Storage may be unavailable or full; the squad lasts for the visit.
    }
}

/** Phones get the squad as rows: the stage needs the room. */
const NARROW = "(max-width: 720px), (max-height: 500px)";

function useNarrow(): boolean {
    const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
    useEffect(() => {
        const query = window.matchMedia(NARROW);
        const update = () => setNarrow(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return narrow;
}

/** Whether this browser can give the stage a WebGL context at all. */
function webglAvailable(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (!gl) return false;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return true;
    } catch {
        return false;
    }
}

function useStill(): boolean {
    const [settings] = useSettings();
    const [os, setOs] = useState(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setOs(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return os || settings.display.reduceMotion;
}

export function SquadBuilder({
    mode,
    budget,
    rating,
    storageKey,
    onChange,
    presetsKey = PRESETS_KEY,
    aside,
    action,
    stageOverlay,
    searching = false,
    autoFocus = true,
}: SquadBuilderProps) {
    const store = useFocusState();
    const glyphs = useGlyphSet();
    const narrow = useNarrow();
    const still = useStill();
    const [canStage, setCanStage] = useState(webglAvailable);
    const staged = canStage && !narrow;
    const standId = staged ? podiumId : listStandId;

    const limits: Limits = useMemo(() => ({ rating, mode, budget }), [rating, mode, budget]);

    /* --- The squad being built, per size --------------------------------- */
    const [saved, setSaved] = useState<Saved>(() => read(storageKey, parseSaved));
    const stands = useMemo(
        () => squadFor(saved, rating, mode, budget),
        [saved, rating, mode, budget],
    );
    useEffect(() => {
        write(
            storageKey,
            serializeSaved({ ...emptySaved(), squads: { ...saved.squads, [mode]: stands } }),
        );
    }, [storageKey, saved, stands, mode]);
    const setStands = (next: Stand[]) =>
        setSaved((s) => ({ ...s, squads: { ...s.squads, [mode]: next } }));

    /* --- Saved squads and types ------------------------------------------ */
    const [library, setLibraryState] = useState<Library>(() => read(presetsKey, parseLibrary));
    const setLibrary = (next: Library) => {
        setLibraryState(next);
        write(presetsKey, serializeLibrary(next));
    };
    // Another screen (or tab) may have saved meanwhile.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === presetsKey) setLibraryState(parseLibrary(e.newValue));
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [presetsKey]);
    const mine = library.types;
    const mySquads = squadsFor(library, mode);

    const issues = useMemo(
        () => squadIssues(stands, rating, mode, budget),
        [stands, rating, mode, budget],
    );
    const report = useRef(onChange);
    report.current = onChange;
    const filled = stands.filter((s): s is Loadout => !!s);
    const labels = filled.map((u) => typeName(u, rating, library.types));
    const issuesKey = JSON.stringify([stands, issues, labels]);
    useEffect(() => {
        report.current(filled, issues, labels);
        // The key stands for the squad, its issues and its names.
    }, [issuesKey]);

    /* --- What is open ----------------------------------------------------- */
    const [editing, setEditing] = useState<number | null>(null);
    const [step, setStep] = useState<EditorStep>("gear");
    const [managing, setManaging] = useState<string | null>(null);
    const [prompt, setPrompt] = useState<PromptState>(null);
    const [struck, setStruck] = useState<{ index: number; n: number } | null>(null);
    const managed = mySquads.find((s) => s.id === managing) ?? null;
    // Where the cursor goes once the view it belongs to has mounted.
    const [focusNext, setFocusNext] = useState<string | null>(null);
    useLayoutEffect(() => {
        if (!focusNext) return;
        store.focus(focusNext, false);
        setFocusNext(null);
    }, [focusNext, store]);

    // A new size, or the search: back to the squad.
    useEffect(() => {
        setEditing(null);
        setManaging(null);
    }, [mode, searching]);
    useLayoutEffect(() => {
        if (autoFocus) store.focus(standId(0), false);
        // Once, on arrival, and when the stands become rows or figures.
    }, [store, staged]);

    const open = (i: number) => {
        setManaging(null);
        setStep(stands[i] ? "gear" : "type");
        setEditing(i);
    };
    const close = () => {
        const i = editing;
        setEditing(null);
        if (i !== null) setFocusNext(standId(i));
    };
    const pick = (option: PickOption) => {
        if (editing === null) return;
        const before = stands[editing];
        setStands(applyOption(stands, editing, option, rating));
        if (option.group === "preset") {
            setStep("gear");
            if (!before || before.preset !== option.unit.preset || !sameKit(before, option.unit))
                setStruck((s) => ({ index: editing, n: (s?.n ?? 0) + 1 }));
        }
    };

    /* --- Stands ----------------------------------------------------------- */
    const unitIssue = (i: number) => issues.find((issue) => issue.unit === i && stands[i]);
    const info: StandInfo = {
        issue: unitIssue,
        title: (i) => {
            const unit = stands[i];
            return unit
                ? `Unit ${unitNumber(i)} · ${typeName(unit, rating, mine)} · ${cr(priceOf(unit))}`
                : `Unit ${unitNumber(i)} · No type`;
        },
        hint: (i) => {
            const unit = stands[i];
            if (!unit) return "Choose a type for this unit";
            return unitIssue(i)?.message ?? gearText(unit);
        },
        commands: (i): Command[] => {
            const unit = stands[i];
            return [
                {
                    action: "confirm",
                    label: unit ? "Edit" : "Choose type",
                    short: unit ? "Edit" : "Choose",
                    tone: "primary",
                    deny: searching ? "Searching for an opponent" : undefined,
                    run: () => open(i),
                },
                ...(unit && !searching
                    ? [
                          {
                              action: "reset",
                              label: "Clear",
                              short: "Clear",
                              run: () => {
                                  setStands(clearUnit(stands, i));
                                  setStruck(null);
                              },
                          } satisfies Command,
                      ]
                    : []),
            ];
        },
    };

    /* --- Figures, with the row under the cursor previewed on its stand ---- */
    const seed = useMemo(() => hashText(storageKey), [storageKey]);
    const options =
        editing !== null ? editorOptions(stands, editing, step, limits, mine) : new Map();
    const previewed = store.preview ? options.get(store.preview) : undefined;
    const shown =
        editing !== null && previewed && !previewed.locked
            ? stands.map((s, i) => (i === editing ? previewed.unit : s))
            : stands;
    const figuresKey = JSON.stringify(shown);
    const figures = useMemo(() => standFigures(shown, seed), [figuresKey, seed]);

    /* --- Panel ------------------------------------------------------------ */
    const spent = squadCost(stands);
    const left = budget === null ? null : budget - spent;
    const over = left !== null && left < 0;
    const meter = (
        <div className="grk-credits">
            <Meter
                label="Credits"
                value={budget === null ? 0 : Math.min(spent, budget)}
                max={budget === null ? 1 : Math.max(1, budget)}
                tone={over ? "warn" : undefined}
                readout={
                    budget === null ? (
                        <>{cr(spent)} · no limit</>
                    ) : (
                        <>
                            {spent} of {cr(budget)} ·{" "}
                            {over ? `${-left!} cr over` : `${left} cr left`}
                        </>
                    )
                }
            />
        </div>
    );

    const saveRefusal = saveSquadRefusal(library, mode, stands);
    const unit = editing !== null ? stands[editing] : null;
    const typeRefusal = saveTypeRefusal(library, unit ?? null);

    let label = "Squad";
    let body: ReactNode;
    if (editing !== null) {
        label = `Unit ${unitNumber(editing)} · ${!unit || step === "type" ? "Unit type" : "Equipment"}`;
        body = (
            <UnitEditor
                stands={stands}
                index={editing}
                step={step}
                limits={limits}
                mine={mine}
                onStep={setStep}
                onPick={pick}
                onClose={close}
                saveTypeRefusal={typeRefusal}
                onSaveType={() =>
                    unit &&
                    setPrompt({
                        kind: "save-type",
                        name: nextName(
                            typeName({ ...unit }, rating).replace(" · modified", ""),
                            mine.map((t) => t.name),
                        ),
                    })
                }
                onDeleteType={(type) => setPrompt({ kind: "delete-type", type })}
            />
        );
    } else if (managed) {
        label = "Saved squad";
        const done = () => {
            setManaging(null);
            setFocusNext(squadRowId(managed.id));
        };
        body = (
            <ManageSquad
                squad={managed}
                stands={stands}
                limits={limits}
                onLoad={() => {
                    setStands(managed.units.map((u) => ({ ...u })));
                    done();
                }}
                onOverwrite={() => {
                    setLibrary(overwriteSquad(library, managed.id, stands));
                    done();
                }}
                onRename={() =>
                    setPrompt({ kind: "rename-squad", id: managed.id, name: managed.name })
                }
                onDelete={() => {
                    setLibrary(deleteSquad(library, managed.id));
                    setManaging(null);
                    setFocusNext(SAVE_SQUAD);
                }}
                onClose={done}
            />
        );
    } else {
        body = (
            <>
                {aside && <div className="grk-aside">{aside}</div>}
                <SavedSquadList
                    saved={mySquads}
                    stands={stands}
                    limits={limits}
                    saveRefusal={saveRefusal}
                    onLoad={(squad: SavedSquad) => setStands(squad.units.map((u) => ({ ...u })))}
                    onManage={(squad: SavedSquad) => setManaging(squad.id)}
                    onSave={() =>
                        setPrompt({
                            kind: "save-squad",
                            name: nextName(
                                "Squad",
                                mySquads.map((s) => s.name),
                            ),
                        })
                    }
                />
            </>
        );
    }

    /* --- Prompts, over the host's screen ---------------------------------- */
    const rootRef = useRef<HTMLDivElement>(null);
    const [screen, setScreen] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        setScreen(rootRef.current?.closest<HTMLElement>(".gui") ?? null);
    }, []);
    const closePrompt = () => setPrompt(null);
    const overlay = prompt && (
        <BuilderPrompt
            prompt={prompt}
            setPrompt={setPrompt}
            close={closePrompt}
            glyphs={glyphs}
            stands={stands}
            mySquads={mySquads}
            mine={mine}
            rating={rating}
            onSaveSquad={(name) => {
                const next = saveSquad(library, mode, name, stands);
                setLibrary(next);
                const added = squadsFor(next, mode).at(-1);
                closePrompt();
                if (added) setFocusNext(squadRowId(added.id));
            }}
            onRename={(id, name) => {
                setLibrary(renameSquad(library, id, name));
                closePrompt();
            }}
            onSaveType={(name) => {
                if (unit) setLibrary(saveType(library, name, unit));
                closePrompt();
            }}
            onDeleteType={(type) => {
                setLibrary(deleteType(library, type.id));
                closePrompt();
            }}
        />
    );

    const standsView = staged ? (
        <BuilderStage
            stands={stands}
            figures={figures}
            rating={rating}
            mine={mine}
            info={info}
            editing={editing}
            struck={struck}
            searching={searching}
            still={still}
            onFail={() => setCanStage(false)}
        >
            {stageOverlay}
        </BuilderStage>
    ) : (
        <StandList stands={stands} rating={rating} mine={mine} info={info} editing={editing}>
            {stageOverlay}
        </StandList>
    );

    return (
        <div
            ref={rootRef}
            className="grk-builder"
            data-layout={staged ? "stage" : "list"}
            data-editing={editing !== null || undefined}
            data-size={squadSize(mode)}
        >
            {standsView}
            <Panel
                label={label}
                meta={editing === null && !managed ? `${squadSize(mode)} units` : undefined}
                className="grk-panel"
            >
                {meter}
                <div className="grk-panel-main">{body}</div>
                {action && <div className="grk-action">{action}</div>}
            </Panel>
            {overlay && screen ? createPortal(overlay, screen) : overlay}
        </div>
    );
}

const sameKit = (a: Loadout, b: Loadout) =>
    a.weapon === b.weapon && a.armor === b.armor && a.utility === b.utility;

type BuilderPromptProps = {
    prompt: NonNullable<PromptState>;
    setPrompt: (p: PromptState) => void;
    close: () => void;
    glyphs: ReturnType<typeof useGlyphSet>;
    stands: Stand[];
    mySquads: SavedSquad[];
    mine: SavedType[];
    rating: number;
    onSaveSquad: (name: string) => void;
    onRename: (id: string, name: string) => void;
    onSaveType: (name: string) => void;
    onDeleteType: (type: SavedType) => void;
};

function BuilderPrompt({
    prompt,
    setPrompt,
    close,
    glyphs,
    stands,
    mySquads,
    mine,
    rating,
    onSaveSquad,
    onRename,
    onSaveType,
    onDeleteType,
}: BuilderPromptProps) {
    if (prompt.kind === "delete-type")
        return (
            <Prompt
                id="prompt-delete-type"
                tone="danger"
                eyebrow="Your unit types"
                title={`Delete ${prompt.type.name}?`}
                lines={[
                    ["Equipment", gearText(prompt.type.loadout)],
                    ["Price", cr(priceOf(prompt.type.loadout))],
                ]}
                confirm={{ label: "Delete", run: () => onDeleteType(prompt.type) }}
                cancel={{ label: "Keep", run: close }}
                glyphs={glyphs}
            >
                Units that use it keep their equipment
            </Prompt>
        );
    const taken =
        prompt.kind === "save-type"
            ? mine.map((t) => t.name)
            : mySquads
                  .filter((s) => prompt.kind !== "rename-squad" || s.id !== prompt.id)
                  .map((s) => s.name);
    const refusal = nameRefusal(prompt.name, taken);
    const setName = (name: string) => setPrompt({ ...prompt, name });
    const submit = () => {
        if (refusal) return;
        if (prompt.kind === "save-squad") onSaveSquad(prompt.name);
        else if (prompt.kind === "rename-squad") onRename(prompt.id, prompt.name);
        else onSaveType(prompt.name);
    };
    const filled = stands.filter((s): s is Loadout => !!s);
    const copy =
        prompt.kind === "save-squad"
            ? {
                  eyebrow: "Saved squads",
                  title: "Save this squad",
                  lines: [
                      ["Units", filled.map((u) => typeName(u, rating, mine)).join(" · ")],
                      ["Cost", cr(squadCost(stands))],
                  ] as [string, ReactNode][],
                  confirm: "Save",
                  body: "Load it from the saved squads whenever it fits the budget",
              }
            : prompt.kind === "rename-squad"
              ? {
                    eyebrow: "Saved squads",
                    title: "Rename squad",
                    lines: undefined,
                    confirm: "Rename",
                    body: "",
                }
              : {
                    eyebrow: "Your unit types",
                    title: "Save as my type",
                    lines: undefined,
                    confirm: "Save",
                    body: "It appears under Yours when choosing a unit type",
                };
    return (
        <Prompt
            id={`prompt-${prompt.kind}`}
            eyebrow={copy.eyebrow}
            title={copy.title}
            lines={copy.lines}
            confirm={{ label: copy.confirm, run: submit, deny: refusal ?? undefined }}
            cancel={{ label: "Cancel", run: close }}
            glyphs={glyphs}
        >
            {copy.body && <span className="grk-prompt-line">{copy.body}</span>}
            <TextField label="Name" value={prompt.name} onChange={setName} onSubmit={submit} />
        </Prompt>
    );
}
