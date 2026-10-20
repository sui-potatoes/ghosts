// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSquad } from "../features/squad/useSquad";
import { editRecruit, equip, MAX_RECRUITS } from "../features/squad/model";
import { itemById } from "../features/squad/catalog";
import { CharacterViewport } from "../features/squad/components/CharacterViewport";
import { AppearancePanel } from "../features/squad/components/AppearancePanel";
import { LoadoutPanel } from "../features/squad/components/LoadoutPanel";
import { StatsPanel } from "../features/squad/components/StatsPanel";
import { DossierPanel } from "../features/squad/components/PersonnelForm";
import type { PersonnelDetails } from "../features/squad/components/PersonnelForm";
import type { Focus } from "../features/squad/studio/recruit-studio";
import type { Slot } from "../features/squad/types";
import "../features/squad/squad.css";

type Panel = "Loadout" | "Stats" | "Appearance" | "Personnel";
export default function Squad() {
    const { state, commit, notice } = useSquad();
    const [selected, setSelected] = useState(state.recruits[0].id),
        [panel, setPanel] = useState<Panel>("Loadout"),
        [focus, setFocus] = useState<Focus>("body");
    const recruit = state.recruits.find((r) => r.id === selected) ?? state.recruits[0];
    const [draft, setDraft] = useState(recruit.appearance),
        [portraits, setPortraits] = useState<Record<string, string>>({}),
        [images, setImages] = useState<Record<string, string>>({}),
        [error, setError] = useState("");
    const [pending, setPending] = useState<string | null>(null);
    const discard = useRef<HTMLDialogElement>(null);
    const dirty = JSON.stringify(draft) !== JSON.stringify(recruit.appearance);
    useEffect(() => {
        if (pending) discard.current?.showModal();
        else discard.current?.close();
    }, [pending]);
    const onPortrait = useCallback(
        (id: string, url: string) => setPortraits((p) => ({ ...p, [id]: url })),
        [],
    );
    function select(id: string) {
        const next = state.recruits.find((r) => r.id === id);
        if (next) {
            setSelected(id);
            setDraft(next.appearance);
            setError("");
        }
    }
    function changeRecruit(id: string) {
        if (id === selected) return;
        if (dirty) setPending(id);
        else select(id);
    }
    function changePanel(next: Panel) {
        setPanel(next);
        setFocus(next === "Appearance" ? "face" : "body");
    }
    function assign(slot: Slot, id: string | null) {
        try {
            commit(equip(state, recruit.id, slot, id));
            setError("");
        } catch (e) {
            setError(String(e instanceof Error ? e.message : e));
        }
    }
    function saveAppearance() {
        const next = editRecruit(state, recruit.id, { appearance: draft });
        commit(next);
        setDraft(next.recruits.find((r) => r.id === recruit.id)!.appearance);
    }
    function savePersonnel(details: PersonnelDetails) {
        const next = editRecruit(state, recruit.id, details);
        commit(next);
        setDraft((d) => ({ ...d, name: next.recruits.find((r) => r.id === recruit.id)!.name }));
    }
    return (
        <main className="squad-screen">
            <header className="squad-header">
                <Link to="/" className="squad-back label text-secondary hover:text-accent">
                    ‹ Menu
                </Link>
                <h1 className="squad-title">Squad</h1>
                <div className="squad-save">
                    <small role="status">{notice}</small>
                </div>
            </header>
            <div className="squad-workspace">
                <aside className="squad-roster" aria-label="Squad roster">
                    <div className="roster-heading">
                        <h2>OPERATIVES</h2>
                        <span>
                            {String(state.recruits.length).padStart(2, "0")} /{" "}
                            {String(MAX_RECRUITS).padStart(2, "0")}
                        </span>
                    </div>
                    <div className="roster-list">
                        {state.recruits.map((r, index) => (
                            <button
                                key={r.id}
                                className={`roster-card ${r.id === recruit.id ? "selected" : ""}`}
                                aria-pressed={r.id === recruit.id}
                                onClick={() => changeRecruit(r.id)}
                            >
                                <div className="roster-portrait">
                                    {portraits[r.id] ? (
                                        <img src={portraits[r.id]} alt={`${r.name} portrait`} />
                                    ) : (
                                        <span>{r.callsign.slice(0, 1)}</span>
                                    )}
                                    <small>0{index + 1}</small>
                                </div>
                                <div className="roster-person">
                                    <span>{r.role}</span>
                                    <strong>{r.callsign}</strong>
                                    <p>{r.name}</p>
                                    <small>
                                        {itemById(r.equipment.primary)?.name ??
                                            "Awaiting equipment"}
                                    </small>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>
                <CharacterViewport
                    recruit={recruit}
                    appearance={draft}
                    recruits={state.recruits}
                    focus={focus}
                    onFocus={setFocus}
                    onPortrait={onPortrait}
                    onEquipment={setImages}
                />
                <section className="squad-inspector" aria-label="Operative management">
                    <nav className="inspector-tabs" aria-label="Operative sections">
                        {(["Loadout", "Stats", "Appearance", "Personnel"] as const).map((p) => (
                            <button
                                key={p}
                                aria-pressed={panel === p}
                                onClick={() => changePanel(p)}
                            >
                                {p}
                                {p === "Appearance" && dirty && <i aria-label="Unsaved changes" />}
                            </button>
                        ))}
                    </nav>
                    {error && (
                        <p role="alert" className="sq-error">
                            {error}
                        </p>
                    )}
                    <div
                        className={`inspector-content ${panel === "Appearance" ? "inspector-appearance" : ""}`}
                    >
                        {panel === "Loadout" ? (
                            <LoadoutPanel
                                recruit={recruit}
                                state={state}
                                images={images}
                                onEquip={assign}
                                onColors={(armorColors) =>
                                    commit(editRecruit(state, recruit.id, { armorColors }))
                                }
                            />
                        ) : panel === "Stats" ? (
                            <StatsPanel recruit={recruit} />
                        ) : panel === "Appearance" ? (
                            <AppearancePanel
                                value={draft}
                                onChange={setDraft}
                                dirty={dirty}
                                onSave={saveAppearance}
                                onReset={() => setDraft(recruit.appearance)}
                            />
                        ) : (
                            <DossierPanel recruit={recruit} onSave={savePersonnel} />
                        )}
                    </div>
                </section>
            </div>
            <dialog ref={discard} className="sq-dialog" onCancel={() => setPending(null)}>
                <span className="sq-eyebrow">UNSAVED APPEARANCE</span>
                <h2>Keep this look?</h2>
                <p>Apply these changes before switching operatives, or discard the preview.</p>
                <div className="sq-dialog-actions">
                    <button
                        className="btn sq-primary"
                        onClick={() => {
                            saveAppearance();
                            if (pending) select(pending);
                            setPending(null);
                        }}
                    >
                        Apply & switch
                    </button>
                    <button
                        onClick={() => {
                            if (pending) select(pending);
                            setPending(null);
                        }}
                    >
                        Discard & switch
                    </button>
                    <button onClick={() => setPending(null)}>Keep editing</button>
                </div>
            </dialog>
        </main>
    );
}
