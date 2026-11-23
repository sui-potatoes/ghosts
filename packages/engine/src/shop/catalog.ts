// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The shop interiors pack as plain data: kind, display name, palette group,
 * search words, placement and durability. Three-free so the rules, the asset
 * catalog and node tests can read it; the meshes are authored in `assets.ts`
 * (`konbini.ts` for the convenience store).
 *
 * Wall-backed runs (fridges, open chillers, wall shelves) are a kit of
 * pieces on one cell each: `single` (both side panels), `end L` / `end R`
 * (one side panel, left / right as seen from the aisle), `mid` (no side
 * panels: half mullions, header, plinth and vent meet the neighbour flush)
 * and an inside `corner` that turns the run where two walls meet. Every
 * piece is authored in cell coordinates with its back on the cell's north
 * edge (just clear of a wall panel there) and its front to the south, so the
 * placement's turn names the wall it stands against. Free-standing runs
 * (gondolas, the freezer island) are `mid`, `end` (turn the end piece to cap
 * either side) and `single`; the counter is `straight`, `end` and `corner`.
 */
import type { AssetSpec } from "../catalog.ts";

/** The store furniture's colour schemes: unbranded, and the two fictional chains of the street. */
export type ShopFinish = "plain" | "eleventy" | "yandottir";
export const shopFinishes: readonly ShopFinish[] = ["plain", "eleventy", "yandottir"];
/** Stains for the izakaya, café and bar joinery. */
export type WoodFinish = "cedar" | "smoked" | "black";
export const woodFinishes: readonly WoodFinish[] = ["cedar", "smoked", "black"];
export type InteriorFinish = ShopFinish | WoodFinish;

export type RunPiece = "single" | "left" | "mid" | "right" | "corner";
export const runPieces: readonly RunPiece[] = ["single", "left", "mid", "right", "corner"];

export type ShopKind =
  | `fridge-${RunPiece}` | "fridge-dead"
  | `chiller-${RunPiece}`
  | `wall-shelf-${RunPiece}`
  | "gondola-single" | "gondola-end" | "gondola-mid"
  | "gondola-tall-single" | "gondola-tall-end" | "gondola-tall-mid"
  | "freezer-single" | "freezer-end" | "freezer-mid"
  | "counter-straight" | "counter-end" | "counter-corner"
  | "register" | "hot-case"
  // Izakaya.
  | "wood-wall" | "lattice-screen" | "noren" | "lantern" | "menu-strips" | "bottle-keep" | "coat-hooks"
  | "umbrella-stand" | "wall-clock" | "calendar" | "poster"
  | "bar-counter-straight" | "bar-counter-end" | "bar-counter-corner" | "stool" | "table-two" | "table-four"
  | "beer-crates" | "sake-barrel" | "grill"
  | "sake-set" | "beer-bottle" | "shochu" | "whisky" | "plates" | "bowl" | "chopsticks" | "caddy" | "napkins"
  | "towel" | "ashtray" | "menu-card"
  | "table-set-drinks" | "table-set-dinner" | "table-set-sake" | "table-set-late"
  // Coffee shop.
  | "espresso" | "grinder" | "pour-over" | "cups" | "pastry-case" | "menu-board" | "cafe-table" | "cafe-chair" | "pendant"
  // Bar.
  | "bar-fridge" | `back-bar-${RunPiece}` | "tap" | "glass-rack" | "ice-bucket" | "neon"
  // Street, parking, smoking.
  | "a-frame" | "sample-case"
  | "rail-guard" | "rail-chain" | "rail-mesh" | "rail-gap" | "wheel-stop" | "bay-line" | "bay-line-end" | "pay-station"
  | "no-smoking-plate" | "no-smoking-pole" | "no-smoking-paint" | "ashtray-stand"
  // Vehicles.
  | "kei-car" | "hatchback" | "kei-truck" | "van" | "taxi" | "scooter" | "mamachari"
  // Storefront glazing and building masses.
  | "auto-door" | "building-1" | "building-2" | "building-4" | "building-8"
  // Counter ends capping the left (west) end, so a straight counter closes at both ends.
  | "counter-end-left" | "bar-counter-end-left"
  // Street cover the level asked for.
  | "recycling-bins" | "dumpster" | "ac-unit" | "ac-pair" | "bus-shelter" | "taxi-shelter" | "roll-cage";

