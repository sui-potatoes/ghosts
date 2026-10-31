// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as THREE from "three";
import { nativeClip } from "@ghosts/squad/motion/clips";
import { equipmentPose, loadEquipmentPoses } from "@ghosts/squad/motion/equipment-poses";
import femaleIdle from "../assets/title-idle-female.bin?url";
import maleIdle from "../assets/title-idle-male.bin?url";

export async function loadTitleRifleIdle(sex: "female" | "male") {
    const [response, poses] = await Promise.all([
        fetch(sex === "female" ? femaleIdle : maleIdle),
        loadEquipmentPoses(sex),
    ]);
    if (!response.ok) throw new Error("Title rifle idle could not load.");
    const data = await new Response(
        (await response.blob()).stream().pipeThrough(new DecompressionStream("gzip")),
    ).json();
    return equipmentPose(nativeClip(THREE.AnimationClip.parse(data)), poses);
}
