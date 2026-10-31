/** Export authored meshes to Blender without browser canvas or image dependencies. */
import * as T from "three";
import { writeFileSync, mkdirSync } from "node:fs";
import { createLongGun } from "../../../packages/squad/src/studio/long-guns.ts";
import { createWeaponAttachment } from "../../../packages/squad/src/studio/weapon-attachments.ts";
import { ATTACHMENTS } from "../../../packages/squad/src/catalog.ts";

const directory = new URL("../../../scratch/output/weapons-source/", import.meta.url);
mkdirSync(directory, { recursive: true });
const manifest: string[] = [];
for (const id of ["rifle", "sniper", "plasma", ...ATTACHMENTS.map((a) => a.id)]) {
    const a = ATTACHMENTS.find((a) => a.id === id);
    const root = a
        ? createWeaponAttachment(a.slot, a.tier)
        : createLongGun(id as "rifle" | "sniper" | "plasma");
    root.updateMatrixWorld(true);
    const nodes: unknown[] = [];
    root.traverse((o) => {
        const mesh = o as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
        const matrix = o.matrixWorld;
        const position = new T.Vector3().setFromMatrixPosition(matrix);
        const vertices: number[][] = [],
            faces: number[][] = [];
        if (mesh.isMesh) {
            const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
            for (let i = 0; i < geo.attributes.position.count; i++) {
                const p = new T.Vector3()
                    .fromBufferAttribute(geo.attributes.position, i)
                    .applyMatrix4(matrix);
                vertices.push(p.toArray());
                if (i % 3 === 0) faces.push([i, i + 1, i + 2]);
            }
        }
        nodes.push({
            id: o.uuid,
            parent: o.parent?.uuid,
            name: o.name,
            position: position.toArray(),
            extras: o.userData,
            vertices,
            faces,
            material: mesh.isMesh
                ? {
                      name: mesh.material.name,
                      color: mesh.material.color.toArray(),
                      metallic: mesh.material.metalness,
                      roughness: mesh.material.roughness,
                      emission: mesh.material.emissive.toArray(),
                      strength: mesh.material.emissiveIntensity,
                  }
                : null,
        });
    });
    writeFileSync(new URL(`${id}.json`, directory), JSON.stringify({ id, nodes }));
    manifest.push(id);
}
writeFileSync(new URL("manifest.json", directory), JSON.stringify(manifest));
console.log(`Prepared ${manifest.length} weapon and attachment sources.`);
