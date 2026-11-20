// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** The passkey's storage slot, free of wallet and browser imports so tests can reach it. */

/** Local storage slot for the passkey's public key (per network). */
export function passkeySlot(network: string): string {
    return `ghosts:passkey:${network}`;
}

/** Remove the remembered passkey from `storage`; true when something was there. */
export function clearPasskeySlot(
    storage: Pick<Storage, "getItem" | "removeItem">,
    network: string,
) {
    const had = storage.getItem(passkeySlot(network)) !== null;
    storage.removeItem(passkeySlot(network));
    return had;
}
