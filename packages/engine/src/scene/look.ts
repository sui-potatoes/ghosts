// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Every dial of the match scene's look in one place: the post pipeline
 * (`post.ts`), the street air (`street-air.ts`), the weather
 * (`precipitation.ts`), the wet ground (`puddles.ts`) and the few lighting
 * numbers the battlefield and the district read. Distances are metres,
 * colours sRGB hex.
 */
export const LOOK = {
  bloom: {
    /** Exposed scene luminance where bloom starts; lit paint and ground overlays stay under it. */
    threshold: 1.15,
    /**
     * The same, while the sun is up (morning, day). Sunlit walls and paving sit well above the night
     * threshold; blooming them lays a soft haze over the whole frame.
     */
    daylight: 2.4,
    /** Softness of the threshold's shoulder. */
    knee: 0.6,
    /** Brightest luminance bloom is fed: a hot highlight keeps its colour instead of a white disc. */
    ceiling: 1.7,
    intensity: 0.5,
    /** How much each wider blur level carries into the next, 0..1. */
    spread: 0.62,
    /** Blur levels below quarter resolution: full stack, and battery saver. */
    levels: { smooth: 5, battery: 3 },
  },
  ao: {
    /** World radius of the contact shading. */
    radius: 0.55,
    strength: 1.5,
    samples: 10,
    /** Camera distances over which the shading fades out, so fogged distance stays clean. */
    fade: [34, 60],
  },
  /** Tilt-shift: sharp between `near[1]` and `far[0]` from the camera, soft outside. */
  focus: { near: [0.5, 1.6], far: [44, 90], amount: 0.85 },
  grade: {
    contrast: 1.14,
    saturation: 1.14,
    /** Added to the darks and multiplied into the lights. */
    shadows: 0x04101f,
    highlights: 0xfff1dc,
    /** How far the two tints go, 0..1. */
    split: 0.55,
  },
  vignette: { start: 0.42, end: 1.05, strength: 0.34 },
  /** Static film grain, in display units. */
  grain: 0.022,
  heightFog: {
    /** Ground-level density as a multiple of the preset's fog density. */
    density: 5,
    /** Thinning per metre of height: lower pools deeper. */
    falloff: 0.42,
    /** Ground distances from the camera over which it comes in, so the play area stays clear. */
    clear: [22, 64],
    /** How strongly lit lamps colour the fog around them. */
    glow: 0.4,
    /** Reach of a lamp's glow in the fog, and on rain and snow. */
    glowRadius: 5.5,
    /** Most the height fog may ever cover, whatever the preset's density. */
    cap: 0.5,
    /**
     * Bright fog reads far hazier than dark fog at the same density: the height
     * fog is divided by 1 + `bright` x the fog colour's luminance, so the day
     * and morning presets get a fraction of what night does.
     */
    bright: 3,
  },
  cones: {
    /** Radius of a lamp's light volume at the ground. */
    radius: 2.3,
    intensity: 0.11,
    /** Metres over which a volume fades into the geometry it meets. */
    soft: 1.1,
  },
  rain: {
    /** The volume around the camera's focus that rain and snow fill: width, height, depth. */
    volume: [58, 24, 58],
    drops: { smooth: 9000, battery: 3500 },
    /** Splash flecks alive at once; none in battery saver. */
    splashes: 1800,
    /** Fall speed in metres per second, and the wind's sideways push (x, z). */
    speed: 15,
    wind: [-3.8, 1.3],
    /** How far each drop's own path strays from the wind, in metres per second. */
    sway: 1.8,
    /** Length and width of a streak at rest. */
    streak: 0.6,
    width: 0.008,
    intensity: 0.42,
    /** Share of drops that are the wide, faint far veil, and how bright those are. */
    veil: 0.3,
    veilStrength: 0.2,
    /** How much of the fog's own colour unlit rain shows: low keeps it out of the dark sky. */
    ambient: 0.5,
    /** How much lamps and signs light the rain, against the fog's own colour. */
    practicals: 5,
    /** Height of a splash fleck, and its brightness. */
    splash: 0.045,
    splashIntensity: 0.22,
    /** Brightness of the bounce-spray layer over open ground, and its height. */
    spray: 0.018,
    sprayHeight: 0.14,
    /** Strength of the ripples drops leave on wet ground. */
    ripples: 0.5,
  },
  snow: {
    flakes: { smooth: 30000, battery: 9000 },
    /** Fall speed, steady sideways wind and flutter radius. */
    speed: 1.1,
    wind: 0.38,
    flutter: 0.3,
    /** Smallest and largest flake diameter; most are near the smallest. */
    size: [0.016, 0.055],
    /** Share of flakes that are large, faint and out of focus. */
    large: 0.003,
    intensity: 0.9,
    practicals: 3.5,
    ambient: 0.6,
    /** Most of an open, up-facing surface that the dusting covers, and its colour. */
    cover: 0.5,
    ground: 0xdfe6f2,
    /** How much of the wet street's mirror survives under snow. */
    wet: 0.12,
    /** Snow scatters light: the fog lifts toward `haze` by `lift`, thickens, and the sky light rises. */
    air: { haze: 0xc9d3e6, lift: 0.14, density: 1.12, ambient: 1.22 },
  },
  wet: {
    /** The street probe's strength on wet ground. */
    environment: 0.75,
    /** Roughness of standing water: smoothest, and where streaks break it up. */
    roughness: [0.035, 0.2],
    /** Roughness left on ground that is merely damp, as a multiple of the dry value. */
    damp: 0.72,
  },
  windows: {
    /** Emissive of a fully lit pane: a warm room, a cool screen. */
    warm: 0xffb062,
    cool: 0x8fb6ff,
    intensity: 0.85,
  },
  signs: {
    /** Emissive strength of the named shops' sign faces at night. */
    near: 2.1,
    /** Brightness of the far street's sign boxes at night, as a multiple of their daytime paint. */
    far: 2.4,
  },
  /** The bulkhead lamp over the south-west footway. */
  alley: { color: 0xffd9a8, intensity: 16, reach: 8 },
  /**
   * The perimeter mist's alpha was authored for display-space blending; the pipeline blends in linear
   * light, where the same alpha over a dark street reads several times heavier. Its alpha is raised to
   * this power so the mist sits where it did.
   */
  mistBlend: 1.7,
  /** Strength of the street probe as the whole scene's environment light. */
  environment: 0.35,
  shadow: { size: 2048, radius: 2.2 },
} as const;
