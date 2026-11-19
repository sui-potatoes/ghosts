// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The Smoke Grenade and Flashbang models: built like the Frag Grenade, within
 * its budget, on its fuze, and apart from it and from each other by shape.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";

import { createFlashbang } from "../../packages/squad/src/studio/flashbang.ts";
import { createFragGrenade } from "../../packages/squad/src/studio/frag-grenade.ts";
import { createSmokeGrenade } from "../../packages/squad/src/studio/smoke-grenade.ts";
import {
    acquireArmoryUtility,
    isArmoryUtility,
} from "../../packages/squad/src/studio/armory-utilities.ts";

type Build = (o: { detail: "high" | "low" }) => T.Group;
const BUILDS: [string, Build][] = [
    ["frag", createFragGrenade],
    ["smoke", createSmokeGrenade],
    ["flash", createFlashbang],
];

function measure(root: T.Group) {
    let triangles = 0;
    const materials = new Set<string>();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const geo = o.geometry as T.BufferGeometry;
        triangles += (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
        materials.add((o.material as T.Material).name);
        for (const v of geo.getAttribute("position").array as Float32Array)
            assert.ok(Number.isFinite(v), "finite positions");
    });
    const size = new T.Box3().setFromObject(root).getSize(new T.Vector3());
    return { triangles, materials, size, parts: root.children.map((c) => c.name) };
}

test("both stay within 10% of the frag's triangles, at both details, with its parts", () => {
    for (const detail of ["high", "low"] as const) {
        const frag = measure(createFragGrenade({ detail }));
        for (const [name, build] of BUILDS.slice(1)) {
            const m = measure(build({ detail }));
            const ratio = m.triangles / frag.triangles;
            assert.ok(
                ratio > 0.9 && ratio < 1.1,
                `${name} ${detail}: ${m.triangles} vs ${frag.triangles}`,
            );
            assert.deepEqual(m.parts, frag.parts);
            if (detail === "low") assert.deepEqual([...m.materials], ["00_Baked"]);
            else
                for (const slot of m.materials)
                    assert.ok(frag.materials.has(slot), `${name}: ${slot} is a frag slot`);
        }
    }
});

test("real sizes from the design, and silhouettes apart: ovoid, tall wide can, slim can", () => {
    const [frag, smoke, flash] = BUILDS.map(([, build]) => measure(build({ detail: "high" })).size);
    const mm = (v: number) => v * 1000;
    // Body widths (the lever stands 2 to 3 mm proud on +X): 64 and 48 mm.
    assert.ok(Math.abs(mm(smoke.z) - 64) < 2.5, `smoke ${mm(smoke.z)} mm across`);
    assert.ok(Math.abs(mm(flash.z) - 48) < 2.5, `flash ${mm(flash.z)} mm across`);
    assert.ok(Math.abs(mm(smoke.y) - 145) < 3, `smoke ${mm(smoke.y)} mm tall`);
    assert.ok(Math.abs(mm(flash.y) - 120) < 3, `flash ${mm(flash.y)} mm tall`);
    // Height over width: the three read apart at row size.
    const aspect = (s: T.Vector3) => s.y / s.z;
    assert.ok(aspect(frag) < 2 && aspect(smoke) > 2.1 && aspect(flash) > aspect(smoke) + 0.2);
});

test("the Armory stage has both, and they share the frag's fuze", () => {
    for (const model of ["grenade", "smoke", "flash"]) {
        assert.ok(isArmoryUtility(model), model);
        const shown = acquireArmoryUtility(model as "smoke");
        assert.ok(shown.model.children.length >= 4);
        shown.release();
    }
    assert.equal(isArmoryUtility("medkit"), false);
    // Pin and keeper are the frag's own parts, in the same place.
    const fragPin = createFragGrenade().getObjectByName("pin")!.position;
    for (const [, build] of BUILDS.slice(1))
        assert.deepEqual(
            build({ detail: "high" }).getObjectByName("pin")!.position.toArray(),
            fragPin.toArray(),
        );
});
