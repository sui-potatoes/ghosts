// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetCatalog } from "../catalog";
import { propHealth, resistsGunfire, type MapProp, type PropKind } from "../environment";
import { TacticalMap } from "../map";
import { Destruction, loadDestruction } from "../scene/destruction";
import { useSession } from "./useSession";

// The whole catalog, one entry per kind (variants share meshes and numbers).
const choices: [PropKind, string][] = [...new Map(
  assetCatalog.map((a) => [a.kind, `${a.category} · ${a.name}`] as [PropKind, string]),
).entries()];

function specimen(kind: PropKind) {
  const props: MapProp[] = [{ id: "specimen", kind, x: 0, z: 0, yaw: 0, seed: 731 }];
  if (kind === "window-wall")
    props.push({ id: "pane", kind: "glass", x: 0, z: 0, y: 0.92, yaw: 0, seed: 732, support: "specimen" });
  if (kind === "office-window-wall" || kind === "office-steel-door") {
    const wall = kind === "office-window-wall";
    props.push({ id: "pane", kind: "glass", x: 0, z: 0, y: wall ? .93 : 1.69, yaw: 0, seed: 732,
      support: "specimen", pane: { width: wall ? 1.22 : .33, height: wall ? 1.46 : .36 } });
  }
  return new TacticalMap({
    id: "destruction-preview", props, covers: [], buildings: [],
    bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    street: { avenueHalf: 99, crossHalf: 99, curb: 0, reach: 99 },
  });
}

