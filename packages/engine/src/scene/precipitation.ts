// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { Rain } from "./rain.ts";
import { Snow } from "./snow.ts";

export type Weather = "clear" | "rain" | "snow";

/** One precipitation effect at a time; snow allocates only on first selection. */
export class Precipitation {
  readonly group = new T.Group();
  private readonly rain = new Rain();
  private snow?: Snow;
  private current: Weather = "rain";
  private battery = true;
  private viewportHeight = 1;

  constructor() {
    this.group.add(this.rain.mesh);
  }

  get kind() { return this.current; }
  get particles() {
    return this.current === "snow" ? this.snow!.mesh.geometry.drawRange.count : 0;
  }

  setKind(kind: Weather) {
    if (kind === "snow" && !this.snow) {
      this.snow = new Snow();
      this.snow.setBatterySaver(this.battery);
      this.snow.setViewportHeight(this.viewportHeight);
      this.group.add(this.snow.mesh);
    }
    this.current = kind;
    this.rain.visible = kind === "rain";
    if (this.snow) this.snow.mesh.visible = kind === "snow";
  }

  setBatterySaver(enabled: boolean) {
    this.battery = enabled;
    this.snow?.setBatterySaver(enabled);
  }

  setViewportHeight(pixels: number) {
    this.viewportHeight = pixels;
    this.snow?.setViewportHeight(pixels);
  }

  update(dt: number) {
    if (this.current === "rain") this.rain.update(dt);
    else if (this.current === "snow") this.snow!.update(dt);
  }

  dispose() {
    this.group.removeFromParent();
    this.rain.mesh.geometry.dispose();
    (this.rain.mesh.material as T.Material).dispose();
    this.snow?.dispose();
    this.group.clear();
  }
}
