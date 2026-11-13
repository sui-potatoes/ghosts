// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useId, useState } from "react";

import { NETWORK } from "../constants";
import { validateRpcUrl } from "../rpcUrl";
import { activeRpcUrl, defaultRpcUrl } from "../sui";
import { probeRpc, type RpcProbe } from "./rpcProbe";
import { updateSettings, useSettings } from "./store";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "done"; result: RpcProbe };

/**
 * Settings → Network: an optional fullnode RPC URL. It is checked as a URL,
 * probed for its chain identifier and refused unless that is the configured
 * network's. The saved value reaches every client on the next reload.
 */
export function NetworkPanel() {
    const [settings] = useSettings();
    const saved = settings.network.rpcUrl;
    const [draft, setDraft] = useState(saved);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const [notice, setNotice] = useState<string | null>(null);
    const inputId = useId();

    const check = validateRpcUrl(draft);
    const busy = status.kind === "busy";
    const unchanged = check.ok && check.url === saved;

    function edit(value: string) {
        setDraft(value);
        setStatus({ kind: "idle" });
        setNotice(null);
    }

    async function test() {
        if (!check.ok || !check.url) return;
        setStatus({ kind: "busy" });
        setStatus({ kind: "done", result: await probeRpc(check.url) });
    }

    async function save() {
        if (!check.ok || busy) return;
        if (check.url) {
            setStatus({ kind: "busy" });
            const result = await probeRpc(check.url);
            setStatus({ kind: "done", result });
            if (!result.ok) return;
        }
        updateSettings((s) => ({ ...s, network: { rpcUrl: check.url } }));
        setDraft(check.url);
        setNotice("Saved. Reload to apply.");
    }

    function reset() {
        updateSettings((s) => ({ ...s, network: { rpcUrl: "" } }));
        setDraft("");
        setStatus({ kind: "idle" });
        setNotice("Back to the default. Reload to apply.");
    }

    // The clients were built at startup; a saved change waits for a reload.
    const pending = (saved || defaultRpcUrl(NETWORK)) !== activeRpcUrl;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
            <div className="flex flex-col gap-2">
                <label htmlFor={inputId} className="label text-secondary">
                    Fullnode RPC URL
                </label>
                <input
                    id={inputId}
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="url"
                    placeholder={defaultRpcUrl(NETWORK)}
                    value={draft}
                    disabled={busy}
                    onChange={(e) => edit(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void save();
                    }}
                    className="set-net-input w-full border border-line bg-raised px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent"
                />
                <p className="text-[12px] text-secondary">
                    Optional. Leave empty for the public {NETWORK} fullnode. https only (http for
                    localhost). The endpoint must serve {NETWORK}; a different network is refused.
                    Changes apply after a reload.
                </p>
                <p className="min-h-[1.25rem] text-[12px] text-warn" role="status">
                    {!check.ok && draft ? check.error : null}
                </p>
            </div>

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    className="btn"
                    disabled={busy || !check.ok || !check.url}
                    onClick={() => void test()}
                >
                    {busy ? "Testing…" : "Test"}
                </button>
                <button
                    type="button"
                    className="btn"
                    disabled={busy || !check.ok || unchanged}
                    onClick={() => void save()}
                >
                    Save
                </button>
                <button
                    type="button"
                    className="btn"
                    disabled={busy || (!saved && !draft)}
                    onClick={reset}
                >
                    Reset to default
                </button>
                {pending && (
                    <button type="button" className="btn" onClick={() => location.reload()}>
                        Reload now
                    </button>
                )}
            </div>

            <div className="min-h-[2.5rem] text-[13px]" role="status">
                {status.kind === "done" &&
                    (status.result.ok ? (
                        <p className="text-accent">
                            OK: {NETWORK} ({status.result.chainId}), {status.result.latencyMs} ms.
                        </p>
                    ) : (
                        <p className="text-warn">{status.result.error}</p>
                    ))}
                {notice && <p className="text-secondary">{notice}</p>}
            </div>
        </div>
    );
}
