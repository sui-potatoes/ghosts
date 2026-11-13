// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Dossier tab: the fixed name, rank and experience, the voice (a part of
 * the look's draft, auditioned on Confirm) and the dismissal with its prompt.
 */

import { previewVoice } from "../../../audio";
import { FREE_RECRUITS, VOICES, type ChainRecruit } from "../../../chain";
import { ActionRow, Prompt, ReadoutLine, Stepper, type Command, type GlyphSet } from "../../../ui";
import type { Write } from "./Loadout";
import { dismissalNote } from "./rules";
import { RankProgress } from "./parts";

export function Dossier({
    recruit,
    voice,
    dirty,
    write,
    onVoice,
    save,
    discard,
    onDismiss,
    toRoster,
}: {
    recruit: ChainRecruit;
    voice: number;
    dirty: boolean;
    write: Write;
    onVoice: (voice: number) => void;
    save: () => void;
    discard: () => void;
    onDismiss: () => void;
    toRoster: Command;
}) {
    const saving: Command[] = dirty
        ? [{ action: "reset", label: "Reset", tone: "danger", run: discard }]
        : [];
    return (
        <>
            <ReadoutLine label="Name">{recruit.metadata.name}</ReadoutLine>
            <RankProgress rank={recruit.rank.$kind} xp={recruit.xp} />
            <div className="hqs-gap" />
            <Stepper
                id="dossier-voice"
                group="inspector"
                label="Voice"
                options={VOICES.map((v) => [String(v.id), v.label])}
                value={String(voice)}
                onChange={(id) => {
                    onVoice(Number(id));
                    previewVoice(Number(id));
                }}
                title="Voice"
                hint={dirty ? "Saves with the look" : "What they say on the field radio"}
                commands={[
                    { action: "nav", label: "Change", glyph: "lr" },
                    dirty
                        ? write("Save", save)
                        : {
                              action: "confirm",
                              label: "Audition",
                              tone: "primary",
                              run: () => previewVoice(voice),
                          },
                    ...saving,
                    toRoster,
                ]}
            />
            <ActionRow
                id="dossier-dismiss"
                group="inspector"
                label="Dismiss"
                tone="danger"
                title="Dismiss"
                hint="Ends the contract for good; their gear returns to the armory"
                commands={[write("Dismiss", onDismiss, { tone: "danger" }), toRoster]}
            />
        </>
    );
}

export function DismissPrompt({
    recruit,
    glyphs,
    onConfirm,
    onCancel,
}: {
    recruit: ChainRecruit;
    glyphs: GlyphSet;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const gear = [
        recruit.weapon?.name,
        recruit.armor?.name,
        ...recruit.utilities.map((u) => u.name),
    ]
        .filter(Boolean)
        .join(", ");
    return (
        <Prompt
            id="prompt-dismiss"
            tone="danger"
            eyebrow="Contract termination"
            title={`Dismiss ${recruit.metadata.name}?`}
            lines={[["Gear", gear || "None carried"]]}
            confirm={{ label: "Dismiss", run: onConfirm }}
            cancel={{ label: "Keep", run: onCancel }}
            glyphs={glyphs}
        >
            {recruit.metadata.name} leaves the squad for good; their gear returns to the armory.{" "}
            {dismissalNote(FREE_RECRUITS)}
        </Prompt>
    );
}
