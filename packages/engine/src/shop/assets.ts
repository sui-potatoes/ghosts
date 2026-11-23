// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { InteriorFinish, RunPiece, ShopKind } from "./catalog.ts";
import { Build, Kit, flatten } from "./kit.ts";
import { chiller, counter, freezer, fridge, gondola, hotCase, register, wallShelf } from "./konbini.ts";
import * as room from "./interiors.ts";
import * as street from "./street.ts";
import * as car from "./vehicles.ts";

/** Builders by kind for everything outside the convenience store. */
const builders: Partial<Record<ShopKind, (b: Build) => void>> = {
  "wood-wall": room.woodWall, "lattice-screen": room.latticeScreen, noren: room.noren, lantern: room.lantern,
  "menu-strips": room.menuStrips, "bottle-keep": room.bottleKeep, "coat-hooks": room.coatHooks,
  "umbrella-stand": room.umbrellaStand, "wall-clock": room.wallClock, calendar: room.calendar, poster: room.poster,
  "bar-counter-straight": (b) => room.woodCounter(b, "straight"), "bar-counter-end": (b) => room.woodCounter(b, "end"),
  "bar-counter-corner": (b) => room.woodCounter(b, "corner"), "bar-counter-end-left": (b) => room.woodCounter(b, "end-left"),
  "counter-end-left": (b) => counter(b, "end-left"), stool: room.stool,
  "table-two": (b) => room.table(b, 2), "table-four": (b) => room.table(b, 4),
  "beer-crates": room.beerCrates, "sake-barrel": room.sakeBarrel, grill: room.grill,
  "table-set-drinks": (b) => room.tableSet(b, "drinks"), "table-set-dinner": (b) => room.tableSet(b, "dinner"),
  "table-set-sake": (b) => room.tableSet(b, "sake"), "table-set-late": (b) => room.tableSet(b, "late"),
  espresso: room.espresso, grinder: room.grinder, "pour-over": room.pourOver, cups: room.cups,
  "pastry-case": room.pastryCase, "menu-board": room.menuBoard, "cafe-table": room.cafeTable,
  "cafe-chair": room.cafeChair, pendant: room.pendant,
  "bar-fridge": room.barFridge, tap: room.tap, "glass-rack": room.glassRack, "ice-bucket": room.iceBucket, neon: room.neon,
  "a-frame": street.aFrame, "sample-case": street.sampleCase,
  "rail-guard": street.railGuard, "rail-chain": street.railChain, "rail-mesh": street.railMesh, "rail-gap": street.railGap,
  "wheel-stop": street.wheelStop, "bay-line": (b) => street.bayLine(b, false), "bay-line-end": (b) => street.bayLine(b, true),
  "pay-station": street.payStation, "no-smoking-plate": street.noSmokingPlate, "no-smoking-pole": street.noSmokingPole,
  "no-smoking-paint": street.noSmokingPaint, "ashtray-stand": street.ashtrayStand, "auto-door": street.autoDoor,
  "building-1": (b) => street.building(b, 1), "building-2": (b) => street.building(b, 2),
  "building-4": (b) => street.building(b, 4), "building-8": (b) => street.building(b, 8),
  "recycling-bins": street.recyclingBins, dumpster: street.dumpster,
  "ac-unit": (b) => street.acUnit(b, false), "ac-pair": (b) => street.acUnit(b, true),
  "bus-shelter": (b) => street.shelter(b, false), "taxi-shelter": (b) => street.shelter(b, true), "roll-cage": street.rollCage,
  "building-wall-store": (b) => street.shell(b, "store"), "building-wall-corner": (b) => street.shell(b, "corner"),
  "building-wall-partition": (b) => street.shell(b, "partition"), "building-wall-timber": (b) => street.shell(b, "timber"),
  "building-wall-concrete": (b) => street.shell(b, "concrete"),
  "kei-car": car.keiCar, hatchback: (b) => car.hatchback(b), "kei-truck": car.keiTruck, van: car.van,
  taxi: (b) => car.hatchback(b, true), scooter: car.scooter, mamachari: car.mamachari,
};
const tableware = ["sake-set", "beer-bottle", "shochu", "whisky", "plates", "bowl", "chopsticks", "caddy", "napkins", "towel", "ashtray", "menu-card"];

