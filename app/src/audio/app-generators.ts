// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shell's procedural sounds by their manifest generator name, for the
 * audition screen: each plays its gesture once. The modules load on first
 * use, so this table imports in node (the manifest test checks it covers
 * every shell generator) and costs nothing until played.
 */

import type { AppGeneratorName } from "@ghosts/engine/sounds";

export const APP_GENERATORS = {
    "ui.confirm": () => import("./ui").then((m) => m.uiConfirm()),
    "ui.back": () => import("./ui").then((m) => m.uiBack()),
    "ui.deny": () => import("./ui").then((m) => m.uiDeny()),
    "ui.hold": () => import("./ui").then((m) => m.uiHoldStep(null, 2)),
    "ui.count": () => import("./ui").then((m) => m.uiCount()),
    "ui.resolve": () => import("./ui").then((m) => m.uiResolve("promoted")),
    "ui.lamp": () => import("./lamp").then((m) => m.uiLampOn(0)),
} satisfies Record<AppGeneratorName, () => Promise<void>>;
