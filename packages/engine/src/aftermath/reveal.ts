// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { escapeHTML as h, pad2 } from "../html.ts";
import { XP_PER_LEVEL, type EncounterReport, type RecruitReport } from "./report.ts";
import "./reveal.css";

function card(r: RecruitReport, i: number, portrait?: string) {
    const status = r.kia ? "KIA" : "RETURNED";
    return `<li class="record-slot ${r.kia ? "is-kia" : ""}" style="--order:${i}" data-record="${i}">
    <article class="recruit-record" aria-label="${h(r.name)} — ${status}" tabindex="0">
      <div class="record-id"><span>${pad2(i + 1)} / ${h(r.role)}</span><span class="record-rank">LV <b data-level>1</b></span></div>
      <div class="record-portrait">${portrait ? `<img src="${h(portrait)}" alt="${h(r.name)} portrait">` : '<div class="record-silhouette">◇</div>'}<span class="record-status">${status}</span></div>
      <div class="record-identity"><h3>${h(r.name)}</h3><p>${h(r.full)}</p></div>
      <div class="record-service"><span>CONFIRMED KILLS</span><strong>${pad2(r.kills)}</strong></div>
      ${
          r.kia
              ? '<div class="record-memorial"><strong>KILLED IN ACTION</strong></div>'
              : `<div class="record-experience"><div><span>FIELD XP</span><strong>+${r.xp}</strong></div><div class="record-xp" role="progressbar" aria-label="${h(r.name)} experience to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p><span data-progress>0 / 100</span><span data-next>NEXT / LV 2</span></p></div>`
      }
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
    <header class="debrief-header">
      <p class="debrief-eyebrow">GHOSTS / AFTER ACTION <span>${h(operation.toUpperCase())}</span></p>
      <h2 id="debrief-title" class="${report.victory ? "" : "is-defeat"}">${report.victory ? "CONTRACT FULFILLED" : "SIGNAL LOST"}</h2>
    </header>
    <div class="debrief-meta"><span>${h(sector.toUpperCase())}</span><span>${pad2(report.turns)} TURNS <i>·</i> ${report.survivors} / ${report.recruits.length} RETURNED${lost ? ` <i>·</i> ${lost} LOST` : ""}</span></div>
    <ol class="record-deck">${report.recruits.map((r, i) => card(r, i, portraits.get(r.id))).join("")}</ol>
    <footer class="debrief-footer"><p class="debrief-summary" role="status" aria-live="polite">OPENING FIELD RECORDS…</p><div><button type="button" data-skip>REVEAL ALL</button><button type="button" data-redeploy disabled>REDEPLOY SQUAD <span>→</span></button>${onQuit ? '<button type="button" data-quit>BACK TO MENU</button>' : ""}</div></footer>
  </div>`;
    const slots = Array.from(dialog.querySelectorAll<HTMLElement>(".record-slot"));
    const skip = dialog.querySelector<HTMLButtonElement>("[data-skip]")!;
    const redeploy = dialog.querySelector<HTMLButtonElement>("[data-redeploy]")!;
    let frame = 0,
        disposed = false,
        finished = false;
    const started = performance.now();
    const revealAt = (i: number) => 450 + i * 190;
    const fillAt = (i: number) => revealAt(i) + 380;
    const fillDuration = (r: RecruitReport) => Math.max(950, r.xp * 12);
    const completeAt = Math.max(
        ...report.recruits.map((r, i) => fillAt(i) + (r.kia ? 700 : fillDuration(r)) + 550),
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
            slot.querySelector("[data-progress]")!.textContent = `${progress} / 100`;
            slot.querySelector("[data-next]")!.textContent = `NEXT / LV ${level + 1}`;
            if (level > 1) {
                slot.querySelector(".record-status")!.textContent = "PROMOTED";
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
                    ? "SQUAD LOST"
                    : [
                          promoted ? `${pad2(promoted)} PROMOTED` : "",
                          lost ? `${pad2(lost)} LOST` : "NO LOSSES",
                      ]
                          .filter(Boolean)
                          .join(" · ");
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
