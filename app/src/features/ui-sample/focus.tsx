// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The focus cursor: one store per screen, exactly one focused node at all
 * times. Nodes register with a group (a panel) and a scope (the screen, or a
 * prompt stacked on it); directions move the cursor spatially, staying inside
 * the current group when it has a node that way and otherwise crossing to the
 * nearest group in that direction, where it lands on the node that group had
 * last. Each node carries its own commands (confirm, reset, back), which is
 * what the command bar shows and what Confirm / Reset / Back run. The mouse
 * moves the same cursor: pointer movement over a node focuses it, a click
 * focuses and confirms. Everything arrives through the input bus.
 */

import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type MouseEvent,
    type PointerEvent,
    type ReactNode,
    type RefObject,
} from "react";

import { uiBack, uiConfirm, uiDeny, uiTick } from "../../audio";
import { onAction } from "../../input";
import type { Action } from "../../settings/keys";

/** The actions a focused thing can answer; directions and tabs belong to the screen. */
export type CommandAction = "confirm" | "reset" | "back";

export type Command = {
    action: CommandAction;
    label: string;
    /** Shown but refused; the reason is what the command bar says. */
    deny?: string;
    /** Primary weighs heaviest in the bar; danger is the destructive variant. */
    tone?: "primary" | "danger";
    run?: () => void;
};

export type Dir = "up" | "down" | "left" | "right";

type Node = {
    id: string;
    group: string;
    scope: string;
    el: HTMLElement | null;
    /** What the command bar names while this node has the cursor. */
    title?: string;
    hint?: string;
    commands: Command[];
};

type Scope = { id: string; back: Command; restore: string | null };

/** A press or a refusal on the focused node, for the pressed/deny motion. */
export type Pulse = { id: string; action: CommandAction; kind: "press" | "deny"; n: number };

const PULSE_MS = 160;

function signature(node: Pick<Node, "title" | "hint" | "commands">): string {
    return JSON.stringify([
        node.title,
        node.hint,
        node.commands.map((c) => [c.action, c.label, c.deny, c.tone]),
    ]);
}

export class FocusStore {
    private nodes = new Map<string, Node>();
    private sigs = new Map<string, string>();
    private scopes: Scope[];
    private memory = new Map<string, string>();
    private listeners = new Set<() => void>();
    focused: string | null = null;
    pulse: Pulse | null = null;
    /**
     * The cursor's last one-shot motion: a press, a refusal, or a bump when a
     * direction had nowhere to go. Never cleared; `n` keys the replay.
     */
    motion: { kind: "press" | "deny" | "bump"; dir?: Dir; n: number } | null = null;
    /** Refusals so far; keys the command bar's reason flash. */
    denies = 0;
    version = 0;
    private n = 0;

