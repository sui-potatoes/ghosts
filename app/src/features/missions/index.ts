// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The mission console's pieces. See README.md in this folder. */

import "./missions.css";

export { BriefingPanel } from "./BriefingPanel";
export { OpsBoard, type BoardView } from "./OpsBoard";
export { OpsConsole, useNarrowConsole } from "./OpsConsole";
export { COMMIT_ID, missionOfNode, OpsQueue, queueId } from "./OpsQueue";
export { SiteLegend, SitePlot } from "./SitePlot";
export { StatusStrip, type Readout } from "./StatusStrip";
export { useLockedMission } from "./useLockedMission";
export { WorldBoard, WorldLegend, ZoomControl } from "./WorldBoard";
export {
    panView,
    sitesOf,
    stepZoom,
    WORLD_ZOOM,
    ZOOM_LEVELS,
    type WorldSite,
    type WorldView,
} from "./world";
export {
    openingMission,
    parseCoordinate,
    plotOf,
    project,
    tally,
    withNext,
    type Mission,
    type MissionFact,
    type MissionPlot,
    type MissionPosition,
    type MissionStage,
    type MissionState,
    type PlotCell,
    type PlotTile,
} from "./model";
