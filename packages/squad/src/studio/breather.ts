// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

const channel = typeof MessageChannel === "undefined" ? null : new MessageChannel();
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();

/**
 * A pause between the long steps of a build or a capture, so the browser can
 * handle input and paint a frame in between instead of freezing the screen
 * for the whole job. Not a timer: hidden tabs do not throttle it to a crawl.
 */
export function breather(): Promise<void> {
    const scheduler = (globalThis as { scheduler?: { yield?(): Promise<void> } }).scheduler;
    if (scheduler?.yield) return scheduler.yield();
    if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
    return new Promise((resolve) => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
    });
}
