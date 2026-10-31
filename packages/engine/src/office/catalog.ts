// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The office asset roster as plain data: kind, display name, palette group.
 * Three-free so the rules, the asset catalog and node tests can read it; the
 * meshes themselves are authored in `assets.ts`.
 */
export const officeCatalog = [
  ["desk", "Work desk", "Furniture"],
  ["desk-tucked", "Desk · tucked chair", "Furniture"],
  ["corner-desk", "Corner desk", "Furniture"],
  ["meeting-table", "Conference table", "Furniture"],
  ["task-chair", "Task chair", "Furniture"],
  ["visitor-chair", "Visitor chair", "Furniture"],
  ["monitor", "Desktop monitor", "Equipment"],
  ["computer", "Computer tower", "Equipment"],
  ["laptop", "Open laptop", "Equipment"],
  ["keyboard", "Keyboard & mouse", "Equipment"],
  ["printer", "Office printer", "Equipment"],
  ["papers", "Paper stack", "Desktop"],
  ["folders", "Tabbed folders", "Desktop"],
  ["binders", "Ring binders", "Desktop"],
  ["desk-tray", "Document trays", "Desktop"],
  ["cubicle", "Fabric cubicle", "Architecture"],
  ["glass-door", "Glass door", "Architecture"],
  ["steel-door", "Security door", "Architecture"],
  ["keypad", "PIN access pad", "Equipment"],
  ["steel-wall", "Steel wall", "Architecture"],
  ["window-wall", "Steel / glass wall", "Architecture"],
  ["glass-wall", "Glass partition", "Architecture"],
  ["filing-cabinet", "Filing cabinet", "Storage"],
  ["shelf", "Archive shelving", "Storage"],
  ["locker", "Staff locker", "Storage"],
  ["wastebasket", "Wire wastebasket", "Bins"],
  ["recycling-bin", "Paper recycling bin", "Bins"],
  ["pedal-bin", "Steel pedal bin", "Bins"],
  ["wheelie-bin", "Wheeled utility bin", "Bins"],
] as const;
export type OfficeKind = typeof officeCatalog[number][0];
export type OfficeFinish = "sage" | "slate" | "sand";
export const officeFinishes: readonly OfficeFinish[] = ["sage", "slate", "sand"];
