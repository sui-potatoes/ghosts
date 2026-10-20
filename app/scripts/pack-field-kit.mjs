// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/* global process, console */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(resolve(process.argv[2] || ".", "package.json"));
const { NodeIO } = require("@gltf-transform/core"),
    { ALL_EXTENSIONS } = require("@gltf-transform/extensions"),
    { dedup, prune, weld } = require("@gltf-transform/functions");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = process.env.GEAR_BUILD_DIR || "/tmp/ghosts-field-kit";
import * as T from "three";
import { readFile, writeFile } from "node:fs/promises";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
    reports = [];
const kinds = process.argv.slice(3);
if (!kinds.length) kinds.push("spectre", "field-kit");
for (const sex of ["male", "female"])
    for (const kind of kinds) {
        const armor = await io.read(`${raw}/${kind}-${sex}.glb`),
            doc = await io.read(`${ROOT}/public/squad/body/${sex}/skin.glb`),
            nativeSkin = doc.getRoot().listSkins()[0],
            jointNames = nativeSkin.listJoints().map((n) => n.getName()),
            groups = new Map(),
            buffer = doc.getRoot().listBuffers()[0];
        for (const node of armor.getRoot().listNodes())
            if (node.getMesh()) {
                const world = new T.Matrix4().fromArray(node.getWorldMatrix()),
                    norm = new T.Matrix3().getNormalMatrix(world),
                    remap = node
                        .getSkin()
                        .listJoints()
                        .map((j) => jointNames.indexOf(j.getName()));
                if (remap.some((i) => i < 0)) throw Error("Unmapped armor joint");
                for (const p of node.getMesh().listPrimitives()) {
                    const material = p.getMaterial(),
                        name = material.getName();
                    if (!groups.has(name))
                        groups.set(name, {
                            mat: doc
                                .createMaterial(name)
                                .setBaseColorFactor(material.getBaseColorFactor())
                                .setMetallicFactor(material.getMetallicFactor())
                                .setRoughnessFactor(material.getRoughnessFactor())
                                .setEmissiveFactor(material.getEmissiveFactor())
                                .setDoubleSided(true),
                            position: [],
                            normal: [],
                            joints: [],
                            weights: [],
                            uv: [],
                            indices: [],
                        });
                    const g = groups.get(name);
                    if (!g.textured) {
                        g.textured = true;
                        const normal = material.getNormalTexture();
                        if (normal) {
                            const texture = doc
                                .createTexture(normal.getName())
                                .setImage(normal.getImage())
                                .setMimeType(normal.getMimeType());
                            g.mat
                                .setNormalTexture(texture)
                                .setNormalScale(material.getNormalScale());
                        }
                    }
                    const base = g.position.length / 3,
                        pos = p.getAttribute("POSITION"),
                        n = p.getAttribute("NORMAL"),
                        j = p.getAttribute("JOINTS_0"),
                        w = p.getAttribute("WEIGHTS_0");
                    for (let i = 0; i < pos.getCount(); i++) {
                        g.position.push(
                            ...new T.Vector3()
                                .fromArray(pos.getElement(i, []))
                                .applyMatrix4(world)
                                .toArray(),
                        );
                        g.normal.push(
                            ...new T.Vector3()
                                .fromArray(n.getElement(i, []))
                                .applyMatrix3(norm)
                                .normalize()
                                .toArray(),
                        );
                        g.joints.push(...j.getElement(i, []).map((v) => remap[v]));
                        g.weights.push(...w.getElement(i, []));
                        g.uv.push(...(p.getAttribute("TEXCOORD_0")?.getElement(i, []) || [0, 0]));
                    }
                    g.indices.push(...Array.from(p.getIndices().getArray(), (i) => i + base));
                }
            }
        const mesh = doc.createMesh(kind).setExtras({
            armorClass: kind.endsWith("heavy")
                ? "heavy"
                : kind.endsWith("mid")
                  ? "medium"
                  : "light",
            revision: 3,
            parts: armor
                .getRoot()
                .listNodes()
                .filter((n) => n.getMesh())
                .map((n) => n.getName()),
        });
        for (const g of groups.values()) {
            const attr = (type, array) =>
                    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer),
                p = doc.createPrimitive().setMaterial(g.mat);
            p.setAttribute("POSITION", attr("VEC3", new Float32Array(g.position)))
                .setAttribute("NORMAL", attr("VEC3", new Float32Array(g.normal)))
                .setAttribute("TEXCOORD_0", attr("VEC2", new Float32Array(g.uv)))
                .setAttribute("JOINTS_0", attr("VEC4", new Uint16Array(g.joints)))
                .setAttribute("WEIGHTS_0", attr("VEC4", new Float32Array(g.weights)))
                .setIndices(attr("SCALAR", new Uint32Array(g.indices)));
            mesh.addPrimitive(p);
        }
        const node = doc
            .getRoot()
            .listNodes()
            .find((n) => n.getMesh());
        node.setMesh(mesh);
        await doc.transform(weld(), dedup(), prune());
        await io.write(`${ROOT}/public/squad/armor/${kind}-${sex}.glb`, doc);
        reports.push({
            sex,
            kind,
            triangles: mesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0),
            materials: mesh.listPrimitives().length,
            vertices: mesh
                .listPrimitives()
                .reduce((s, p) => s + p.getAttribute("POSITION").getCount(), 0),
        });
    }
const previous = JSON.parse(
    await readFile(`${ROOT}/public/squad/armor/budget.json`, "utf8").catch(() => "[]"),
);
await writeFile(
    `${ROOT}/public/squad/armor/budget.json`,
    JSON.stringify([...previous.filter((r) => !kinds.includes(r.kind)), ...reports], null, 2),
);
console.log(reports);
