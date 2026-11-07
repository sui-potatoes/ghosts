// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Character builds for the title scene, one at a time with a task break
 * before each. Deforming and fitting three bodies back to back held the main
 * thread for about a second while the menu was already on screen; queued, the
 * menu answers between them.
 */
let tail: Promise<unknown> = Promise.resolve();
const breather = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function queueBuild<T>(build: () => Promise<T>): Promise<T> {
    const turn = tail.then(breather).then(build);
    tail = turn.catch(() => {});
    return turn;
}
