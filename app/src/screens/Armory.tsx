// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Armory at `/headquarters/armory`: every weapon and armor the account
 * holds — in storage or issued — on a full stage. Rifles get a bench: draft
 * fittings (one per type, three in all) against the live 3D model and stat
 * deltas, then apply them in one transaction, minting what is not in stock
 * (testnet). Gear is issued to recruits from here, and the supply catalog
 * (testnet requisition) lives here too. See `src/features/headquarters/README.md`.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ATTACHMENTS, itemById } from "@ghosts/squad/catalog";
import type { Equipment, WeaponAttachments } from "@ghosts/squad/types";

import {
    fittingsTx,
    issueTx,
    requisitionTx,
    unequipArmorTx,
    unequipWeaponTx,
    type ChainArmor,
    type ChainRecruit,
    type ChainUpgrade,
    type ChainWeapon,
    type Step,
} from "../chain";
import { PadHints } from "../components/PadHints";
import {
    armorInventory,
    armorStats,
    fitAttachments,
    fitCount,
    fitOf,
    fittingsOf,
    MAX_FITTINGS,
    sameFit,
    stockCounts,
    weaponInventory,
    weaponStats,
    type Fit,
    type Gear,
    type Held,
} from "../features/headquarters/armory";
import {
    ArmorBench,
    RequisitionBench,
    UpgradeBench,
    WeaponBench,
    type CatalogEntry,
} from "../features/headquarters/components/ArmoryBench";
import {
    ArmoryInventory,
    type Category,
    type Selection,
} from "../features/headquarters/components/ArmoryInventory";
import { Gate, HqHeader } from "../features/headquarters/components/Chrome";
import { TxOverlay } from "../features/headquarters/components/TxOverlay";
import { useEquipmentImages } from "../features/headquarters/equipmentImages";
import { armorModel, weaponModel } from "../features/headquarters/mapping";
import { useHeadquarters } from "../features/headquarters/useHeadquarters";
import { WeaponPreview } from "../features/squad/components/WeaponPreview";
import "../features/squad/squad.css";
import "../features/headquarters/headquarters.css";

const RIFLES = [
    { tier: 1, name: "Standard Rifle" },
    { tier: 2, name: "Sharpshooter Rifle" },
    { tier: 3, name: "Plasma Rifle" },
];
const ARMORS = [
    { tier: 1, name: "Light Armor" },
    { tier: 2, name: "Medium Armor" },
    { tier: 3, name: "Heavy Armor" },
];
const STANDARD_RIFLE = itemById("mx4")!;

export default function Armory() {
    const [params] = useSearchParams();
    const { accountId, account, armory, action, recruits, gate } = useHeadquarters();
    return (
        <ArmoryView
            accountId={accountId.data}
            upgrades={account.data?.upgrades}
            armory={armory}
            recruits={recruits}
            action={action}
            gate={gate}
            initialItem={params.get("item")}
        />
    );
}

export interface ArmoryViewProps {
    /** The account id; null when the address has none, undefined while unknown. */
    accountId: string | null | undefined;
    upgrades: ChainUpgrade[] | undefined;
    armory: { weapons: ChainWeapon[]; armors: ChainArmor[] };
    recruits: ChainRecruit[];
    action: { busy: string | null; error: string; run(steps: Step[]): Promise<boolean> };
    /** A notice to show instead of the workspace (deployment, sign-in, reading). */
    gate: ReactNode;
    /** A weapon or armor to open with (`?item=`). */
    initialItem?: string | null;
}

