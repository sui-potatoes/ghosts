// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Basics, ready for a host: the scenario, its fixed squad, the guided driver
 * and the guide, wired together. The host mounts them on `<Encounter>` and
 * hears when the lessons are done or left.
 */
import { levelView } from "../../editor/playtest-view.ts";
import { registerMapView } from "../../scene/maps.ts";
import { Guide, guidedDriver, type GuideHost } from "../run.ts";
import { basicsLevel } from "./level.ts";
import { basicsScenario, basicsSquad } from "./scenario.ts";
import { basicsScript } from "./script.ts";

export { BASICS_ID } from "./scenario.ts";

/** Everything `<Encounter>` takes to play Basics, guided. */
export function basicsTraining(host: GuideHost = {}) {
  const scenario = basicsScenario();
  registerMapView(scenario.map.id, levelView(basicsLevel()));
  const guide = new Guide(basicsScript, host);
  return { scenario, squad: basicsSquad(), guide, driver: guidedDriver(guide) };
}
