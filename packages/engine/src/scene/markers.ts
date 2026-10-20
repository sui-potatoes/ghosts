import * as T from "three";
import type { Unit } from "../game";
import { escapeHTML } from "../html";

const LABEL_OFFSET = new T.Vector3(0, 2.05, 0);

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
      label.innerHTML = `<span>${u.enemy ? "◇" : "◆"} ${escapeHTML(u.name)}</span><i></i>`;
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
