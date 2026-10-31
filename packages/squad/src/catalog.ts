// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Attachment, AttachmentSlot, Equipment, Slot } from "./types";
export const ATTACHMENT_SLOT_NAMES: Record<AttachmentSlot, string> = {
  clip: "Expanded clip",
  stock: "Stock",
  laser: "Laser sight",
  scope: "Scope",
};
export const ATTACHMENT_SLOTS = Object.keys(
  ATTACHMENT_SLOT_NAMES,
) as AttachmentSlot[];
export const ATTACHMENTS: Attachment[] = [
  {
    id: "clip-1",
    name: "Basic Expanded Clip",
    slot: "clip",
    tier: 1,
    packed: 0x01n << 112n,
    stat: "+1 ammo",
  },
  {
    id: "clip-2",
    name: "Advanced Expanded Clip",
    slot: "clip",
    tier: 2,
    packed: 0x02n << 112n,
    stat: "+2 ammo",
  },
  {
    id: "clip-3",
    name: "Superior Expanded Clip",
    slot: "clip",
    tier: 3,
    packed: 0x03n << 112n,
    stat: "+3 ammo",
  },
  {
    id: "stock-1",
    name: "Basic Stock",
    slot: "stock",
    tier: 1,
    packed: 0x01n << 104n,
    stat: "+1 range",
  },
  {
    id: "stock-2",
    name: "Advanced Stock",
    slot: "stock",
    tier: 2,
    packed: 0x02n << 104n,
    stat: "+2 range",
  },
  {
    id: "stock-3",
    name: "Sniper Stock",
    slot: "stock",
    tier: 3,
    packed: 0x03n << 104n,
    stat: "+3 range",
  },
  {
    id: "laser-1",
    name: "Basic Laser Sight",
    slot: "laser",
    tier: 1,
    packed: 0x05n << 72n,
    stat: "+5% crit",
  },
  {
    id: "laser-2",
    name: "Advanced Laser Sight",
    slot: "laser",
    tier: 2,
    packed: 0x0an << 72n,
    stat: "+10% crit",
  },
  {
    id: "laser-3",
    name: "Sniper Laser Sight",
    slot: "laser",
    tier: 3,
    packed: 0x0fn << 72n,
    stat: "+15% crit",
  },
  {
    id: "scope-1",
    name: "Basic Scope",
    slot: "scope",
    tier: 1,
    packed: 0x05n << 8n,
    stat: "+5% aim",
  },
  {
    id: "scope-2",
    name: "Advanced Scope",
    slot: "scope",
    tier: 2,
    packed: 0x0an << 8n,
    stat: "+10% aim",
  },
  {
    id: "scope-3",
    name: "Superior Scope",
    slot: "scope",
    tier: 3,
    packed: 0x0fn << 8n,
    stat: "+15% aim",
  },
];
export const attachmentById = (id: string | null | undefined) =>
  ATTACHMENTS.find((item) => item.id === id);
export const SLOT_NAMES: Record<Slot, string> = {
  primary: "Primary weapon",
  sidearm: "Sidearm",
  armor: "Body armor",
  utility: "Utility",
};
export const SLOTS = Object.keys(SLOT_NAMES) as Slot[];
export const EQUIPMENT: Equipment[] = [
  {
    id: "mx4",
    name: "Standard Rifle",
    type: "ASSAULT RIFLE",
    slot: "primary",
    description:
      "Compact, dependable. The weapon you reach for when the contract gets complicated.",
    weight: 3.2,
    stat: "2–6 damage · 3 rounds · 10% crit",
    model: "rifle",
  },
  {
    id: "srs9",
    name: "Sharpshooter Rifle",
    type: "MARKSMAN RIFLE",
    slot: "primary",
    description:
      "A long sightline and a steady hand. Built for deliberate engagements.",
    weight: 4.7,
    stat: "4–6 damage · 3 rounds · 20% crit",
    model: "sniper",
  },
  {
    id: "plasma",
    name: "Plasma Rifle",
    type: "PLASMA RIFLE",
    slot: "primary",
    description: "High damage and critical potential for precise engagements.",
    weight: 3.2,
    stat: "5–7 damage · 3 rounds · 30% crit",
    model: "plasma",
  },
  {
    id: "k12",
    name: "K–12 Sidearm",
    type: "SERVICE PISTOL",
    slot: "sidearm",
    description:
      "A lightweight fallback for close encounters and depleted magazines.",
    weight: 0.9,
    stat: "2–4 damage · 6 rounds",
    model: "pistol",
  },
  {
    id: "spectre",
    name: "Spectre Carrier",
    type: "LIGHT ARMOR",
    slot: "armor",
    description:
      "The original fitted carrier. Flexible coverage without sacrificing movement.",
    weight: 3.4,
    stat: "+1 armor · +10% dodge",
    model: "armor",
  },
  {
    id: "nyx",
    name: "NYX / Veil",
    type: "LIGHT ARMOR",
    slot: "armor",
    description:
      "Close-fitting ceramic plates over woven graphite. Articulated ribs, gauntlets and contoured leg protection for the quiet approach.",
    weight: 2.6,
    stat: "+1 armor · +10% dodge",
    model: "assassin-armor",
  },
  {
    id: "nyx-mid",
    name: "NYX / Shade",
    type: "MEDIUM ARMOR",
    slot: "armor",
    description:
      "Overlapping shoulder shells, wrapped thigh protection and a reinforced cuirass. Built to move through contested ground.",
    weight: 4.8,
    stat: "+2 armor",
    model: "assassin-mid",
  },
  {
    id: "nyx-heavy",
    name: "NYX / Wraith",
    type: "HEAVY ARMOR",
    slot: "armor",
    description:
      "Continuous breach cuirass, reinforced shoulder arches and twin dorsal power housings. Layered limb shields give Wraith its imposing silhouette.",
    weight: 7.2,
    stat: "+3 armor · +1 health · −1 mobility · −10% dodge",
    model: "assassin-heavy",
  },
  {
    id: "frag",
    name: "M7 Fragmentation",
    type: "THROWABLE",
    slot: "utility",
    description: "One grenade, one opportunity to move a stubborn target.",
    weight: 0.5,
    stat: "5 damage · area effect",
    model: "grenade",
  },
  {
    id: "trauma",
    name: "Field Trauma Kit",
    type: "MEDICAL",
    slot: "utility",
    description:
      "Compact dressings and emergency supplies. Get your people home.",
    weight: 0.8,
    stat: "Restore 4 health",
    model: "medkit",
  },
];
export const itemById = (id: string | null) =>
  EQUIPMENT.find((item) => item.id === id);
export const INITIAL_STOCK: Record<string, number> = {
  mx4: 4,
  srs9: 2,
  plasma: 2,
  k12: 6,
  spectre: 6,
  nyx: 4,
  "nyx-mid": 4,
  "nyx-heavy": 4,
  frag: 4,
  trauma: 3,
  // Preview inventory: one of each attachment per operative.
  ...Object.fromEntries(ATTACHMENTS.map((item) => [item.id, 4])),
};
