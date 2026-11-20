// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { itemById } from "@ghosts/squad/catalog";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { GRENADE_RADIUS, isThrowOrder } from "../../action-registry";
import { audio } from "../../audio";
import { distance } from "../../game";
import { baseIntel, threatArea, threatSignature, type UnitIntel } from "../../intel";
// @ts-ignore Native editor adapter is shared JavaScript.
import { deployment } from "../../mpfb-characters.js";
import { session } from "../../session";
import { useSession } from "../useSession";
import { IntelCard, IntelAimLines, type Density } from "./IntelCard";
import { placeCard, type Rect, type Side } from "./placement";
import { inspect, shownUnit, useInspect } from "./store";
import "./intel.css";

/**
 * Everything the readout says about unit `id`: the engine's own reading,
 * then the host's intel source over it. Data in memory only.
 */
export function unitIntel(id: string): UnitIntel | null {
  const u = session.game.unit(id);
  if (!u) return null;
  const look = (deployment as Map<string, { armorId?: string | null }>).get(id);
  const base = baseIntel(session.game, u, look?.armorId ? itemById(look.armorId)?.name : null);
  return inspect.source ? inspect.source(u, base) : base;
}

/**
 * The target's condition and loadout for the aim readout while a shot is
 * aimed. Mount it inside the aim area; it reads the session's target itself.
 */
export function TargetIntel() {
  const s = useSession();
  useInspect();
  const intel = s.mode === "fire" && s.target ? unitIntel(s.target) : null;
  return <IntelAimLines intel={intel} />;
}