type Placement = Omit<AssetSpec, "kind" | "name" | "category" | "finishes">;
export interface ShopEntry extends Placement {
  name: string;
  group: string;
  /** Which colour schemes it offers: the chains' liveries (the default), wood stains, or one look. */
  scheme?: "shop" | "wood" | "none";
}

const one: AssetSpec["cells"] = [[0, 0]];
const tall: AssetSpec["cells"] = [[0, 0], [0, 1]];
const long1: AssetSpec["cells"] = [[0, 0], [0, 1], [0, 2]];
const long2: AssetSpec["cells"] = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
const pieceName: Record<RunPiece, string> = {
  single: "single", left: "end L", mid: "mid", right: "end R", corner: "inside corner",
};

/** One wall-backed run: the five pieces under consecutive uids. */
function run(kind: string, first: number, name: string, group: string, tags: string, spec: Omit<ShopEntry, "uid" | "tags" | "name" | "group">) {
  return Object.fromEntries(runPieces.map((piece, i) => [`${kind}-${piece}`, {
    uid: `k${String(first + i).padStart(2, "0")}`, name: `${name} · ${pieceName[piece]}`, group, tags, ...spec,
  }]));
}

const fridgeTags = "fridge cooler drinks refrigerator glass door konbini store wall run";
const chillerTags = "chiller open case multideck fridge rice balls onigiri lunch boxes bento dairy konbini wall run";
const shelfTags = "shelf wall shelving goods konbini store wall run";
const gondolaTags = "gondola shelf aisle snacks food stand double-sided konbini store";
const freezerTags = "freezer chest ice cream frozen island konbini store";
const counterTags = "counter checkout cashier till konbini store";

/** Placement and durability per kind, in palette order. Uids are pinned by `catalog.test.ts`. */
export const shopRoster: Record<ShopKind, ShopEntry> = {
  // Full-height but destructible: `cover` is the one cell class a frag clears on chain (an Obstacle),
  // so the scene and the rules agree when a grenade takes a fridge out. A `solid` cell would stay a
  // Wall on chain after the scene had shattered it.
  ...run("fridge", 1, "Drinks fridge", "Konbini · Fridges", fridgeTags, { footprint: "cover", cells: one, hp: 110 }),
  "fridge-dead": {
    uid: "k06", name: "Drinks fridge · dead mid", group: "Konbini · Fridges", tags: `${fridgeTags} dark broken open`,
    footprint: "cover", cells: one, hp: 110,
  },
  ...run("chiller", 7, "Open chiller", "Konbini · Fridges", chillerTags, { footprint: "cover", cells: one, hp: 100 }),
  ...run("wall-shelf", 12, "Wall shelf", "Konbini · Shelves", shelfTags, { footprint: "cover", cells: one, hp: 90, blast: 2 }),
  "gondola-single": { uid: "k17", name: "Gondola · single", group: "Konbini · Shelves", tags: gondolaTags, footprint: "cover", cells: one, hp: 80, blast: 2 },
  "gondola-end": { uid: "k18", name: "Gondola · end cap", group: "Konbini · Shelves", tags: gondolaTags, footprint: "cover", cells: one, hp: 80, blast: 2 },
  "gondola-mid": { uid: "k19", name: "Gondola · mid", group: "Konbini · Shelves", tags: gondolaTags, footprint: "cover", cells: one, hp: 80, blast: 2 },
  "gondola-tall-single": { uid: "k20", name: "Tall gondola · single", group: "Konbini · Shelves", tags: `${gondolaTags} tall`, footprint: "cover", cells: one, hp: 90, blast: 2 },
  "gondola-tall-end": { uid: "k21", name: "Tall gondola · end cap", group: "Konbini · Shelves", tags: `${gondolaTags} tall`, footprint: "cover", cells: one, hp: 90, blast: 2 },
  "gondola-tall-mid": { uid: "k22", name: "Tall gondola · mid", group: "Konbini · Shelves", tags: `${gondolaTags} tall`, footprint: "cover", cells: one, hp: 90, blast: 2 },
  "freezer-single": { uid: "k23", name: "Chest freezer · single", group: "Konbini · Fridges", tags: freezerTags, footprint: "cover", cells: one, hp: 90 },
  "freezer-end": { uid: "k24", name: "Chest freezer · end", group: "Konbini · Fridges", tags: freezerTags, footprint: "cover", cells: one, hp: 90 },
  "freezer-mid": { uid: "k25", name: "Chest freezer · mid", group: "Konbini · Fridges", tags: freezerTags, footprint: "cover", cells: one, hp: 90 },
  "counter-straight": { uid: "k26", name: "Shop counter · straight", group: "Konbini · Checkout", tags: counterTags, footprint: "cover", cells: one, hp: 100, blast: 2, top: 1 },
  "counter-end": { uid: "k27", name: "Shop counter · end", group: "Konbini · Checkout", tags: counterTags, footprint: "cover", cells: one, hp: 100, blast: 2, top: 1 },
  "counter-corner": { uid: "k28", name: "Shop counter · corner", group: "Konbini · Checkout", tags: counterTags, footprint: "cover", cells: one, hp: 100, blast: 2, top: 1 },
  register: {
    uid: "k29", name: "Cash register", group: "Konbini · Checkout",
    tags: "register cash machine till pos terminal card reader receipt printer checkout",
    footprint: "none", cells: one, hp: 30, mount: "surface", offset: [-0.3, 0],
  },
  "hot-case": {
    uid: "k30", name: "Hot food case", group: "Konbini · Checkout",
    tags: "hot food case warmer fried chicken counter checkout",
    footprint: "none", cells: one, hp: 20, mount: "surface", offset: [0.3, 0.02],
  },
  ...batch2(),
} as Record<ShopKind, ShopEntry>;

