import { initialSquad, restoreSquad, SQUAD_STORAGE_KEY } from "../../src/features/squad/model.ts";
import { DEFAULT_ARMOR_COLORS } from "../../src/features/squad/armor-colors.ts";
import type { Appearance, ArmorColors, Recruit } from "../../src/features/squad/types.ts";
import type { Unit } from "./game.ts";

export interface DeploymentLook {
  appearance: Appearance;
  armorId: string | null;
  armorColors: ArmorColors;
  name?: string;
  callsign?: string;
  /** Voice index within the look's sex; unset means the first recorded voice. */
  voice?: number;
}
const showcase = ["nyx-mid", "nyx", "nyx-heavy", "nyx"];
/** Snapshot the local roster; playtest actions never spend inventory or modify it. */
export function deploymentLooks(raw: string | null, units: Unit[]): Map<string, DeploymentLook> {
  let recruits: Recruit[];
  let saved = false;
  try {
    if (!raw) throw Error("No saved squad");
    recruits = restoreSquad(JSON.parse(raw)).recruits;
    saved = true;
  } catch {
    recruits = initialSquad().recruits;
  }
  const defaults = initialSquad().recruits;
  return new Map(units.map((unit, i) => {
    const recruit = unit.enemy ? defaults[i % defaults.length] : recruits[i] ?? defaults[i % defaults.length];
    return [unit.id, {
      appearance: recruit.appearance,
      armorId: !unit.enemy && saved && recruits[i]
        ? recruit.equipment.armor : showcase[i % showcase.length],
      armorColors: unit.enemy
        ? { ...DEFAULT_ARMOR_COLORS, primary: "#454144", accent: "#c98177" }
        : recruit.armorColors,
      ...(!unit.enemy ? { name: recruit.name, callsign: recruit.callsign } : {}),
    }];
  }));
}
export function readDeploymentLooks(units: Unit[]) {
  let raw = null;
  try { raw = localStorage.getItem(SQUAD_STORAGE_KEY); } catch { /* Private mode: default squad. */ }
  return deploymentLooks(raw, units);
}
export function applyDeploymentNames(units: Unit[], looks: Map<string, DeploymentLook>) {
  for (const unit of units) {
    const look = looks.get(unit.id);
    if (look?.name) unit.full = look.name;
    if (look?.callsign) unit.name = look.callsign;
  }
}
