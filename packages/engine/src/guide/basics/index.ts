// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics, ready for a host: one continuous run through the simulation room,
 * the field switching stages under the guide (`restage`), with the fixed
 * squad, the guided driver and the guide wired together. The host mounts it
 * once; the lessons are resume points on the card, not stops.
 */
import { registerMapView } from "../../scene/maps.ts";
import { Guide, guidedDriver, type GuideHost } from "../run.ts";
import { simulationView } from "../sim-scene.ts";
import { CARD, STAGE_TITLES } from "./copy.ts";
import { basicsLevel, type StageId } from "./level.ts";
import { basicsSquad, stageScenario } from "./scenario.ts";
import { basicsScript, STAGES } from "./script.ts";

export { BASICS_ID } from "./scenario.ts";

/** The lessons, in order, as the host lists them. */
export const BASICS_CHAPTERS: readonly { id: string; title: string }[] = STAGES.map((s) => ({
  id: s.id,
  title: STAGE_TITLES[s.id],
}));

/** Where the host takes the player from the closing card. */
export interface BasicsHost extends Omit<GuideHost, "exits"> {
  onPlay?(): void;
  onTraining?(): void;
}

/** Everything `<Encounter>` takes to play Basics, guided, from a lesson (the first by default). */
export function basicsTraining(host: BasicsHost = {}, lesson: string = "contact") {
  const id = (STAGES.some((s) => s.id === lesson) ? lesson : "contact") as StageId;
  const scenario = stageScenario(id);
  registerMapView(scenario.map.id, simulationView(basicsLevel()));
  const exits = [
    { label: CARD.play, run: () => host.onPlay?.() },
    { label: CARD.training, run: () => host.onTraining?.() },
  ];
  const guide = new Guide(basicsScript(stageScenario), { ...host, exits });
  if (id !== "contact") guide.startAt(id);
  return { scenario, squad: basicsSquad(), guide, driver: guidedDriver(guide) };
}
