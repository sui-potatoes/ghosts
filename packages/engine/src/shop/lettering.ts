// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every piece of lettering the shop pack draws, in one place: the input of
 * the offline bake (`scripts/bake-lettering.mjs`), which sets each string in
 * white on clear into one atlas image, and the list a native speaker checks.
 * Short generic phrases only, no business names; the two chains stay Latin.
 * `brush` is Yuji Syuku (noren, lanterns, menu strips), `sans` Noto Sans JP
 * (printed signage), both used on the baking machine only: the game ships
 * the image, never a font. Materials tint the white glyphs with `ink` and
 * sit them on a `ground` plate, so one glyph image serves every colour.
 *
 * `shape`: `h` set horizontally, `v` top to bottom (one glyph per row; the
 * long vowel mark turns), `s` a single glyph.
 */
export type LetterFont = "brush" | "sans";
export type LetterShape = "h" | "v" | "s";

export interface Lettering {
  id: string;
  text: string;
  font: LetterFont;
  /** CSS font weight the bake sets it in. */
  weight?: number;
  shape: LetterShape;
  /** Ink and ground, 0xRRGGBB; a ground of -1 is clear (paint on a pavement). */
  ink: number;
  ground: number;
  /** English, for review. */
  gloss: string;
  /** Where it is drawn. */
  use: string;
}

const paper = 0xf1ebdc, ink = 0x24201c, cream = 0xf2e6cc;

