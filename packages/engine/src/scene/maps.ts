// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type * as T from "three";
import { buildDistrict, loadDistrictTextures } from "../district";
import type { Level } from "../editor/level";
import type { Occluder } from "./occlusion";
import { buildOffice } from "../office/scene";
import type { TimeOfDay } from "../scene-weather";
import type { Weather } from "./precipitation";
import { applyOfficeLighting } from "../office/lighting";
import type { PropAssets } from "./prop-assets";

/** Meshes the scenery may place: the same catalog assets combat destroys. */
export interface SceneryKit {
  props: PropAssets;
}

/** How a map looks: its textures and its scenery. The rules know only the `MapPlan`. */
export interface MapView {
  /** The editor level this scenery dresses, when it is one: what the layout view says is placed where. */
  level?: Level;
  /** The scenery itself supplies cover meshes (e.g. office furniture). */
  furnishedCover?: boolean;
  defaults?: { time: TimeOfDay; weather: Weather };
  /** Interior maps provide their own exposure / fill and omit outdoor atmosphere. */
  interiorLighting?: (scene: T.Scene, key: T.DirectionalLight, ambient: T.HemisphereLight,
    rim: T.DirectionalLight, time: TimeOfDay) => number;
  /**
   * Outdoors, after the time-of-day preset is applied: the map's own deviations
   * from it (an editor level's lighting dials). Returns the exposure to use
   * instead of the preset's, or nothing to keep it.
   */
  tune?: (scene: T.Scene, sun: T.DirectionalLight, ambient: T.HemisphereLight,
    rim: T.DirectionalLight, time: TimeOfDay) => number | void;
  /** Metres from the centre the camera may pan and the sun's shadows must reach, past the default stage. */
  extent?: number;
  /** Load and upload textures before the first build. */
  load(renderer: T.WebGLRenderer): Promise<void>;
  /** Add the scenery; buildings that may hide units come back as occluders. */
  build(scene: T.Scene, kit: SceneryKit): Occluder[];
}

const views: Record<string, MapView> = {
  kora: { load: loadDistrictTextures, build: buildDistrict },
  office: { load: async () => {}, build: buildOffice, furnishedCover: true,
    interiorLighting: applyOfficeLighting, defaults: { time: "night", weather: "clear" } },
};

const registered = new Map<string, MapView>();

/** Scenery known only at run time (an editor level under playtest), under its plan id. */
export function registerMapView(id: string, view: MapView) {
  registered.set(id, view);
}

export function mapView(id: string): MapView {
  const view = views[id] ?? registered.get(id);
  if (!view) throw new Error(`No scenery for map "${id}"`);
  return view;
}
