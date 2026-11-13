// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * What a recruit's utility means to the player: the slot count and the words
 * for the actions an item grants, read from the shared catalog
 * (`packages/catalog/actions.json`) by the action's `ActionKind` name.
 */

import catalog from "../../../../packages/catalog/actions.json";

/** `MAX_UTILITIES` in `ghosts::recruit`: how many utilities a recruit carries. */
export const UTILITY_SLOTS = 1;

/** An action as the chain's `Action` decodes: uses left, `null` for unlimited. */
export interface GrantedAction {
    uses: number | null;
    kind: { $kind: string };
}

export interface ActionLine {
    id: string;
    name: string;
    description: string;
    /** "1 use per match", "Unlimited". */
    uses: string;
}

const BY_ID = new Map(catalog.actions.map((a) => [a.id, a]));

/** Uses per match, as printed on a slot. */
export function usesText(uses: number | null): string {
    return uses === null ? "Unlimited" : `${uses} ${uses === 1 ? "use" : "uses"} per match`;
}

/** The lines for the actions an item grants, named and described from the catalog. */
export function actionLines(actions: readonly GrantedAction[]): ActionLine[] {
    return actions.map(({ kind, uses }) => {
        const entry = BY_ID.get(kind.$kind);
        return {
            id: kind.$kind,
            name: entry?.name ?? kind.$kind,
            description: entry?.description ?? "",
            uses: usesText(uses),
        };
    });
}
