// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useState } from "react";

import { NETWORK } from "../../constants";
import { probeRpc } from "../../settings/rpcProbe";
import { updateSettings, useSettings } from "../../settings/store";
import { activeRpcUrl, defaultRpcUrl } from "../../sui";
import { rpcForm, type RpcFormView, type RpcStatus } from "./model";

/**
 * The custom fullnode endpoint as the view holds it: the typed draft (kept
 * across categories, so leaving can ask about it), the last probe and the
 * three commands. Same rules as the classic panel (`settings/NetworkPanel`):
 * a URL is checked, probed for its chain identifier and refused unless it is
 * the configured network's; the saved value reaches the clients on reload.
 */
export type RpcDraft = {
    draft: string;
    saved: string;
    active: string;
    fallback: string;
    view: RpcFormView;
    edit: (value: string) => void;
    test: () => Promise<void>;
    /** Probes, then saves; true when saved. */
    save: () => Promise<boolean>;
    /** Back to the public default, saved at once. */
    reset: () => void;
    /** Drop the typed draft. */
    discard: () => void;
};

export function useRpcDraft(): RpcDraft {
    const [settings] = useSettings();
    const saved = settings.network.rpcUrl;
    const [draft, setDraft] = useState(saved);
    const [status, setStatus] = useState<RpcStatus>({ kind: "idle" });
    const fallback = defaultRpcUrl(NETWORK);
    const view = rpcForm({ draft, saved, status, active: activeRpcUrl, fallback });

    return {
        draft,
        saved,
        active: activeRpcUrl,
        fallback,
        view,
        edit: (value) => {
            setDraft(value);
            setStatus({ kind: "idle" });
        },
        test: async () => {
            if (view.testDeny || !view.check.ok) return;
            setStatus({ kind: "busy", what: "test" });
            setStatus({ kind: "done", result: await probeRpc(view.check.url || fallback) });
        },
        save: async () => {
            const check = view.check;
            if (view.saveDeny || !check.ok) return false;
            if (check.url) {
                setStatus({ kind: "busy", what: "save" });
                const result = await probeRpc(check.url);
                setStatus({ kind: "done", result });
                if (!result.ok) return false;
            }
            updateSettings((s) => ({ ...s, network: { rpcUrl: check.url } }));
            setDraft(check.url);
            return true;
        },
        reset: () => {
            updateSettings((s) => ({ ...s, network: { rpcUrl: "" } }));
            setDraft("");
            setStatus({ kind: "idle" });
        },
        discard: () => {
            setDraft(saved);
            setStatus({ kind: "idle" });
        },
    };
}
