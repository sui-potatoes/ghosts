// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** Horizontal travel synchronized to the authored contact and landing keys.
 * Vertical motion belongs to the skeleton's pelvis/legs, never the scene root.
 */
export const VAULT_SECONDS = 1.65;
export const VAULT_TRAVEL = [
  [0, 0],
  [0.16, 0.1],
  [0.28, 0.24],
  [0.42, 0.4],
  [0.56, 0.57],
  [0.7, 0.77],
  [0.84, 0.94],
  [1, 1],
];
export function vaultProgress(t: number) {
  const i = Math.max(0, VAULT_TRAVEL.findIndex((key) => key[0] >= t) - 1);
  if (t >= 1) return 1;
  const a = VAULT_TRAVEL[i],
    b = VAULT_TRAVEL[i + 1];
  const u = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
  return a[1] + (b[1] - a[1]) * u;
}
