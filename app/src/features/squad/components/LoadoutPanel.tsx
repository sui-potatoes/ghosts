import { ARMOR_FINISHES } from "../armor-colors";
import { useState } from "react";
import { EQUIPMENT, SLOTS, SLOT_NAMES, itemById } from "../catalog";
import { available, totalWeight } from "../model";
import type { ArmorColors, Recruit, Slot, SquadState } from "../types";

interface Props {
    recruit: Recruit;
    state: SquadState;
    images: Record<string, string>;
    onColors(colors: ArmorColors): void;
    onEquip(slot: Slot, id: string | null): void;
}
export function LoadoutPanel({ recruit, state, images, onEquip, onColors }: Props) {
    const [slot, setSlot] = useState<Slot>("primary");
    return (
        <div className="loadout-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">LOADOUT</span>
                    <h3>Equipment</h3>
                </div>
                <span className="sq-count">{totalWeight(recruit).toFixed(1)} KG</span>
            </div>
            <div className="loadout-slots">
                {SLOTS.map((s) => {
                    const item = itemById(recruit.equipment[s]);
                    return (
                        <button
                            key={s}
                            className={slot === s ? "selected" : ""}
                            onClick={() => setSlot(s)}
                            aria-pressed={slot === s}
                        >
                            <span className="slot-number">0{SLOTS.indexOf(s) + 1}</span>
                            <span>
                                <small>{SLOT_NAMES[s]}</small>
                                <strong>{item?.name ?? "Unassigned"}</strong>
                            </span>
                            {item && images[item.id] ? (
                                <img src={images[item.id]} alt="" />
                            ) : (
                                <span className="slot-empty">＋</span>
                            )}
                        </button>
                    );
                })}
            </div>
            {slot === "armor" && recruit.equipment.armor && (
                <fieldset className="armor-finish">
                    <legend>Armor finish</legend>
                    <div className="armor-finishes">
                        {ARMOR_FINISHES.map(({ name, colors }) => (
                            <button
                                key={name}
                                title={name}
                                aria-label={`${name} armor finish`}
                                aria-pressed={Object.entries(colors).every(
                                    ([key, value]) =>
                                        recruit.armorColors[key as keyof ArmorColors] === value,
                                )}
                                onClick={() => onColors({ ...colors })}
                            >
                                <span>
                                    {Object.values(colors).map((color, i) => (
                                        <i key={i} style={{ backgroundColor: color }} />
                                    ))}
                                </span>
                                {name}
                            </button>
                        ))}
                    </div>
                    <div className="armor-color-channels">
                        {(
                            [
                                ["primary", "Plates"],
                                ["secondary", "Trim"],
                                ["accent", "Accents"],
                            ] as const
                        ).map(([key, label]) => (
                            <label key={key}>
                                <input
                                    type="color"
                                    aria-label={`Armor ${label.toLowerCase()} color`}
                                    value={recruit.armorColors[key]}
                                    onChange={(e) =>
                                        onColors({ ...recruit.armorColors, [key]: e.target.value })
                                    }
                                />
                                <span>{label}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            )}
            <div className="inventory-heading">
                <h4>Shared inventory</h4>
                <span>{SLOT_NAMES[slot]}</span>
            </div>
            <div className="equipment-list">
                {EQUIPMENT.filter((i) => i.slot === slot).map((item) => {
                    const assigned = recruit.equipment[slot] === item.id,
                        left = available(state, item.id);
                    return (
                        <article
                            key={item.id}
                            className={`equipment-card ${assigned ? "equipped" : ""}`}
                        >
                            <div className="equipment-image">
                                {images[item.id] ? (
                                    <img src={images[item.id]} alt={item.name} />
                                ) : (
                                    <span>Preparing render…</span>
                                )}
                                <span className="equipment-stock">{left} AVAILABLE</span>
                            </div>
                            <div className="equipment-description">
                                <span className="sq-eyebrow">{item.type}</span>
                                <h4>{item.name}</h4>
                                <p>{item.description}</p>
                                <div className="equipment-stats">
                                    <span>{item.stat}</span>
                                    <span>{item.weight.toFixed(1)} KG</span>
                                </div>
                                <button
                                    className={assigned ? "btn sq-equipped" : "btn sq-primary"}
                                    disabled={!assigned && !left}
                                    onClick={() => onEquip(slot, assigned ? null : item.id)}
                                >
                                    {assigned
                                        ? "✓ Equipped · return to inventory"
                                        : left
                                          ? "Equip operative ↗"
                                          : "All copies assigned"}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
            <p className="sq-footnote">Returning an item makes it available to another recruit.</p>
        </div>
    );
}