/** The armory itself, fed by `Armory` (or anything else holding the same data). */
export function ArmoryView({
    accountId,
    upgrades: held,
    armory,
    recruits,
    action,
    gate,
    initialItem,
}: ArmoryViewProps) {
    const navigate = useNavigate();
    const images = useEquipmentImages();

    const [category, setCategory] = useState<Category>("weapons");
    const [selection, setSelection] = useState<Selection | null>(() =>
        initialItem ? { kind: "weapon", id: initialItem } : null,
    );
    const [drafts, setDrafts] = useState<Record<string, Fit>>({});
    const [preview, setPreview] = useState<string | null>(null);

    const weapons = useMemo(
        () => weaponInventory(armory.weapons, recruits),
        [armory.weapons, recruits],
    );
    const armors = useMemo(
        () => armorInventory(armory.armors, recruits),
        [armory.armors, recruits],
    );
    const upgrades = useMemo(() => held ?? [], [held]);
    const stock = useMemo(() => stockCounts(upgrades), [upgrades]);
    const fitted = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const { item } of weapons)
            for (const id of Object.values(fitAttachments(fitOf(item.upgrades))))
                if (id) counts[id] = (counts[id] ?? 0) + 1;
        return counts;
    }, [weapons]);

    // What is selected: an explicit choice, else the first item of the category.
    const byId = (list: Held<Gear>[], id: string) => list.find((h) => h.item.id === id);
    const fallback: Selection | null =
        category === "weapons" && weapons[0]
            ? { kind: "weapon", id: weapons[0].item.id }
            : category === "armor" && armors[0]
              ? { kind: "armor", id: armors[0].item.id }
              : category === "upgrades" && ATTACHMENTS.find((a) => stock[a.id] || fitted[a.id])
                ? {
                      kind: "upgrade",
                      attachment: ATTACHMENTS.find((a) => stock[a.id] || fitted[a.id])!.id,
                  }
                : null;
    let current: Selection | null = selection ?? fallback;
    // A deep link may name armor; an issued item may have vanished after a write.
    if (current?.kind === "weapon" && !byId(weapons, current.id))
        current = byId(armors, current.id) ? { kind: "armor", id: current.id } : fallback;
    if (current?.kind === "armor" && !byId(armors, current.id)) current = fallback;

    const weapon = current?.kind === "weapon" ? byId(weapons, current.id) : undefined;
    const armor = current?.kind === "armor" ? byId(armors, current.id) : undefined;
    const fit = useMemo(() => fitOf(weapon?.item.upgrades), [weapon]);
    const draft = (weapon && drafts[weapon.item.id]) || fit;
    const draftKey = JSON.stringify(draft);
    // A stable attachments object: the preview rebuilds its scene when this changes.
    const draftAttachments = useMemo(() => fitAttachments(draft), [draftKey]);
    const drafted = new Set(
        Object.entries(drafts)
            .filter(([id, d]) => {
                const w = byId(weapons, id);
                return w && !sameFit(fitOf(w.item.upgrades), d);
            })
            .map(([id]) => id),
    );

    const catalog = useMemo<{ title: string; entries: CatalogEntry[] }[]>(
        () => [
            {
                title: "Rifles",
                entries: RIFLES.map(({ tier, name }) => {
                    const model = itemById(weaponModel({ name }));
                    return {
                        key: `rifle-${tier}`,
                        label: name,
                        detail: model?.stat ?? "",
                        image: model && images[model.id],
                        requisition: { kind: "rifle", tier },
                    };
                }),
            },
            {
                title: "Armor",
                entries: ARMORS.map(({ tier, name }) => {
                    const model = itemById(armorModel({ name }));
                    return {
                        key: `armor-${tier}`,
                        label: name,
                        detail: model?.stat ?? "",
                        image: model && images[model.id],
                        requisition: { kind: "armor", tier },
                    };
                }),
            },
            {
                title: "Upgrades",
                entries: ATTACHMENTS.map((a) => ({
                    key: a.id,
                    label: a.name,
                    detail: a.stat,
                    image: images[a.id],
                    requisition: { kind: a.slot, tier: a.tier },
                })),
            },
        ],
        [images],
    );

    // The stage: the selected item, the drafted fit for rifles.
    const stage = useMemo<{
        item: Equipment;
        attachments?: WeaponAttachments;
        title: string;
    } | null>(() => {
        if (current?.kind === "requisition") {
            const key = preview ?? "rifle-1";
            if (key.startsWith("rifle-")) {
                const name = RIFLES[+key.slice(6) - 1].name;
                return { item: itemById(weaponModel({ name }))!, title: name };
            }
            if (key.startsWith("armor-")) {
                const name = ARMORS[+key.slice(6) - 1].name;
                return { item: itemById(armorModel({ name }))!, title: name };
            }
            const a = ATTACHMENTS.find((x) => x.id === key)!;
            return { item: STANDARD_RIFLE, attachments: { [a.slot]: a.id }, title: a.name };
        }
        if (current?.kind === "upgrade") {
            const a = ATTACHMENTS.find((x) => x.id === current.attachment)!;
            return { item: STANDARD_RIFLE, attachments: { [a.slot]: a.id }, title: a.name };
        }
        return null;
    }, [current?.kind, current && "attachment" in current ? current.attachment : null, preview]);

    const busy = !!action.busy;
    const acc = accountId ?? null;

    function select(s: Selection) {
        setSelection(s);
        if (s.kind === "requisition") setPreview(null);
    }

    function run(label: string, build: () => ReturnType<typeof requisitionTx>) {
        return action.run([{ label, build }]);
    }

    async function apply() {
        if (!weapon || !acc) return;
        const id = weapon.item.id;
        const ok = await run(`Fitting ${weapon.item.name}`, () =>
            fittingsTx(
                acc,
                { id, upgrades: weapon.item.upgrades ?? [] },
                upgrades,
                fittingsOf(draft),
                weapon.carrier?.objectId ?? null,
            ),
        );
        if (ok)
            setDrafts((d) => {
                const next = { ...d };
                delete next[id];
                return next;
            });
    }

    function issue(kind: "weapon" | "armor", held: Held<Gear>, to: ChainRecruit) {
        if (!acc) return;
        void run(`Issuing ${held.item.name} to ${to.metadata.name}`, () =>
            issueTx(acc, kind, held.item.id, held.carrier?.objectId ?? null, {
                id: to.objectId,
                equipped: !!(kind === "weapon" ? to.weapon : to.armor),
            }),
        );
    }

    function store(kind: "weapon" | "armor", held: Held<Gear>) {
        if (!acc || !held.carrier) return;
        const from = held.carrier.objectId;
        void run(`Storing ${held.item.name}`, () =>
            kind === "weapon" ? unequipWeaponTx(acc, from) : unequipArmorTx(acc, from),
        );
    }

    const noAccount = !gate && accountId === null;
    const stageItem = weapon
        ? itemById(weaponModel(weapon.item))
        : armor
          ? itemById(armorModel(armor.item))
          : stage?.item;
    const stageAttachments = weapon ? draftAttachments : stage?.attachments;
    const stageTitle = weapon?.item.name ?? armor?.item.name ?? stage?.title;
    const stageDraft = !!weapon && !sameFit(fit, draft);

    return (
        <main className="squad-screen hq-screen">
            <HqHeader
                status={`${weapons.length} weapons · ${armors.length} armor · ${Object.values(stock).reduce((n, c) => n + c, 0)} upgrades`}
            />
            {gate ??
                (noAccount ? (
                    <Gate
                        heading="NO ACCOUNT ON FILE"
                        action="Hire your squad"
                        onAction={() => navigate("/headquarters")}
                    >
                        The armory opens with your account. Hiring the free squad sets it up.
                    </Gate>
                ) : (
                    <div className="squad-workspace hq-armory" inert={busy}>
                        <ArmoryInventory
                            category={category}
                            onCategory={(c) => {
                                setCategory(c);
                                setSelection(null);
                            }}
                            weapons={weapons}
                            armors={armors}
                            stock={stock}
                            fitted={fitted}
                            selection={current}
                            onSelect={select}
                            drafted={drafted}
                            images={images}
                        />
                        <section className="hq-stage hq-armory-stage" aria-label="Inspection stage">
                            {stageItem ? (
                                <>
                                    <div className="stage-identity">
                                        <span>
                                            {stageItem.type}
                                            {stageDraft && " · DRAFT FITTINGS"}
                                        </span>
                                        <h2>{stageTitle}</h2>
                                        <p>
                                            {weapon
                                                ? weapon.carrier
                                                    ? `Issued to ${weapon.carrier.metadata.name}`
                                                    : "In armory"
                                                : armor
                                                  ? armor.carrier
                                                      ? `Worn by ${armor.carrier.metadata.name}`
                                                      : "In armory"
                                                  : current?.kind === "upgrade"
                                                    ? "Shown on a standard rifle"
                                                    : "Supply catalog"}
                                        </p>
                                    </div>
                                    <WeaponPreview
                                        item={stageItem}
                                        attachments={stageAttachments}
                                    />
                                </>
                            ) : (
                                <div className="hq-armory-empty">
                                    <span className="sq-eyebrow">ARMORY</span>
                                    <p>
                                        Nothing on the racks yet. Requisition gear from the supply
                                        catalog to start fitting it.
                                    </p>
                                    <button
                                        className="btn sq-primary"
                                        onClick={() => select({ kind: "requisition" })}
                                    >
                                        Open supply catalog <span>↗</span>
                                    </button>
                                </div>
                            )}
                        </section>
                        <section className="squad-inspector" aria-label="Bench">
                            {action.error && (
                                <p role="alert" className="sq-error">
                                    {action.error}
                                </p>
                            )}
                            <div className="inspector-content">
                                {weapon ? (
                                    <WeaponBench
                                        held={weapon}
                                        fit={fit}
                                        draft={draft}
                                        now={weaponStats(weapon.item, fit)}
                                        next={weaponStats(weapon.item, draft)}
                                        stock={stock}
                                        images={images}
                                        recruits={recruits}
                                        busy={busy}
                                        notice={
                                            fitCount(draft) >= MAX_FITTINGS
                                                ? "Three fittings is the limit — clear a type to fit another."
                                                : ""
                                        }
                                        onDraft={(next) =>
                                            setDrafts((d) => ({ ...d, [weapon.item.id]: next }))
                                        }
                                        onApply={() => void apply()}
                                        onIssue={(to) => issue("weapon", weapon, to)}
                                        onReturn={() => store("weapon", weapon)}
                                    />
                                ) : armor ? (
                                    <ArmorBench
                                        held={armor}
                                        stats={armorStats(armor.item)}
                                        recruits={recruits}
                                        busy={busy}
                                        onIssue={(to) => issue("armor", armor, to)}
                                        onReturn={() => store("armor", armor)}
                                    />
                                ) : current?.kind === "upgrade" ? (
                                    <UpgradeBench
                                        attachment={current.attachment}
                                        stock={stock[current.attachment] ?? 0}
                                        fittedOn={weapons.filter(
                                            ({ item }) =>
                                                fitAttachments(fitOf(item.upgrades))[
                                                    ATTACHMENTS.find(
                                                        (a) => a.id === current.attachment,
                                                    )!.slot
                                                ] === current.attachment,
                                        )}
                                        candidates={weapons.filter(({ item }) => {
                                            const a = ATTACHMENTS.find(
                                                (x) => x.id === current.attachment,
                                            )!;
                                            const f = fitOf(item.upgrades);
                                            return (
                                                f[a.slot] !== a.tier &&
                                                (!!f[a.slot] || fitCount(f) < MAX_FITTINGS)
                                            );
                                        })}
                                        busy={busy}
                                        onOpen={(weaponId, fitHere) => {
                                            const a = ATTACHMENTS.find(
                                                (x) => x.id === current.attachment,
                                            )!;
                                            const w = byId(weapons, weaponId);
                                            if (fitHere && w)
                                                setDrafts((d) => ({
                                                    ...d,
                                                    [weaponId]: {
                                                        ...(d[weaponId] ?? fitOf(w.item.upgrades)),
                                                        [a.slot]: a.tier,
                                                    },
                                                }));
                                            setCategory("weapons");
                                            setSelection({ kind: "weapon", id: weaponId });
                                        }}
                                    />
                                ) : (
                                    <RequisitionBench
                                        groups={catalog}
                                        preview={preview}
                                        busy={busy}
                                        onPreview={setPreview}
                                        onRequisition={(entry) =>
                                            acc &&
                                            void run(`Requisitioning ${entry.label}`, () =>
                                                requisitionTx(acc, entry.requisition),
                                            )
                                        }
                                    />
                                )}
                            </div>
                        </section>
                    </div>
                ))}
            <TxOverlay label={action.busy} />
            <PadHints className="squad-pad-hints" entries={[["b", "Back"]]} />
        </main>
    );
}
