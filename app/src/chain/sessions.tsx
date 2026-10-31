// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Device sessions over `sui::address_alias`. The owner (passkey) authorizes
 * this device's session key once — the key's address joins the owner's
 * on-chain `AddressAliases` set — and from then on the non-extractable key
 * (`session-key.ts`) signs transactions whose sender is the main account,
 * with no further ceremonies. The alias set is the single source of truth:
 * the Sessions rows list every authorized key (this device or another), show
 * when each last acted, and terminate any of them with one passkey-signed
 * `remove`.
 *
 * Last-action times come from the chain, not from local notes: recent
 * transactions sent by the owner are fetched and attributed to session keys
 * by the public key inside each signature, so a key that went quiet shows
 * its age on every device.
 */

import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { formatAddress } from "@mysten/sui/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { NETWORK } from "../constants";
import type { SettingRow } from "../settings/SettingList";
import {
    AddressAliases,
    aliasesObjectId,
    aliasesRef,
    authorizeDevice,
    expireSessionKey,
    forgetSessionStatus,
    removeTx,
} from "./alias";
import { useBcsObject } from "./objects";
import { sendTransaction } from "./sender";
import {
    clearSessionKey,
    loadSessionKey,
    SESSION_TTL_MS,
    sessionAddress,
    sessionExpired,
    supportsSessionKeys,
    type StoredSessionKey,
} from "./session-key";

/**
 * When each session key last signed for `owner`, from the owner's recent
 * transactions: the signature's public key names the session that sent it.
 */
