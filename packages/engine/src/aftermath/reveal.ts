// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { escapeHTML as h, pad2 } from "../html.ts";
import { XP_PER_LEVEL, type EncounterReport, type RecruitReport } from "./report.ts";
import "./reveal.css";

function card(r: RecruitReport, i: number, portrait?: string) {
    const status = r.kia ? "KIA" : "RETURNED";
    return `<li class="record-slot ${r.kia ? "is-kia" : ""}" style="--order:${i}" data-record="${i}">
    <div class="record-sleeve" aria-hidden="true"><span>GHOSTS / PERSONNEL</span><b>◇</b><small>FIELD RECORD ${pad2(i + 1)}</small></div>
    <article class="recruit-record" aria-label="${h(r.name)} — ${status}" tabindex="0">
      <div class="record-turn">
        <div class="record-back" aria-hidden="true"><span>G H O S T S</span><b>◇</b><small>EVERY GHOST HAS A STORY.</small></div>
        <div class="record-front">
          <div class="record-id"><span>${pad2(i + 1)} / ${h(r.role)}</span><span>G / 09</span></div>
          <div class="record-portrait">${portrait ? `<img src="${h(portrait)}" alt="${h(r.name)} portrait">` : '<div class="record-silhouette">◇</div>'}<span class="record-status">${status}</span><span class="record-rank">LV <b data-level>1</b></span></div>
          <div class="record-identity"><h3>${h(r.name)}</h3><p>${h(r.full)}</p></div>
          <div class="record-service"><span>CONFIRMED KILLS</span><strong>${pad2(r.kills)}</strong></div>
          ${r.kia ? '<div class="record-memorial"><strong>KILLED IN ACTION</strong><span>Their watch is over.<br>We carry them with us.</span></div>' : `<div class="record-experience"><div><span>FIELD EXPERIENCE</span><strong>+${r.xp} XP</strong></div><div class="record-xp" role="progressbar" aria-label="${h(r.name)} experience to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p><span data-progress>0 / 100 XP</span><span data-next>NEXT / LV 2</span></p></div><div class="record-promotion" aria-hidden="true"><span>✦</span><b>LEVEL UP!</b><small>NEW LEVEL / ${pad2(r.level)}</small></div>`}
          <div class="record-edge" aria-hidden="true"></div>
        </div>
      </div>
    </article>
  </li>`;
}

/** All timing is owned by this dialog; close/reset cancels every pending frame. */
export interface RevealOptions {
    report: EncounterReport;
    /** Operation name and sector for the header, from the scenario. */
    operation: string;
    sector: string;
    portraits: Map<string, string>;
    onRedeploy: () => void;
    /** Back to the menu; without it the link is not offered. */
    onQuit?: () => void;
    onClose: () => void;
}

export function revealEncounter(
    dialog: HTMLDialogElement,
    { report, operation, sector, portraits, onRedeploy, onQuit, onClose }: RevealOptions,
) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const oldFocus = document.activeElement as HTMLElement | null;
    const lost = report.recruits.length - report.survivors;
    const promoted = report.recruits.filter((r) => !r.kia && r.level > 1).length;
    dialog.classList.add("encounter-rewards");
    dialog.setAttribute("aria-labelledby", "debrief-title");
    dialog.innerHTML = `<div class="debrief-shell">
    <header class="debrief-header"><div><p class="debrief-eyebrow">GHOSTS / AFTER ACTION <span>${h(operation.toUpperCase())}</span></p><h2 id="debrief-title">${report.victory ? "Contract fulfilled." : "Signal lost."}</h2><p class="debrief-subtitle">${lost ? `${report.survivors} returned. ${lost} left a silence.` : "Everyone came home. Make it count."}</p></div><div class="debrief-seal">${report.victory ? "CONTRACT<br><b>CLOSED</b>" : "SQUAD<br><b>LOST</b>"}</div></header>
    <div class="debrief-meta"><span>${h(sector)}</span><span>${pad2(report.turns)} TURNS <i>·</i> ${report.survivors} / ${report.recruits.length} RETURNED</span></div>
    <ol class="record-deck">${report.recruits.map((r, i) => card(r, i, portraits.get(r.id))).join("")}</ol>
    <footer class="debrief-footer"><p class="debrief-summary" role="status" aria-live="polite">Opening field records…</p><div><button type="button" data-skip>REVEAL ALL <span>↗</span></button><button type="button" data-redeploy disabled>REDEPLOY SQUAD <span>→</span></button>${onQuit ? '<button type="button" data-quit>BACK TO MENU ↗</button>' : ""}</div></footer>
    <p class="debrief-note">${lost ? "IN MEMORY OF THE GHOSTS WHO DID NOT RETURN." : "ANOTHER CONTRACT. ANOTHER STORY."}</p>
  </div>`;
    const slots = Array.from(dialog.querySelectorAll<HTMLElement>(".record-slot"));
    const skip = dialog.querySelector<HTMLButtonElement>("[data-skip]")!;
    const redeploy = dialog.querySelector<HTMLButtonElement>("[data-redeploy]")!;
    let frame = 0,
        disposed = false,
        finished = false;
    const started = performance.now();
    const revealAt = (i: number) => 1900 + i * 280;
    const fillAt = (i: number) => revealAt(i) + 480;
    const fillDuration = (r: RecruitReport) => Math.max(950, r.xp * 12);
    const completeAt = Math.max(
        ...report.recruits.map((r, i) => fillAt(i) + (r.kia ? 900 : fillDuration(r)) + 750),
    );
    const paint = (elapsed: number) => {
        report.recruits.forEach((r, i) => {
            const slot = slots[i];
            slot.classList.toggle("is-revealed", elapsed >= revealAt(i));
            if (r.kia) return;
            const amount = Math.min(
                r.xp,
                Math.floor(
                    r.xp * Math.max(0, Math.min(1, (elapsed - fillAt(i)) / fillDuration(r))),
                ),
            );
            const level = 1 + Math.floor(amount / XP_PER_LEVEL);
            const progress = amount % XP_PER_LEVEL;
            const bar = slot.querySelector<HTMLElement>(".record-xp")!;
            bar.setAttribute("aria-valuenow", String(progress));
            bar.setAttribute(
                "aria-valuetext",
                `Level ${level}, ${progress} of 100 XP to level ${level + 1}`,
            );
            slot.querySelector<HTMLElement>(".record-xp i")!.style.transform =
                `scaleX(${progress / 100})`;
            slot.querySelector("[data-level]")!.textContent = String(level);
            slot.querySelector("[data-progress]")!.textContent = `${progress} / 100 XP`;
            slot.querySelector("[data-next]")!.textContent = `NEXT / LV ${level + 1}`;
            if (level > 1) {
                slot.querySelector(".record-status")!.textContent = "PROMOTED";
                slot.querySelector(".record-promotion small")!.textContent =
                    `NEW LEVEL / ${pad2(level)}`;
                slot.querySelector("article")!.setAttribute(
                    "aria-label",
                    `${r.name} — promoted to level ${level}`,
                );
                slot.classList.add("is-promoted");
            }
        });
        if (elapsed >= completeAt && !finished) {
            finished = true;
            redeploy.disabled = false;
            skip.textContent = "VIEW BATTLEFIELD";
            dialog.querySelector(".debrief-summary")!.textContent =
                report.survivors === 0
                    ? "No one forgotten."
                    : `${promoted} ${promoted === 1 ? "promotion" : "promotions"}${lost ? ` · ${lost} ${lost === 1 ? "fallen operative" : "fallen operatives"}` : " · No one left behind"}`;
        }
    };
    const tick = (now: number) => {
        if (disposed) return;
        paint(now - started);
        if (!finished) frame = requestAnimationFrame(tick);
    };
    const revealAll = () => {
        cancelAnimationFrame(frame);
        dialog.classList.add("reveal-immediately");
        paint(completeAt);
    };
    const close = () => dialog.close();
    skip.onclick = () => (finished ? close() : revealAll());
    redeploy.onclick = () => {
        close();
        onRedeploy();
    };
    const quit = dialog.querySelector<HTMLButtonElement>("[data-quit]");
    if (quit && onQuit)
        quit.onclick = () => {
            close();
            onQuit();
        };
    dialog.oncancel = (e) => {
        e.preventDefault();
        if (finished) close();
        else revealAll();
    };
    dialog.onclick = null;
    dialog.onclose = () => {
        disposed = true;
        cancelAnimationFrame(frame);
        dialog.classList.remove("encounter-rewards", "reveal-immediately");
        dialog.removeAttribute("aria-labelledby");
        dialog.innerHTML = "";
        dialog.oncancel = null;
        dialog.onclose = null;
        if (oldFocus?.isConnected) oldFocus.focus();
        onClose();
    };
    if (!dialog.open) dialog.showModal();
    skip.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    if (reduced) revealAll();
    else frame = requestAnimationFrame(tick);
}