export const lettering: readonly Lettering[] = [
  // Convenience store: category plates on the fridge, chiller, freezer and shelf headers.
  { id: "drinks", text: "飲料", font: "sans", shape: "h", ink, ground: paper, gloss: "beverages", use: "drinks fridge header plate" },
  { id: "onigiri", text: "おにぎり", font: "sans", shape: "h", ink, ground: paper, gloss: "rice balls", use: "open chiller header plate" },
  { id: "bento", text: "弁当", font: "sans", shape: "h", ink, ground: paper, gloss: "lunch boxes", use: "open chiller header plate" },
  { id: "ice", text: "アイス", font: "sans", shape: "h", ink, ground: paper, gloss: "ice cream", use: "chest freezer plate" },
  { id: "sweets", text: "お菓子", font: "sans", shape: "h", ink, ground: paper, gloss: "sweets, snacks", use: "gondola end-cap header" },
  { id: "daily", text: "日用品", font: "sans", shape: "h", ink, ground: paper, gloss: "daily goods", use: "wall shelf header plate" },
  { id: "eleventy", text: "ELEVENTY", font: "sans", shape: "h", ink: 0xf2c14e, ground: 0x2a2238, gloss: "fictional chain (Latin)", use: "register screen, counter front" },
  { id: "yandottir", text: "YANDOTTIR", font: "sans", shape: "h", ink: 0xf6e7d0, ground: 0x1d6f6a, gloss: "fictional chain (Latin)", use: "register screen, counter front" },
  // Izakaya.
  { id: "izakaya", text: "居酒屋", font: "brush", shape: "v", ink: 0x1d1a17, ground: 0xc8392c, gloss: "izakaya (pub)", use: "red lantern" },
  { id: "sake", text: "酒", font: "brush", shape: "s", ink: cream, ground: 0x2c3a5a, gloss: "sake, alcohol", use: "noren curtain" },
  { id: "yakitori", text: "焼鳥", font: "brush", shape: "v", ink: 0x1d1a17, ground: 0xc8392c, gloss: "grilled chicken skewers", use: "red lantern" },
  { id: "open", text: "営業中", font: "brush", shape: "h", ink, ground: 0xd9c7a0, gloss: "open for business", use: "hanging door plate" },
  { id: "preparing", text: "準備中", font: "brush", shape: "h", ink, ground: 0xd9c7a0, gloss: "preparing (closed)", use: "hanging door plate, back face" },
  { id: "menu", text: "お品書き", font: "brush", shape: "v", ink: cream, ground: 0x2a211b, gloss: "menu", use: "menu strip board header" },
  { id: "beer", text: "生ビール", font: "brush", shape: "v", ink, ground: cream, gloss: "draft beer", use: "menu strip" },
  { id: "skewers", text: "焼鳥", font: "brush", shape: "v", ink, ground: cream, gloss: "grilled chicken skewers", use: "menu strip" },
  { id: "edamame", text: "枝豆", font: "brush", shape: "v", ink, ground: cream, gloss: "edamame", use: "menu strip" },
  { id: "tofu", text: "冷奴", font: "brush", shape: "v", ink, ground: cream, gloss: "chilled tofu", use: "menu strip" },
  { id: "karaage", text: "唐揚げ", font: "brush", shape: "v", ink, ground: cream, gloss: "fried chicken", use: "menu strip" },
  { id: "sashimi", text: "刺身", font: "brush", shape: "v", ink, ground: cream, gloss: "sashimi", use: "menu strip" },
  { id: "shochu", text: "焼酎", font: "brush", shape: "v", ink, ground: cream, gloss: "shochu", use: "menu strip" },
  { id: "nihonshu", text: "日本酒", font: "brush", shape: "v", ink, ground: cream, gloss: "Japanese sake", use: "menu strip" },
  // Coffee shop.
  { id: "coffee", text: "珈琲", font: "brush", shape: "h", ink: cream, ground: 0x2b2420, gloss: "coffee", use: "café menu board header" },
  { id: "kissaten", text: "喫茶", font: "brush", shape: "v", ink: 0x2b2420, ground: 0xe8dcc0, gloss: "coffee house", use: "A-frame sign" },
  { id: "blend", text: "ブレンド", font: "sans", shape: "h", ink: cream, ground: 0x2b2420, gloss: "house blend", use: "café menu board" },
  { id: "tea", text: "紅茶", font: "sans", shape: "h", ink: cream, ground: 0x2b2420, gloss: "black tea", use: "café menu board" },
  { id: "cake", text: "ケーキ", font: "sans", shape: "h", ink: cream, ground: 0x2b2420, gloss: "cake", use: "café menu board" },
  { id: "napolitan", text: "ナポリタン", font: "sans", shape: "h", ink: cream, ground: 0x2b2420, gloss: "spaghetti Napolitan", use: "café menu board" },
  // Street.
  { id: "no-smoking", text: "禁煙", font: "sans", shape: "h", ink: 0xc8302a, ground: 0xf2f0ea, gloss: "no smoking", use: "wall plate under the pictogram" },
  { id: "street-smoking", text: "路上喫煙禁止", font: "sans", shape: "h", ink: 0xf2f0ea, ground: 0xc8302a, gloss: "no smoking on the street", use: "pole sign, pavement marking" },
  { id: "smoking-area", text: "喫煙所", font: "sans", shape: "h", ink: 0xf2f0ea, ground: 0x3b5a46, gloss: "smoking area", use: "standing ashtray" },
  { id: "parking", text: "駐車場", font: "sans", shape: "h", ink: 0xf2f0ea, ground: 0x23508c, gloss: "car park", use: "pay station header" },
  { id: "full", text: "満", font: "sans", shape: "s", ink: 0xf2f0ea, ground: 0xb8302a, gloss: "full", use: "pay station indicator" },
  { id: "vacant", text: "空", font: "sans", shape: "s", ink: 0xf2f0ea, ground: 0x2d7a4a, gloss: "vacant", use: "pay station indicator" },
  { id: "monthly", text: "月極", font: "sans", shape: "h", ink: 0x23508c, ground: 0xf2f0ea, gloss: "monthly contract parking", use: "fence plate" },
  { id: "for-rent", text: "貸事務所", font: "sans", shape: "v", ink: 0xf2f0ea, ground: 0x23508c, gloss: "office space for rent", use: "building vertical sign" },
  { id: "tenants", text: "テナント募集", font: "sans", shape: "v", ink: 0xc8302a, ground: 0xf2f0ea, gloss: "tenants wanted", use: "building vertical sign" },
  { id: "bus-stop", text: "バス停", font: "sans", shape: "h", ink: 0xf2f0ea, ground: 0x23508c, gloss: "bus stop", use: "bus shelter roof sign" },
  { id: "taxi-stand", text: "タクシー乗り場", font: "sans", shape: "h", ink: 0x1d1a17, ground: 0xe6b84a, gloss: "taxi stand", use: "taxi shelter roof sign" },
  { id: "24h", text: "24時間", font: "sans", shape: "v", ink: 0xf2f0ea, ground: -1, gloss: "24 hours", use: "blade sign, pylon" },
  { id: "atm", text: "ATM", font: "sans", shape: "h", ink: 0xf2f0ea, ground: -1, gloss: "ATM (Latin)", use: "ATM header" },
  { id: "sale", text: "セール", font: "sans", shape: "h", ink: 0xf2f0ea, ground: 0xc8302a, gloss: "sale", use: "window poster" },
  { id: "new", text: "新発売", font: "sans", shape: "h", ink: 0x24201c, ground: 0xf2c14e, gloss: "new release", use: "window poster" },
  { id: "toilet", text: "トイレ", font: "sans", shape: "h", ink: 0x24201c, ground: -1, gloss: "toilet", use: "toilet door plate" },
  { id: "burnable", text: "燃えるゴミ", font: "sans", shape: "h", ink: 0x24201c, ground: 0xf2f0ea, gloss: "burnable rubbish", use: "recycling bank label" },
  { id: "pet", text: "ペットボトル", font: "sans", shape: "h", ink: 0x24201c, ground: 0xf2f0ea, gloss: "PET bottles", use: "recycling bank label" },
  { id: "cans", text: "カン・ビン", font: "sans", shape: "h", ink: 0x24201c, ground: 0xf2f0ea, gloss: "cans and bottles", use: "recycling bank label" },
  { id: "works", text: "工事中", font: "sans", shape: "h", ink: 0xc8302a, ground: -1, gloss: "under construction", use: "roadworks board" },
  { id: "street-smoking-paint", text: "路上喫煙禁止", font: "sans", shape: "h", ink: 0xe8e4d8, ground: -1, gloss: "no smoking on the street", use: "pavement marking" },
];

export const letteringById = new Map(lettering.map((l) => [l.id, l]));