async function fetchActivity(owner: string): Promise<Map<string, number>> {
    const response = await fetch(`https://graphql.${NETWORK}.sui.io/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            query: `query ($sender: SuiAddress!) {
                transactions(last: 50, filter: { sentAddress: $sender }) {
                    nodes { signatures { signatureBytes } effects { timestamp } }
                }
            }`,
            variables: { sender: owner },
        }),
    });
    const body = (await response.json()) as {
        data?: {
            transactions?: {
                nodes?: {
                    signatures?: { signatureBytes?: string }[];
                    effects?: { timestamp?: string };
                }[];
            };
        };
    };
    const seen = new Map<string, number>();
    for (const node of body.data?.transactions?.nodes ?? []) {
        const at = node.effects?.timestamp ? Date.parse(node.effects.timestamp) : 0;
        if (!at) continue;
        for (const { signatureBytes } of node.signatures ?? []) {
            if (!signatureBytes) continue;
            try {
                const parsed = parseSerializedSignature(signatureBytes);
                if (parsed.signatureScheme !== "ED25519" || !parsed.publicKey) continue;
                const signer = new Ed25519PublicKey(parsed.publicKey).toSuiAddress();
                if ((seen.get(signer) ?? 0) < at) seen.set(signer, at);
            } catch {
                // Multisig / zkLogin envelopes are the owner's own ceremonies.
            }
        }
    }
    return seen;
}

/** "just now", "5m ago", "3h ago", "12d ago" — old sessions read as old. */
function ago(at: number | undefined): string | null {
    if (!at) return null;
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

const STALE_DAYS = 14;

/**
 * A termination waiting on the player's confirmation: whom it names and the
 * work it would do. The panel shows the confirmation; `run` is the unchanged
 * passkey-signed removal and fires only once the player confirms.
 */
export type SessionTermination = {
    /** What the confirmation names: "This device" or the short address. */
    label: string;
    /** This browser's own key: removal also wipes it locally. */
    local: boolean;
    /** Send the removal; the rows' busy state tracks it. */
    run: () => void;
};

/**
 * The Sessions rows for the account panel: the on-chain alias set with
 * last-action times, termination on each, and authorization of this device.
 * Termination is irreversible for the removed key, so activating a session
 * row hands `confirmTermination` the request instead of sending it; the
 * removal runs only when the panel's confirmation calls `run`.
 */
export function useSessionRows(
    confirmTermination: (termination: SessionTermination) => void,
): SettingRow[] {
    const account = useCurrentAccount();
    const client = useCurrentClient();
    const owner = account?.address ?? null;
    const [supported, setSupported] = useState<boolean | null>(null);
    const [local, setLocal] = useState<StoredSessionKey | null>(null);
    const [busy, setBusy] = useState(false);
    const [fault, setFault] = useState<string | null>(null);

    useEffect(() => {
        let gone = false;
        void supportsSessionKeys().then((ok) => !gone && setSupported(ok));
        void loadSessionKey().then((key) => !gone && setLocal(key));
        return () => {
            gone = true;
        };
    }, []);

    // A key past its lifetime self-expires the moment the panel sees it.
    useEffect(() => {
        if (!owner || !local || !sessionExpired(local)) return;
        void expireSessionKey(client, owner).finally(() => {
            void loadSessionKey().then(setLocal);
        });
    }, [owner, local, client]);

    const aliasesId = owner ? aliasesObjectId(owner) : null;
    const aliasesQuery = useBcsObject({
        id: aliasesId,
        schema: AddressAliases,
        refetchInterval: 30_000,
    });
    // A missing object is a state, not an error: aliasing was never enabled.
    const enabled = aliasesQuery.isSuccess;
    const aliases = aliasesQuery.data?.aliases.contents ?? [];

    const activity = useQuery({
        queryKey: ["session-activity", owner],
        enabled: !!owner && aliases.length > 1,
        refetchInterval: 60_000,
        queryFn: () => fetchActivity(owner!),
    });

    const localAddress = local ? sessionAddress(local) : null;

    return useMemo((): SettingRow[] => {
        if (!owner) return [];
        const rows: SettingRow[] = [{ kind: "section", id: "sessions", label: "Sessions" }];
        if (supported === false) {
            rows.push({
                kind: "static",
                id: "sessions-unsupported",
                label: "Device sessions",
                value: <span className="text-warn">unavailable in this browser</span>,
                description:
                    "This browser cannot hold a session key safely; transactions keep using the passkey directly.",
            });
            return rows;
        }

        const run = (work: () => Promise<void>) => {
            if (busy) return;
            setBusy(true);
            setFault(null);
            void work()
                .catch((e) => {
                    console.warn("session action failed:", e);
                    setFault(e instanceof Error ? e.message : String(e));
                })
                .finally(() => {
                    setBusy(false);
                    void aliasesQuery.refetch();
                    void activity.refetch();
                    void loadSessionKey().then(setLocal);
                });
        };

        for (const alias of aliases) {
            // The owner's own entry is the module's bookkeeping, not a session;
            // it is never listed and never offered for removal.
            if (alias === owner) continue;
            const isLocal = alias === localAddress;
            const label = isLocal ? "This device" : formatAddress(alias);
            const lastAt =
                activity.data?.get(alias) ??
                (isLocal ? (local?.lastUsedAt ?? local?.createdAt) : undefined);
            const last = ago(lastAt);
            const old = lastAt !== undefined && Date.now() - lastAt > STALE_DAYS * 86400_000;
            const left =
                isLocal && local
                    ? Math.max(
                          0,
                          Math.ceil((local.createdAt + SESSION_TTL_MS - Date.now()) / 86400_000),
                      )
                    : null;
            rows.push({
                kind: "action",
                id: `session-${alias}`,
                label,
                value: (
                    <span className={old ? "text-warn" : undefined}>
                        {busy
                            ? "working…"
                            : `${last ?? "no action seen"}${left !== null ? ` · ${left}d left` : ""} · terminate`}
                    </span>
                ),
                description: `Activate to terminate this session: a confirmation asks first, then one passkey signature removes it from the alias set${
                    isLocal ? " and wipes the key here" : ""
                }.`,
                onConfirm: () => {
                    if (busy) return;
                    confirmTermination({
                        label,
                        local: isLocal,
                        run: () =>
                            run(async () => {
                                await sendTransaction(
                                    removeTx(await aliasesRef(client, aliasesId!), alias),
                                    { passkey: true },
                                );
                                if (isLocal) await clearSessionKey();
                                forgetSessionStatus();
                            }),
                    });
                },
            });
        }

        const authorized = !!localAddress && aliases.includes(localAddress);
        if (!authorized) {
            rows.push({
                kind: "action",
                id: "session-authorize",
                label: "Authorize this device",
                value: busy ? (
                    "working…"
                ) : fault ? (
                    <span className="text-warn">failed — activate to retry</span>
                ) : enabled ? (
                    "one passkey prompt"
                ) : (
                    "two prompts, first time"
                ),
                description: fault
                    ? `The last attempt failed: ${fault.slice(0, 110)}`
                    : "Creates a session key that never leaves this browser and authorizes it on chain: play then needs no passkey per transaction.",
                onConfirm: () =>
                    run(async () => {
                        await authorizeDevice(client, owner, async (tx) => {
                            const sent = sendTransaction(tx, { passkey: true });
                            if (!sent) throw new Error("Sign in to authorize this device.");
                            await sent;
                        });
                    }),
            });
        }
        return rows;
    }, [
        owner,
        supported,
        aliases,
        activity,
        aliasesQuery,
        local,
        localAddress,
        busy,
        fault,
        client,
        aliasesId,
        enabled,
        confirmTermination,
    ]);
}
