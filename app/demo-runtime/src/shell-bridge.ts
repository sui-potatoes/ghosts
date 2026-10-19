/**
 * Messages between the playtest frame and the Ghosts shell around it. The
 * shell owns the pause menu; the frame only reports an unconsumed back key
 * and obeys pause / restart commands. Both sides are same-origin, and every
 * message is checked against the other window before it is trusted.
 */

/** Shell → frame. */
export type ShellMessage =
  | { type: "ghosts:pause"; paused: boolean }
  | { type: "ghosts:restart" };

/** Frame → shell. */
export type FrameMessage = { type: "ghosts:pause-request" };

/** A shell message out of untrusted `postMessage` data, or null. */
export function parseShellMessage(data: unknown): ShellMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; paused?: unknown };
  if (m.type === "ghosts:pause" && typeof m.paused === "boolean")
    return { type: "ghosts:pause", paused: m.paused };
  if (m.type === "ghosts:restart") return { type: "ghosts:restart" };
  return null;
}

/** A frame message out of untrusted `postMessage` data, or null. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown };
  return m.type === "ghosts:pause-request" ? { type: "ghosts:pause-request" } : null;
}

/** True when this document is framed by the shell rather than opened directly. */
export function inShell(): boolean {
  return window.parent !== window;
}

/** Ask the shell to pause. Returns false when there is no shell to ask. */
export function requestPause(): boolean {
  if (!inShell()) return false;
  const message: FrameMessage = { type: "ghosts:pause-request" };
  window.parent.postMessage(message, location.origin);
  return true;
}

/** Run `handler` for every valid message from the shell. Returns the unsubscribe. */
export function onShellMessage(handler: (message: ShellMessage) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const message = parseShellMessage(e.data);
    if (message) handler(message);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