export { shopRoster, shopKinds, shopFinishes } from "./catalog.ts";
export type { ShopKind, ShopFinish, InteriorFinish } from "./catalog.ts";
export { woodFinishes } from "./catalog.ts";

/** Seeded looks per kind: a run of modules cycles through these by cell. */
export const SHOP_VARIANTS = 4;

/**
 * The shop pack's meshes, like `OfficeAssets`: metres, floor origin, +Z the
 * front, in the cell's own coordinates (wall-backed pieces keep their back on
 * the north edge). `create` returns merged groups sharing cached geometry and
 * materials; `parts` the unmerged pieces for rigid breakage. Dispose the pack
 * only after removing every instance.
 */
export class ShopAssets {
  private readonly kit = new Kit();
  private readonly templates = new Map<string, T.Group>();
  private readonly partTemplates = new Map<string, T.Group>();

  create(kind: ShopKind, finish?: InteriorFinish, variant = 0): T.Group {
    const key = `${kind}:${finish}:${variant % SHOP_VARIANTS}`;
    let template = this.templates.get(key);
    if (!template) {
      template = this.build(kind, finish, variant % SHOP_VARIANTS);
      this.templates.set(key, template);
    }
    return template.clone(true);
  }

  /** Individual authored pieces for rigid breakage; same transforms and finish as the intact model. */
  parts(kind: ShopKind, finish?: InteriorFinish, variant = 0): T.Group {
    this.create(kind, finish, variant);
    return this.partTemplates.get(`${kind}:${finish}:${variant % SHOP_VARIANTS}`)!.clone(true);
  }

  private build(kind: ShopKind, finish: InteriorFinish | undefined, variant: number) {
    const b = new Build(this.kit, kind, finish ?? "plain", variant);
    b.root.userData.shopKind = kind;
    const [family, ...rest] = kind.split("-");
    const piece = rest.join("-");
    const builder = builders[kind];
    if (builder) builder(b);
    else if (tableware.includes(kind)) room.ware(b, kind as room.Ware);
    else if (kind.startsWith("back-bar-")) room.backBar(b, kind.slice(9) as RunPiece);
    else if (kind.startsWith("wall-shelf-")) wallShelf(b, kind.slice(11) as RunPiece);
    else if (kind.startsWith("gondola-tall-")) gondola(b, kind.slice(13) as "single" | "end" | "mid", true);
    else switch (family) {
      case "fridge": fridge(b, piece as RunPiece | "dead"); break;
      case "chiller": chiller(b, piece as RunPiece); break;
      case "gondola": gondola(b, piece as "single" | "end" | "mid", false); break;
      case "freezer": freezer(b, piece as "single" | "end" | "mid"); break;
      case "counter": counter(b, piece as "straight" | "end" | "end-left" | "corner"); break;
      case "register": register(b); break;
      case "hot": hotCase(b); break;
      default: throw new Error(`No shop model for ${kind}`);
    }
    flatten(b.root);
    const key = `${kind}:${finish}:${variant}`;
    this.partTemplates.set(key, b.root.clone(true));
    this.merge(b.root, kind);
    return b.root;
  }

  /** Merge per material within each part; door leaves and lids stay separate. */
  private merge(group: T.Group, kind: string) {
    for (const child of [...group.children]) if (child instanceof T.Group) this.merge(child, kind);
    const batches = new Map<T.Material, T.Mesh[]>();
    for (const child of group.children) if (child instanceof T.Mesh && !Array.isArray(child.material)) {
      const list = batches.get(child.material) ?? []; list.push(child); batches.set(child.material, list);
    }
    for (const [material, meshes] of batches) {
      const transformed = meshes.map(m => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const geometry = mergeGeometries(transformed, false);
      for (const g of transformed) g.dispose();
      if (!geometry) throw new Error(`Cannot batch shop asset ${kind}`);
      const m = new T.Mesh(this.kit.geometry(geometry), material);
      m.castShadow = !(material as T.MeshStandardMaterial).transparent; m.receiveShadow = true;
      group.remove(...meshes); group.add(m);
    }
  }

  dispose() {
    this.kit.dispose();
    this.templates.clear(); this.partTemplates.clear();
  }
}
