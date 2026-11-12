// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";

/**
 * Wireframe view for the 3D stages, a development aid: every triangle edge of
 * every mesh over a flat fill, so topology and density can be read at a
 * glance. Works on whatever meshes are under a root and never touches the
 * source geometries or materials, which are shared between model clones.
 */

export interface WireframeColors {
  /** Edge colour; the theme accent. */
  line: T.ColorRepresentation;
  /** Flat fill that hides the edges behind it; a tone near the stage background. */
  fill: T.ColorRepresentation;
}

/** Triangles in a geometry: index count / 3, else position count / 3. */
export function triangleCount(geometry: T.BufferGeometry): number {
  const count =
    geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(count / 3);
}

export interface MeshStats {
  triangles: number;
  meshes: number;
}

/** Triangles and meshes under `root` (every mesh the stage would draw). */
export function meshStats(root: T.Object3D): MeshStats {
  const stats: MeshStats = { triangles: 0, meshes: 0 };
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    stats.meshes++;
    stats.triangles += triangleCount(node.geometry);
  });
  return stats;
}

/** "38,924 tris · 11 meshes". */
export function formatMeshStats({ triangles, meshes }: MeshStats): string {
  const n = new Intl.NumberFormat("en-US");
  return `${n.format(triangles)} ${triangles === 1 ? "tri" : "tris"} · ${n.format(meshes)} ${meshes === 1 ? "mesh" : "meshes"}`;
}

/**
 * Hidden-line wireframe on `root`: each mesh keeps its geometry, takes a flat
 * `MeshBasicMaterial` with a polygon offset and gets a `LineSegments` child of
 * its true triangle edges. Skinned meshes cannot be followed by line geometry,
 * so they take a wireframe material instead. `restore()` puts the original
 * materials back exactly and disposes everything created here.
 */
export function applyWireframe(
  root: T.Object3D,
  colors: WireframeColors,
): () => void {
  const fill = new T.MeshBasicMaterial({
    color: colors.fill,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    toneMapped: false,
  });
  const line = new T.LineBasicMaterial({
    color: colors.line,
    toneMapped: false,
  });
  const skinned = new T.MeshBasicMaterial({
    color: colors.line,
    wireframe: true,
    toneMapped: false,
  });
  const meshes: T.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof T.Mesh) meshes.push(node);
  });
  const saved = new Map<T.Mesh, T.Material | T.Material[]>();
  const lines: T.LineSegments[] = [];
  const edges = new Map<T.BufferGeometry, T.WireframeGeometry>();
  for (const mesh of meshes) {
    saved.set(mesh, mesh.material);
    if (mesh instanceof T.SkinnedMesh) {
      mesh.material = skinned;
      continue;
    }
    mesh.material = fill;
    let geometry = edges.get(mesh.geometry);
    if (!geometry)
      edges.set(
        mesh.geometry,
        (geometry = new T.WireframeGeometry(mesh.geometry)),
      );
    const segments = new T.LineSegments(geometry, line);
    segments.raycast = () => {};
    mesh.add(segments);
    lines.push(segments);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const segments of lines) segments.removeFromParent();
    for (const [mesh, material] of saved) mesh.material = material;
    for (const geometry of edges.values()) geometry.dispose();
    fill.dispose();
    line.dispose();
    skinned.dispose();
  };
}

/**
 * Per-frame wireframe for animated, skinned scenes: swaps every mesh under
 * `root` to one wireframe material for the duration of `draw`, then puts the
 * originals back, so meshes that arrive later need no bookkeeping.
 */
export class WireframeDraw {
  private material: T.MeshBasicMaterial;
  constructor(line: T.ColorRepresentation) {
    this.material = new T.MeshBasicMaterial({
      color: line,
      wireframe: true,
      toneMapped: false,
    });
  }
  run(root: T.Object3D, draw: () => void) {
    const saved = new Map<T.Mesh, T.Material | T.Material[]>();
    root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      saved.set(node, node.material);
      node.material = this.material;
    });
    try {
      draw();
    } finally {
      for (const [mesh, material] of saved) mesh.material = material;
    }
  }
  dispose() {
    this.material.dispose();
  }
}
