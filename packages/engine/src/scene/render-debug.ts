// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/** What the battlefield hands the QA hook: its renderer, scenes and one forced frame. */
export type RenderDebugSource = {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  air: T.Scene;
  /** Draw one full frame now (post pipeline included); `shadows` re-renders the shadow maps too. */
  frame(shadows: boolean): void;
};

/** Lights, casters and meshes in `scene`, counted for the QA hook. */
export function renderCensus(scene: T.Scene) {
  const lights: Record<string, number> = {};
  const shadowLights: { type: string; mapSize: number[] }[] = [];
  let meshes = 0, visibleMeshes = 0, casters = 0, transparent = 0, instanced = 0;
  const materials = new Set<string>(), geometries = new Set<string>();
  scene.traverseVisible((o) => {
    if (o instanceof T.Light) {
      lights[o.type] = (lights[o.type] ?? 0) + 1;
      if (o.castShadow && "shadow" in o && o.shadow instanceof T.LightShadow)
        shadowLights.push({ type: o.type, mapSize: [o.shadow.mapSize.x, o.shadow.mapSize.y] });
    }
  });
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    meshes++;
    let visible = true;
    for (let p: T.Object3D | null = o; p; p = p.parent) if (!p.visible) visible = false;
    if (!visible) return;
    visibleMeshes++;
    if (o instanceof T.InstancedMesh) instanced++;
    if (o.castShadow) casters++;
    geometries.add(o.geometry.uuid);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m.uuid);
      if (m.transparent) transparent++;
    }
  });
  return {
    lights, shadowLights, meshes, visibleMeshes, casters, transparent, instanced,
    materials: materials.size, geometries: geometries.size,
  };
}

/**
 * `ghosts:render-debug` = `1` on this device: the live battlefield's render
 * numbers at `globalThis.__ghostsRender`, for QA. `sample(n)` forces `n`
 * frames (no rAF needed) and returns `renderer.info` of the last one, the
 * census, and the time per frame (medians of the CPU time and of the CPU
 * time plus a wait for the GPU, and the mean of a back-to-back run), with
 * and without a shadow-map pass.
 */
export function exposeRenderDebug(source: RenderDebugSource) {
  try {
    if (localStorage.getItem("ghosts:render-debug") !== "1") return;
  } catch {
    return;
  }
  const { renderer } = source;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const sync = () => {
    // Reading one pixel waits for the GPU: the time then covers the whole frame, not just its submission.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  };
  const median = (v: number[]) => +[...v].sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(2);
  const time = (n: number, shadows: boolean) => {
    const cpu: number[] = [], total: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = performance.now();
      source.frame(shadows);
      cpu.push(performance.now() - start);
      sync();
      total.push(performance.now() - start);
    }
    // Back to back with one wait at the end, as the render loop runs: CPU and GPU overlap.
    sync();
    const start = performance.now();
    for (let i = 0; i < n; i++) source.frame(shadows);
    sync();
    const throughputMs = +((performance.now() - start) / n).toFixed(2);
    return { cpuMs: median(cpu), syncedMs: median(total), throughputMs };
  };
  (globalThis as { __ghostsRender?: unknown }).__ghostsRender = {
    renderer,
    scene: source.scene,
    frame: source.frame,
    census: () => renderCensus(source.scene),
    sample(n = 20) {
      time(3, true);
      const shadowFrame = time(n, true);
      const info = renderer.info;
      const withShadows = { calls: info.render.calls, triangles: info.render.triangles };
      const steady = time(n, false);
      return {
        pixelRatio: renderer.getPixelRatio(),
        drawingBuffer: renderer.getDrawingBufferSize(new T.Vector2()).toArray(),
        shadowMap: { enabled: renderer.shadowMap.enabled, autoUpdate: renderer.shadowMap.autoUpdate, type: renderer.shadowMap.type },
        steady: { ...steady, calls: info.render.calls, triangles: info.render.triangles },
        withShadows: { ...shadowFrame, ...withShadows },
        memory: { ...info.memory },
        programs: info.programs?.length ?? 0,
        census: renderCensus(source.scene),
        air: renderCensus(source.air),
      };
    },
  };
}
