// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { BodyShape } from "./body";

export type Sex = "female" | "male";
export interface Appearance {
    version: number;
    name: string;
    sex: Sex;
    shape: string;
    shapeAmount: number;
    values: Record<string, number>;
    body: BodyShape;
    skin: string;
    skinTint: string;
    warmth: number;
    roughness: number;
    blushColor: string;
    blushAmount: number;
    blushPlacement: string;
    blushSpread: number;
    eyes: string;
    hair: string;
    hairColor: string;
    brows: string;
    browColor: string;
    browThickness: number;
    browLength: number;
    browArch: number;
    browTail: number;
    browDensity: number;
    tattoo: string;
    tattooPlace: string;
    tattooColor: string;
    tattooOpacity: number;
    glasses: string;
    glassesColor: string;
    lensColor: string;
    lensTint: number;
    scar: string;
    scarPlace: string;
    scarAmount: number;
}
export interface MorphControl {
    key: string;
    label: string;
    group: string;
    low: string;
    high: string;
}
export interface Schema {
    controls: MorphControl[];
    shapes: string[];
}
export type Slot = "primary" | "sidearm" | "armor" | "utility";
export type AttachmentSlot = "clip" | "stock" | "laser" | "scope";
export type WeaponAttachments = Partial<Record<AttachmentSlot, string | null>>;
export interface Attachment {
    id: string;
    name: string;
    slot: AttachmentSlot;
    tier: 1 | 2 | 3;
    packed: bigint;
    stat: string;
}
export type Role = "Assault" | "Recon" | "Support" | "Marksman";
export interface ArmorColors {
    primary: string;
    secondary: string;
    accent: string;
}
export interface Recruit {
    id: string;
    name: string;
    callsign: string;
    role: Role;
    appearance: Appearance;
    armorColors: ArmorColors;
    equipment: Record<Slot, string | null>;
    /** Attachments fitted to the primary weapon; absent in older saves. */
    attachments?: WeaponAttachments;
}
export interface SquadState {
    version: 1;
    recruits: Recruit[];
    stock: Record<string, number>;
}
export interface Equipment {
    id: string;
    name: string;
    type: string;
    slot: Slot;
    description: string;
    weight: number;
    stat: string;
    model:
        | "rifle"
        | "sniper"
        | "plasma"
        | "pistol"
        | "armor"
        | "assassin-armor"
        | "assassin-mid"
        | "assassin-heavy"
        | "grenade"
        | "medkit";
}
