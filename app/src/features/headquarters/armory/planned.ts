// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Utilities the catalog lists as `planned` (`packages/catalog/items.json`):
 * designed, with a model, and not in the contract. The Armory's requisition
 * catalog is the one place they appear, with requisition inactive. They have
 * no kind and no order, so nothing here can reach a transaction; the chain's
 * utility list (`../utilities.ts`), the ranked economy and the squad catalog
 * keep reading `chain` entries only.
 */

import itemsCatalog from "../../../../../packages/catalog/items.json" with { type: "json" };

/** Why a planned utility cannot be requisitioned. */
export const NOT_IN_SUPPLY = "Not in supply";

/** The requisition command's refusal for a supply line: one without an order is not in supply. */
export const requisitionDeny = (line: { order?: unknown }): string | undefined =>
    line.order ? undefined : NOT_IN_SUPPLY;

/** The Armory-only stage models (`@ghosts/squad/studio/armory-utilities`). */
export type PlannedModel = "smoke" | "flash";

export interface PlannedUtility {
    /** The catalog id. */
    id: string;
    name: string;
    description: string;
    model: PlannedModel;
    /** The bench's lines, label and value. */
    lines: { label: string; value: string }[];
}

/** What the design settles for each, by catalog id (`docs/plans/utilities-smoke-flash.md`). */
const LINES: Record<string, PlannedUtility["lines"]> = {
    "smoke-grenade": [
        { label: "Range", value: "5 tiles" },
        { label: "Area", value: "2-tile cloud" },
        { label: "Effect", value: "Smoke · worse aim, harder to hit" },
        { label: "Uses", value: "1 per match" },
    ],
    flashbang: [
        { label: "Range", value: "5 tiles" },
        { label: "Area", value: "1-tile burst" },
        { label: "Effect", value: "Stun · no action points for 1 turn" },
        { label: "Uses", value: "1 per match" },
    ],
};

const MODELS: readonly string[] = ["smoke", "flash"] satisfies PlannedModel[];

interface RawItem {
    id: string;
    type: string;
    status: string;
    name: string;
    description: string;
    clientIds?: string[];
}

/** The planned utilities, in the catalog's order. */
export const PLANNED_UTILITIES: PlannedUtility[] = (itemsCatalog.items as RawItem[])
    .filter((i) => i.type === "utility" && i.status === "planned")
    .flatMap((i) => {
        const model = i.clientIds?.[0];
        if (!model || !MODELS.includes(model) || !LINES[i.id]) return [];
        return [
            {
                id: i.id,
                name: i.name,
                description: i.description,
                model: model as PlannedModel,
                lines: LINES[i.id],
            },
        ];
    });