    constructor(rootBack: Command) {
        this.scopes = [{ id: "root", back: rootBack, restore: null }];
    }

    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => void this.listeners.delete(fn);
    };

    getVersion = () => this.version;

    private emit() {
        this.version++;
        for (const fn of this.listeners) fn();
    }

    get scope(): Scope {
        return this.scopes[this.scopes.length - 1];
    }

    setRootBack(back: Command) {
        this.scopes[0].back = back;
    }

    node(id: string | null): Node | undefined {
        return id ? this.nodes.get(id) : undefined;
    }

    /** The node a group's cursor was last on; a panel's "current" row. */
    remembered(group: string): string | undefined {
        return this.memory.get(group);
    }

    private inScope(scope = this.scope.id): Node[] {
        const list = [...this.nodes.values()].filter((n) => n.scope === scope && n.el?.isConnected);
        return list.sort((a, b) =>
            a.el!.compareDocumentPosition(b.el!) & Node_FOLLOWING ? -1 : 1,
        );
    }

    register(node: Node) {
        this.nodes.set(node.id, node);
        this.sigs.set(node.id, signature(node));
        const current = this.node(this.focused);
        if (node.scope === this.scope.id && (!current || current.scope !== this.scope.id)) {
            this.setFocus(node.id, false);
        }
        this.emit();
    }

    /** Refresh a node's data; only a visible change (labels, reasons) re-renders. */
    update(id: string, data: Pick<Node, "title" | "hint" | "commands" | "el">) {
        const node = this.nodes.get(id);
        if (!node) return;
        Object.assign(node, data);
        const sig = signature(node);
        if (sig !== this.sigs.get(id)) {
            this.sigs.set(id, sig);
            if (id === this.focused) this.emit();
        }
    }

    unregister(id: string) {
        const node = this.nodes.get(id);
        this.nodes.delete(id);
        this.sigs.delete(id);
        if (this.focused === id && node) {
            // The cursor never vanishes: same panel first, then anything in scope.
            const rest = this.inScope();
            const next = rest.find((n) => n.group === node.group) ?? rest[0];
            this.focused = null;
            if (next) this.setFocus(next.id, false);
        }
        this.emit();
    }

    pushScope(id: string, back: Command) {
        this.scopes.push({ id, back, restore: this.focused });
        const first = this.inScope(id)[0];
        if (first) this.setFocus(first.id, false);
        this.emit();
    }

    popScope(id: string) {
        const i = this.scopes.findIndex((s) => s.id === id);
        if (i <= 0) return;
        const [scope] = this.scopes.splice(i, 1);
        const back = this.node(scope.restore);
        if (back && back.scope === this.scope.id) this.setFocus(back.id, false);
        else if (this.node(this.focused)?.scope !== this.scope.id) {
            const first = this.inScope()[0];
            this.focused = first?.id ?? null;
        }
        this.emit();
    }

    private setFocus(id: string, sound: boolean) {
        if (this.focused === id) return;
        this.focused = id;
        const node = this.nodes.get(id);
        if (node) this.memory.set(node.group, id);
        if (sound && node?.el) uiTick(node.el);
    }

    /** Put the cursor on `id`; `sound` for moves the player made. */
    focus(id: string, sound = true) {
        if (!this.nodes.has(id) || this.focused === id) return;
        this.setFocus(id, sound);
        this.emit();
    }

    /** The first node of a group, or the one it had last when `remember`. */
    focusGroup(group: string, remember = false, sound = false) {
        const nodes = this.inScope().filter((n) => n.group === group);
        const last = remember ? nodes.find((n) => n.id === this.memory.get(group)) : undefined;
        const target = last ?? nodes[0];
        if (target) this.focus(target.id, sound);
    }

    move(dir: Dir) {
        const current = this.node(this.focused);
        const nodes = this.inScope();
        if (!current?.el) {
            if (nodes[0]) this.focus(nodes[0].id);
            return;
        }
        const from = current.el.getBoundingClientRect();
        const same = nodes.filter((n) => n.group === current.group && n !== current);
        let target = nearest(from, same, dir);
        if (!target) {
            const other = nodes.filter((n) => n.group !== current.group);
            const hit = nearest(from, other, dir);
            if (hit) {
                // Entering a panel resumes where its cursor was, like a console menu.
                const back = this.node(this.memory.get(hit.group) ?? null);
                target = back && back.scope === this.scope.id && back.el?.isConnected ? back : hit;
            }
        }
        if (!target && (dir === "up" || dir === "down") && same.length) {
            // Lists wrap vertically inside their own panel.
            const sorted = [current, ...same].sort(
                (a, b) => a.el!.getBoundingClientRect().top - b.el!.getBoundingClientRect().top,
            );
            target = dir === "down" ? sorted[0] : sorted[sorted.length - 1];
        }
        if (target) {
            this.focus(target.id);
        } else {
            this.motion = { kind: "bump", dir, n: ++this.n };
            this.emit();
        }
    }

    /** The command `action` resolves to on the focused node; back falls to the scope. */
    command(action: CommandAction): Command | undefined {
        const own = this.node(this.focused)?.commands.find((c) => c.action === action);
        if (own) return own;
        return action === "back" ? this.scope.back : undefined;
    }

    /** Run a command with its feedback: pressed or refused, and the sound. */
    run(command: Command) {
        const id = this.focused ?? "";
        if (command.deny) {
            uiDeny();
            this.denies++;
            this.flash({ id, action: command.action, kind: "deny", n: ++this.n });
            return;
        }
        if (command.action === "back") uiBack();
        else uiConfirm();
        this.flash({ id, action: command.action, kind: "press", n: ++this.n });
        command.run?.();
    }

    invoke(action: CommandAction): boolean {
        const command = this.command(action);
        if (!command) return false;
        this.run(command);
        return true;
    }

    private flash(pulse: Pulse) {
        this.pulse = pulse;
        this.motion = { kind: pulse.kind, n: pulse.n };
        this.emit();
        setTimeout(() => {
            if (this.pulse?.n !== pulse.n) return;
            this.pulse = null;
            this.emit();
        }, PULSE_MS);
    }
}

