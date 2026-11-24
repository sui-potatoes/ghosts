// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { copyText, DETAIL_CAP, readout, selectionRect } from "../layout-readout";
import { useSession } from "./useSession";

const LEGEND: [kind: string, label: string][] = [
  ["empty", "Empty"],
  ["wall", "Wall 2.4 m"],
  ["obstacle", "Obstacle 1 m"],
  ["pit", "Unwalkable"],
  ["low", "Low side 1 m"],
  ["high", "High side 2.4 m"],
  ["a", "Spawn A"],
  ["b", "Spawn B"],
];

/** Write `text` to the clipboard; the older route when the page may not use the async one. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } finally {
      area.remove();
    }
  }
}

/**
 * The layout view's panel: the legend, what is under the pointer, and the
 * selected tiles with Copy (plain text for a chat, `copyText`) and Clear.
 * Absent while the view is off.
 */
export function LayoutPanel() {
  const s = useSession();
  const layout = s.battlefield.layout;
  const [copied, setCopied] = useState(false);
  if (!layout) return null;
  const title = layout.level?.name || s.game.scenario.briefing.title;
  const hovered = layout.info(layout.hover);
  const picked = layout.selection;
  const rect = selectionRect(picked);
  const text = copyText(title, layout.tiles, layout.level, picked);
  return (
    <aside className="layout-panel" aria-label="Layout">
      <header>
        <small>Layout</small>
        <span>x, y as in the level file</span>
      </header>
      <p className="layout-hint">Click a tile · Shift-drag a region</p>
      <ul className="layout-legend">
        {LEGEND.map(([kind, label]) => (
          <li key={kind}>
            <i data-kind={kind} />
            {label}
          </li>
        ))}
      </ul>
      <p className="layout-hover" data-empty={!hovered || undefined}>
        {hovered ? readout(hovered) : "Point at a tile"}
      </p>
      <div className="layout-picked">
        <strong>
          {picked.length} {picked.length === 1 ? "tile" : "tiles"}
        </strong>
        {rect && picked.length > 1 && <span>{rect}</span>}
        <button
          type="button"
          disabled={!picked.length}
          onClick={() => {
            void copy(text).then((ok) => {
              setCopied(ok);
              if (ok) window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" disabled={!picked.length} onClick={() => layout.clearSelection()}>
          Clear
        </button>
      </div>
      {picked.length > 0 && (
        <pre className="layout-text" data-detail={picked.length <= DETAIL_CAP || undefined}>
          {text}
        </pre>
      )}
    </aside>
  );
}
