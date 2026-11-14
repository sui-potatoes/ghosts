// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { CLASSIC_TITLE } from "./classicTitle";
import { PauseDialog, type PauseProps } from "./features/dialogs/PauseDialog";
import { PauseMenuClassic } from "./PauseMenuClassic";

/**
 * The in-game pause menu over the encounter frame (`/demo`, `/match`), in the
 * shared interface language (`features/dialogs/PauseDialog.tsx`); the classic
 * card is `PauseMenuClassic.tsx`, behind `CLASSIC_TITLE`.
 */
export function PauseMenu(props: PauseProps) {
    return CLASSIC_TITLE ? <PauseMenuClassic {...props} /> : <PauseDialog {...props} />;
}
