// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ARMOR_FINISHES } from "@ghosts/squad/armor-colors";
import { ATTACHMENT_SLOTS, ATTACHMENT_SLOT_NAMES, itemById } from "@ghosts/squad/catalog";
import type { ArmorColors, Recruit as LocalRecruit } from "@ghosts/squad/types";

import {
    issueTx,
    unequipArmorTx,
    unequipWeaponTx,
    type ChainArmor,
    type ChainRecruit,
    type ChainWeapon,
} from "../../../chain";
import { attachmentFor, fitOf, MAX_FITTINGS } from "../armory";
import { armorModel, weaponModel } from "../mapping";

interface Props {
    accountId: string;
    recruit: ChainRecruit;
    /** The recruit as the studio sees it: catalog models for the saved gear. */
    local: LocalRecruit;
    colors: ArmorColors;
    onColors(colors: ArmorColors): void;
    weapons: ChainWeapon[];
    armors: ChainArmor[];
    images: Record<string, string>;
    busy: boolean;
    act(label: string, build: () => Transaction): void;
}

const armoryLink = (id?: string) => `/headquarters/armory${id ? `?item=${id}` : ""}`;

/**
 * The recruit's gear at a glance: what they carry, quick swaps from the
 * armory's racks, and the plate finish (part of their look). Fittings,
 * requisition and the full racks live in the Armory.
 */
export function LoadoutPanel(props: Props) {
    const { accountId, recruit, local, images, busy, act } = props;
    const [slot, setSlot] = useState<"primary" | "armor">("primary");
    const rid = recruit.objectId;
    const first = recruit.metadata.name.split(" ")[0];
    const primary = itemById(local.equipment.primary);
    const armor = itemById(local.equipment.armor);
    const fit = fitOf(recruit.weapon?.upgrades);

    return (
        <div className="loadout-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">LOADOUT</span>
                    <h3>Equipment</h3>
                </div>
                <Link className="sq-count hq-armory-link" to={armoryLink()}>
                    Armory ↗
                </Link>
            </div>
            <div className="loadout-slots">
                {(
                    [
                        [
                            "primary",
                            "Primary weapon",
                            recruit.weapon?.name ?? "Standard Issue Rifle",
                            primary,
                        ],
                        ["armor", "Body armor", recruit.armor?.name ?? "No body armor", armor],
                    ] as const
                ).map(([s, label, value, item], i) => (
                    <button
                        key={s}
                        className={slot === s ? "selected" : ""}
                        aria-pressed={slot === s}
                        onClick={() => setSlot(s)}
                    >
                        <span className="slot-number">0{i + 1}</span>
                        <span>
                            <small>{label}</small>
                            <strong>{value}</strong>
                        </span>
                        {item && images[item.id] ? (
                            <img src={images[item.id]} alt="" />
                        ) : (
                            <span className="slot-empty">＋</span>
                        )}
                    </button>
                ))}
            </div>

            {slot === "primary" && (
                <section className="hq-carried" aria-label="Carried rifle">
                    {recruit.weapon ? (
                        <>
                            <div className="inventory-heading">
                                <h4>Fittings</h4>
                                <span>
                                    {Object.keys(fit).length} / {MAX_FITTINGS}
                                </span>
                            </div>
                            <ul className="hq-fit-list">
                                {ATTACHMENT_SLOTS.map((s) => {
                                    const a = fit[s] ? attachmentFor(s, fit[s]!) : undefined;
                                    return (
                                        <li key={s} className={a ? "on" : ""}>
                                            <span>{ATTACHMENT_SLOT_NAMES[s]}</span>
                                            <strong>{a ? `${a.name} · ${a.stat}` : "—"}</strong>
                                        </li>
                                    );
                                })}
                            </ul>
                            <div className="hq-carried-actions">
                                <Link className="btn sq-primary" to={armoryLink(recruit.weapon.id)}>
                                    Fit in the armory <span>↗</span>
                                </Link>
                                <button
                                    className="btn sq-equipped"
                                    disabled={busy}
                                    onClick={() =>
                                        act(`Storing ${recruit.weapon!.name}`, () =>
                                            unequipWeaponTx(accountId, rid),
                                        )
                                    }
                                >
                                    Return to armory
                                </button>
                            </div>
                        </>
                    ) : (
                        <p className="sq-footnote">
                            Carrying the standard issue rifle. Draw a rifle from the racks below to
                            fit it in the armory.
                        </p>
                    )}
                </section>
            )}

            {slot === "armor" && (
                <>
                    {recruit.armor && (
                        <div className="hq-carried-actions">
                            <button
                                className="btn sq-equipped"
                                disabled={busy}
                                onClick={() =>
                                    act(`Storing ${recruit.armor!.name}`, () =>
                                        unequipArmorTx(accountId, rid),
                                    )
                                }
                            >
                                Return {recruit.armor.name} to armory
                            </button>
                        </div>
                    )}
                    {recruit.armor && (
                        <ArmorFinish colors={props.colors} onColors={props.onColors} />
                    )}
                </>
            )}

            <div className="inventory-heading">
                <h4>Racks</h4>
                <span>{slot === "primary" ? "Rifles in storage" : "Armor in storage"}</span>
            </div>
            <div className="hq-issue-list">
                {(slot === "primary" ? props.weapons : props.armors).map((g) => {
                    const model = itemById(slot === "primary" ? weaponModel(g) : armorModel(g));
                    const fitted = "upgrades" in g ? (g as ChainWeapon).upgrades.length : 0;
                    return (
                        <button
                            key={g.objectId}
                            disabled={busy}
                            onClick={() =>
                                act(`Issuing ${g.name} to ${recruit.metadata.name}`, () =>
                                    issueTx(
                                        accountId,
                                        slot === "primary" ? "weapon" : "armor",
                                        g.objectId,
                                        null,
                                        {
                                            id: rid,
                                            equipped: !!(slot === "primary"
                                                ? recruit.weapon
                                                : recruit.armor),
                                        },
                                    ),
                                )
                            }
                        >
                            {model && images[model.id] && <img src={images[model.id]} alt="" />}
                            <strong>{g.name}</strong>
                            <small>
                                {slot === "primary" ? `${fitted} / ${MAX_FITTINGS} fitted · ` : ""}
                                Issue to {first}
                            </small>
                        </button>
                    );
                })}
                {(slot === "primary" ? props.weapons : props.armors).length === 0 && (
                    <p className="sq-footnote">
                        Nothing in storage.{" "}
                        <Link to={armoryLink()}>Requisition in the armory ↗</Link>
                    </p>
                )}
            </div>
        </div>
    );
}

function ArmorFinish({
    colors,
    onColors,
}: {
    colors: ArmorColors;
    onColors(c: ArmorColors): void;
}) {
    return (
        <fieldset className="armor-finish">
            <legend>Armor finish</legend>
            <div className="armor-finishes">
                {ARMOR_FINISHES.map(({ name, colors: finish }) => (
                    <button
                        key={name}
                        aria-label={`${name} armor finish`}
                        aria-pressed={Object.entries(finish).every(
                            ([key, value]) => colors[key as keyof ArmorColors] === value,
                        )}
                        onClick={() => onColors({ ...finish })}
                    >
                        <span>
                            {Object.values(finish).map((color, i) => (
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
                            value={colors[key]}
                            onChange={(e) => onColors({ ...colors, [key]: e.target.value })}
                        />
                        <span>{label}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
