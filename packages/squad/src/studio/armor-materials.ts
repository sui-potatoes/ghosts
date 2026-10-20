// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { MeshStandardMaterial } from "three";
import type { ArmorColors } from "../types";

/** Only owned armor clones are painted; textiles, boots and hardware keep their finishes. */
export function paintArmor(materials: MeshStandardMaterial[], colors: ArmorColors) {
    for (const material of materials) {
        const name = material.name.toLowerCase();
        if (name.includes("ceramic")) material.color.set(colors.primary);
        else if (name.includes("edge binding") || name.includes("titanium and markings"))
            material.color.set(colors.secondary);
        else if (name.includes("identification")) {
            material.color.set(colors.accent);
            if (name.startsWith("nyx")) {
                material.emissive.set(colors.accent);
                material.emissiveIntensity = 0.65;
            }
        }
    }
}
