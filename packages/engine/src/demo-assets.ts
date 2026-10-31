// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The one way engine code names a file under `public/demo-assets` (models,
 * district textures, the basis transcoder, combat rigs). Honours the host's
 * base URL the way the squad package's `assetUrl` does, instead of each
 * loader hard-coding an absolute `/demo-assets/...` path that breaks when
 * the app is served from a sub-path.
 */
export function demoAsset(path: string): string {
  return `${import.meta.env?.BASE_URL ?? "/"}demo-assets/${path}`;
}
