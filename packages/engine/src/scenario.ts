import { koraPlan } from "./district-plan.ts";
import type { Role } from "./game.ts";
import type { Cell, MapPlan } from "./map.ts";

/** One unit as a scenario places it; combat stats follow from the role. */
export interface UnitSpec {
  id: string;
  name: string;
  full: string;
  role: Role;
  pos: Cell;
  color: string;
  enemy?: boolean;
}

/**
 * An encounter as data: the map, who deploys where, the objective cell, and
 * the words around it (briefing, contract, objectives, feed lines).
 */
/** The deployment briefing. `*word*` marks an emphasised word (an order name). */
export interface Briefing {
  issuer: string;
  title: string;
  setting: string;
  contract: string[];
  rules: string;
  facts: [label: string, value: string][];
}

/** The employer card in the intel panel. */
export interface Contract {
  employer: string;
  division: string;
  value: string;
  threat: string;
  /** Filled pips out of five. */
  threatLevel: number;
}

export interface Scenario {
  id: string;
  map: MapPlan;
  units: UnitSpec[];
  relay: Cell;
  briefing: Briefing;
  contract: Contract;
  /** Where it happens: the debrief's sector line, the compass coordinates, the panel's file code. */
  location: { sector: string; coordinates: [lat: string, lon: string]; code: string };
  objectives: {
    /** Intel panel: title and detail. Field card: the short order. */
    secure: { title: string; detail: string; order: string };
    eliminate: { title: string; order: string };
  };
  lines: {
    /** First feed line. */
    opening: string;
    /** Feed line and status-line stamp when the objective is taken. */
    secured: string;
    securedStamp: string;
  };
}

const WRAITH = "#e77469";

export const blackRain: Scenario = {
  id: "black-rain",
  map: koraPlan,
  relay: [0, -2],
  briefing: {
    issuer: "HELIOS STRATEGIC INDUSTRIES / EYES ONLY",
    title: "Operation Black Rain",
    setting: "Kōra Industrial District / 02:14 AM / Heavy rainfall. Nobody owns this city. Everybody pays.",
    contract: [
      "Kōra Systems intercepted a Helios research shipment. The manifest sits on a relay inside Sector 09. Your squad has one window before the network purges the evidence.",
      "Move an operator onto the illuminated relay pad and use *Extract*. Neutralize the three Wraith security operators to close the contract.",
    ],
    rules:
      "Two action points per operator. Low cover reduces incoming accuracy by 25 points. Hunkering improves defense. Grenades damage every unit within two tiles, including your own.",
    facts: [
      ["EMPLOYER", "HELIOS INDUSTRIES"],
      ["OPPOSITION", "KŌRA / WRAITH SECURITY"],
      ["PAYMENT", "₡ 48,000"],
      ["EXTRACTION", "RELAY CORE + AREA SECURED"],
    ],
  },
  location: { sector: "SECTOR 09 / TOKYO", coordinates: ["35° 41′ N", "139° 41′ E"], code: "BL–09.007" },
  contract: {
    employer: "HELIOS",
    division: "STRATEGIC INDUSTRIES",
    value: "₡ 48,000",
    threat: "ELEVATED",
    threatLevel: 3,
  },
  objectives: {
    secure: {
      title: "Secure the relay core",
      detail: "Reach the uplink. Extract corporate intel.",
      order: "Take the relay core",
    },
    eliminate: { title: "Neutralize hostile assets", order: "Clear Wraith security" },
  },
  lines: {
    opening: "Ghosts squad deployed. Retrieve the relay core.",
    secured: "Relay core acquired. Eliminate remaining hostiles.",
    securedStamp: "RELAY CORE ACQUIRED",
  },
  units: [
    { id: "v", name: "VEX", full: "Mara Voss", role: "ASSAULT", pos: [-3, 4], color: "#cdb77c" },
    { id: "g", name: "GHOST", full: "Ren Ishikawa", role: "RECON", pos: [-1, 5], color: "#7eaaa7" },
    { id: "b", name: "BISHOP", full: "Elias Ward", role: "HEAVY", pos: [1, 4], color: "#a4ad8d" },
    { id: "e", name: "ECHO", full: "Sana Okafor", role: "SPECIALIST", pos: [-5, 3], color: "#ad92a6" },
    { id: "h1", name: "WRAITH–01", full: "Kōra security", role: "ASSAULT", pos: [2, -3], color: WRAITH, enemy: true },
    { id: "h2", name: "WRAITH–02", full: "Kōra security", role: "HEAVY", pos: [5, -2], color: WRAITH, enemy: true },
    { id: "h3", name: "WRAITH–03", full: "Kōra security", role: "RECON", pos: [-3, -4], color: WRAITH, enemy: true },
  ],
};
