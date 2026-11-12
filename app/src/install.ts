import { useEffect, useState } from "react";

/** Chrome's install prompt event; not in lib.dom. */
interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
    // Captured at module load: the event can fire before any component mounts.
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferred = event as InstallPromptEvent;
        notify();
    });
    window.addEventListener("appinstalled", () => {
        deferred = null;
        notify();
    });
}

const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;

const isIos = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export type InstallState =
    { kind: "none" } | { kind: "prompt"; install: () => Promise<void> } | { kind: "ios" };

/** What the install entry should offer: the native prompt, the iOS hint, or nothing. */
export function useInstall(): InstallState {
    const [, tick] = useState(0);
    useEffect(() => {
        const l = () => tick((n) => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    if (isStandalone()) return { kind: "none" };
    if (deferred) {
        const event = deferred;
        return {
            kind: "prompt",
            install: async () => {
                await event.prompt();
                await event.userChoice;
                // The event is single-use whatever the answer.
                deferred = null;
                notify();
            },
        };
    }
    return isIos() ? { kind: "ios" } : { kind: "none" };
}
