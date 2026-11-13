// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { SuiClientTypes } from "@mysten/sui/client";

/** An executed transaction with everything an encounter driver reads from it. */
export type ExecutedTransaction = SuiClientTypes.Transaction<{
    effects: true;
    events: true;
    objectTypes: true;
}>;