/** `r` grown by `pad` on every side, and to at least `minW` by `minH` around its centre. */
function inflate(r: { x: number; y: number; w: number; h: number }, pad: number, minW: number, minH: number) {
  const w = Math.max(r.w + 2 * pad, minW),
    h = Math.max(r.h + 2 * pad, minH);
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

/**
 * The unit readout over the field: a lock-on around the described unit, a
 * leader line and the card. React renders only when the described unit or
 * the encounter changes; following the unit is a frame hook on the scene that
 * writes transforms, nothing else.
 */
export function IntelLayer() {
  const s = useSession();
  useInspect();
  const id = shownUnit();
  const density: Density = id && id === inspect.held && id !== inspect.hovered ? "held" : "hover";
  // Recomputed with the encounter (hp, ammo, uses) and the described unit, not with the pointer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intel = useMemo(() => (id ? unitIntel(id) : null), [id, s.version, inspect.version]);

  const selected = s.selectedUnit();
  const unit = id ? s.game.unit(id) : undefined;
  const threat =
    unit && selected && unit.enemy !== selected.enemy && unit.id !== selected.id && intel?.weapon
      ? { against: selected.name, chance: s.game.chance(unit, selected) }
      : null;
  // Any throw being aimed: the frag, the flashbang and the smoke grenade share the radius.
  const inBlast = !!unit && isThrowOrder(s.mode) && !!s.grenadeTarget && distance(unit.pos, s.grenadeTarget) <= GRENADE_RADIUS;

  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const lock = useRef<HTMLDivElement>(null);
  const leader = useRef<SVGLineElement>(null);
  const shown = useRef("");
  const size = useRef({ w: 0, h: 0 });
  const side = useRef<Side | undefined>(undefined);
  const written = useRef("");
  /** HUD chrome the card keeps off (`data-intel-avoid`), in the layer's pixels; measured on change, not per frame. */
  const chrome = useRef<Rect[]>([]);
  const measureChrome = useRef(() => {});
  measureChrome.current = () => {
    const el = layer.current;
    const root = el?.closest(".encounter");
    if (!el || !root) return;
    const origin = el.getBoundingClientRect();
    chrome.current = [...root.querySelectorAll<HTMLElement>("[data-intel-avoid]")].flatMap((node) => {
      const r = node.getBoundingClientRect();
      return r.width && r.height ? [{ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }] : [];
    });
  };

  /** Follow the unit: lock brackets on its body, the card beside it, the leader between. */
  const place = useRef(() => {});
  place.current = () => {
    const el = layer.current;
    const target = shown.current;
    if (!el) return;
    const bf = session.battlefield;
    const body = target && card.current ? bf.unitBox(target) : null;
    // The brackets sit a little off the body, and never shrink past a readable size far away.
    const box = body && inflate(body, 6, 30, 46);
    if (!box) {
      if (written.current !== "hidden") {
        written.current = "hidden";
        el.dataset.visible = "false";
      }
      return;
    }
    const sel = session.selected && session.selected !== target ? bf.unitBox(session.selected) : null;
    const others: Rect[] = [];
    for (const u of session.game.units) {
      if (u.id === target || u.id === session.selected) continue;
      const other = bf.unitBox(u.id);
      if (other) others.push(other);
    }
    const avoid = sel ? [sel, ...chrome.current] : chrome.current;
    const p = placeCard(box, size.current, bf.viewSize, avoid, side.current, others);
    side.current = p.side;
    const sig = `${box.x | 0},${box.y | 0},${box.w | 0},${box.h | 0},${p.x | 0},${p.y | 0}`;
    if (sig === written.current) return;
    written.current = sig;
    el.dataset.visible = "true";
    el.dataset.side = p.side;
    lock.current!.style.transform = `translate3d(${box.x | 0}px,${box.y | 0}px,0)`;
    lock.current!.style.width = `${Math.round(box.w)}px`;
    lock.current!.style.height = `${Math.round(box.h)}px`;
    card.current!.style.transform = `translate3d(${p.x | 0}px,${p.y | 0}px,0)`;
    const [x1, y1, x2, y2] = p.leader;
    const line = leader.current!;
    line.setAttribute("x1", String(x1 | 0));
    line.setAttribute("y1", String(y1 | 0));
    line.setAttribute("x2", String(x2 | 0));
    line.setAttribute("y2", String(y2 | 0));
  };

  useEffect(() => {
    if (s.state !== "ready") return;
    const hook = () => place.current();
    const resized = () => {
      measureChrome.current();
      written.current = "";
      place.current();
    };
    s.battlefield.frameHooks.add(hook);
    window.addEventListener("resize", resized);
    return () => {
      s.battlefield.frameHooks.delete(hook);
      window.removeEventListener("resize", resized);
    };
  }, [s, s.state]);

  // A new unit: lock on (sound, brackets and the card's lines run their animation again).
  useLayoutEffect(() => {
    const changed = shown.current !== id;
    shown.current = id;
    const el = layer.current;
    if (!el) return;
    if (card.current) size.current = { w: card.current.offsetWidth, h: card.current.offsetHeight };
    measureChrome.current();
    if (changed && id) {
      side.current = undefined;
      el.classList.remove("is-locking");
      // Restart the lock-on animations on the same nodes: no close and reopen.
      void el.offsetWidth;
      el.classList.add("is-locking");
      audio.lock();
    }
    written.current = "";
    place.current();
  });

  // The described unit's reach on the ground; recomputed only when it or the board changes.
  const threatKey = unit && s.mode === "move" && !s.busy ? threatSignature(s.game, unit) : "";
  useEffect(() => {
    if (s.state !== "ready") return;
    const u = threatKey ? session.game.unit(shown.current) : undefined;
    // The player's own selected unit already shows its move reach.
    if (!u || (!u.enemy && u.id === session.selected)) session.battlefield.showThreat(null);
    else session.battlefield.showThreat(threatArea(session.game, u), u.enemy);
  }, [s, s.state, threatKey, s.selected]);
  useEffect(() => () => session.battlefield?.showThreat(null), []);

  useEffect(() => () => inspect.reset(), []);

  if (s.state !== "ready") return null;
  return (
    <div ref={layer} className={`intel-layer ${intel?.hostile ? "is-hostile" : "is-friendly"}`} data-visible="false" aria-live="polite">
      <svg className="intel-leader" aria-hidden>
        <line ref={leader} />
      </svg>
      <div ref={lock} className="intel-lock" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <b className="intel-sweep" />
      </div>
      {intel && (
        <IntelCard
          ref={card}
          intel={intel}
          density={density}
          opponent={inspect.opponent}
          threat={threat}
          inBlast={inBlast}
        />
      )}
    </div>
  );
}
