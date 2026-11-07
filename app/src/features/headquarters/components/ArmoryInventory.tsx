// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import {
    ATTACHMENTS,
    ATTACHMENT_SLOTS,
    ATTACHMENT_SLOT_NAMES,
    itemById,
} from "@ghosts/squad/catalog";

import { fitOf, type Gear, type Held } from "../armory";
import { armorModel, weaponModel } from "../mapping";

export type Category = "weapons" | "armor" | "mods";
export type Selection =
    | { kind: "weapon" | "armor"; id: string }
    | { kind: "upgrade"; attachment: string }
    | { kind: "requisition" };

interface Props {
    category: Category;
    onCategory(category: Category): void;
    weapons: Held<Gear>[];
    armors: Held<Gear>[];
    stock: Record<string, number>;
    /** Weapons carrying each attachment, by catalog id. */
    fitted: Record<string, number>;
    selection: Selection | null;
    onSelect(selection: Selection): void;
    /** Weapons with unsaved fittings. */
    drafted: Set<string>;
    images: Record<string, string>;
}

const firstName = (name: string) => name.split(" ")[0];

/** The armory's contents by category, each item with where it is. */
export function ArmoryInventory(props: Props) {
    const { category, selection, images } = props;
    const upgrades = ATTACHMENTS.filter((a) => props.stock[a.id] || props.fitted[a.id]);
    const counts: Record<Category, number> = {
        weapons: props.weapons.length,
        armor: props.armors.length,
        mods: Object.values(props.stock).reduce((n, c) => n + c, 0),
    };
    const isSelected = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection);

    return (
        <aside className="squad-roster hq-inventory" aria-label="Armory inventory">
            <nav className="hq-inventory-tabs" aria-label="Inventory categories">
                {(["weapons", "armor", "mods"] as const).map((c) => (
                    <button
                        key={c}
                        aria-pressed={category === c}
                        onClick={() => props.onCategory(c)}
                    >
                        {c}
                        <span>{String(counts[c]).padStart(2, "0")}</span>
                    </button>
                ))}
            </nav>
            <div className="roster-list">
                {category === "weapons" &&
                    props.weapons.map(({ item, carrier }) => {
                        const fit = fitOf(item.upgrades);
                        const model = itemById(weaponModel(item));
                        const s = { kind: "weapon", id: item.id } as const;
                        return (
                            <Row
                                key={item.id}
                                image={model && images[model.id]}
                                name={item.name}
                                status={
                                    carrier
                                        ? `Issued · ${firstName(carrier.metadata.name)}`
                                        : "In armory"
                                }
                                selected={isSelected(s)}
                                drafted={props.drafted.has(item.id)}
                                onClick={() => props.onSelect(s)}
                            >
                                <span className="hq-fit-pips" aria-label="Mods">
                                    {ATTACHMENT_SLOTS.map((slot) => (
                                        <i
                                            key={slot}
                                            title={ATTACHMENT_SLOT_NAMES[slot]}
                                            className={fit[slot] ? "on" : ""}
                                        >
                                            {fit[slot] ?? ""}
                                        </i>
                                    ))}
                                </span>
                            </Row>
                        );
                    })}
                {category === "armor" &&
                    props.armors.map(({ item, carrier }) => {
                        const model = itemById(armorModel(item));
                        const s = { kind: "armor", id: item.id } as const;
                        return (
                            <Row
                                key={item.id}
                                image={model && images[model.id]}
                                name={item.name}
                                status={
                                    carrier
                                        ? `Worn · ${firstName(carrier.metadata.name)}`
                                        : "In armory"
                                }
                                selected={isSelected(s)}
                                onClick={() => props.onSelect(s)}
                            />
                        );
                    })}
                {category === "mods" &&
                    upgrades.map((a) => {
                        const s = { kind: "upgrade", attachment: a.id } as const;
                        return (
                            <Row
                                key={a.id}
                                image={images[a.id]}
                                name={a.name}
                                status={`×${props.stock[a.id] ?? 0} in stock${props.fitted[a.id] ? ` · ${props.fitted[a.id]} fitted` : ""}`}
                                selected={isSelected(s)}
                                onClick={() => props.onSelect(s)}
                            />
                        );
                    })}
                {counts[category] === 0 && !(category === "mods" && upgrades.length) && (
                    <p className="sq-footnote">
                        {category === "weapons"
                            ? "No rifles on file. Recruits without one carry the standard issue, which is not an armory item."
                            : category === "armor"
                              ? "No armor on file."
                              : "No mods in stock."}
                    </p>
                )}
            </div>
            <button
                className={`hq-requisition-entry ${selection?.kind === "requisition" ? "selected" : ""}`}
                onClick={() => props.onSelect({ kind: "requisition" })}
            >
                <span>＋ Requisition</span>
                <small>Free</small>
            </button>
        </aside>
    );
}

function Row(props: {
    image?: string;
    name: string;
    status: string;
    selected: boolean;
    drafted?: boolean;
    onClick(): void;
    children?: React.ReactNode;
}) {
    return (
        <button
            className={`hq-gear-row ${props.selected ? "selected" : ""}`}
            aria-pressed={props.selected}
            onClick={props.onClick}
        >
            <span className="hq-gear-thumb">{props.image && <img src={props.image} alt="" />}</span>
            <span className="hq-gear-text">
                <strong>{props.name}</strong>
                <small>
                    {props.status}
                    {props.drafted && <i aria-label="Unsaved mods" />}
                </small>
                {props.children}
            </span>
        </button>
    );
}
