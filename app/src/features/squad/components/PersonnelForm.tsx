import { useState } from "react";
import { ROLES } from "../model";
import type { Recruit, Role } from "../types";
export interface PersonnelDetails {
    name: string;
    callsign: string;
    role: Role;
}
export function PersonnelForm({
    recruit,
    onSave,
    submitLabel = "Save personnel record",
}: {
    recruit: PersonnelDetails;
    onSave(details: PersonnelDetails): void;
    submitLabel?: string;
}) {
    const [name, setName] = useState(recruit.name),
        [callsign, setCallsign] = useState(recruit.callsign),
        [role, setRole] = useState(recruit.role),
        [error, setError] = useState("");
    return (
        <form
            className="personnel-form"
            onSubmit={(e) => {
                e.preventDefault();
                try {
                    onSave({ name, callsign, role });
                    setError("");
                } catch (e) {
                    setError(e instanceof Error ? e.message : "Unable to save recruit.");
                }
            }}
        >
            <label className="sq-field">
                <span>Full name</span>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    minLength={2}
                    maxLength={40}
                    required
                    autoComplete="off"
                    placeholder="Mara Vale"
                />
            </label>
            <label className="sq-field">
                <span>Callsign</span>
                <input
                    className="callsign-input"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value)}
                    minLength={2}
                    maxLength={14}
                    required
                    autoComplete="off"
                    placeholder="VEX"
                />
            </label>
            <label className="sq-field">
                <span>Specialization</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                    ))}
                </select>
            </label>
            {error && (
                <p className="sq-error" role="alert">
                    {error}
                </p>
            )}
            <button type="submit" className="btn sq-primary">
                {submitLabel} <span>↗</span>
            </button>
        </form>
    );
}
export function DossierPanel({
    recruit,
    onSave,
}: {
    recruit: Recruit;
    onSave(details: PersonnelDetails): void;
}) {
    return (
        <div className="dossier-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">OPERATIVE RECORD</span>
                    <h3>Personnel</h3>
                </div>
            </div>
            <p className="sq-panel-copy">Set the operative’s name, callsign and squad role.</p>
            <PersonnelForm
                key={`${recruit.id}:${recruit.name}:${recruit.callsign}:${recruit.role}`}
                recruit={recruit}
                onSave={onSave}
            />
            <div className="personnel-stamp">
                <span>GHOSTS / PERSONNEL</span>
                <strong>ACTIVE</strong>
                <small>LOCAL PERSONNEL FILE / {recruit.id.slice(0, 8).toUpperCase()}</small>
            </div>
        </div>
    );
}
