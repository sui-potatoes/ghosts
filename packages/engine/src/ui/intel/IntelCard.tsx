// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { forwardRef, type ReactNode } from "react";
import { weaponLabel, type ModKind, type OpponentIntel, type UnitIntel } from "../../intel";
import { IntelIcon, RankMark, type IntelIconName } from "./icons";

/** How much the readout says: a hover, a held readout, or lines inside the aim readout. */
export type Density = "hover" | "held" | "aim";

/** Mod slots in fitting order; a weapon takes one of each kind, three at most. */
const MOD_SLOTS = 3;
const MOD_LETTER: Record<ModKind, string> = { scope: "S", laser: "L", stock: "K", clip: "C" };

const RANK_SHORT: Record<string, string> = {
  Rookie: "RKE",
  Squaddie: "SQD",
  Corporal: "CPL",
  Sergeant: "SGT",
  Lieutenant: "LT",
  Captain: "CPT",
  Major: "MAJ",
  Colonel: "COL",
};

/** `n` pips, the first `filled` lit; `tone` colours the lit ones. */
function Pips({ n, filled, tone, label, kind = "pip" }: { n: number; filled: number; tone?: string; label: string; kind?: "pip" | "bar" }) {
  return (
    <span className={`intel-pips ${kind === "bar" ? "is-bar" : ""} ${tone ?? ""}`} role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

function Stat({ icon, label, children }: { icon: IntelIconName; label: string; children: ReactNode }) {
  return (
    <span className="intel-stat" title={label}>
      <IntelIcon name={icon} />
      <b>{children}</b>
      <small>{label}</small>
    </span>
  );
}

/** Health as pips with the armor after them as shields; a long bar past twenty points. */
function Condition({ intel }: { intel: UnitIntel }) {
  const c = intel.condition;
  return (
    <div className="intel-line intel-cond">
      <span className="intel-cell">
        <IntelIcon name="health" />
        <Pips n={c.maxHp} filled={c.hp} kind={c.maxHp > 20 ? "bar" : "pip"} label={`${c.hp} of ${c.maxHp} health`} tone="is-hp" />
        <b className="intel-num">
          {c.hp}
          <small>/{c.maxHp}</small>
        </b>
        {c.armor > 0 && (
          <span className="intel-armor" title="Armor: each point takes one off every hit">
            <IntelIcon name="shield" />
            <b className="intel-num">{c.armor}</b>
          </span>
        )}
      </span>
      {c.active && (
        <span className="intel-cell" title="Action points this turn">
          <small className="intel-key">AP</small>
          <Pips n={c.apMax} filled={c.ap} label={`${c.ap} of ${c.apMax} action points`} tone="is-ap" />
        </span>
      )}
    </div>
  );
}

/** Weapon with its mods as pips, armor, utility with its uses. */
function Loadout({ intel }: { intel: UnitIntel }) {
  const { weapon, armor, utility } = intel;
  return (
    <div className="intel-line intel-gear">
      <span className={`intel-row ${weapon ? "" : "is-void"}`}>
        <IntelIcon name="primary" />
        <span className="intel-name">{weapon ? weaponLabel(weapon) : "Unarmed"}</span>
        {weapon && (
          <span className="intel-mods" role="img" aria-label={weapon.mods.length ? weapon.mods.map((m) => m.name).join(", ") : "No mods"}>
            {Array.from({ length: MOD_SLOTS }, (_, i) => {
              const mod = weapon.mods[i];
              return (
                <i key={i} className={mod ? `on tier-${mod.tier}` : ""} title={mod?.name}>
                  {mod ? MOD_LETTER[mod.kind] : ""}
                </i>
              );
            })}
          </span>
        )}
        {weapon && (
          <span className="intel-ammo" title="Rounds in the magazine">
            <Pips
              n={intel.condition.clip}
              filled={intel.condition.ammo}
              kind={intel.condition.clip > 8 ? "bar" : "pip"}
              label={`${intel.condition.ammo} of ${intel.condition.clip} rounds`}
              tone={intel.condition.ammo ? "is-ammo" : "is-ammo is-empty"}
            />
          </span>
        )}
      </span>
      {armor && (
        <span className="intel-row">
          <IntelIcon name="armor" />
          <span className="intel-name">{armor.name}</span>
        </span>
      )}
      {utility && (
        <span className={`intel-row ${utility.uses === 0 ? "is-spent" : ""}`}>
          <IntelIcon name="utility" />
          <span className="intel-name">{utility.name}</span>
          {utility.uses === 0 ? (
            <small className="intel-tag">Spent</small>
          ) : utility.uses !== null ? (
            <Pips
              n={Math.max(utility.max ?? 0, utility.uses)}
              filled={utility.uses}
              label={`${utility.uses} ${utility.uses === 1 ? "use" : "uses"} left`}
            />
          ) : null}
        </span>
      )}
    </div>
  );
}

/** The fight stats as compact cells: what to expect from it, by number. */
function Stats({ intel, full }: { intel: UnitIntel; full: boolean }) {
  const s = intel.stats;
  const [lo, hi] = s.damage;
  return (
    <div className="intel-line intel-stats">
      {intel.weapon && <Stat icon="aim" label="Aim">{s.aim}</Stat>}
      {intel.weapon && (
        <Stat icon="damage" label="Damage">
          {lo === hi ? lo : `${lo}–${hi}`}
        </Stat>
      )}
      {intel.weapon && <Stat icon="range" label="Range">{s.range}</Stat>}
      {full && <Stat icon="mobility" label="Move">{s.mobility}</Stat>}
      {full && s.dodge !== undefined && <Stat icon="dodge" label="Dodge">{s.dodge}</Stat>}
      {full && s.defense !== undefined && <Stat icon="shield" label="Defense">{s.defense}</Stat>}
    </div>
  );
}

export interface ReadoutProps {
  intel: UnitIntel;
  density: Density;
  opponent?: OpponentIntel | null;
  /** This unit's hit chance against the player's selected unit, and who that is. */
  threat?: { against: string; chance: number } | null;
  /** In the blast of the grenade being aimed. */
  inBlast?: boolean;
}

/** The unit readout's card: identity, condition, loadout, fight stats, effects. */
export const IntelCard = forwardRef<HTMLDivElement, ReadoutProps>(function IntelCard(
  { intel, density, opponent, threat, inBlast },
  ref,
) {
  const side = intel.hostile ? "is-hostile" : "is-friendly";
  if (!intel.known)
    return (
      <div ref={ref} className={`intel-card ${side} is-unknown`}>
        <div className="intel-line intel-head">
          <span className="intel-side">
            <IntelIcon name={intel.hostile ? "hostile" : "friendly"} />
            {intel.hostile ? "Hostile" : "Squad"}
          </span>
        </div>
        <div className="intel-line intel-void">No data</div>
      </div>
    );
  const held = density !== "hover";
  return (
    <div ref={ref} className={`intel-card ${side} is-${density}`}>
      <div className="intel-line intel-head">
        <span className="intel-side">
          <IntelIcon name={intel.hostile ? "hostile" : "friendly"} />
          {intel.hostile ? "Hostile" : "Squad"}
        </span>
        {intel.rank && (
          <span className="intel-rank-tag" title={intel.rank.name}>
            <RankMark index={intel.rank.index} />
            {RANK_SHORT[intel.rank.name] ?? intel.rank.name}
          </span>
        )}
        {inBlast && <span className="intel-tag is-alert">In blast</span>}
      </div>
      <div className="intel-line intel-id">
        <strong>{intel.callsign}</strong>
        {held && intel.name && <small>{intel.name}</small>}
      </div>
      {intel.hostile && opponent && (
        <div className="intel-line intel-cmdr" title="The opposing commander">
          <small className="intel-key">CMDR</small>
          <span className="intel-name">{opponent.name ?? "Unnamed"}</span>
          <b className="intel-num">{Math.round(opponent.rating)}</b>
          {held && opponent.record && (
            <small className="intel-record">
              {opponent.record.wins}–{opponent.record.losses}
              {opponent.record.draws ? `–${opponent.record.draws}` : ""}
            </small>
          )}
        </div>
      )}
      <Condition intel={intel} />
      <Loadout intel={intel} />
      <Stats intel={intel} full={held} />
      {threat && (
        <div
          className={`intel-line intel-threat ${threat.chance ? "" : "is-safe"}`}
          title={`Its chance to hit ${threat.against}`}
        >
          <IntelIcon name="aim" />
          <span className="intel-name">{threat.against}</span>
          <b className="intel-num">
            {threat.chance}
            <small>%</small>
          </b>
        </div>
      )}
      {/* Status effects: the game has none yet; their line goes here when it does. */}
      {intel.effects.length > 0 && (
        <div className="intel-line intel-effects">
          {intel.effects.map((e) => (
            <span key={e.id} className="intel-tag">
              {e.label}
              {e.turns !== undefined && <b>{e.turns}</b>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * The target's loadout, with its magazine, for the aim readout: while a shot
 * is being aimed the readout merges into it instead of standing beside it (the
 * aim readout already carries its health and armor). Renders nothing for a
 * unit nothing is known about.
 */
export function IntelAimLines({ intel }: { intel: UnitIntel | null }) {
  if (!intel?.known) return null;
  return (
    <div className={`intel-card is-aim ${intel.hostile ? "is-hostile" : "is-friendly"}`}>
      <Loadout intel={intel} />
    </div>
  );
}
