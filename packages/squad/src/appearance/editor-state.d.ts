// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { Appearance, Schema, Sex } from "../types";
export const GLASSES: [string, string][];
export const DEFAULT_LENS_TINT: number;
export const SCARS: [string, string][];
export const HAIR: [string, string][];
export const BROWS: [string, string][];
export const TATTOOS: [string, string][];
export const BROW_CONTROLS: {
    key: "browThickness" | "browLength" | "browArch" | "browTail" | "browDensity";
    label: string;
    low: string;
    high: string;
    min?: number;
    max?: number;
}[];
export const EYE_PRESETS: { name: string; values: Record<string, number> }[];
export const presets: (Partial<Appearance> & {
    name: string;
    sex: Sex;
    description: string;
    values: Record<string, number>;
})[];
export function baseState(): Appearance;
export function fromPreset(preset: Partial<Appearance>): Appearance;
export function normalize(input: unknown, schema: Schema): Appearance;
export function weights(state: Appearance): Record<string, number>;
export function randomIdentity(
    schema: Schema,
    sex: Sex,
    random?: () => number,
    previous?: Appearance | null,
): Appearance;
export function shuffleFace(schema: Schema, current: Appearance, random?: () => number): Appearance;
