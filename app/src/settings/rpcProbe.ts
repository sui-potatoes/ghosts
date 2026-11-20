// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { SuiGrpcClient } from "@mysten/sui/grpc";

import { NETWORK } from "../constants";
import { defaultRpcUrl } from "../sui";

export type RpcProbe =
    { ok: true; latencyMs: number; chainId: string } | { ok: false; error: string };

const TIMEOUT_MS = 8000;

async function chainId(baseUrl: string): Promise<{ chainId: string; latencyMs: number }> {
    const client = new SuiGrpcClient({ network: NETWORK, baseUrl });
    const start = performance.now();
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out.")), TIMEOUT_MS),
    );
    const { chainIdentifier } = await Promise.race([client.getChainIdentifier(), timeout]);
    return { chainId: chainIdentifier, latencyMs: Math.round(performance.now() - start) };
}

/**
 * Ask an endpoint for its chain identifier (one cheap call) and check it
 * against the configured network's, read from the public default fullnode.
 * A mismatch, or no way to verify, is a failure.
 */
export async function probeRpc(url: string): Promise<RpcProbe> {
    let found: Awaited<ReturnType<typeof chainId>>;
    let blockedByCsp = false;
    const onViolation = (e: SecurityPolicyViolationEvent) => {
        if (e.effectiveDirective.startsWith("connect-src")) blockedByCsp = true;
    };
    document.addEventListener("securitypolicyviolation", onViolation);
    try {
        found = await chainId(url);
    } catch (e) {
        // The violation event is queued as its own task, so it can land after the rejection.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (blockedByCsp) {
            return {
                ok: false,
                error: "Blocked by this site's Content-Security-Policy, which does not allow connections to that endpoint",
            };
        }
        return {
            ok: false,
            error: `Could not reach the endpoint (${e instanceof Error ? e.message : String(e)})`,
        };
    } finally {
        document.removeEventListener("securitypolicyviolation", onViolation);
    }
    let expected: string;
    try {
        expected = (await chainId(defaultRpcUrl(NETWORK))).chainId;
    } catch {
        return {
            ok: false,
            error: `Could not verify the network: the public ${NETWORK} fullnode is unreachable`,
        };
    }
    if (found.chainId !== expected) {
        return {
            ok: false,
            error: `Wrong network: this endpoint is chain ${found.chainId}, the app plays on ${NETWORK} (${expected})`,
        };
    }
    return { ok: true, latencyMs: found.latencyMs, chainId: found.chainId };
}