const Node_FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

/**
 * The best node in `dir` from `from`: candidates must lie that way; the
 * distance along the direction counts once, the offset across it twice, and
 * an overlap across the direction costs nothing (rows straight below win).
 */
function nearest(from: DOMRect, nodes: Node[], dir: Dir): Node | undefined {
    let best: Node | undefined;
    let score = Infinity;
    const slack = 2;
    for (const node of nodes) {
        const r = node.el!.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        let along: number;
        let across: number;
        if (dir === "down" || dir === "up") {
            along = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
            if (along < -slack) continue;
            across = Math.max(0, r.left - from.right, from.left - r.right);
        } else {
            along = dir === "right" ? r.left - from.right : from.left - r.right;
            if (along < -slack) continue;
            across = Math.max(0, r.top - from.bottom, from.top - r.bottom);
            // Sideways into a column, prefer the row level with the cursor.
            across += Math.abs(r.top + r.height / 2 - (from.top + from.height / 2)) * 0.25;
        }
        const s = Math.max(0, along) + across * 2;
        if (s < score) {
            score = s;
            best = node;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// React side.

const StoreContext = createContext<FocusStore | null>(null);
const ScopeContext = createContext("root");

export function useFocusStore(): FocusStore {
    const store = useContext(StoreContext);
    if (!store) throw new Error("useFocusStore outside <FocusRoot>");
    return store;
}

/** Re-render with the store; the whole screen is small enough to follow every change. */
export function useFocusState(): FocusStore {
    const store = useFocusStore();
    useSyncExternalStore(store.subscribe, store.getVersion);
    return store;
}

type RootProps = {
    /** Back with nothing above it: leaving the screen. */
    back: Command;
    /** Bumper / Q-E tab switching, while no prompt is open. */
    onTab?: (step: 1 | -1) => void;
    children: ReactNode;
};

/**
 * The screen's input owner. It takes every menu action while mounted, so the
 * shell's EscapeBack never sees Back on this screen: the root back command is
 * the way out. It subscribes a tick after mount so it sits above EscapeBack,
 * whose effect runs after the routes'.
 */
export function FocusRoot({ back, onTab, children }: RootProps) {
    const [store] = useState(() => new FocusStore(back));
    store.setRootBack(back);
    const tab = useRef(onTab);
    tab.current = onTab;

    useEffect(() => {
        let stop: (() => void) | null = null;
        const timer = setTimeout(() => {
            stop = onAction((action: Action) => {
                switch (action) {
                    case "up":
                    case "down":
                    case "left":
                    case "right":
                        store.move(action);
                        return true;
                    case "confirm":
                    case "reset":
                    case "back":
                        store.invoke(action);
                        return true;
                    case "prev-tab":
                    case "next-tab":
                        if (store.scope.id === "root")
                            tab.current?.(action === "next-tab" ? 1 : -1);
                        return true;
                    default:
                        return true;
                }
            });
        });
        return () => {
            clearTimeout(timer);
            stop?.();
        };
    }, [store]);

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** A stacked scope (a prompt): the cursor is trapped in it, Back runs `back`. */
export function FocusScope({
    id,
    back,
    children,
}: {
    id: string;
    back: Command;
    children: ReactNode;
}) {
    const store = useFocusStore();
    const ref = useRef(back);
    ref.current = back;
    useLayoutEffect(() => {
        store.pushScope(id, {
            ...ref.current,
            run: () => ref.current.run?.(),
        });
        return () => store.popScope(id);
    }, [store, id]);
    return <ScopeContext.Provider value={id}>{children}</ScopeContext.Provider>;
}

type FocusableOptions = {
    id: string;
    group: string;
    title?: string;
    hint?: string;
    commands?: Command[];
};

/**
 * Register an element as a cursor target. Spread `props` on it: the ref, the
 * focus attributes the CSS draws, pointer focus and click-to-confirm.
 */
export function useFocusable<T extends HTMLElement>({
    id,
    group,
    title,
    hint,
    commands = [],
}: FocusableOptions) {
    const store = useFocusState();
    const scope = useContext(ScopeContext);
    const ref = useRef<T | null>(null);

    useLayoutEffect(() => {
        store.register({ id, group, scope, el: ref.current, title, hint, commands });
        return () => store.unregister(id);
        // Registered once per id; the data is refreshed below on every render.
    }, [store, id, group, scope]);

    useLayoutEffect(() => {
        store.update(id, { el: ref.current, title, hint, commands });
    });

    const focused = store.focused === id;
    const pulse = store.pulse?.id === id ? store.pulse : null;
    // The panel's own place-keeper: where its cursor was, once the cursor left it.
    const current = !focused && store.remembered(group) === id;

    return {
        focused,
        props: {
            ref,
            "data-focused": focused || undefined,
            "data-current": current || undefined,
            "data-pressed": pulse?.kind === "press" || undefined,
            "data-denied": pulse?.kind === "deny" || undefined,
            onPointerMove: (e: PointerEvent) => {
                if (e.pointerType !== "touch") store.focus(id);
            },
            onMouseDown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => {
                store.focus(id, false);
                const confirm = commands.find((c) => c.action === "confirm");
                if (confirm) store.run(confirm);
            },
        },
    };
}

/**
 * The cursor itself: one bracket frame for the whole screen that snaps to the
 * focused node's box. Measured against the screen root so the screen's zoom
 * (phone landscape, large displays) cancels out.
 */
export function FocusCursor({ root }: { root: RefObject<HTMLElement | null> }) {
    const store = useFocusState();
    const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const node = store.node(store.focused);
    const el = node?.el ?? null;

    useLayoutEffect(() => {
        const host = root.current;
        if (!el || !host) return;
        const measure = () => {
            const r = el.getBoundingClientRect();
            const h = host.getBoundingClientRect();
            const scale = h.width / host.offsetWidth || 1;
            setBox({
                x: (r.left - h.left) / scale,
                y: (r.top - h.top) / scale,
                w: r.width / scale,
                h: r.height / scale,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(host);
        return () => observer.disconnect();
    }, [el, root, store.version]);

    if (!box || !el) return null;
    const motion = store.motion;
    return (
        <div
            className="uis-cursor"
            aria-hidden
            // A destructive question turns the cursor amber with the frame it sits on.
            data-tone={
                node?.commands.some((c) => c.action === "confirm" && c.tone === "danger")
                    ? "danger"
                    : undefined
            }
            style={{
                transform: `translate(${box.x}px, ${box.y}px)`,
                width: box.w,
                height: box.h,
            }}
        >
            {/* Remounted per press or bump, so its one-shot motion replays. */}
            <div
                key={motion?.n ?? 0}
                className="uis-cursor-frame"
                data-motion={motion?.kind}
                data-dir={motion?.dir}
            >
                <i />
                <i />
                <i />
                <i />
            </div>
        </div>
    );
}
