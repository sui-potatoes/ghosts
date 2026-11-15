// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The game's interface language. See README.md in this folder. */

import "./gui.css";

export { claimScreenBack, screenOwnsBack } from "./back";
export { barOf, CommandBar, CommandHint, FocusCommandBar } from "./CommandBar";
export {
    FocusCursor,
    FocusRoot,
    FocusScope,
    FocusStore,
    headerClick,
    useFocusable,
    useFocusState,
    useFocusStore,
    type Command,
    type CommandAction,
    type Dir,
    type Pulse,
} from "./focus";
export { ScreenFrame, StatusChip, Tabs, type TabDef } from "./frame";
export { GridPicker, type GridOption } from "./GridPicker";
export { Glyph, useGlyphSet, type GlyphSet } from "./glyphs";
export { Icon, SLOT_ICON, STAT_ICON, type IconName } from "./icons";
export { List } from "./List";
export {
    ActionRow,
    EmptyState,
    Eyebrow,
    ListRow,
    Meter,
    Panel,
    ReadoutLine,
    Slider,
    SlotRow,
    StatRow,
    Stepper,
    SwatchRow,
    TextField,
    Thumb,
} from "./parts";
export { ContextMenu, InlineCommands } from "./pointer";
export { Prompt } from "./Prompt";
export { StagePanel, useStageAttach, type StageControl } from "./stage";
