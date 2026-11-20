// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * How a failed read shows on the Spectate screens: the title says what could
 * not be loaded and nothing more, a second line only when the cause is known
 * (the device is offline), and the error itself goes to the console for
 * developers, never on screen.
 */

import { useEffect } from "react";

/** The one cause a failed read can name: the device is offline. Null when it is not known to be. */
export function offlineLine(
    online: boolean | undefined = globalThis.navigator?.onLine,
): string | null {
    return online === false ? "You are offline" : null;
}

/** Log a read's error for developers, once per error. */
export function useReportError(error: unknown, what: string) {
    useEffect(() => {
        if (error) console.error(`[spectate] ${what}`, error);
    }, [error, what]);
}
