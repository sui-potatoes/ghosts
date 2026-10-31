// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import type { Unit } from "../game";
import { escapeHTML } from "../html";

const LABEL_OFFSET = new T.Vector3(0, 2.05, 0);

/** Hit odds and the hp a shot takes off, shown on the aimed unit's plate. */
export interface AimReadout {
  chance: number;
  hit: number;
  crit: number;
  lethal: boolean;
}

/**
 * Per-unit markers that are not the body: a name plate over the head (a DOM
 * button projected from the scene) and a soft contact shadow at the feet.
 */
export class UnitMarkers {
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly contacts = new Map<string, T.Mesh>();
  private readonly point = new T.Vector3();

  constructor(
    scene: T.Scene,
    host: HTMLElement,
    units: Unit[],
    onPick: (id: string) => void,
    private readonly ground: (x: number, z: number) => number,
  ) {
    const geometry = new T.CircleGeometry(0.42, 20);
    const material = new T.MeshBasicMaterial({ color: 0x020708, transparent: true, opacity: 0.28, depthWrite: false });
    for (const u of units) {
      const contact = new T.Mesh(geometry, material);
      contact.rotation.x = -Math.PI / 2;
      contact.scale.y = 0.7;
      this.contacts.set(u.id, contact);
      scene.add(contact);
      const label = document.createElement("button");
      label.className = `unit-label ${u.enemy ? "hostile" : ""}`;
      label.setAttribute("aria-label", `Select ${u.name}`);
      label.innerHTML = `<span>${u.enemy ? "◇" : "◆"} ${escapeHTML(u.name)}</span><i></i><em class="aim-readout" hidden></em>`;
      label.onclick = () => onPick(u.id);
      host.append(label);
      this.labels.set(u.id, label);
    }
  }

  /** Selection, health bar and visibility from the unit's state. */
  sync(u: Unit, selected: boolean) {
    const label = this.labels.get(u.id)!;
    label.classList.toggle("selected", selected);
    label.querySelector("i")!.style.setProperty("--health", `${(u.hp / u.maxHp) * 100}%`);
    if (u.hp > 0) label.hidden = false;
  }

  hide(id: string) {
    this.labels.get(id)!.hidden = true;
  }

  private aimed: string | null = null;

  /**
   * While `target` is aimed at, its plate carries the hit odds and marks the
   * slice of health the shot would remove (deeper on a crit) on its bar; the
   * plate follows the unit, so the readout is where the eye is. Null clears.
   */
  aim(target: Unit | null, readout?: AimReadout) {
    if (this.aimed && this.aimed !== target?.id) this.clearAim(this.aimed);
    this.aimed = target?.id ?? null;
    if (!target || !readout) {
      if (target) this.clearAim(target.id);
      this.aimed = null;
      return;
    }
    const label = this.labels.get(target.id)!;
    const bar = label.querySelector("i")!;
    const pct = (n: number) => `${(Math.max(0, n) / target.maxHp) * 100}%`;
    label.classList.add("aimed");
    bar.style.setProperty("--kept", pct(target.hp - readout.crit));
    bar.style.setProperty("--hit-from", pct(target.hp - readout.hit));
    const em = label.querySelector("em")!;
    em.hidden = false;
    em.innerHTML = `<strong>${readout.chance}%</strong> −${readout.hit} HP${readout.lethal ? " <b>LETHAL</b>" : ""}`;
  }

  private clearAim(id: string) {
    const label = this.labels.get(id)!;
    label.classList.remove("aimed");
    const bar = label.querySelector("i")!;
    bar.style.removeProperty("--kept");
    bar.style.removeProperty("--hit-from");
    label.querySelector("em")!.hidden = true;
  }

  /** Follow the body: shadow under the feet, plate projected over the head. */
  place(u: Unit, root: T.Vector3, camera: T.Camera, width: number, height: number) {
    const contact = this.contacts.get(u.id)!;
    contact.position.copy(root);
    contact.position.y = this.ground(root.x, root.z) + 0.035;
    contact.visible = u.hp > 0;
    if (u.hp <= 0) return;
    const p = this.point.copy(root).add(LABEL_OFFSET).project(camera);
    const label = this.labels.get(u.id)!;
    label.style.display = p.z > 1 || p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1 ? "none" : "";
    const transform = `translate(${(p.x * 0.5 + 0.5) * width}px,${(-p.y * 0.5 + 0.5) * height}px) translate(-50%,-100%)`;
    if (label.style.transform !== transform) label.style.transform = transform;
  }

  dispose() {
    for (const label of this.labels.values()) label.remove();
  }
}
