/// <reference types="vite/client" />
import { encounterReport } from "./aftermath/report";
import { revealEncounter } from "./aftermath/reveal";
import { escapeHTML } from "./html";
// @ts-ignore Native editor adapter is shared JavaScript.
import {loadNativeIdentities,deployment} from "./mpfb-characters.js";
import { applyDeploymentNames } from "./squad-bridge";
import { onShellMessage, requestPause } from "./shell-bridge";
import { DEFAULT_VOICE_INDEX, effectVolume, readAudioSettings, VoicePlayer, type Voice } from "./voice";
import { EffectPlayer } from "./sfx";
import { timePresets, type TimeOfDay } from "./scene-weather";
import { loadDistrictTextures } from "./district";
import { surfaceHeight } from "./district-plan";
import { motions, type Motion } from "./motions";
import "./style.css";
import "./ghosts-theme.css";
import {
  Encounter,
  weapons,
  distance,
  key,
  relay,
  covers,
  type Cell,
  type Unit,
  type Weapon,
} from "./game";
import { Battlefield } from "./scene";
import { getSettings, subscribeSettings } from "../../src/settings/store";
import { loadOperatives, resetHuman, humanTextureStats } from "./humans";
import {
  bestShotTarget,
  shotBlockReason,
  grenadeBlockReason,
  defaultGrenadeTarget,
} from "./targeting";
const icons: Record<string, string> = {
  cross:
    '<path d="M12 3v4m0 10v4M3 12h4m10 0h4"/><circle cx="12" cy="12" r="5"/>',
  move: '<path d="m12 3 4 4m-4-4L8 7m4-4v18M3 12l4-4m-4 4 4 4M3 12h18m0 0-4-4m4 4-4 4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M12 7v9"/>',
  reload:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 14-3l1 7M4 12l1 7a8 8 0 0 0 14-3"/>',
  grenade:
    '<path d="m13 4 3-2 3 3-2 3M8 6l8 8M6 8c-4 4-4 8-1 11s7 3 11-1 4-8 1-11-7-3-11 1Z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  squad:
    '<circle cx="9" cy="7" r="3"/><path d="M2 21v-4a7 7 0 0 1 14 0v4M17 4a3 3 0 0 1 0 6m1 4c3 0 4 3 4 7"/>',
  gun: '<path d="M3 8h16v5H9l-2 7H3l2-8H2V9m17-1V6h3v6h-3M9 13v3h5v-3"/>',
  intel: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8m-8 4h5"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 2 3 3 1 1 4 4-1 1-3 4-1 1-4-3-2V7l-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16"/>',
  focus:
    '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/><circle cx="12" cy="12" r="3"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="13" r="4"/>',
  sound:
    '<path d="M3 9h4l5-5v16l-5-5H3zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 3v1"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m7 4 14 8-14 8z"/>',
  bolt: '<path d="m14 2-9 12h7l-2 8 9-13h-7z"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.cross}</svg>`;
const logo =
  '<svg viewBox="0 0 44 44" fill="none" aria-hidden="true"><path d="m22 3 17 9v20L22 41 5 32V12z" stroke="currentColor" stroke-width="1.6"/><path d="m12 16 10 6 10-6v7l-10 6-10-6zm0 12 10 6 10-6" stroke="currentColor" stroke-width="2"/></svg>';
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="/" target="_top" aria-label="Return to Ghosts menu">${logo}<span>GHOSTS<small>TOKYO STREET PLAYTEST</small></span></a><div class="topnav"><span class="active">OPERATIONS</span><span>GHOSTS DIVISION <i>/</i> CONTRACT 007</span></div><div class="top-status"><i class="status-dot"></i> LOCAL SIMULATION <span class="divider"></span><span class="avatar">DV</span><span>COMMAND AUTHORITY<small>LEVEL 04 / OPERATOR</small></span></div></header>
<nav class="rail" aria-label="Command sections"><div class="rail-top"><button class="active" data-panel="tactical" aria-label="Tactical operations"><span>Field</span></button><a href="/squad" target="_top" title="Manage squad and equipment; leaving ends this local encounter"><span>Squad ↗</span></a><button data-panel="intel" aria-label="Mission briefing"><span>Briefing</span></button><a href="/settings" target="_top" title="Open Ghosts settings; leaving ends this local encounter"><span>Settings ↗</span></a></div><div class="rail-bottom"><button id="sound" title="Enable synthesized combat audio" aria-label="Enable combat audio" aria-pressed="false">${icon("sound")}</button><button data-panel="help" title="Field manual" aria-label="Field manual">${icon("help")}</button></div></nav>
<main class="workspace"><section class="battlefield" aria-label="Interactive 3D tactical battlefield"><div id="viewport"></div><div class="vignette"></div><div id="world-labels"></div>
<div class="view-tools"><details id="scene-controls"><summary>SCENE</summary><section aria-label="Scene controls"><label for="scene-time">TIME OF DAY</label><select id="scene-time"><option value="morning">Morning</option><option value="day">Day</option><option value="evening">Evening</option><option value="night" selected>Night</option></select><label class="scene-rain"><input id="scene-rain" type="checkbox" checked> Rain</label><small id="scene-light-status" role="status">Streetlights on · lights follow the time</small></section></details><button id="drills" aria-expanded="false" title="Inspect the full human motion library">MOTION DRILLS</button><button id="view" title="Switch tactical / close camera [C]">${icon("camera")}<span>TACTICAL VIEW</span><kbd>C</kbd></button><button id="grid" class="active" aria-pressed="true" title="Toggle tactical grid [G]" aria-label="Toggle grid">${icon("map")}</button><button id="focus" title="Focus selected operator [F]" aria-label="Focus selected operator">${icon("focus")}</button></div>
<div class="north"><span>N</span><i></i><small>35° 41′ N<br>139° 41′ E</small></div><div id="feedback" role="status" aria-live="polite"></div>
<section id="motion-deck" aria-label="Operator motion drills" hidden><div class="drill-heading"><span>GHOSTS / TRAINING</span><button id="close-drills" aria-label="Close motion drills">×</button></div><h2>Practice makes lethal.</h2><label for="motion-select">${motions.length} skeletal actions</label><select id="motion-select"></select><div class="drill-controls"><button id="previous-motion" aria-label="Previous motion">←</button><button id="play-motion">PLAY DRILL</button><button id="next-motion" aria-label="Next motion">→</button></div><p id="motion-status" role="status">Choose a drill. No AP or ammunition spent.</p></section><div id="targeting-hud" aria-label="Target confirmation" hidden></div><div id="aim-reticle" aria-hidden="true" hidden><i></i><b></b></div>
<div class="field-bottom"><div class="field-caption"><span class="live-pip"></span> GHOSTS SQUAD <span id="squad-count">04 OPERATORS ACTIVE</span><button id="reset" title="Restart this local encounter">↻ RESET OPERATION</button></div><div id="squad-cards"></div><div class="camera-hint"><span>DRAG <b>ORBIT</b></span><span>SCROLL <b>ZOOM</b></span><span>RIGHT DRAG <b>PAN</b></span><span>Q / E <b>ROTATE</b></span><span>TAB <b>NEXT OPERATOR</b></span></div></div>
<div class="loading" id="loading"><span>${logo}</span><p>BRINGING THE SQUAD IN</p></div></section>
<aside class="intel-panel"><div class="panel-heading"><span>OPERATION INTEL</span><span class="signal">▂▄▆█</span></div><div class="contract"><div class="eyebrow">EMPLOYER / 001</div><div class="corp-logo">◈ <span>HELIOS<small>STRATEGIC INDUSTRIES</small></span><span class="verified">✓</span></div><div class="contract-row"><span>Contract value</span><strong>₡ 48,000</strong></div><div class="contract-row"><span>Threat assessment</span><b class="danger-text">ELEVATED <i>▰▰▰▱▱</i></b></div></div>
<div class="objectives"><div class="section-title">MISSION OBJECTIVES <span>02</span></div><div class="objective" id="obj-core"><i>◇</i><div>Secure the relay core<small>Reach the uplink. Extract corporate intel.</small></div><span>01</span></div><div class="objective" id="obj-enemies"><i>◇</i><div>Neutralize hostile assets<small id="hostile-count">0 / 3 targets eliminated</small></div><span>02</span></div></div>
<div class="turn-info"><div><span class="eyebrow">CURRENT PHASE</span><h2 id="phase">YOUR TURN</h2></div><div class="turn-number"><span>TURN</span><strong id="turn">01</strong></div></div>
<div class="target-section"><div class="section-title">HOSTILE SIGNATURES <span id="enemy-total">03</span></div><div id="targets"></div></div>
<div id="context-card"></div><div class="activity"><div class="section-title">COMBAT FEED <span class="live-pip"></span></div><div id="log" role="log" aria-live="polite"></div></div>
<button class="end-turn" id="end-turn"><span>END TURN <small>HAND OVER INITIATIVE</small></span>${icon("chevron")}<kbd>↵</kbd></button><div class="panel-foot"><span>ENCRYPTION ACTIVE</span><span>BL–09.007</span></div></aside>
<section class="command-deck" aria-label="Operator action controls"><div id="selected-info"></div><div class="action-list">${[
  ["move", "move", "Move", "M"],
  ["fire", "cross", "Fire weapon", "X"],
  ["grenade", "grenade", "Grenade", "T"],
  ["reload", "reload", "Reload", "R"],
  ["overwatch", "eye", "Overwatch", "O"],
  ["hunker", "shield", "Hunker", "H"],
  ["secure", "download", "Extract", "V"],
]
  .map(
    ([id, ico, title, hotkey]) =>
      `<button data-action="${id}" title="${title} [${hotkey}]"><kbd>${hotkey}</kbd>${icon(ico)}<span>${title}</span><small>${id === "fire" ? "ENDS TURN" : id === "overwatch" || id === "hunker" ? "ALL AP" : "1 AP"}</small></button>`,
  )
  .join("")}</div></section>
</main><footer class="statusbar"><span><i class="status-dot"></i> GHOSTS <b>TOKYO PLAYTEST</b></span><span>NO SIGNAL LEAVES THIS TERMINAL <i>/</i> BUILD 0.2</span><button id="manual-footer">FIELD MANUAL <kbd>?</kbd></button></footer>
<dialog id="modal"><div id="modal-content"></div></dialog>`;
let game = new Encounter();
// Reproducible local combat QA, stripped from the published build.
if(import.meta.env.MODE === "development" && import.meta.env.DEV && new URLSearchParams(location.search).get("review")==="corner") {
  game.units.find(u=>u.id==="v")!.pos=[4,-3];
  game.units.find(u=>u.id==="h3")!.pos=[-1,-5];
}
if(import.meta.env.MODE === "development" && import.meta.env.DEV && new URLSearchParams(location.search).get("review")==="bishop-wall") {
  game.units.find(u=>u.id==="b")!.pos=[3,4];
}
if(import.meta.env.MODE === "development" && import.meta.env.DEV && new URLSearchParams(location.search).get("review")==="cover-axes") {
  const positions:Cell[]=[[-1,-4],[1,-4],[0,-3],[0,-5]];
  game.allies.forEach((u,i)=>{u.pos=positions[i];});
}
let battlefield: Battlefield;
let selected = "v",
  target = "h1";
let mode: "move" | "fire" | "grenade" = "move";
let busy = false;
let resultShown = false;
let grenadeTarget: Cell | null = null;
let soundOn = false;
let audio: AudioContext | undefined;
let feedbackTimer: ReturnType<typeof setTimeout>;
const portraits = new Map<string, string>();
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
$(".brand").innerHTML =
  "<span>GHOSTS<small>Tokyo playtest · Back to menu ↗</small></span>";
$(".topnav").innerHTML =
  "<span>Helios Industries / Private military contract</span>";
$(".top-status").innerHTML =
  '<span class="contract-seal">PAID IN FULL<br>ON EXTRACTION</span>';
$(".battlefield").insertAdjacentHTML(
  "beforeend",
  '<div id="field-objectives"></div>',
);
$(".command-deck").insertAdjacentHTML(
  "afterbegin",
  '<div id="field-weapons" aria-label="Select weapon"></div>',
);
$(".workspace").append($("#end-turn"));
const selectedUnit = () => game.units.find((u) => u.id === selected)!;
const voice = new VoicePlayer();
const sfx = new EffectPlayer();
/** The deployed look decides the voice: its sex, and its chosen index when it has one. */
function voiceFor(u: Unit): Voice | null {
  const look = deployment.get(u.id);
  if (!look || u.enemy) return null;
  return { sex: look.appearance.sex, index: look.voice ?? DEFAULT_VOICE_INDEX };
}
const targetUnit = () => game.units.find((u) => u.id === target);
function tone(
  kind: "rifle" | "sniper" | "pistol" | "grenade" | "pin" | "aim" | "click" | "reload",
  weapon?: Weapon,
) {
  // A recorded effect replaces the synthesized tone; the rest stay behind the rail toggle.
  if (sfx.play(kind, weapon)) return;
  if (!soundOn || kind === "pin" || kind === "aim") return;
  // Synthesized tones sit on the same effects level as the recordings.
  const level = effectVolume(readAudioSettings(localStorage.getItem("ghosts:settings")));
  if (level <= 0) return;
  audio ??= new AudioContext();
  void audio.resume();
  const duration =
    kind === "grenade"
      ? 0.6
      : kind === "sniper"
        ? 0.3
        : kind === "click"
          ? 0.05
          : 0.13;
  const buffer = audio.createBuffer(
    1,
    audio.sampleRate * duration,
    audio.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value =
    kind === "grenade"
      ? 240
      : kind === "sniper"
        ? 700
        : kind === "click"
          ? 2800
          : 1500;
  const gain = audio.createGain();
  gain.gain.value = (kind === "click" ? 0.03 : 0.12) * level;
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start();
}
function notify(message: string, type = "") {
  const el = $("#feedback");
  el.textContent = message;
  el.className = `visible ${type}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => (el.className = ""), 2800);
}
function select(id: string) {
  if (busy) return;
  if (!$("#motion-deck").hidden) {
    void closeDrills();
    return;
  }
  const u = game.units.find((u) => u.id === id);
  if (!u || u.hp <= 0) return;
  if (u.enemy) {
    if (mode === "grenade") {
      void pick(u.pos, u.id);
      return;
    }
    target = id;
    mode = "fire";
  } else {
    if (selected !== id) voice.speak("select", voiceFor(u));
    selected = id;
    battlefield.select(id);
    mode = "move";
    grenadeTarget = null;
  }
  tone("click");
  update();
}
function update() {
  battlefield.invalidate();
  $(".battlefield").classList.toggle("executing", busy);
  if (!game.allies.some((u) => u.id === selected) && game.allies.length) {
    selected = game.allies[0].id;
    battlefield.select(selected);
  }
  if (!game.enemies.some((u) => u.id === target))
    target = game.enemies[0]?.id || "";
  const u = selectedUnit(),
    t = targetUnit();
  battlefield.sync();
  battlefield.showRange(u, mode === "move" && !busy);
  if (mode === "grenade" && !busy) battlefield.showGrenadeRange(u);
  battlefield.hover.visible = false;
  battlefield.showPath(undefined);
  $("#squad-count").textContent =
    `${String(game.allies.length).padStart(2, "0")} OPERATORS ACTIVE`;
  $("#squad-cards").innerHTML = game.units
    .filter((a) => !a.enemy)
    .map(
      (a, i) =>
        `<button class="squad-card ${selected === a.id ? "selected" : ""} ${a.hp <= 0 ? "kia" : ""}" data-unit="${a.id}" ${a.hp <= 0 ? "disabled" : ""}><img src="${portraits.get(a.id)}" alt="${escapeHTML(a.name)} facial portrait"/><span class="squad-index">0${i + 1}</span><span class="squad-details"><small>${a.role}</small><strong>${escapeHTML(a.name)}</strong><span class="hp-track"><i style="width:${(a.hp / a.maxHp) * 100}%"></i></span><span class="squad-meta">${a.hp <= 0 ? "KIA" : a.hunkered ? "HUNKERED" : a.overwatch ? "OVERWATCH" : `${a.hp} / ${a.maxHp} HP`}<span class="ap-dots">${[0, 1].map((j) => `<i class="${a.ap > j ? "filled" : ""}"></i>`).join("")}</span></span></span></button>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLElement>("[data-unit]")
    .forEach((b) => (b.onclick = () => select(b.dataset.unit!)));
  $("#selected-info").innerHTML =
    `<span class="selected-mark">${icon("shield")}</span><div><small>SELECTED OPERATOR</small><strong>${escapeHTML(u.name)} <span>/ ${u.role}</span></strong><span class="operator-meta">${u.ap} AP <i>·</i> ${u.ammo} / ${u.clip} ROUNDS <i>·</i> ${game.cover(u) > 0 ? "IN COVER" : "EXPOSED"}</span></div>`;
  $("#phase").textContent =
    game.result === "victory"
      ? "CONTRACT COMPLETE"
      : game.result === "defeat"
        ? "SQUAD LOST"
        : game.phase === "enemy"
          ? "HOSTILE TURN"
          : "YOUR TURN";
  $("#turn").textContent = String(game.turn).padStart(2, "0");
  $("#hostile-count").textContent =
    `${3 - game.enemies.length} / 3 targets eliminated`;
  $("#enemy-total").textContent = String(game.enemies.length).padStart(2, "0");
  $("#obj-core").classList.toggle("complete", game.secured);
  $("#obj-enemies").classList.toggle("complete", !game.enemies.length);
  $("#targets").innerHTML =
    game.enemies
      .map(
        (e) =>
          `<button class="target-row ${e.id === target ? "selected" : ""}" data-target="${e.id}"><span class="target-symbol">${icon("cross")}</span><span><strong>${escapeHTML(e.name)}</strong><small>${e.role} <i>/</i> ${distance(u.pos, e.pos)} TILES</small></span><span class="target-hp">${e.hp}<small>HP</small></span><span class="hit-chance">${game.chance(u, e)}<small>%</small></span></button>`,
      )
      .join("") ||
    '<div class="empty-targets">ALL HOSTILE ASSETS NEUTRALIZED</div>';
  document.querySelectorAll<HTMLElement>("[data-target]").forEach(
    (b) =>
      (b.onclick = () => {
        select(b.dataset.target!);
      }),
  );
  $("#field-objectives").innerHTML =
    `<small>THE CONTRACT</small><p><i class="${game.secured ? "done" : ""}"></i>Take the relay core${game.secured ? " / SECURED" : ""}</p><p><i class="${!game.enemies.length ? "done" : ""}"></i>Clear Wraith security <b>${3 - game.enemies.length}/3</b></p><span>Turn ${String(game.turn).padStart(2, "0")} — ${game.phase === "player" ? "Ghosts has initiative" : "Hostile activity"}</span>`;
  $("#field-weapons").innerHTML = (["rifle", "sniper", "pistol"] as Weapon[])
    .map(
      (w) =>
        `<button data-weapon="${w}" class="${u.weapon === w ? "active" : ""}" ${busy || !game.canAct(u) ? "disabled" : ""}>${w === "rifle" ? "MX–4" : w === "sniper" ? "SRS–9" : "K–12"} <small>${w} <b>${u.magazines[w]} / ${weapons[w].clip}</b></small></button>`,
    )
    .join("");
  const weaponButtons = `<div class="weapon-switch" aria-label="Equipped weapon">${(["rifle", "sniper", "pistol"] as Weapon[]).map((w) => `<button data-weapon="${w}" class="${u.weapon === w ? "active" : ""}" ${busy || !game.canAct(u) ? "disabled" : ""}>${w.toUpperCase()}</button>`).join("")}</div>`;
  let context = `<div class="section-title">LOADOUT <span>${u.ammo} / ${u.clip}</span></div><div class="weapon-title">${icon("gun")}<div><strong>${weapons[u.weapon].label}</strong><small>${u.damage} DMG <i>/</i> ${u.range} RANGE <i>/</i> ${u.armor} ARMOR</small></div></div>${weaponButtons}`;
  if (mode === "fire" && t)
    context += `<div class="shot-preview"><strong>${game.chance(u, t)}<span>%</span></strong><div>CHANCE TO HIT<small>${shotBlockReason(game, u, t) ?? (game.cover(t, u) ? "TARGET IN COVER" : "TARGET IN RANGE")}</small></div></div><p class="action-instruction">Confirm your shot in the battlefield targeting panel.</p>`;
  else if (mode === "grenade")
    context += `<div class="action-instruction"><span class="amber-text">FRAGMENTATION / ${u.grenade ? "EXPENDED" : "READY"}</span><p>Click a ground tile or hostile marker, then confirm the throw in the battlefield panel. Orange tiles show throw range.</p></div>`;
  else
    context += `<div class="action-instruction"><span class="amber-text">${u.ap ? "AWAITING ORDERS" : "ACTION POINTS DEPLETED"}</span><p>${u.ap ? "Click a highlighted tile to move. Low barriers are vaulted automatically." : "Select another operator or end the turn."}</p></div>`;
  $("#context-card").innerHTML = context;
  document.querySelectorAll<HTMLElement>("[data-weapon]").forEach(
    (b) =>
      (b.onclick = () => {
        void switchWeapon(b.dataset.weapon as Weapon);
      }),
  );

  $("#log").innerHTML = game.log
    .slice(0, 4)
    .map(
      (l, i) =>
        `<p><span>${String(game.turn).padStart(2, "0")}.${String(game.log.length - i).padStart(2, "0")}</span>${l}</p>`,
    )
    .join("");
  const cannot = busy || !game.canAct(u);
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
    const a = b.dataset.action;
    b.classList.toggle("active", a === mode);
    if (a === "fire")
      b.querySelector("span")!.textContent =
        mode === "fire" ? "Confirm shot" : "Fire weapon";
    if (a === "grenade")
      b.querySelector("span")!.textContent =
        mode === "grenade" && grenadeTarget ? "Confirm throw" : "Grenade";
    b.disabled =
      cannot ||
      (a === "reload" && u.ammo === u.clip) ||
      (a === "grenade" && u.grenade) ||
      (a === "fire" && (!u.ammo || !game.enemies.length)) ||
      (a === "overwatch" && !u.ammo) ||
      (a === "secure" && (game.secured || distance(u.pos, relay) > 1));
    if (a === "fire")
      b.querySelector("small")!.textContent =
        u.weapon === "pistol" ? "1 AP" : "ENDS TURN";
  });
  $("#end-turn").toggleAttribute(
    "disabled",
    busy || !!game.result || game.phase !== "player",
  );
  updateTargeting();
  if (game.result && !busy && !resultShown && !$("#modal").hasAttribute("open")) showPanel("result");
}
function cancelTargeting() {
  if (busy) return;
  mode = "move";
  grenadeTarget = null;
  update();
}
function updateTargeting() {
  const hud = $("#targeting-hud"),
    u = selectedUnit(),
    t = targetUnit();
  const active = mode !== "move" && !game.result;
  $(".battlefield").classList.toggle("targeting", active);
  hud.hidden = !active;
  if (!active) {
    void battlefield.leaveAim();
    return;
  }
  if (mode === "fire" && t) {
    void battlefield.aimAt(u, t.pos, "fire");
    const reason = shotBlockReason(game, u, t);
    hud.innerHTML = `<div class="targeting-top"><span>${escapeHTML(u.name)} / ${weapons[u.weapon].label}</span><button id="cancel-target">CANCEL <kbd>ESC</kbd></button></div><div class="targeting-main"><div class="aim-probability">${game.chance(u, t)}<small>% HIT</small></div><div class="aim-description"><small>HOSTILE TARGET</small><strong>${escapeHTML(t.name)}</strong><span>${reason ?? `${u.damage} DAMAGE · ${distance(u.pos, t.pos)} TILES · ${u.weapon === "pistol" ? "1 AP" : "ENDS OPERATOR TURN"}`}</span></div><button id="confirm-fire" class="primary" ${busy || reason ? "disabled" : ""}>${busy ? "FIRING…" : "CONFIRM SHOT"} ${icon("cross")}</button></div><div class="target-choices">${game.enemies.map((e) => `<button data-aim-target="${e.id}" class="${e.id === target ? "active" : ""}" ${busy ? "disabled" : ""}>${escapeHTML(e.name)} <b>${distance(u.pos, e.pos) > u.range + 3 ? "OUT OF RANGE" : `${game.chance(u, e)}%`}</b></button>`).join("")}</div>`;
    $("#confirm-fire").onclick = () => void fire();
  } else if (mode === "grenade") {
    // Keep the overhead camera while choosing the landing point; shoulder shot begins on throw.
    if (!busy) void battlefield.leaveAim();
    const reason = grenadeBlockReason(game, u, grenadeTarget);
    const affected = grenadeTarget
      ? game.units.filter(
          (a) => a.hp > 0 && distance(a.pos, grenadeTarget!) <= 2,
        )
      : [];
    const friendly = affected.filter((a) => !a.enemy);
    hud.innerHTML = `<div class="targeting-top"><span>${escapeHTML(u.name)} / FRAGMENTATION</span><button id="cancel-target">CANCEL <kbd>ESC</kbd></button></div><div class="targeting-main"><div class="aim-probability">${grenadeTarget ? distance(u.pos, grenadeTarget) : "—"}<small>/ 5 RANGE</small></div><div class="aim-description"><small>GRENADE LANDING POINT</small><strong>${grenadeTarget ? grenadeTarget.join(" : ") : "SELECT A TILE"}</strong><span class="${friendly.length ? "friendly-warning" : ""}">${reason ?? (friendly.length ? `FRIENDLY FIRE: ${friendly.map((a) => a.name).join(", ")}` : `${affected.length} HOSTILES IN BLAST · 2-TILE RADIUS · 1 AP`)}</span></div><button id="confirm-grenade" class="primary" ${busy || reason ? "disabled" : ""}>${busy ? "THROWING…" : "CONFIRM THROW"} ${icon("grenade")}</button></div><div class="grenade-adjust"><span>CLICK GROUND TO AIM / ADJUST TILE</span>${[
      ["north", "↑", 0, -1],
      ["west", "←", -1, 0],
      ["east", "→", 1, 0],
      ["south", "↓", 0, 1],
    ]
      .map(
        ([name, glyph, x, z]) =>
          `<button data-nudge="${x},${z}" aria-label="Aim grenade ${name}" ${busy ? "disabled" : ""}>${glyph}</button>`,
      )
      .join("")}</div>`;
    $("#confirm-grenade").onclick = () => void throwGrenade();
    document.querySelectorAll<HTMLElement>("[data-nudge]").forEach(
      (b) =>
        (b.onclick = () => {
          const [x, z] = b.dataset.nudge!.split(",").map(Number);
          const from = grenadeTarget ?? u.pos;
          void pick([from[0] + x, from[1] + z]);
        }),
    );
    if (grenadeTarget) battlefield.showPath([u.pos, grenadeTarget], true);
  }
  $("#cancel-target").toggleAttribute("disabled", busy);
  $("#cancel-target").onclick = cancelTargeting;
  document
    .querySelectorAll<HTMLElement>("[data-aim-target]")
    .forEach((b) => (b.onclick = () => select(b.dataset.aimTarget!)));
}
async function perform(fn: () => Promise<void>) {
  if (busy || game.result) return;
  busy = true;
  update();
  try {
    await fn();
  } finally {
    busy = false;
    update();
  }
}
async function switchWeapon(weapon: Weapon) {
  const u = selectedUnit();
  if (busy || !game.canAct(u) || u.weapon === weapon) return;
  if (!$("#motion-deck").hidden) await closeDrills();
  mode = "move";
  await perform(async () => {
    await battlefield.leaveAim();
    await battlefield.changeWeapon(u, weapon);
    notify(`${weapons[weapon].label} / EQUIPPED`);
  });
}
async function fire() {
  const a = selectedUnit(),
    b = targetUnit();
  if (!b) return;
  await perform(async () => {
    const result = game.attack(a, b);
    if (!result) {
      notify("No shot available. Reposition or reload.");
      return;
    }
    await battlefield.aimReady;
    voice.speak("fire", voiceFor(a));
    tone(a.weapon);
    await battlefield.fire(a, b, result.hit);
    if (b.hp <= 0) voice.speak("kill", voiceFor(a));
    mode = "move";
    await battlefield.leaveAim();
    notify(
      result.hit
        ? `${result.crit ? "CRITICAL HIT" : "CONFIRMED HIT"} / −${result.damage} HP${b.hp <= 0 ? " / TARGET DOWN" : ""}`
        : "SHOT MISSED",
      result.hit ? "hit" : "miss",
    );
  });
}
async function throwGrenade() {
  if (!grenadeTarget) return;
  const p: Cell = [...grenadeTarget],
    u = selectedUnit();
  await perform(async () => {
    if (!game.throwGrenade(u, p)) {
      notify(grenadeBlockReason(game, u, p) ?? "Throw unavailable");
      return;
    }
    await battlefield.aimAt(u, p, "grenade");
    voice.speak("grenade", voiceFor(u));
    tone("pin");
    await battlefield.grenade(u, p);
    tone("grenade");
    notify("FRAGMENTATION / AREA IMPACT");
    grenadeTarget = null;
    mode = "move";
    await battlefield.leaveAim();
  });
}
async function action(name: string) {
  if (!$("#motion-deck").hidden) {
    await closeDrills();
    return;
  }
  if (busy || !game.canAct(selectedUnit())) return;
  const u = selectedUnit();
  tone("click");
  if (name === "move" || name === "fire" || name === "grenade") {
    if (name === "fire" && mode === "fire") {
      await fire();
      return;
    }
    if (name === "grenade" && mode === "grenade" && grenadeTarget) {
      await throwGrenade();
      return;
    }
    mode = name;
    grenadeTarget = name === "grenade" ? defaultGrenadeTarget(game, u) : null;
    if (name === "fire") {
      target = bestShotTarget(game, u)?.id ?? "";
      sfx.play("aim", u.weapon);
    }
    update();
    return;
  }
  if (name === "reload") {
    await perform(async () => {
      if (game.reload(u)) {
        tone("reload", u.weapon);
        await battlefield.reload(u);
        notify(`${u.name} / MAGAZINE READY`);
      }
    });
  } else if (name === "hunker") {
    await perform(async () => {
      if (game.hunker(u)) {
        voice.speak("hunker", voiceFor(u));
        await battlefield.stance(u);
        notify("HUNKERED / DEFENSE INCREASED");
      }
    });
  } else if (name === "overwatch") {
    await perform(async () => {
      if (game.watch(u)) {
        await battlefield.watch(u);
        notify("OVERWATCH / REACTION FIRE ARMED");
      }
    });
  } else if (name === "secure") {
    if (game.secure(u)) {
      notify("RELAY CORE ACQUIRED");
      update();
    }
  }
}
async function pick(p: Cell, id?: string) {
  if (!$("#motion-deck").hidden) return;
  if (busy || game.result) return;
  const u = selectedUnit();
  if (mode === "grenade") {
    const reason = grenadeBlockReason(game, u, p);
    if (reason) {
      notify(reason);
      return;
    }
    grenadeTarget = p;
    update();
    battlefield.showPath([u.pos, p], true);
    return;
  }
  if (id) {
    select(id);
    return;
  }
  if (mode === "move") {
    await perform(async () => {
      const path = game.move(u, p);
      if (!path) {
        notify("Destination unavailable or outside movement range.");
        return;
      }
      const vault = path.some((c) => covers.some((v) => key(c) === key(v)));
      if (vault) notify("TRAVERSING LOW COVER");
      voice.speak(game.cover(u) > 0 ? "cover" : "move", voiceFor(u));
      await battlefield.move(u, path);
    });
  }
}
async function endTurn() {
  if (!$("#motion-deck").hidden) {
    await closeDrills();
    return;
  }
  if (busy || game.result || game.phase !== "player") return;
  mode = "move";
  grenadeTarget = null;
  await battlefield.leaveAim();
  await perform(async () => {
    game.beginEnemy();
    update();
    notify("HOSTILE ACTIVITY / STAND BY", "miss");
    for (const enemy of [...game.enemies]) {
      if (!game.allies.length || enemy.hp <= 0) break;
      let nearest = [...game.allies].sort(
        (a, b) => distance(a.pos, enemy.pos) - distance(b.pos, enemy.pos),
      )[0];
      if (distance(enemy.pos, nearest.pos) > 5) {
        const paths = game.paths(enemy);
        const candidates = [...paths.values()]
          .filter((p) => p.length > 1)
          .sort(
            (a, b) =>
              distance(a[a.length - 1], nearest.pos) -
              distance(b[b.length - 1], nearest.pos),
          );
        if (candidates.length) {
          const path = game.move(enemy, candidates[0].at(-1)!);
          if (path) await battlefield.move(enemy, path);
        }
        for (const ally of game.allies.filter(
          (a) => a.overwatch && distance(a.pos, enemy.pos) <= a.range + 3,
        )) {
          ally.overwatch = false;
          ally.ap = 1;
          game.phase = "player";
          const result = game.attack(ally, enemy);
          game.phase = "enemy";
          if (result) {
            notify(`${ally.name} / OVERWATCH`);
            voice.speak("overwatch", voiceFor(ally));
            tone(ally.weapon);
            await battlefield.fire(ally, enemy, result.hit);
            if (enemy.hp <= 0) voice.speak("kill", voiceFor(ally));
          }
          if (enemy.hp <= 0) break;
        }
      }
      if (enemy.hp <= 0) continue;
      nearest = [...game.allies].sort(
        (a, b) => distance(a.pos, enemy.pos) - distance(b.pos, enemy.pos),
      )[0];
      if (!nearest) break;
      if (enemy.ammo === 0) {
        game.reload(enemy);
        tone("reload", enemy.weapon);
        await battlefield.reload(enemy);
      } else {
        const result = game.attack(enemy, nearest);
        if (result) {
          tone(enemy.weapon);
          await battlefield.fire(enemy, nearest, result.hit);
          if (result.hit && nearest.hp > 0) voice.speak("hit", voiceFor(nearest));
        }
      }
      battlefield.sync();
      update();
    }
    if (!game.result) {
      game.nextTurn();
      notify(`TURN ${String(game.turn).padStart(2, "0")} / YOUR INITIATIVE`);
    }
  });
}
function showPanel(panel: string) {
  if (panel === "tactical") return;
  if (panel === "result") {
    resultShown = true;
    revealEncounter($<HTMLDialogElement>("#modal"), encounterReport(game), portraits, reset, () => battlefield.invalidate());
    return;
  }
  const modal = $<HTMLDialogElement>("#modal");
  modal.onclose = () => { battlefield.invalidate(); if (game.result && !busy && !resultShown) update(); };
  let content = "";
  const heading = (kicker: string, title: string, sub: string) =>
    `<div class="modal-heading"><div class="eyebrow">${kicker}</div><h2>${title}</h2><p>${sub}</p></div>`;
  const briefing = () =>
    heading(
      "HELIOS STRATEGIC INDUSTRIES / EYES ONLY",
      "Operation Black Rain",
      "Kōra Industrial District / 02:14 AM / Heavy rainfall. Nobody owns this city. Everybody pays.",
    ) +
    `<div class="briefing"><div><h3>THE CONTRACT</h3><p>Kōra Systems intercepted a Helios research shipment. The manifest sits on a relay inside Sector 09. Your squad has one window before the network purges the evidence.</p><p>Move an operator next to the illuminated relay and use <b>Extract</b>. Neutralize the three Wraith security operators to close the contract.</p><h3>RULES OF ENGAGEMENT</h3><p>Two action points per operator. Low cover reduces incoming accuracy by 25 points. Hunkering improves defense. Grenades damage every unit within two tiles, including your own.</p></div><div class="briefing-facts"><span>EMPLOYER<b>HELIOS INDUSTRIES</b></span><span>OPPOSITION<b>KŌRA / WRAITH SECURITY</b></span><span>PAYMENT<b>₡ 48,000</b></span><span>EXTRACTION<b>RELAY CORE + AREA SECURED</b></span></div></div>`;
  if (panel === "intel") content = briefing();
  // Entry and redeploy: the briefing plus who is going in, closed by Deploy.
  if (panel === "deploy") {
    const allies = game.units.filter((u) => !u.enemy);
    content =
      briefing() +
      `<div class="deploy-squad"><h3><span>DEPLOYED SQUAD</span><span>${String(allies.length).padStart(2, "0")} OPERATIVES</span></h3><ol class="deploy-roster">${allies
        .map((u) => {
          const portrait = portraits.get(u.id);
          return `<li>${portrait ? `<img src="${portrait}" alt="">` : ""}<div><span>${u.role}</span><b>${escapeHTML(u.name)}</b><small>${escapeHTML(u.full)}</small><p>${weapons[u.weapon].label}<br>HP ${u.maxHp} · ARMOR ${u.armor} · AIM ${u.aim}</p></div></li>`;
        })
        .join("")}</ol></div><div class="deploy-actions"><button type="button" class="deploy-go">DEPLOY SQUAD <span>→</span></button></div>`;
  }
  if (panel === "help")
    content =
      heading(
        "GHOSTS / FIELD MANUAL",
        "Control the encounter.",
        "A complete local encounter. Every command below is interactive.",
      ) +
      `<div class="manual-grid">${[
        [
          "Tab / Shift+Tab",
          "Cycle operators",
          "Next / previous living squad member. 1–4 selects directly.",
        ],
        [
          "M",
          "Move / vault",
          "Click a highlighted tile. Paths cross low barriers with a vault.",
        ],
        [
          "X",
          "Fire weapon",
          "Select a hostile, inspect hit chance, then confirm the shot.",
        ],
        [
          "T",
          "Throw grenade",
          "Choose a tile within 5 spaces, review the arc, confirm.",
        ],
        [
          "R",
          "Reload",
          "Uses 1 AP. Magazines persist independently for each gun.",
        ],
        [
          "H",
          "Hunker down",
          "Uses remaining AP. Defense increases until your next turn.",
        ],
        [
          "O",
          "Overwatch",
          "Uses remaining AP. Fires when an enemy moves into range.",
        ],
        ["V", "Extract relay", "Within one tile of the relay. Costs 1 AP."],
        [
          "C / F",
          "Close camera / focus",
          "Orbit and zoom remain available in either camera mode.",
        ],
        [
          "Q / E",
          "Rotate camera",
          "Drag to orbit, scroll to zoom, right-drag to pan.",
        ],
        ["G", "Tactical grid", "Toggle the ground grid."],
        [
          "ENTER",
          "End turn",
          "Confirm a shot or grenade while targeting; otherwise end the turn.",
        ],
      ]
        .map(
          ([k, t, d]) =>
            `<div><kbd>${k}</kbd><span><b>${t}</b><p>${d}</p></span></div>`,
        )
        .join(
          "",
        )}</div><p class="modal-note">Weapon stats and encounter balance are demo presets. Core AP, ammo, range, armor, and cover concepts follow the Ghosts tactical rules; overwatch, hunker, sidearm actions, and vault presentation are frontend extensions. <a href="/demo-assets/asset-credits.txt" target="_blank" rel="noopener">Asset credits</a>.</p>`;
  $("#modal-content").innerHTML =
    `<button class="modal-close" aria-label="Close panel">${icon("close")}</button>${content}`;
  modal.classList.toggle("briefing-modal", panel === "intel" || panel === "deploy");
  if (!modal.open) modal.showModal();
  $(".modal-close").onclick = () => modal.close();
  if (panel === "deploy") {
    const go = $<HTMLButtonElement>(".deploy-go");
    go.onclick = () => modal.close();
    go.focus();
  }
  modal.onclick = (e) => {
    if (e.target === modal) modal.close();
  };
  if (document.querySelector("#restart-encounter"))
    $("#restart-encounter").onclick = () => {
      modal.close();
      reset();
    };
}
function toggleAudio() {
  soundOn = !soundOn;
  $("#sound").classList.toggle("active", soundOn);
  $("#sound").setAttribute("aria-pressed", String(soundOn));
  $("#sound").setAttribute(
    "aria-label",
    soundOn ? "Disable combat audio" : "Enable combat audio",
  );
  tone("click");
  notify(`COMBAT AUDIO / ${soundOn ? "ON" : "OFF"}`);
}
function toggleGrid() {
  battlefield.invalidate();
  battlefield.gridVisible = !battlefield.gridVisible;
  battlefield.grid.visible = battlefield.gridVisible;
  $("#grid").classList.toggle("active", battlefield.gridVisible);
  $("#grid").setAttribute("aria-pressed", String(battlefield.gridVisible));
}
function reset() {
  if (busy) return;
  if (!$("#motion-deck").hidden) {
    void closeDrills();
    return;
  }
  void battlefield.leaveAim();
  voice.stop();
  resultShown = false;
  game = new Encounter();
  applyDeploymentNames(game.units, deployment);
  battlefield.game = game;
  selected = "v";
  target = "h1";
  mode = "move";
  grenadeTarget = null;
  for (const u of game.units) {
    const r = battlefield.rigs.get(u.id)!;
    r.root.position.set(u.pos[0] * 1.35, surfaceHeight(u.pos[0] * 1.35, u.pos[1] * 1.35), u.pos[1] * 1.35);
    resetHuman(r);
    const opponent = game.units
      .filter((v) => v.enemy !== u.enemy)
      .sort((a, b) => distance(u.pos, a.pos) - distance(u.pos, b.pos))[0];
    r.root.rotation.y = Math.atan2(
      u.pos[0] - opponent.pos[0],
      u.pos[1] - opponent.pos[1],
    );
  }
  battlefield.select(selected);
  update();
  notify("OPERATION RESET / SQUAD DEPLOYED");
  showPanel("deploy");
}
/** Freeze the encounter while the shell's pause menu is up. */
function setPaused(paused: boolean) {
  battlefield?.setPaused(paused);
  voice.setPaused(paused);
  sfx.setPaused(paused);
  document.body.dataset.paused = String(paused);
  if (!audio) return;
  if (paused) void audio.suspend();
  else if (soundOn) void audio.resume();
}
onShellMessage((message) => {
  if (!battlefield) return;
  if (message.type === "ghosts:pause") setPaused(message.paused);
  else if (message.type === "ghosts:restart") reset();
});
try {
  const renderer = Battlefield.createRenderer();
  await loadOperatives(renderer);
  await loadNativeIdentities(game.units);
  await loadDistrictTextures(renderer);
  $("#viewport").dataset.humanTextures = JSON.stringify(humanTextureStats());
  battlefield = new Battlefield(
    $("#viewport"),
    $("#world-labels"),
    game,
    renderer,
  );
  const applyRenderSettings = () =>
    battlefield.setRenderMode(getSettings().display.batterySaver ? "battery" : "smooth");
  applyRenderSettings();
  const unsubscribeRenderSettings = subscribeSettings(applyRenderSettings);
  window.addEventListener("pagehide", unsubscribeRenderSettings, { once: true });
  await battlefield.warmup();
  for (const u of game.units.filter((u) => !u.enemy))
    portraits.set(u.id, battlefield.portrait(u));
  battlefield.onPick = (p, id) => void pick(p, id);
  battlefield.onHover = (p) => {
    if (busy) return;
    const u = selectedUnit();
    if (mode === "move" && u.ap) {
      const path = battlefield.previewPath(p);
      battlefield.hover.visible = !!path;
      battlefield.showPath(path);
    } else if (
      mode === "grenade" &&
      distance(u.pos, p) <= 5 &&
      !grenadeTarget
    ) {
      battlefield.hover.visible = true;
      battlefield.showPath([u.pos, p], true);
    }
  };
  if (import.meta.env.MODE === "development" && import.meta.env.DEV && new URLSearchParams(location.search).get("review")?.startsWith("debrief")) {
    const { prepareDebriefReview } = await import("./aftermath/review");
    prepareDebriefReview(game, new URLSearchParams(location.search).get("review")!);
  }
  update();
  $("#loading").remove();
  showPanel("deploy");
} catch (error) {
  $("#loading").innerHTML =
    `<p>3D renderer could not initialize.<br>Please enable WebGL and reload.</p>`;
  console.error(error);
}
document
  .querySelectorAll<HTMLElement>("[data-panel]")
  .forEach((b) => (b.onclick = () => showPanel(b.dataset.panel!)));
document
  .querySelectorAll<HTMLElement>("[data-action]")
  .forEach((b) => (b.onclick = () => void action(b.dataset.action!)));
$("#end-turn").onclick = () => void endTurn();
$("#view").onclick = () => {
  if (busy) return;
  if (mode !== "move") {
    cancelTargeting();
    return;
  }
  battlefield.view(!battlefield.cinematic);
  $("#view span").textContent = battlefield.cinematic
    ? "CLOSE CAMERA"
    : "TACTICAL VIEW";
};
$("#scene-time").onchange = () => {
  const time = $<HTMLSelectElement>("#scene-time").value as TimeOfDay;
  if (!Object.hasOwn(timePresets, time)) return;
  battlefield.setTimeOfDay(time);
  $("#scene-light-status").textContent = `Streetlights ${timePresets[time].lights ? "on" : "off"} · lights follow the time`;
};
$("#scene-rain").onchange = () => battlefield.setRain($<HTMLInputElement>("#scene-rain").checked);
$("#grid").onclick = toggleGrid;
$("#focus").onclick = () => battlefield.focus();
$("#sound").onclick = toggleAudio;
$("#reset").onclick = reset;
$("#manual-footer").onclick = () => showPanel("help");

const motionSelect = $<HTMLSelectElement>("#motion-select");
motionSelect.innerHTML = [...new Set(motions.map((m) => m[2]))]
  .map(
    (group) =>
      `<optgroup label="${group}">${motions
        .filter((m) => m[2] === group)
        .map((m) => `<option value="${m[0]}">${m[1]}</option>`)
        .join("")}</optgroup>`,
  )
  .join("");
motionSelect.value = "crouch_enter";
async function runDrill() {
  if (busy || game.phase !== "player") return;
  const motion = motionSelect.value as Motion;
  const label = motions.find((m) => m[0] === motion)![1];
  await perform(async () => {
    for (const b of Array.from(
      document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        "#motion-deck button, #motion-deck select",
      ),
    ))
      b.disabled = true;
    $("#motion-status").textContent = `${label} / IN PROGRESS`;
    try {
      await battlefield.drill(selectedUnit(), motion);
    } finally {
      for (const b of Array.from(
        document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "#motion-deck button, #motion-deck select",
        ),
      ))
        b.disabled = false;
      $("#motion-status").textContent =
        `${label} / COMPLETE — replay or choose another.`;
    }
  });
}
async function closeDrills() {
  if (busy) return;
  $("#motion-deck").hidden = true;
  $("#drills").setAttribute("aria-expanded", "false");
  await battlefield.endDrills();
  update();
}
$("#drills").onclick = async () => {
  if (busy || game.result || game.phase !== "player") return;
  if (!$("#motion-deck").hidden) {
    await closeDrills();
    return;
  }
  mode = "move";
  await battlefield.leaveAim();
  $("#motion-deck").hidden = false;
  $("#drills").setAttribute("aria-expanded", "true");
  update();
  void runDrill();
};
$("#close-drills").onclick = () => void closeDrills();
$("#play-motion").onclick = () => void runDrill();
motionSelect.onchange = () => void runDrill();
for (const [id, step] of [
  ["previous-motion", -1],
  ["next-motion", 1],
] as const)
  $("#" + id).onclick = () => {
    if (busy) return;
    motionSelect.selectedIndex =
      (motionSelect.selectedIndex + step + motions.length) % motions.length;
    void runDrill();
  };
document.addEventListener("keydown", (e) => {
  if ($<HTMLDialogElement>("#modal").open || e.ctrlKey || e.metaKey || e.altKey)
    return;
  const k = e.key.toLowerCase();
  if ((e.target as HTMLElement).closest("#scene-controls")) {
    if (k === "escape") {
      $<HTMLDetailsElement>("#scene-controls").open = false;
      $("#scene-controls summary").focus();
    }
    return;
  }
  if (!$("#motion-deck").hidden) {
    if (k === "escape") void closeDrills();
    return;
  }
  if (k === "escape" && mode === "move") {
    if (requestPause()) e.preventDefault();
    return;
  }
  if (busy) return;
  if (
    k === "tab" &&
    !["input", "select", "textarea"].includes(
      (e.target as HTMLElement).tagName.toLowerCase(),
    )
  ) {
    e.preventDefault();
    const living = game.units.filter((u) => !u.enemy && u.hp > 0);
    const i = living.findIndex((u) => u.id === selected);
    if (living.length)
      select(
        living[(i + (e.shiftKey ? -1 : 1) + living.length) % living.length].id,
      );
    return;
  }
  if (
    ["input", "select", "textarea", "button"].includes(
      (e.target as HTMLElement).tagName.toLowerCase(),
    ) &&
    (e.key === "Enter" || e.key === " ")
  )
    return;
  if (["1", "2", "3", "4"].includes(k)) {
    select(["v", "g", "b", "e"][+k - 1]);
    return;
  }
  const actions: Record<string, string> = {
    m: "move",
    x: "fire",
    t: "grenade",
    r: "reload",
    o: "overwatch",
    h: "hunker",
    v: "secure",
  };
  if (actions[k]) {
    e.preventDefault();
    void action(actions[k]);
  } else if (k === "enter") {
    e.preventDefault();
    if (mode === "fire") void fire();
    else if (mode === "grenade") void throwGrenade();
    else void endTurn();
  } else if (k === "g") toggleGrid();
  else if (k === "f") battlefield.focus();
  else if (k === "c") $("#view").click();
  else if (k === "q") battlefield.rotate(-Math.PI / 4);
  else if (k === "e") battlefield.rotate(Math.PI / 4);
  else if (k === "?") showPanel("help");
  else if (k === "escape") {
    cancelTargeting();
  }
});
window.addEventListener("beforeunload", () => battlefield?.dispose());
