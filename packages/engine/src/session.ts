import { Encounter, type Cell, type Unit } from "./game";
import type { Scenario } from "./scenario";
import type { Battlefield } from "./scene/battlefield";

export type Mode = "move" | "fire" | "grenade";
/** The briefing dialog: read from the pause menu, or the deployment briefing with the squad. */
export type Panel = "intel" | "deploy";
export type Tone = "" | "hit" | "miss";

/**
 * The one owner of the encounter's mutable state: the rules (`game`), the
 * scene (`battlefield`, set once assets are loaded), what the player has
 * selected, the input mode, and what the UI shows over the field. It is also
 * the UI's store: `changed()` bumps `version` and tells subscribers.
 */
export class Session {
  game: Encounter;
  battlefield!: Battlefield;
  selected = "v";
  target = "h1";
  mode: Mode = "move";
  busy = false;
  resultShown = false;
  grenadeTarget: Cell | null = null;
  /** Portrait data URLs by ally id, rendered once the scene is warm. */
  readonly portraits = new Map<string, string>();
  state: "loading" | "ready" | "failed" = "loading";
  panel: Panel | null = null;
  /** The after-action debrief is open. */
  debrief = false;
  /** The host has the encounter paused (its pause menu is up); keys go to the host. */
  paused = false;
  /** The status line over the field; `at` tells repeats of the same message apart. */
  feedback: { message: string; tone: Tone; at: number } | null = null;
  version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(scenario?: Scenario) {
    this.game = new Encounter(scenario);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  /** Tell the UI the session changed. */
  changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Put `message` on the status line. */
  notify(message: string, tone: Tone = "") {
    this.feedback = { message, tone, at: performance.now() };
    this.changed();
  }

  /** A dialog covers the field: the briefing or the debrief. */
  get dialogOpen() {
    return this.panel !== null || this.debrief;
  }

  selectedUnit(): Unit {
    return this.game.unit(this.selected)!;
  }

  targetUnit(): Unit | undefined {
    return this.game.unit(this.target);
  }

  /** Keep the selection on the living: the first ally standing, the first hostile left. */
  settleSelection() {
    const { game } = this;
    if (!game.allies.some((u) => u.id === this.selected) && game.allies.length) {
      this.selected = game.allies[0].id;
      this.battlefield.select(this.selected);
    }
    if (!game.enemies.some((u) => u.id === this.target)) this.target = game.enemies[0]?.id ?? "";
  }

  /** Back to the opening selection; the caller swaps `game` first. */
  resetSelection() {
    this.selected = "v";
    this.target = "h1";
    this.mode = "move";
    this.grenadeTarget = null;
    this.resultShown = false;
  }
}

/** The mounted encounter's session. One encounter runs at a time; `newSession` starts the next. */
export let session = new Session();

export function newSession(scenario?: Scenario): Session {
  session = new Session(scenario);
  return session;
}
