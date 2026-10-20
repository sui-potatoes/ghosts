import { action, endTurn, select } from "../actions";
import { distance, weapons } from "../game";
import { pad2 } from "../html";
import type { CombatAction } from "../keys";
import { shotBlockReason } from "../targeting";
import { Icon, type IconName } from "./icons";
import { useSession } from "./useSession";
import { cap } from "./view";

/** The right-hand column: contract, objectives, phase, hostiles, loadout and the combat feed. */
export function IntelPanel() {
  const s = useSession();
  const { game } = s;
  const { contract, objectives, location } = game.scenario;
  const u = s.selectedUnit();
  const down = game.hostileCount - game.enemies.length;
  return (
    <aside className="intel-panel">
      <div className="panel-heading">
        <span>OPERATION INTEL</span>
        <span className="signal">▂▄▆█</span>
      </div>
      <div className="contract">
        <div className="eyebrow">EMPLOYER / 001</div>
        <div className="corp-logo">
          ◈{" "}
          <span>
            {contract.employer}
            <small>{contract.division}</small>
          </span>
          <span className="verified">✓</span>
        </div>
        <div className="contract-row">
          <span>Contract value</span>
          <strong>{contract.value}</strong>
        </div>
        <div className="contract-row">
          <span>Threat assessment</span>
          <b className="danger-text">
            {contract.threat} <i>{"▰".repeat(contract.threatLevel) + "▱".repeat(5 - contract.threatLevel)}</i>
          </b>
        </div>
      </div>
      <div className="objectives">
        <div className="section-title">
          MISSION OBJECTIVES <span>02</span>
        </div>
        <div className={`objective ${game.secured ? "complete" : ""}`}>
          <i>◇</i>
          <div>
            {objectives.secure.title}
            <small>{objectives.secure.detail}</small>
          </div>
          <span>01</span>
        </div>
        <div className={`objective ${!game.enemies.length ? "complete" : ""}`}>
          <i>◇</i>
          <div>
            {objectives.eliminate.title}
            <small>
              {down} / {game.hostileCount} targets eliminated
            </small>
          </div>
          <span>02</span>
        </div>
      </div>
      <div className="turn-info">
        <div>
          <span className="eyebrow">CURRENT PHASE</span>
          <h2>
            {game.result === "victory"
              ? "CONTRACT COMPLETE"
              : game.result === "defeat"
                ? "SQUAD LOST"
                : game.phase === "enemy"
                  ? "HOSTILE TURN"
                  : "YOUR TURN"}
          </h2>
        </div>
        <div className="turn-number">
          <span>TURN</span>
          <strong>{pad2(game.turn)}</strong>
        </div>
      </div>
      <div className="target-section">
        <div className="section-title">
          HOSTILE SIGNATURES <span>{pad2(game.enemies.length)}</span>
        </div>
        <div id="targets">
          {game.enemies.length ? (
            game.enemies.map((e) => (
              <button
                key={e.id}
                className={`target-row ${e.id === s.target ? "selected" : ""}`}
                onClick={() => select(e.id)}
              >
                <span className="target-symbol">
                  <Icon name="cross" />
                </span>
                <span>
                  <strong>{e.name}</strong>
                  <small>
                    {e.role} <i>/</i> {distance(u.pos, e.pos)} TILES
                  </small>
                </span>
                <span className="target-hp">
                  {e.hp}
                  <small>HP</small>
                </span>
                <span className="hit-chance">
                  {game.chance(u, e)}
                  <small>%</small>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-targets">ALL HOSTILE ASSETS NEUTRALIZED</div>
          )}
        </div>
      </div>
      <ContextCard />
      <div className="activity">
        <div className="section-title">
          COMBAT FEED <span className="live-pip" />
        </div>
        <div id="log" role="log" aria-live="polite">
          {game.log.slice(0, 4).map((line, i) => (
            <p key={game.log.length - i}>
              <span>
                {pad2(game.turn)}.{pad2(game.log.length - i)}
              </span>
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="panel-foot">
        <span>ENCRYPTION ACTIVE</span>
        <span>{location.code}</span>
      </div>
    </aside>
  );
}

/** The selected operator's loadout, with the shot odds or the order state under it. */
function ContextCard() {
  const s = useSession();
  const { game } = s;
  const u = s.selectedUnit(),
    t = s.targetUnit();
  return (
    <div id="context-card">
      <div className="section-title">
        LOADOUT{" "}
        <span>
          {u.ammo} / {u.clip}
        </span>
      </div>
      <div className="weapon-title">
        <Icon name="gun" />
        <div>
          <strong>{weapons[u.weapon].label}</strong>
          <small>
            {u.damage} DMG <i>/</i> {u.range} RANGE <i>/</i> {u.armor} ARMOR
          </small>
        </div>
      </div>
      {s.mode === "fire" && t ? (
        <div className="shot-preview">
          <strong>
            {game.chance(u, t)}
            <span>%</span>
          </strong>
          <div>
            CHANCE TO HIT
            <small>{shotBlockReason(game, u, t) ?? (game.cover(t, u) ? "TARGET IN COVER" : "TARGET IN RANGE")}</small>
          </div>
        </div>
      ) : (
        <div className="action-instruction">
          <span className="amber-text">
            {s.mode === "grenade"
              ? `FRAGMENTATION / ${u.grenade ? "EXPENDED" : "READY"}`
              : u.ap
                ? "AWAITING ORDERS"
                : "ACTION POINTS DEPLETED"}
          </span>
        </div>
      )}
    </div>
  );
}

const ORDERS: { id: CombatAction; icon: IconName; title: string }[] = [
  { id: "move", icon: "move", title: "Move" },
  { id: "fire", icon: "cross", title: "Fire weapon" },
  { id: "grenade", icon: "grenade", title: "Grenade" },
  { id: "reload", icon: "reload", title: "Reload" },
  { id: "overwatch", icon: "eye", title: "Overwatch" },
  { id: "hunker", icon: "shield", title: "Hunker" },
  { id: "secure", icon: "download", title: "Extract" },
];

/** The selected operator and the order buttons, with End turn beside them. */
export function CommandDeck() {
  const s = useSession();
  const { game, busy } = s;
  const u = s.selectedUnit();
  const cannot = busy || !game.canAct(u);
  const disabled: Record<string, boolean> = {
    reload: u.ammo === u.clip,
    grenade: u.grenade,
    fire: !u.ammo || !game.enemies.length,
    overwatch: !u.ammo,
    secure: game.secured || distance(u.pos, game.relay) > 0,
  };
  const label = (id: string, title: string) =>
    id === "fire" && s.mode === "fire"
      ? "Confirm shot"
      : id === "grenade" && s.mode === "grenade" && s.grenadeTarget
        ? "Confirm throw"
        : title;
  const cost = (id: string) =>
    id === "fire" ? (u.weapon === "pistol" ? "1 AP" : "ENDS TURN") : id === "overwatch" || id === "hunker" ? "ALL AP" : "1 AP";
  return (
    <>
      <section className="command-deck" aria-label="Operator action controls">
        <div id="selected-info">
          <span className="selected-mark">
            <Icon name="shield" />
          </span>
          <div>
            <small>SELECTED OPERATOR</small>
            <strong>
              {u.name} <span>/ {u.role}</span>
            </strong>
            <span className="operator-meta">
              {u.ap} AP <i>·</i> {u.ammo} / {u.clip} ROUNDS <i>·</i> {game.cover(u) > 0 ? "IN COVER" : "EXPOSED"}
            </span>
          </div>
        </div>
        <div className="action-list">
          {ORDERS.map(({ id, icon, title }) => (
            <button
              key={id}
              data-action={id}
              className={id === s.mode ? "active" : ""}
              disabled={cannot || !!disabled[id]}
              onClick={() => void action(id)}
            >
              <kbd>{cap(id)}</kbd>
              <Icon name={icon} />
              <span>{label(id, title)}</span>
              <small>{cost(id)}</small>
            </button>
          ))}
        </div>
      </section>
      <button
        className="end-turn"
        id="end-turn"
        disabled={busy || !!game.result || game.phase !== "player"}
        onClick={() => void endTurn()}
      >
        <span>END TURN</span>
        <Icon name="chevron" />
      </button>
    </>
  );
}
