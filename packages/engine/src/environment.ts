// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Cell } from "./map.ts";
import { assetCatalog, assetSpec } from "./catalog.ts";
import type { OfficeKind, OfficeFinish } from "./office/catalog.ts";
import type { InteriorFinish, ShopKind } from "./shop/catalog.ts";

export type StreetKind =
  | "barrier" | "crate" | "cargo" | "barrels" | "smoking-barrel"
  | "fence-sheet" | "fence-chain" | "fence-picket" | "cone" | "sign"
  | "wall" | "window-wall" | "glass"
  | "vending" | "bicycle" | "pallet" | "utility-pole";
/** Typed stand-ins: tactical semantics as plain meshes, no authored model. */
export type BlockKind =
  | "block-cover" | "block-high" | "block-weak" | "block-obstacle" | "block-solid" | "block-fill";
export type PropKind = StreetKind | BlockKind | `office-${OfficeKind}` | `shop-${ShopKind}`;

/** Positions are world metres; variation is seeded independently of combat. */
export interface MapProp {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  y?: number;
  yaw: number;
  seed: number;
  /** Stretch along the prop's own x (an edge asset fitted to one cell edge); 1 when absent. */
  span?: number;
  /** A window frame is removed when its supporting masonry is destroyed. */
  support?: string;
  /** Only solid, waist-high props occupy tactical cover cells. */
  cover?: Cell;
  /** A frameless pane fitted into static building scenery; never tactical cover. */
  storefront?: { building: number; width: number; height: number };
  office?: { kind: OfficeKind; finish?: OfficeFinish; open?: boolean };
  /** A shop-pack piece's chain livery; its seeded look comes from `seed`. */
  shop?: { finish?: InteriorFinish };
  /** A building piece's outside faces (bits: 1 +z, 2 +x, 4 -z, 8 -x, local); absent: all four. */
  faces?: number;
  /** Independent glazing in an office wall or door. */
  pane?: { width: number; height: number };
  /** Movement / cover cells owned by this prop, released when it is destroyed. */
  blocks?: Cell[];
  covers?: Cell[];
  /** Local-space shot volume, in metres. Shot presentation uses the actual contact. */
  hitbox?: { width: number; height: number; depth: number; x?: number; y?: number; z?: number };
}

export interface PropDamage {
  id: string;
  hp: number;
  destroyed: boolean;
  /** World-space contact for a stray shot, so its tracer reaches the actual pane. */
  impact?: [number, number, number];
}

/** Hit points per kind, from the asset catalog — the one roster of assets. */
export const propHealth = Object.fromEntries(
  assetCatalog.map((a) => [a.kind, a.hp]),
) as Record<PropKind, number>;

/** Furniture joints and modular panel fixings fail under blast pressure. Rifle HP is unchanged. */
export function propBlastMultiplier(kind: PropKind) {
  return assetSpec(kind).blast ?? 1;
}

/** Full-height masonry needs explosives; low cover retains its existing damage rules. */
export function resistsGunfire(kind: PropKind) {
  return assetSpec(kind).gunproof === true;
}

/** A local random stream: asset detail never consumes combat/rain randomness. */
export function propRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
