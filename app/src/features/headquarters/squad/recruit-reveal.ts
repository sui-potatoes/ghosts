// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The recruitment reveal as plain data, tested in `tests/hq-recruitment.test.ts`.
 * Four podiums stand dark; as the hired recruits land they come up one at a
 * time, left to right: first the light and the figurine (stage 1), a beat
 * later the plate with the name and rank (stage 2). A recruit that stood on
 * file before the hire is at stage 2 from the start. Progress is state in a
 * map, moved by timers in the host and by `settle` (a skip, reduced motion), so
 * the final state never depends on an animation event.
 */

/** 0 dark and empty, 1 lit with its figurine, 2 plate filled in. */
export type Stage = 0 | 1 | 2;
export type Stages = Readonly<Record<string, Stage>>;
export type Slots = readonly ({ objectId: string } | null)[];

/** The pause before the first light, after the figurines stand (ms). */
export const FIRST_BEAT = 500;
/** From a light to its plate (ms). */
export const PLATE_BEAT = 450;
/** From a plate to the next podium's light (ms). */
export const NEXT_BEAT = 650;
/** How long the reveal waits for the figurines to be built before it goes on anyway (ms). */
export const BUILD_WAIT = 6000;

/** Everyone listed stands complete: the screen was opened with them on file. */
export function standing(slots: Slots): Stages {
    const out: Record<string, Stage> = {};
    for (const s of slots) if (s) out[s.objectId] = 2;
    return out;
}

export const stageOf = (stages: Stages, id: string): Stage => stages[id] ?? 0;

/** The next step of the reveal: the first podium, left to right, not yet complete. */
export function nextStep(
    slots: Slots,
    stages: Stages,
): { id: string; index: number; to: 1 | 2 } | null {
    for (let index = 0; index < slots.length; index++) {
        const s = slots[index];
        if (!s) continue;
        const at = stageOf(stages, s.objectId);
        if (at < 2) return { id: s.objectId, index, to: (at + 1) as 1 | 2 };
    }
    return null;
}

/** One step on. */
export function advance(slots: Slots, stages: Stages): Stages {
    const step = nextStep(slots, stages);
    return step ? { ...stages, [step.id]: step.to } : stages;
}

/** Everything listed complete at once: a skip, or reduced motion. */
export function settle(slots: Slots, stages: Stages): Stages {
    return nextStep(slots, stages) ? { ...stages, ...standing(slots) } : stages;
}

/** The wait before the next step: a plate follows its light, a light follows the previous plate. */
export function beatBefore(step: { to: 1 | 2 }, first: boolean): number {
    return step.to === 2 ? PLATE_BEAT : first ? FIRST_BEAT : NEXT_BEAT;
}

/** Per podium: the light is up (and the figurine stands). */
export const litOf = (slots: Slots, stages: Stages): boolean[] =>
    slots.map((s) => !!s && stageOf(stages, s.objectId) >= 1);

/** Per podium: the plate shows its recruit. */
export const namedOf = (slots: Slots, stages: Stages): boolean[] =>
    slots.map((s) => !!s && stageOf(stages, s.objectId) >= 2);

/**
 * What the primary command is:
 * - `idle`: vacancies and nothing on the way: Hire squad;
 * - `waiting`: a hire is under way, nobody has landed to show yet;
 * - `revealing`: recruits are coming up: Skip;
 * - `settled`: the squad stands complete: Continue.
 */
export type Phase = "idle" | "waiting" | "revealing" | "settled";

export function phaseOf(slots: Slots, stages: Stages, pending: boolean): Phase {
    if (nextStep(slots, stages)) return "revealing";
    if (slots.length > 0 && slots.every(Boolean)) return "settled";
    return pending ? "waiting" : "idle";
}
