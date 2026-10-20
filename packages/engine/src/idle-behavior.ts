// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

export type IdleContext = "open" | "cover" | "wall" | "pistol";
export type IdleChoice = {
  clip: string;
  hold: number | null;
  seconds: number;
  phase: number;
};
const pools: Record<
  IdleContext,
  readonly { clip: string; hold: number | null }[]
> = {
  open: [
    { clip: "idle", hold: null },
    { clip: "idle_weight_shift", hold: null },
    { clip: "standing_rifle_fire", hold: 0 },
  ],
  cover: [
    { clip: "crouch_idle", hold: null },
    { clip: "rifle_crouch_idle", hold: null },
  ],
  wall: [{clip:"wall_idle",hold:null},{clip:"wall_peek",hold:null}],
  pistol: [
    { clip: "pistol_idle", hold: null },
    { clip: "pistol_ready", hold: 0 },
  ],
};
/** Shuffle without replacement, per stance; actors then keep their own timers and phase. */
export class IdleDirector {
  private decks = new Map<IdleContext, number[]>();
  private random: () => number;
  constructor(random = Math.random) {
    this.random = random;
  }
  next(context: IdleContext, previous = ""): IdleChoice {
    const pool = pools[context];
    let deck = this.decks.get(context);
    if (!deck?.length) {
      deck = pool.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      this.decks.set(context, deck);
    }
    let index = deck.findIndex((i) => pool[i].clip !== previous);
    if (index < 0) {
      const alternative = pool.findIndex((p) => p.clip !== previous);
      return {
        ...pool[alternative],
        seconds: 3 + this.random() * 5,
        phase: this.random(),
      };
    }
    const selected = pool[deck.splice(index, 1)[0]];
    return {
      ...selected,
      seconds: (selected.hold === null ? 5 : 2.5) + this.random() * 5,
      phase: this.random(),
    };
  }
}
