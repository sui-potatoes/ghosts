// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The focus cursor's model: one store per screen, exactly one focused node at
 * all times. Nodes register with a group (a panel) and a scope (the screen, or
 * a prompt stacked on it); directions move the cursor spatially, staying
 * inside the current group when it has a node that way and otherwise crossing
 * to the nearest group in that direction, where it lands on the node that
 * group had last. Each node carries its own commands (confirm, reset, back),
 * which is what the command bar shows and what Confirm / Reset / Back run.
 *
 * Plain TypeScript, no React and no app imports (sounds are injected), so the
 * navigation rules are unit-tested in `tests/gui-focus.test.ts`.
 */

/**
 * The actions a focused thing can answer; directions and tabs belong to the
 * screen. `nav` is display-only: it names what the directions do while a
 * target holds them (a stage rotating, a stepper stepping).
 */
export type CommandAction = "nav" | "confirm" | "reset" | "back";

export type Command = {
    action: CommandAction;
    label: string;
    /** Shown but refused; the reason is what the command bar says. */
    deny?: string;
    /** Primary weighs heaviest in the bar; danger is the destructive variant. */
    tone?: "primary" | "danger";
    /** A shorter label for the inline chips on a row, where space is tight. */
    short?: string;
    /** For `nav`: which directions it names. */
    glyph?: "lr" | "ud";
    /**
     * A click or tap on the target runs THIS command instead of the primary.
     * For a row whose primary is a commit elsewhere (Apply sends a transaction)
     * while its own cheap action (open a picker) is a secondary: a click must
     * never commit by surprise. Runs on the first click, so the row is `instant`.
     */
    click?: boolean;
    run?: () => void;
};

export type Dir = "up" | "down" | "left" | "right";

/** What the store needs of an element: its box, its place in the document. */
export type FocusElement = Pick<
    HTMLElement,
    "getBoundingClientRect" | "isConnected" | "compareDocumentPosition"
>;

export type FocusNode = {
    id: string;
    group: string;
    scope: string;
    el: FocusElement | null;
    /** What the command bar names while this node has the cursor. */
    title?: string;
    hint?: string;
    commands: Command[];
    /** Takes a direction before the cursor does (steppers, the stage); true consumes it. */
    directions?: (dir: Dir) => boolean;
};

export type FocusScopeEntry = {
    id: string;
    back: Command;
    restore: string | null;
    /** A modal scope (a prompt) blocks the screen's tabs and sections, even for the mouse. */
    modal: boolean;
};

/** A press or a refusal on the focused node, for the pressed/deny motion. */
export type Pulse = { id: string; action: CommandAction; kind: "press" | "deny"; n: number };

/** The interface sounds; the React side passes the app's, tests pass nothing. */
export type FocusSounds = {
    tick?: (el: FocusElement | null) => void;
    confirm?: () => void;
    back?: () => void;
    deny?: () => void;
};

const PULSE_MS = 160;
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

function signature(node: Pick<FocusNode, "title" | "hint" | "commands">): string {
    return JSON.stringify([
        node.title,
        node.hint,
        node.commands.map((c) => [c.action, c.label, c.deny, c.tone, c.glyph]),
    ]);
}

export class FocusStore {
    private nodes = new Map<string, FocusNode>();
    private sigs = new Map<string, string>();
    private scopes: FocusScopeEntry[];
    private memory = new Map<string, string>();
    private pendingRestore: string | null = null;
    /**
     * The focused node that just unmounted under the cursor, until the player
     * moves: a scope opened in the same commit (a picker standing in for its
     * rows) returns there, not to the fallback the cursor was parked on.
     */
    private lost: string | null = null;
    /**
     * The group the cursor was in when its node unmounted, until the commit
     * settles (a microtask): a node of the same group registering meanwhile
     * (a tab's new rows replacing the old) takes the cursor. Only then does
     * the cursor fall back elsewhere, and a fallback never rewrites another
     * panel's remembered row.
     */
    private orphan: { group: string; scope: string } | null = null;
    private listeners = new Set<() => void>();
    private sounds: FocusSounds;
    focused: string | null = null;
    /**
     * The last input was the mouse or a touch: the focused row then shows its
     * commands inline. Any menu action from keys or pad clears it.
     */
    pointer = false;
    /** The command list (right-click, long-press): which node, and where (client px). */
    menu: { id: string; x: number; y: number } | null = null;
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

