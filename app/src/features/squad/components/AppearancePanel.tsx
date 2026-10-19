import { useState } from "react";
import type { Appearance } from "../types";
import { schema } from "../appearance/schema";
import {
    BROWS,
    BROW_CONTROLS,
    EYE_PRESETS,
    GLASSES,
    HAIR,
    SCARS,
    TATTOOS,
    shuffleFace,
    randomIdentity,
    fromPreset,
    presets,
    normalize,
} from "../appearance/editor-state.js";
const SKINS = [
    ["young_caucasian", "Clear · light"],
    ["young_asian", "Clear · medium"],
    ["young_african", "Clear · deep"],
    ["middleage_caucasian", "Mature · light"],
    ["middleage_asian", "Mature · medium"],
    ["middleage_african", "Mature · deep"],
];
const EYES = ["brown", "brownlight", "green", "bluegreen", "blue", "grey", "deepblue", "ice"].map(
    (key) => [key, key.replace("light", " light").replace("deep", "deep ")],
);
function Select({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[][];
    onChange(value: string): void;
}) {
    return (
        <label className="sq-field">
            <span>{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map(([id, name]) => (
                    <option key={id} value={id}>
                        {name}
                    </option>
                ))}
            </select>
        </label>
    );
}
function Range({
    label,
    value,
    onChange,
    min = -1,
    max = 1,
    low,
    high,
}: {
    label: string;
    value: number;
    onChange(value: number): void;
    min?: number;
    max?: number;
    low?: string;
    high?: string;
}) {
    return (
        <label className="sq-range">
            <span>
                {label}
                <output>{Math.round(value * 100)}</output>
            </span>
            <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={value}
                onChange={(e) => onChange(+e.target.value)}
            />
            <small>
                <span>{low}</span>
                <span>{high}</span>
            </small>
        </label>
    );
}
function Color({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange(value: string): void;
}) {
    return (
        <label className="sq-color">
            <span>{label}</span>
            <input
                aria-label={label}
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </label>
    );
}
interface Props {
    value: Appearance;
    onChange(value: Appearance): void;
    dirty: boolean;
    onSave(): void;
    onReset(): void;
}
export function AppearancePanel({ value: s, onChange, dirty, onSave, onReset }: Props) {
    const [category, setCategory] = useState("Face"),
        [region, setRegion] = useState("Contour");
    const patch = (p: Partial<Appearance>) => onChange({ ...s, ...p });
    const morph = (key: string, value: number) => patch({ values: { ...s.values, [key]: value } });
    const section =
        category === "Eyes" ? "Eyes" : category === "Brows" ? "Brow & forehead" : region;
    return (
        <div className="appearance-panel">
            <div className="sq-panel-heading">
                <div>
                    <span className="sq-eyebrow">FACIAL EDITOR</span>
                    <h3>Appearance</h3>
                </div>
                <span className="sq-count">51 MORPHS</span>
            </div>
            <div className="appearance-nav" aria-label="Appearance categories">
                {["Face", "Eyes", "Brows", "Hair", "Skin", "Details"].map((c) => (
                    <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
                        {c}
                    </button>
                ))}
            </div>
            <div className="appearance-fields">
                {category === "Face" && (
                    <>
                        <Select
                            label="Base anatomy"
                            value={s.sex}
                            options={[
                                ["female", "Female"],
                                ["male", "Male"],
                            ]}
                            onChange={(sex) => patch({ sex: sex as Appearance["sex"] })}
                        />
                        <Select
                            label="Starting identity"
                            value=""
                            options={[
                                ["", "Choose a preset…"],
                                ...presets.map((p, i) => [String(i), `${p.name} / ${p.sex}`]),
                            ]}
                            onChange={(i) => {
                                if (i !== "")
                                    onChange(
                                        normalize(
                                            { ...fromPreset(presets[+i]), name: s.name },
                                            schema,
                                        ),
                                    );
                            }}
                        />
                        <Select
                            label="Facial region"
                            value={region}
                            options={[...new Set(schema.controls.map((c) => c.group))]
                                .filter((g) => g !== "Eyes" && g !== "Brow & forehead")
                                .map((g) => [g, g])}
                            onChange={setRegion}
                        />
                        {region === "Contour" && (
                            <>
                                <Select
                                    label="Skull outline"
                                    value={s.shape}
                                    options={["none", ...schema.shapes].map((k) => [
                                        k,
                                        k === "none" ? "Natural base" : k,
                                    ])}
                                    onChange={(shape) => patch({ shape })}
                                />
                                <Range
                                    label="Outline strength"
                                    min={0}
                                    value={s.shapeAmount}
                                    onChange={(shapeAmount) => patch({ shapeAmount })}
                                />
                            </>
                        )}
                    </>
                )}
                {category === "Eyes" && (
                    <>
                        <Select
                            label="Iris color"
                            value={s.eyes}
                            options={EYES}
                            onChange={(eyes) => patch({ eyes })}
                        />
                        <div className="sq-preset-buttons">
                            {EYE_PRESETS.map((p) => (
                                <button
                                    key={p.name}
                                    onClick={() => patch({ values: { ...s.values, ...p.values } })}
                                >
                                    {p.name}
                                </button>
                            ))}
                        </div>
                    </>
                )}
                {category === "Brows" && (
                    <>
                        <Select
                            label="Brow style"
                            value={s.brows}
                            options={BROWS}
                            onChange={(brows) => patch({ brows })}
                        />
                        <Color
                            label="Brow color"
                            value={s.browColor}
                            onChange={(browColor) => patch({ browColor })}
                        />
                        {BROW_CONTROLS.map((c) => (
                            <Range
                                key={c.key}
                                label={c.label}
                                min={(c.min ?? -100) / 100}
                                max={(c.max ?? 100) / 100}
                                low={c.low}
                                high={c.high}
                                value={s[c.key]}
                                onChange={(v) => patch({ [c.key]: v })}
                            />
                        ))}
                    </>
                )}
                {["Face", "Eyes", "Brows"].includes(category) &&
                    schema.controls
                        .filter((c) => c.group === section)
                        .map((c) => (
                            <Range
                                key={c.key}
                                label={c.label}
                                low={c.low}
                                high={c.high}
                                value={s.values[c.key] ?? 0}
                                onChange={(v) => morph(c.key, v)}
                            />
                        ))}
                {category === "Hair" && (
                    <>
                        <Select
                            label="Hair style"
                            value={s.hair}
                            options={HAIR}
                            onChange={(hair) => patch({ hair })}
                        />
                        <Color
                            label="Hair color"
                            value={s.hairColor}
                            onChange={(hairColor) => patch({ hairColor })}
                        />
                        <button
                            className="sq-text-button"
                            onClick={() => patch({ browColor: s.hairColor })}
                        >
                            Match brows to hair ↗
                        </button>
                    </>
                )}
                {category === "Skin" && (
                    <>
                        <Select
                            label="Skin texture"
                            value={s.skin}
                            options={SKINS}
                            onChange={(skin) => patch({ skin })}
                        />
                        <Color
                            label="Skin tint"
                            value={s.skinTint}
                            onChange={(skinTint) => patch({ skinTint })}
                        />
                        <Range
                            label="Warmth"
                            value={s.warmth}
                            low="Cool"
                            high="Warm"
                            onChange={(warmth) => patch({ warmth })}
                        />
                        <Range
                            label="Skin roughness"
                            min={0.45}
                            value={s.roughness}
                            onChange={(roughness) => patch({ roughness })}
                        />
                        <Color
                            label="Blush color"
                            value={s.blushColor}
                            onChange={(blushColor) => patch({ blushColor })}
                        />
                        <Range
                            label="Blush strength"
                            min={0}
                            value={s.blushAmount}
                            onChange={(blushAmount) => patch({ blushAmount })}
                        />
                        <Select
                            label="Blush placement"
                            value={s.blushPlacement}
                            options={[
                                ["apples", "Cheeks"],
                                ["high", "High cheeks"],
                            ]}
                            onChange={(blushPlacement) => patch({ blushPlacement })}
                        />
                        <Range
                            label="Blush spread"
                            min={0}
                            value={s.blushSpread}
                            onChange={(blushSpread) => patch({ blushSpread })}
                        />
                    </>
                )}
                {category === "Details" && (
                    <>
                        <Select
                            label="Eyewear"
                            value={s.glasses}
                            options={GLASSES}
                            onChange={(glasses) => patch({ glasses })}
                        />
                        {s.glasses !== "none" && (
                            <>
                                <Color
                                    label="Frame color"
                                    value={s.glassesColor}
                                    onChange={(glassesColor) => patch({ glassesColor })}
                                />
                                <Color
                                    label="Lens color"
                                    value={s.lensColor}
                                    onChange={(lensColor) => patch({ lensColor })}
                                />
                                <Range
                                    label="Lens tint"
                                    min={0}
                                    value={s.lensTint}
                                    onChange={(lensTint) => patch({ lensTint })}
                                />
                            </>
                        )}
                        <Select
                            label="Scar"
                            value={s.scar}
                            options={SCARS}
                            onChange={(scar) => patch({ scar })}
                        />
                        {s.scar !== "none" && (
                            <>
                                <Select
                                    label="Scar placement"
                                    value={s.scarPlace}
                                    options={[
                                        ["cheekLeft", "Left cheek"],
                                        ["cheekRight", "Right cheek"],
                                        ["temple", "Temple"],
                                        ["bridge", "Nose bridge"],
                                    ]}
                                    onChange={(scarPlace) => patch({ scarPlace })}
                                />
                                <Range
                                    label="Scar definition"
                                    min={0}
                                    value={s.scarAmount}
                                    onChange={(scarAmount) => patch({ scarAmount })}
                                />
                            </>
                        )}
                        <Select
                            label="Tattoo"
                            value={s.tattoo}
                            options={TATTOOS}
                            onChange={(tattoo) => patch({ tattoo })}
                        />
                        {s.tattoo !== "none" && (
                            <>
                                <Select
                                    label="Tattoo placement"
                                    value={s.tattooPlace}
                                    options={[
                                        ["cheekLeft", "Left cheek"],
                                        ["cheekRight", "Right cheek"],
                                        ["temple", "Temple"],
                                        ["forehead", "Forehead"],
                                    ]}
                                    onChange={(tattooPlace) => patch({ tattooPlace })}
                                />
                                <Color
                                    label="Ink color"
                                    value={s.tattooColor}
                                    onChange={(tattooColor) => patch({ tattooColor })}
                                />
                                <Range
                                    label="Ink opacity"
                                    min={0}
                                    value={s.tattooOpacity}
                                    onChange={(tattooOpacity) => patch({ tattooOpacity })}
                                />
                            </>
                        )}
                    </>
                )}
            </div>
            <div className="appearance-footer">
                <div>
                    <button onClick={() => onChange(shuffleFace(schema, s))}>Shuffle face</button>
                    <button
                        onClick={() =>
                            onChange({
                                ...randomIdentity(schema, s.sex, Math.random, s),
                                name: s.name,
                            })
                        }
                    >
                        New look ↻
                    </button>
                </div>
                <button className="btn sq-primary" disabled={!dirty} onClick={onSave}>
                    Apply appearance <span>↗</span>
                </button>
                <button className="sq-text-button" disabled={!dirty} onClick={onReset}>
                    Discard changes
                </button>
            </div>
        </div>
    );
}