export const shopKinds = Object.keys(shopRoster) as ShopKind[];


/** The izakaya, coffee shop and bar, the street front, the car park, and parked vehicles. */
function batch2(): Record<string, ShopEntry> {
  const rows: Record<string, ShopEntry> = {};
  let n = 31;
  const k = () => `k${String(n++).padStart(2, "0")}`;
  const add = (kind: string, name: string, group: string, tags: string, spec: Omit<ShopEntry, "uid" | "name" | "group" | "tags">) => {
    rows[kind] = { uid: k(), name, group, tags, ...spec };
  };
  const wood = "wood" as const, none = "none" as const;
  const table = (tags: string) => `table tableware clutter izakaya ${tags}`;
  // Izakaya: walls and decor.
  add("wood-wall", "Timber wall", "Izakaya · Walls", "wall wood timber plank panelling izakaya",
    { footprint: "solid", cells: [], place: "edge", span: 1.35, hp: 160, gunproof: true, blast: 3, scheme: wood });
  add("lattice-screen", "Lattice screen · low", "Izakaya · Walls", "lattice koshi screen partition divider wood izakaya",
    { footprint: "cover", cells: [], place: "edge", span: 1.35, hp: 50, blast: 2, scheme: wood });
  add("noren", "Noren curtain", "Izakaya · Walls", "noren curtain doorway entrance fabric izakaya",
    { footprint: "none", cells: [], place: "edge", span: 1.35, hp: 10, scheme: none });
  add("lantern", "Red lantern", "Izakaya · Decor", "lantern chochin red paper light hanging izakaya",
    { footprint: "none", cells: one, hp: 10, scheme: none });
  add("menu-strips", "Menu strips", "Izakaya · Decor", "menu strips boards wall izakaya",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.35, hp: 15, scheme: wood });
  add("bottle-keep", "Bottle-keep shelf", "Izakaya · Decor", "bottle keep shelf wall bottles izakaya",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.3, hp: 30, scheme: wood });
  add("coat-hooks", "Coat hooks · jackets", "Izakaya · Decor", "coat hooks hangers jackets wall izakaya",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.65, hp: 20, scheme: wood });
  add("umbrella-stand", "Umbrella stand", "Izakaya · Decor", "umbrella stand entrance izakaya",
    { footprint: "none", cells: one, hp: 15, scheme: none });
  add("wall-clock", "Wall clock", "Izakaya · Decor", "clock wall izakaya cafe",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 2.05, hp: 8, scheme: none });
  add("calendar", "Wall calendar", "Izakaya · Decor", "calendar wall izakaya",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.45, hp: 5, scheme: none });
  add("poster", "Framed poster", "Izakaya · Decor", "poster frame picture wall decor",
    { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.45, hp: 8, scheme: none });
  // Izakaya: furniture.
  for (const [piece, name] of [["straight", "straight"], ["end", "end"], ["corner", "corner"]])
    add(`bar-counter-${piece}`, `Wooden counter · ${name}`, "Izakaya · Furniture", "counter bar wooden izakaya",
      { footprint: "cover", cells: one, hp: 100, blast: 2, top: 1.02, scheme: wood });
  add("stool", "Bar stool", "Izakaya · Furniture", "stool seat bar izakaya",
    { footprint: "none", cells: one, hp: 30, scheme: wood });
  add("table-two", "Table · 2 seats", "Izakaya · Furniture", "table chairs dining izakaya",
    { footprint: "cover", cells: one, hp: 80, blast: 2, top: 0.7, scheme: wood });
  add("table-four", "Table · 4 seats", "Izakaya · Furniture", "table chairs dining izakaya",
    { footprint: "cover", cells: tall, hp: 100, blast: 2, top: 0.7, scheme: wood });
  add("beer-crates", "Beer crate stack", "Izakaya · Furniture", "beer crates stack bottles izakaya",
    { footprint: "cover", cells: one, hp: 60, top: 0.87, scheme: none });
  add("sake-barrel", "Sake barrel", "Izakaya · Furniture", "sake barrel komodaru cask straw izakaya",
    { footprint: "cover", cells: one, hp: 70, top: 0.78, scheme: none });
  add("grill", "Yakitori grill", "Izakaya · Furniture", "grill yakitori charcoal kitchen izakaya",
    { footprint: "none", cells: one, hp: 30, mount: "surface", scheme: none });
  // Izakaya: tableware, singly and as table sets.
  const ware: [string, string, string][] = [
    ["sake-set", "Sake flask & cups", "sake tokkuri flask cups"], ["beer-bottle", "Beer bottle & glass", "beer bottle glass"],
    ["shochu", "Shochu bottle", "shochu bottle"], ["whisky", "Whisky bottle", "whisky bottle"],
    ["plates", "Small plates", "plates dishes food"], ["bowl", "Rice bowl", "bowl rice"],
    ["chopsticks", "Chopsticks on rest", "chopsticks"], ["caddy", "Condiment caddy", "caddy soy sauce condiments chopsticks"],
    ["napkins", "Napkin box", "napkins tissues"], ["towel", "Hand towel", "oshibori towel"],
    ["ashtray", "Ashtray", "ashtray"], ["menu-card", "Standing menu card", "menu card"],
    ["table-set-drinks", "Table set · drinks", "set cluster beer"], ["table-set-dinner", "Table set · dinner", "set cluster plates bowls"],
    ["table-set-sake", "Table set · sake", "set cluster sake"], ["table-set-late", "Table set · last orders", "set cluster empties ashtray"],
  ];
  for (const [kind, name, tags] of ware)
    add(kind, name, "Izakaya · Tableware", table(tags), { footprint: "none", cells: one, hp: 6, mount: "surface", scheme: none });
  // Coffee shop.
  const cafe = (tags: string) => `cafe coffee kissaten ${tags}`;
  add("espresso", "Espresso machine", "Café · Counter", cafe("espresso machine two group"), { footprint: "none", cells: one, hp: 60, mount: "surface", offset: [0, -0.1], scheme: none });
  add("grinder", "Coffee grinder", "Café · Counter", cafe("grinder beans"), { footprint: "none", cells: one, hp: 25, mount: "surface", offset: [0.45, -0.1], scheme: none });
  add("pour-over", "Pour-over stand", "Café · Counter", cafe("pour over drip siphon kettle"), { footprint: "none", cells: one, hp: 15, mount: "surface", scheme: wood });
  add("cups", "Cups & saucers", "Café · Counter", cafe("cups saucers stack"), { footprint: "none", cells: one, hp: 8, mount: "surface", scheme: none });
  add("pastry-case", "Pastry case", "Café · Counter", cafe("pastry case cakes glass display"), { footprint: "none", cells: one, hp: 20, mount: "surface", scheme: wood });
  add("menu-board", "Café menu board", "Café · Decor", cafe("menu board wall"), { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.45, hp: 12, scheme: none });
  add("cafe-table", "Café table", "Café · Furniture", cafe("table round"), { footprint: "cover", cells: one, hp: 60, blast: 2, top: 0.72, scheme: wood });
  add("cafe-chair", "Café chair", "Café · Furniture", cafe("chair bentwood seat"), { footprint: "none", cells: one, hp: 30, scheme: wood });
  add("pendant", "Pendant lamp", "Café · Decor", cafe("pendant lamp light hanging warm"), { footprint: "none", cells: one, hp: 8, scheme: none });
  // Bar.
  add("bar-fridge", "Drinks fridge · standalone", "Bar · Fittings", "fridge cooler drinks soft drinks bar standalone single glass door",
    { footprint: "cover", cells: one, hp: 80, scheme: none });
  Object.assign(rows, run("back-bar", n, "Back bar", "Bar · Fittings", "back bar shelf bottles liquor wall run mirror",
    { footprint: "cover", cells: one, hp: 90, blast: 2, scheme: wood }));
  n += 5;
  add("tap", "Beer tap tower", "Bar · Counter", "beer tap tower draft bar", { footprint: "none", cells: one, hp: 30, mount: "surface", offset: [0.3, -0.05], scheme: none });
  add("glass-rack", "Glass rack", "Bar · Counter", "glass rack glasses bar", { footprint: "none", cells: one, hp: 10, mount: "surface", offset: [-0.3, 0], scheme: none });
  add("ice-bucket", "Ice bucket & shaker", "Bar · Counter", "ice bucket shaker cocktail bar", { footprint: "none", cells: one, hp: 10, mount: "surface", offset: [0, 0.05], scheme: none });
  add("neon", "Neon sign", "Bar · Decor", "neon sign light glow wall bar", { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.6, hp: 10, scheme: none });
  // Street front.
  add("a-frame", "A-frame sign", "Street · Shopfront", "a-frame sidewalk sign board cafe street", { footprint: "none", cells: one, hp: 15, scheme: none });
  add("sample-case", "Food sample case", "Street · Shopfront", "food sample display case plastic shopfront window",
    { footprint: "cover", cells: one, hp: 40, scheme: wood });
  // Car park: fence runs seat on edges like the street fences; every section carries both its posts.
  add("rail-guard", "Guard rail · pipe", "Street · Parking", "parking fence guard rail pipe low",
    { footprint: "cover", cells: [], place: "edge", span: 1.35, hp: 60, scheme: none });
  add("rail-chain", "Chain & bollards", "Street · Parking", "parking fence chain bollards low",
    { footprint: "none", cells: [], place: "edge", span: 1.35, hp: 30, scheme: none });
  add("rail-mesh", "Mesh fence · tall", "Street · Parking", "parking fence mesh panel tall",
    { footprint: "obstacle", cells: [], place: "edge", span: 1.35, hp: 40, scheme: none });
  add("rail-gap", "Fence opening", "Street · Parking", "parking fence gap opening entrance posts",
    { footprint: "none", cells: [], place: "edge", span: 1.35, hp: 30, scheme: none });
  add("wheel-stop", "Wheel stop", "Street · Parking", "parking wheel stop concrete kerb", { footprint: "none", cells: one, hp: 0, scheme: none });
  add("bay-line", "Bay line", "Street · Parking", "parking bay line paint marking", { footprint: "none", cells: one, hp: 0, scheme: none });
  add("bay-line-end", "Bay line · end", "Street · Parking", "parking bay line paint marking end", { footprint: "none", cells: one, hp: 0, scheme: none });
  add("pay-station", "Pay station", "Street · Parking", "parking pay station machine coin", { footprint: "none", cells: one, hp: 40, scheme: none });
  // Smoking.
  add("no-smoking-plate", "No-smoking plate", "Street · Smoking", "no smoking sign plate wall", { footprint: "none", cells: [], place: "edge", mount: "wall", lift: 1.4, hp: 5, scheme: none });
  add("no-smoking-pole", "No-smoking pole sign", "Street · Smoking", "no smoking sign pole sidewalk", { footprint: "none", cells: one, hp: 20, scheme: none });
  add("no-smoking-paint", "No-smoking marking", "Street · Smoking", "no smoking pavement marking paint", { footprint: "none", cells: one, hp: 0, scheme: none });
  add("ashtray-stand", "Standing ashtray", "Street · Smoking", "ashtray smoking area bin stand", { footprint: "none", cells: one, hp: 20, scheme: none });
  // Vehicles: indestructible for now (destruction deferred), so a wall tile like a building:
  // the rules never clear a cell a car still stands on. Seeded paint colours.
  n = 1;
  const v = () => `v${String(n++).padStart(2, "0")}`;
  const car = (kind: string, name: string, tags: string, cells: AssetSpec["cells"]) =>
    (rows[kind] = { uid: v(), name, group: "Street · Vehicles", tags: `vehicle parked ${tags}`, footprint: "solid", cells, hp: 0, scheme: none });
  car("kei-car", "Kei car", "car kei mini", long1);
  car("hatchback", "Compact hatchback", "car hatchback sedan", long2);
  car("kei-truck", "Kei truck", "truck kei pickup flatbed", long1);
  car("van", "Delivery van", "van delivery one-box", long2);
  car("taxi", "Taxi", "taxi cab car", long2);
  rows["scooter"] = { uid: v(), name: "Scooter", group: "Street · Vehicles", tags: "vehicle scooter moped parked", footprint: "none", cells: one, hp: 0, scheme: none };
  // Building masses: unenterable, indestructible, a wall tile like the typed building block.
  let m = 1;
  const u = () => `u${String(m++).padStart(2, "0")}`;
  for (const floors of [1, 2, 4, 8])
    rows[`building-${floors}`] = { uid: u(), name: `Building · ${floors} storey${floors > 1 ? "s" : ""}`, group: "Street · Buildings",
      tags: "building block mass facade tall storeys", footprint: "solid", cells: one, hp: 0, scheme: none };
  // The glazed storefront's doorway: an open edge (no cover), posts shared with the glass walls beside it.
  rows["auto-door"] = { uid: u(), name: "Automatic door", group: "Office · Architecture",
    tags: "door automatic sliding glass storefront entrance", footprint: "none", cells: [], place: "edge", span: 1.35, hp: 12, scheme: none };
  rows["counter-end-left"] = { uid: u(), name: "Shop counter · end L", group: "Konbini · Checkout",
    tags: counterTags, footprint: "cover", cells: one, hp: 100, blast: 2, top: 1 };
  rows["bar-counter-end-left"] = { uid: u(), name: "Wooden counter · end L", group: "Izakaya · Furniture",
    tags: "counter bar wooden izakaya", footprint: "cover", cells: one, hp: 100, blast: 2, top: 1.02, scheme: wood };
  const street = (kind: string, name: string, tags: string, spec: Omit<ShopEntry, "uid" | "name" | "group" | "tags">) =>
    (rows[kind] = { uid: u(), name, group: "Street · Cover", tags: `street cover ${tags}`, scheme: none, ...spec });
  street("recycling-bins", "Recycling bins", "bin bins trash recycling cans bottles", { footprint: "cover", cells: one, hp: 50 });
  street("dumpster", "Dumpster", "dumpster bin skip container trash", { footprint: "cover", cells: one, hp: 120, top: 1.12 });
  street("ac-unit", "AC condenser", "ac air conditioner condenser outdoor unit wall", { footprint: "cover", cells: one, hp: 40, top: 0.78 });
  street("ac-pair", "AC condensers · stacked", "ac air conditioner condenser outdoor unit wall stacked", { footprint: "cover", cells: one, hp: 60 });
  // Shelters seat on the edge their back panel stands on: low cover along it, open in front.
  street("bus-shelter", "Bus shelter", "bus stop shelter bench roof glass", { footprint: "cover", cells: [], place: "edge", span: 1.35, hp: 60 });
  street("taxi-shelter", "Taxi stand shelter", "taxi stand shelter bench roof glass", { footprint: "cover", cells: [], place: "edge", span: 1.35, hp: 60 });
  street("roll-cage", "Roll cage", "roll cage cart delivery trolley boxes", { footprint: "cover", cells: one, hp: 50 });
  rows["mamachari"] = { uid: v(), name: "City bicycle", group: "Street · Vehicles", tags: "vehicle bicycle bike mamachari basket parked", footprint: "none", cells: one, hp: 0, scheme: none };
  return rows;
}
