// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OfficeAssets, officeCatalog, officeFinishes, type OfficeFinish, type OfficeKind } from "../office/assets";
import { useSession } from "./useSession";

type Selection = OfficeKind | "workstation" | "bins";

/** Static specimens render only on camera / selection / size changes. */
export function OfficePreview({ onClose }: { onClose(): void }) {
  const session = useSession();
  const dialog = useRef<HTMLDialogElement>(null), viewport = useRef<HTMLDivElement>(null);
  const control = useRef<{ show(kind: Selection, finish: OfficeFinish, open: boolean): void } | null>(null);
  const [kind, setKind] = useState<Selection>("workstation");
  const [finish, setFinish] = useState<OfficeFinish>("sage");
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const modal = dialog.current!, host = viewport.current!;
    const paused = session.paused;
    session.paused = true; session.battlefield.setPaused(true); modal.showModal();
    const cleanups: (() => void)[] = [];
    try {
      const assets = new OfficeAssets(); cleanups.push(() => assets.dispose());
      const renderer = new T.WebGLRenderer({ antialias: true });
      cleanups.push(() => { renderer.dispose(); renderer.domElement.remove(); });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.domElement.setAttribute("aria-label", "Rotatable office asset preview");
      host.append(renderer.domElement);
      const scene = new T.Scene(); scene.background = new T.Color(0x202c32);
      const camera = new T.PerspectiveCamera(36, 1, 0.01, 80);
      const orbit = new OrbitControls(camera, renderer.domElement);
      cleanups.push(() => orbit.dispose());
      orbit.maxPolarAngle = Math.PI * 0.49; orbit.minDistance = 0.15; orbit.maxDistance = 20;
      const render = () => renderer.render(scene, camera);
      orbit.addEventListener("change", render);
      scene.add(new T.HemisphereLight(0xddefff, 0x727867, 2.4));
      const light = new T.DirectionalLight(0xffe9ca, 3.5);
      light.position.set(-3, 7, 5); light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024); light.shadow.normalBias = 0.015;
      scene.add(light); cleanups.push(() => light.dispose());
      const floor = new T.Mesh(new T.PlaneGeometry(80, 80), assets.material(0x3c4b50, 0, 0.94));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.012; floor.receiveShadow = true;
      scene.add(floor); cleanups.push(() => floor.geometry.dispose());
      let specimen = new T.Group();
      let previousKind: Selection | undefined;
      control.current = { show(selection, palette, doorOpen) {
        specimen.removeFromParent(); specimen = new T.Group(); scene.add(specimen);
        const add = (asset: OfficeKind, x = 0, y = 0, z = 0, yaw = 0) => {
          const g = assets.create(asset, palette); g.position.set(x, y, z); g.rotation.y = yaw; specimen.add(g); return g;
        };
        if (selection === "bins") {
          add("wastebasket", -.95); add("recycling-bin", -.38);
          add("pedal-bin", .24); add("wheelie-bin", .99);
        } else if (selection === "workstation") {
          add("desk"); add("cubicle", 0, 0, -0.52);
          add("monitor", -0.15, 0.766, -0.13); add("keyboard", -0.16, 0.766, 0.18);
          add("desk-tray", 0.43, 0.766, -0.08); add("computer", 0.4, 0, -0.04);
          add("task-chair", -0.1, 0, 0.92, Math.PI + 0.25);
          add("filing-cabinet", 1, 0, -0.1); add("binders", 1, 1.02, -0.1);
        } else {
          const g = add(selection);
          const hinge = g.getObjectByName("door-hinge");
          if (hinge) hinge.rotation.y = doorOpen ? Math.PI / 2 : 0;
        }
        const bounds = new T.Box3().setFromObject(specimen), dimensions = bounds.getSize(new T.Vector3());
        setSize(`${dimensions.x.toFixed(2)} × ${dimensions.y.toFixed(2)} × ${dimensions.z.toFixed(2)} m`);
        if (previousKind !== selection) {
          const radius = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.25);
          orbit.target.copy(bounds.getCenter(new T.Vector3()));
          camera.position.copy(orbit.target).add(new T.Vector3(1.1, 0.8, 1.6).multiplyScalar(radius));
          orbit.update(); previousKind = selection;
        }
        render();
      } };
      const resize = () => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); render();
      };
      const observer = new ResizeObserver(resize); observer.observe(host);
      cleanups.push(() => observer.disconnect()); resize();
      control.current.show("workstation", "sage", false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The office preview could not load.");
    }
    return () => {
      control.current = null; for (const cleanup of cleanups.reverse()) cleanup();
      modal.close(); session.paused = paused; session.battlefield.setPaused(paused);
    };
  }, [session]);

  const show = (selection: Selection, palette: OfficeFinish, doorOpen: boolean) => control.current?.show(selection, palette, doorOpen);
  return <dialog ref={dialog} className="destruction-preview office-preview" aria-labelledby="office-title"
    onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()}>
    <header><div><small>ASSET PACK 02 / OFFICE</small><h2 id="office-title">After hours.</h2></div>
      <button onClick={onClose} aria-label="Close office preview">✕</button></header>
    <p>{officeCatalog.length} modular assets · Three finishes · Explore the furnished floor in Demo 2.</p>
    <div className="destruction-stage" ref={viewport}>
      {error && <span className="destruction-loading" role="alert">{error}</span>}
      <span className="destruction-orbit">DRAG TO ORBIT · SCROLL TO ZOOM</span>
      <span className="destruction-speed">{size}</span>
    </div>
    <div className="destruction-toolbar">
      <label>ASSET<select aria-label="Office asset" value={kind} onChange={e => {
        const next = e.target.value as Selection; setKind(next); setOpen(false); show(next, finish, false);
      }}><option value="workstation">Furnished workstation</option><option value="bins">Trash bin collection</option>
        {[...new Set(officeCatalog.map(a => a[2]))].map(category => <optgroup key={category} label={category}>
          {officeCatalog.filter(a => a[2] === category).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </optgroup>)}
      </select></label>
      <label>FINISH<select aria-label="Office finish" value={finish} onChange={e => {
        const next = e.target.value as OfficeFinish; setFinish(next); show(kind, next, open);
      }}>{officeFinishes.map(f => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}</select></label>
      {(kind === "glass-door" || kind === "steel-door") && <button aria-pressed={open} onClick={() => {
        setOpen(!open); show(kind, finish, !open);
      }}>{open ? "Close door" : "Open door"}</button>}
    </div>
    <footer><p>Inspect furniture and fixtures here. Use Scene → Destruction preview to test breakage. PIN pads are display props.</p></footer>
  </dialog>;
}
