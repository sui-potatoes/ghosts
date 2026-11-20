// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Games are no longer recorded on the device: the store older builds kept them
 * in is cleared once per load, so nothing stale stays behind.
 */

/** Where older builds kept the games recorded in `/demo`. */
export const OLD_RECORDINGS_KEY = "ghosts:watch:journals";

let done = false;

/** Remove the old recordings from the device's storage, once per load; blocked storage is left alone. */
export function forgetDeviceRecordings(storage?: Pick<Storage, "removeItem"> | null): void {
    if (done) return;
    done = true;
    try {
        (storage ?? window.localStorage).removeItem(OLD_RECORDINGS_KEY);
    } catch {
        // storage blocked: nothing to clear
    }
}