    constructor(rootBack: Command, sounds: FocusSounds = {}) {
        this.scopes = [{ id: "root", back: rootBack, restore: null, modal: false }];
        this.sounds = sounds;
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

    get scope(): FocusScopeEntry {
        return this.scopes[this.scopes.length - 1];
    }

    /** A modal scope (a prompt) is open: tabs, sections and the header's clicks wait. */
    get blocked(): boolean {
        return this.scopes.some((s) => s.modal);
    }

    /**
     * Header navigation (a tab or section key, a header click) from wherever
     * the cursor is: refused while a modal scope (a prompt) is open; a
     * passing scope (a picker, the command list) is closed first, as its Back
     * would, so the switch lands on the screen itself. True when it may go on.
     */
    clearForHeader(): boolean {
        if (this.blocked) return false;
        for (let i = 0; i < 4 && this.scope.id !== "root"; i++) {
            const id = this.scope.id;
            this.scope.back.run?.();
            // The scope pops when its owner unmounts; a React close lands after this call.
            if (this.scope.id === id) break;
        }
        return true;
    }

    setRootBack(back: Command) {
        this.scopes[0].back = back;
    }

    node(id: string | null): FocusNode | undefined {
        return id ? this.nodes.get(id) : undefined;
    }

    /** The node a group's cursor was last on; a panel's "current" row. */
    remembered(group: string): string | undefined {
        return this.memory.get(group);
    }

    /** Live nodes of a scope, in document order. */
    inScope(scope = this.scope.id): FocusNode[] {
        const list = [...this.nodes.values()].filter((n) => n.scope === scope && n.el?.isConnected);
        return list.sort((a, b) =>
            a.el!.compareDocumentPosition(b.el as unknown as Node) & FOLLOWING ? -1 : 1,
        );
    }

    register(node: FocusNode) {
        this.nodes.set(node.id, node);
        this.sigs.set(node.id, signature(node));
        const current = this.node(this.focused);
        if (node.id === this.pendingRestore && node.scope === this.scope.id) {
            // The node a closed scope came from, back after a remount (a picker
            // that stood in for its rows): the cursor returns to it.
            this.pendingRestore = null;
            this.orphan = null;
            this.setFocus(node.id, false);
        } else if (this.orphan) {
            // Its replacement in the same panel takes the cursor.
            if (node.scope === this.orphan.scope && node.group === this.orphan.group) {
                this.orphan = null;
                this.setFocus(node.id, false);
            }
        } else if (node.scope === this.scope.id && (!current || current.scope !== this.scope.id)) {
            this.setFocus(node.id, false);
        }
        this.emit();
    }

    /** Refresh a node's data; only a visible change (labels, reasons) re-renders. */
    update(id: string, data: Pick<FocusNode, "title" | "hint" | "commands" | "el" | "directions">) {
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
        if (this.menu?.id === id) this.menu = null;
        if (this.focused === id && node) {
            // The cursor never vanishes: whatever replaces it in the same panel
            // within this commit takes it, else the panel's next row, else
            // anything in scope. Decided once the commit settles.
            this.focused = null;
            this.lost = id;
            this.orphan = { group: node.group, scope: node.scope };
            queueMicrotask(() => this.settle());
            return;
        }
        this.emit();
    }

    /** Resolve a cursor whose node unmounted and nothing in its panel replaced it. */
    settle() {
        const orphan = this.orphan;
        if (!orphan) return;
        this.orphan = null;
        if (!this.node(this.focused)) {
            const rest = this.inScope();
            const same = rest.find((n) => n.group === orphan.group);
            const next = same ?? rest[0];
            if (next) {
                this.focused = next.id;
                if (same) this.memory.set(same.group, same.id);
            }
        }
        this.emit();
    }

    pushScope(id: string, back: Command, modal = false) {
        this.settle();
        this.scopes.push({ id, back, restore: this.lost ?? this.focused, modal });
        this.lost = null;
        const first = this.inScope(id)[0];
        if (first) this.setFocus(first.id, false);
        this.emit();
    }

    popScope(id: string) {
        const i = this.scopes.findIndex((s) => s.id === id);
        if (i <= 0) return;
        const [scope] = this.scopes.splice(i, 1);
        if (this.menu && id === "menu") this.menu = null;
        if (this.orphan?.scope === id) this.orphan = null;
        const back = this.node(scope.restore);
        if (back && back.scope === this.scope.id) this.setFocus(back.id, false);
        else {
            this.pendingRestore = scope.restore;
            if (this.node(this.focused)?.scope !== this.scope.id) {
                const first = this.inScope()[0];
                this.focused = first?.id ?? null;
            }
        }
        this.emit();
    }

    private setFocus(id: string, sound: boolean) {
        if (this.focused === id) return;
        this.focused = id;
        const node = this.nodes.get(id);
        if (node) this.memory.set(node.group, id);
        if (sound && node?.el) this.sounds.tick?.(node.el);
    }

    /** Put the cursor on `id`; `sound` for moves the player made. */
    focus(id: string, sound = true) {
        if (!this.nodes.has(id) || this.focused === id) return;
        this.lost = null;
        this.orphan = null;
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
        this.settle();
        this.lost = null;
        const current = this.node(this.focused);
        if (current?.directions?.(dir)) return;
        const nodes = this.inScope();
        if (!current?.el) {
            if (nodes[0]) this.focus(nodes[0].id);
            return;
        }
        const target = pickTarget(current, nodes, dir, (group) => this.memory.get(group));
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

    /** Targets moved without resizing (a 3D scene laid out anew): the cursor re-measures. */
    relayout() {
        this.emit();
    }

    /** Pointer input: mark the mouse or touch as the device in use (inline commands appear). */
    pointerInput() {
        if (this.pointer) return;
        this.pointer = true;
        this.emit();
    }

    /** Keys or pad: back to the console presentation. */
    keyInput() {
        if (!this.pointer) return;
        this.pointer = false;
        this.emit();
    }

    openMenu(id: string, x: number, y: number) {
        this.menu = { id, x, y };
        this.emit();
    }

    closeMenu() {
        if (!this.menu) return;
        this.menu = null;
        this.emit();
    }

    /** Run a command with its feedback: pressed or refused, and the sound. */
    run(command: Command) {
        const id = this.focused ?? "";
        if (command.deny) {
            this.sounds.deny?.();
            this.denies++;
            this.flash({ id, action: command.action, kind: "deny", n: ++this.n });
            return;
        }
        if (command.action === "back") this.sounds.back?.();
        else this.sounds.confirm?.();
        this.flash({ id, action: command.action, kind: "press", n: ++this.n });
        command.run?.();
    }

    invoke(action: CommandAction): boolean {
        if (action === "nav") return false;
        this.settle();
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

/**
 * Where `dir` takes the cursor from `current`: the nearest node that way in
 * its own group; else the nearest group that way, resuming on the node that
 * group had last (a panel never visited starts at its top); else, vertically,
 * the list wraps inside its own group. Undefined: nowhere to go (a bump).
 */
export function pickTarget(
    current: FocusNode,
    nodes: FocusNode[],
    dir: Dir,
    remembered: (group: string) => string | undefined,
): FocusNode | undefined {
    const from = current.el!.getBoundingClientRect();
    const same = nodes.filter((n) => n.group === current.group && n !== current);
    let target = nearest(from, same, dir);
    if (!target) {
        const other = nodes.filter((n) => n.group !== current.group);
        const hit = nearest(from, other, dir);
        if (hit) {
            const backId = remembered(hit.group);
            const back = backId ? other.find((n) => n.id === backId) : undefined;
            target = back ?? other.find((n) => n.group === hit.group) ?? hit;
        }
    }
    if (!target && (dir === "up" || dir === "down") && same.length) {
        const sorted = [current, ...same].sort(
            (a, b) => a.el!.getBoundingClientRect().top - b.el!.getBoundingClientRect().top,
        );
        target = dir === "down" ? sorted[0] : sorted[sorted.length - 1];
    }
    return target;
}

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

/**
 * The best node in `dir` from `from`: candidates must lie that way; the
 * distance along the direction counts once, the offset across it twice, and
 * an overlap across the direction costs nothing (rows straight below win).
 */
export function nearest<N extends { el: FocusElement | null }>(
    from: Box,
    nodes: N[],
    dir: Dir,
): N | undefined {
    let best: N | undefined;
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

/**
 * What the pointer reaches on the target itself (inline chips, the command
 * list): its secondary commands. The primary is the click, and the command
 * bar names it with its glyph for keys and pad.
 */
export function secondaryCommands(commands: Command[]): Command[] {
    return commands.filter((c) => c.action === "reset");
}

/**
 * The command a click or tap on a target runs. `instant` targets (selecting,
 * opening a picker: cheap and undoable) run their primary on the first click;
 * the others run it on a click while already focused, unless `clickConfirm`
 * is off (choosers, whose clicks belong to their arrows and swatches).
 */
export function clickCommand(
    commands: Command[],
    { again, instant, clickConfirm }: { again: boolean; instant: boolean; clickConfirm: boolean },
): Command | undefined {
    if (!clickConfirm) return undefined;
    const own = commands.find((c) => c.click);
    if (own) return own;
    if (!(instant || again)) return undefined;
    return commands.find((c) => c.action === "confirm");
}
