// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { ARMOR_FINISHES } from "@ghosts/squad/armor-colors";
import { useState } from "react";
import {
    ATTACHMENTS,
    ATTACHMENT_SLOTS,
    ATTACHMENT_SLOT_NAMES,
    EQUIPMENT,
    SLOTS,
    SLOT_NAMES,
    itemById,
} from "@ghosts/squad/catalog";
import { available, totalWeight } from "@ghosts/squad/model";
import type { ArmorColors, AttachmentSlot, Recruit, Slot, SquadState } from "@ghosts/squad/types";
import { WeaponPreview } from "./WeaponPreview";
import { recruitStats } from "@ghosts/squad/stats";

interface Props {
    recruit: Recruit;
    state: SquadState;
    images: Record<string, string>;
    onColors(colors: ArmorColors): void;
    onEquip(slot: Slot, id: string | null): void;
    onAttachment(slot: AttachmentSlot, id: string | null): void;
}
export function LoadoutPanel({ recruit, state, images, onEquip, onColors, onAttachment }: Props) {
    const [slot, setSlot] = useState<Slot>("primary");
    const [attachmentSlot, setAttachmentSlot] = useState<AttachmentSlot>("clip");
    const primary = itemById(recruit.equipment.primary);
    const stats = recruitStats(recruit);
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
            {slot === "primary" && primary && (
                <section className="weapon-workbench" aria-label="Weapon attachments">
                    <div className="weapon-workbench-heading">
                        <div>
                            <span className="sq-eyebrow">WEAPON BENCH</span>
                            <h4>{primary.name}</h4>
                        </div>
                        <span className="sq-count">
                            {Object.values(recruit.attachments ?? {}).filter(Boolean).length} / 4
                            FITTED
                        </span>
                    </div>
                    <label className="weapon-type-select">
                        Weapon type
                        <select
                            aria-label="Weapon type"
                            value={primary.id}
                            onChange={(e) => onEquip("primary", e.target.value)}
                        >
                            {EQUIPMENT.filter((item) => item.slot === "primary").map((item) => (
                                <option
                                    key={item.id}
                                    value={item.id}
                                    disabled={
                                        item.id !== primary.id && available(state, item.id) === 0
                                    }
                                >
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <WeaponPreview item={primary} attachments={recruit.attachments} />
                    <div className="weapon-live-stats" aria-live="polite">
                        <span>
                            <b>
                                {stats.damage - stats.spread}–{stats.damage + stats.spread}
                            </b>{" "}
                            DMG
                        </span>
                        <span>
                            <b>{stats.ammo}</b> AMMO
                        </span>
                        <span>
                            <b>{stats.range}</b> RANGE
                        </span>
                        <span>
                            <b>{stats.critChance}%</b> CRIT
                        </span>
                        <span>
                            <b>{stats.aim}%</b> AIM
                        </span>
                    </div>
                    <div className="attachment-tabs" role="group" aria-label="Attachment family">
                        {ATTACHMENT_SLOTS.map((s) => (
                            <button
                                key={s}
                                aria-pressed={s === attachmentSlot}
                                onClick={() => setAttachmentSlot(s)}
                            >
                                {ATTACHMENT_SLOT_NAMES[s]}
                                {recruit.attachments?.[s] && <i aria-label="Installed" />}
                            </button>
                        ))}
                    </div>
                    <div className="attachment-options">
                        <button
                            className="attachment-default"
                            aria-pressed={!recruit.attachments?.[attachmentSlot]}
                            onClick={() => onAttachment(attachmentSlot, null)}
                        >
                            {attachmentSlot === "clip" || attachmentSlot === "stock"
                                ? "Standard part"
                                : "No attachment"}
                            <span>Base stats</span>
                        </button>
                        {ATTACHMENTS.filter((a) => a.slot === attachmentSlot).map((a) => {
                            const installed = recruit.attachments?.[attachmentSlot] === a.id;
                            const left = available(state, a.id);
                            return (
                                <button
                                    key={a.id}
                                    className="attachment-option"
                                    aria-pressed={installed}
                                    disabled={!installed && left === 0}
                                    onClick={() =>
                                        onAttachment(attachmentSlot, installed ? null : a.id)
                                    }
                                >
                                    {images[a.id] && <img src={images[a.id]} alt="" />}
                                    <span className="attachment-tier">
                                        TIER {a.tier.toString().padStart(2, "0")}
                                    </span>
                                    <strong>{a.name}</strong>
                                    <span className="attachment-bonus">{a.stat}</span>
                                    <small>
                                        {installed
                                            ? "✓ Installed · remove"
                                            : `${left} available · install`}
                                    </small>
                                </button>
                            );
                        })}
                    </div>
                    <p className="sq-footnote">
                        Fittings transfer when swapping rifles. Returning the rifle returns its
                        fittings.
                    </p>
                </section>
            )}
            {slot === "armor" && recruit.equipment.armor && (
                <fieldset className="armor-finish">
                    <legend>Armor finish</legend>
                    <div className="armor-finishes">
                        {ARMOR_FINISHES.map(({ name, colors }) => (
                            <button
                                key={name}
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
