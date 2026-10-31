// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { normalizeArmorColors } from "./armor-colors.ts";
import {
  ATTACHMENT_SLOTS,
  attachmentById,
  EQUIPMENT,
  INITIAL_STOCK,
  SLOTS,
  itemById,
} from "./catalog.ts";
import { normalize, presets, fromPreset } from "./appearance/editor-state.js";
import { schema } from "./appearance/schema.ts";
import type {
  Appearance,
  ArmorColors,
  AttachmentSlot,
  Recruit,
  Role,
  Slot,
  SquadState,
} from "./types.ts";

export const SQUAD_STORAGE_KEY = "ghosts:squad-preview:v1";
export const MAX_RECRUITS = 4;
export const ROLES: Role[] = ["Assault", "Recon", "Support", "Marksman"];
export function initialSquad(): SquadState {
  const people = [
    ["vex", "Mara Vale", "VEX", "Assault", 0, "mx4", "frag"],
    ["ghost", "Jonas Keller", "GHOST", "Marksman", 3, "srs9", "frag"],
    ["bishop", "Imani Okoye", "BISHOP", "Support", 1, "mx4", "trauma"],
    ["echo", "Sora Ishikawa", "ECHO", "Recon", 2, "mx4", "frag"],
  ] as const;
  return {
    version: 1,
    stock: { ...INITIAL_STOCK },
    recruits: people.map(
      ([id, name, callsign, role, preset, primary, utility]) => ({
        id,
        name,
        callsign,
        role,
        appearance: normalize({ ...fromPreset(presets[preset]), name }, schema),
        armorColors: normalizeArmorColors(null),
        equipment: { primary, utility, sidearm: "k12", armor: "spectre" },
        attachments: {},
      }),
    ),
  };
}
export function available(state: SquadState, id: string): number {
  return Math.max(
    0,
    (state.stock[id] ?? 0) -
      state.recruits.reduce(
        (n, r) =>
          n +
          SLOTS.filter((slot) => r.equipment[slot] === id).length +
          ATTACHMENT_SLOTS.filter((slot) => r.attachments?.[slot] === id)
            .length,
        0,
      ),
  );
}
export function equip(
  state: SquadState,
  recruitId: string,
  slot: Slot,
  itemId: string | null,
): SquadState {
  const recruit = state.recruits.find((r) => r.id === recruitId);
  if (!recruit) throw Error("Recruit not found.");
  if (itemId === recruit.equipment[slot]) return state;
  if (itemId && itemById(itemId)?.slot !== slot)
    throw Error("That item does not fit this slot.");
  if (itemId && available(state, itemId) < 1)
    throw Error("All copies are assigned to other recruits.");
  return {
    ...state,
    recruits: state.recruits.map((r) =>
      r.id === recruitId
        ? {
            ...r,
            equipment: { ...r.equipment, [slot]: itemId },
            attachments: slot === "primary" && !itemId ? {} : r.attachments,
          }
        : r,
    ),
  };
}
/** All attachment families fit every primary rifle. Swapping a rifle keeps its fittings. */
export function equipAttachment(
  state: SquadState,
  recruitId: string,
  slot: AttachmentSlot,
  itemId: string | null,
): SquadState {
  const recruit = state.recruits.find((r) => r.id === recruitId);
  if (!recruit) throw Error("Recruit not found.");
  if (!ATTACHMENT_SLOTS.includes(slot)) throw Error("Unknown attachment slot.");
  if (!recruit.equipment.primary) throw Error("Equip a primary weapon first.");
  if (itemId && attachmentById(itemId)?.slot !== slot)
    throw Error("That attachment does not fit this slot.");
  if ((recruit.attachments?.[slot] ?? null) === itemId) return state;
  if (itemId && available(state, itemId) < 1)
    throw Error("All copies are assigned to other recruits.");
  return {
    ...state,
    recruits: state.recruits.map((r) =>
      r.id === recruitId
        ? { ...r, attachments: { ...r.attachments, [slot]: itemId } }
        : r,
    ),
  };
}
export function editRecruit(
  state: SquadState,
  id: string,
  changes: {
    name?: string;
    callsign?: string;
    role?: Role;
    appearance?: Appearance;
    armorColors?: ArmorColors;
  },
): SquadState {
  const existing = state.recruits.find((r) => r.id === id);
  if (!existing) throw Error("Recruit not found.");
  const next = { ...existing, ...changes };
  next.armorColors = normalizeArmorColors(next.armorColors);
  next.name = next.name.trim().replace(/\s+/g, " ");
  next.callsign = next.callsign.trim().toUpperCase();
  if (next.name.length < 2 || next.name.length > 40)
    throw Error("Name must be 2–40 characters.");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} -]{1,13}$/u.test(next.callsign))
    throw Error("Callsign must be 2–14 letters, numbers, spaces or hyphens.");
  if (
    state.recruits.some(
      (r) => r.id !== id && r.callsign.toUpperCase() === next.callsign,
    )
  )
    throw Error("That callsign is already in your squad.");
  if (!ROLES.includes(next.role)) throw Error("Choose a valid role.");
  next.appearance = normalize({ ...next.appearance, name: next.name }, schema);
  return {
    ...state,
    recruits: state.recruits.map((r) => (r.id === id ? next : r)),
  };
}
export function addRecruit(state: SquadState, recruit: Recruit): SquadState {
  if (state.recruits.length >= MAX_RECRUITS)
    throw Error("The roster holds four recruits.");
  if (state.recruits.some((r) => r.id === recruit.id))
    throw Error("Recruit already exists.");
  const next = {
    ...state,
    recruits: [
      ...state.recruits,
      {
        ...recruit,
        equipment: { primary: null, sidearm: null, armor: null, utility: null },
        attachments: {},
      },
    ],
  };
  return editRecruit(next, recruit.id, {});
}
export function totalWeight(recruit: Recruit) {
  return SLOTS.reduce(
    (n, slot) => n + (itemById(recruit.equipment[slot])?.weight ?? 0),
    0,
  );
}
/** Strict boundary: browser storage is untrusted and never changes the item catalog. */
export function restoreSquad(input: unknown): SquadState {
  if (!input || typeof input !== "object") throw Error("Invalid roster.");
  const stored = input as Partial<SquadState>;
  if (
    stored.version !== 1 ||
    !Array.isArray(stored.recruits) ||
    !stored.recruits.length ||
    stored.recruits.length > MAX_RECRUITS
  )
    throw Error("Unsupported roster.");
  let result: SquadState = {
    version: 1,
    stock: { ...INITIAL_STOCK },
    recruits: [],
  };
  for (const r of stored.recruits) {
    if (
      !r ||
      typeof r.id !== "string" ||
      r.id.length > 80 ||
      typeof r.name !== "string" ||
      typeof r.callsign !== "string"
    )
      throw Error("Invalid recruit.");
    result = addRecruit(result, {
      ...r,
      appearance: normalize(r.appearance, schema),
    });
    for (const slot of SLOTS)
      if (r.equipment?.[slot]) {
        const item = EQUIPMENT.find(
          (item) => item.id === r.equipment[slot] && item.slot === slot,
        );
        if (item && available(result, item.id))
          result = equip(result, r.id, slot, item.id);
      }
    for (const slot of ATTACHMENT_SLOTS) {
      const item = attachmentById(r.attachments?.[slot]);
      if (
        item?.slot === slot &&
        available(result, item.id) &&
        result.recruits.find((entry) => entry.id === r.id)?.equipment.primary
      )
        result = equipAttachment(result, r.id, slot, item.id);
    }
  }
  return result;
}

/** The recruits of a saved roster (`JSON` text), or null when there is none or it is invalid. */
export function savedRecruits(raw: string | null): Recruit[] | null {
  if (!raw) return null;
  try {
    return restoreSquad(JSON.parse(raw)).recruits;
  } catch {
    return null;
  }
}