/** An isolated specimen uses the same damage reducer, meshes and physics as the field. */
export function DestructionPreview({ onClose, initialKind = "crate" }: { onClose: () => void; initialKind?: PropKind }) {
  const session = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const controller = useRef<{ reset(kind: PropKind): void; hit(blast: boolean, pane?: boolean, damage?: number): void } | null>(null);
  const [kind, setKind] = useState<PropKind>(initialKind);
  const [hp, setHp] = useState(propHealth[initialKind]);
  const [paneHp, setPaneHp] = useState(12);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const slowRef = useRef(false);

  useEffect(() => {
    const modal = dialog.current!, host = viewport.current!;
    const previouslyPaused = session.paused;
    session.paused = true;
    session.battlefield.setPaused(true);
    modal.showModal();
    let disposed = false, cleanup: (() => void) | undefined;
    void loadDestruction().then(() => {
      if (disposed) return;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.45;
      host.append(renderer.domElement);
      renderer.domElement.setAttribute("aria-label", "Rotatable 3D destruction specimen");
      const scene = new T.Scene();
      scene.background = new T.Color(0x161f25);
      scene.fog = new T.Fog(0x161f25, 14, 30);
      const camera = new T.PerspectiveCamera(38, 1, 0.1, 50);
      camera.position.set(4.5, 3.2, 6);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.target.set(0, 0.8, 0);
      orbit.minDistance = 3; orbit.maxDistance = 13;
      orbit.maxPolarAngle = Math.PI / 2 - 0.03;
      orbit.enableDamping = true;
      scene.add(new T.HemisphereLight(0xd5ecff, 0x66604b, 2.6));
      const light = new T.DirectionalLight(0xffe4bc, 4);
      light.position.set(-3, 7, 5); light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.left = -8; light.shadow.camera.right = 8;
      light.shadow.camera.top = 8; light.shadow.camera.bottom = -8;
      light.shadow.normalBias = 0.035;
      scene.add(light);
      const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({
        color: 0x374348, roughness: 0.92,
      }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; floor.receiveShadow = true;
      const grid = new T.GridHelper(20, 20, 0x64716e, 0x445256);
      grid.position.y = 0.001;
      scene.add(floor, grid);
      let map = specimen(initialKind);
      const destruction = new Destruction(map, () => { renderer.shadowMap.needsUpdate = true; });
      scene.add(destruction.group);
      const sync = () => {
        setHp(map.health("specimen")); setPaneHp(map.health("pane"));
      };
      controller.current = {
        reset(next) {
          map = specimen(next); destruction.reset(map); sync();
        },
        hit(blast, pane = false, damage = 28) {
          const changes = blast ? map.blastProps([0, 0]) : map.damageProp(pane ? "pane" : "specimen", damage);
          map.applyPropDamage(changes);
          destruction.apply(changes, new T.Vector3(0, 0.2, blast ? 0.7 : 3));
          sync();
        },
      };
      const resize = () => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host); resize();
      let frame = 0, last = performance.now();
      const animate = (now: number) => {
        frame = requestAnimationFrame(animate);
        const dt = Math.min((now - last) / 1000, 0.05); last = now;
        if (document.hidden) return;
        destruction.update(dt * (slowRef.current ? 0.25 : 1), camera);
        orbit.update(); renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(animate);
      cleanup = () => {
        cancelAnimationFrame(frame); observer.disconnect(); orbit.dispose(); destruction.dispose();
        floor.geometry.dispose(); floor.material.dispose(); grid.dispose(); light.dispose();
        renderer.dispose(); renderer.domElement.remove();
      };
      setReady(true);
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Could not load the preview.");
    });
    return () => {
      disposed = true; controller.current = null; cleanup?.(); modal.close();
      session.paused = previouslyPaused;
      session.battlefield.setPaused(previouslyPaused);
    };
  }, [session, initialKind]);

  const hasPane = kind === "window-wall" || kind === "office-window-wall" || kind === "office-steel-door";
  return (
    <dialog ref={dialog} className="destruction-preview" aria-labelledby="destruction-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={(e) => e.stopPropagation()}>
      <header>
        <div><small>FIELD LAB / LIVE PHYSICS</small><h2 id="destruction-title">Break something.</h2></div>
        <button type="button" onClick={onClose} aria-label="Close destruction preview">✕</button>
      </header>
      <p>Try the map props. Your encounter stays untouched.</p>
      <div className="destruction-stage" ref={viewport}>
        {!ready && <span className="destruction-loading" role="status">{error || "Preparing the test floor…"}</span>}
        <span className="destruction-orbit">DRAG TO ORBIT · SCROLL TO ZOOM</span>
        <span className="destruction-speed">{slow ? "¼ SPEED" : "LIVE"}</span>
      </div>
      <div className="destruction-toolbar">
        <label>SPECIMEN<select aria-label="Preview prop" disabled={!ready} value={kind} onChange={(e) => {
          const next = e.target.value as PropKind;
          setKind(next); controller.current?.reset(next);
        }}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="destruction-health" role="status">
          <strong>{hp === 0 ? "DESTROYED" : `${hp} / ${propHealth[kind]} HP`}</strong>
          <progress aria-label="Prop durability" value={hp} max={propHealth[kind]} />
          <small>{hasPane ? `Window: ${paneHp ? "intact" : "shattered"}` :
            hp === 0 ? "Reset to try again" : hp < propHealth[kind] ? "Damaged — still standing" : "Ready for impact"}</small>
          {hp > 0 && resistsGunfire(kind) && <small>Wall resists gunfire — use explosives</small>}
        </div>
        <label className="destruction-slow"><input type="checkbox" checked={slow} onChange={(e) => {
          setSlow(e.target.checked); slowRef.current = e.target.checked;
        }} /> Slow motion</label>
      </div>
      <footer>
        <button disabled={!ready || hp === 0} onClick={() => controller.current?.hit(false, false, 8)}>Light hit <small>{resistsGunfire(kind) ? "RESISTED" : "8 DMG"}</small></button>
        <button disabled={!ready || hp === 0} onClick={() => controller.current?.hit(false)}>Shoot <small>{resistsGunfire(kind) ? "RESISTED" : "28 DMG"}</small></button>
        <button className="destruction-blast" disabled={!ready || hp === 0} onClick={() => controller.current?.hit(true)}>Blast <small>100 DMG</small></button>
        {hasPane && <button disabled={!ready || paneHp === 0} onClick={() => controller.current?.hit(false, true)}>Shoot window</button>}
        <button className="destruction-reset" disabled={!ready} onClick={() => controller.current?.reset(kind)}>↻ Reset</button>
      </footer>
    </dialog>
  );
}
