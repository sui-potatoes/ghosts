// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The leaderboard's read in the app: every `Account` in the `Registry` up to
 * the cap (`chain/leaderboard.ts`), the names of the ranked ones (their
 * assigned names, the short fallback for none; kept ten minutes, so the
 * minute's refresh asks only for new players), and the live `Rules` the tiers
 * come from. Read again every minute and when the window comes back.
 */

import { useCurrentClient } from "@mysten/dapp-kit-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { inLanes, readLeaderAccounts, type LeaderboardClient } from "../../chain/leaderboard";
import { assignedName } from "../../chain/names";
import { useRules } from "../../chain/ranked";
import { GHOSTS } from "../../constants";
import { defaultName } from "../../player/name";
import { TIERS } from "../play/economy";
import { useEconomy } from "../play/economy/useEconomy";
import type { NamedAccount, Placement, TierBand } from "./model";

type Client = ReturnType<typeof useCurrentClient>;

export const REFRESH_MS = 60_000;
const NAME_TTL_MS = 10 * 60_000;
const NAME_LANES = 8;

const names = new Map<string, { at: number; name: Promise<string | null> }>();

function nameOf(client: Client, owner: string): Promise<string | null> {
    const kept = names.get(owner);
    if (kept && Date.now() - kept.at < NAME_TTL_MS) return kept.name;
    const name = assignedName(client, owner).catch(() => {
        names.delete(owner);
        return null;
    });
    names.set(owner, { at: Date.now(), name });
    return name;
}

async function fetchBoard(client: Client): Promise<NamedAccount[]> {
    const { accounts } = await readLeaderAccounts(
        client as unknown as LeaderboardClient,
        GHOSTS.registry,
    );
    const ranked = accounts.filter((a) => a.games > 0);
    const named = await inLanes(ranked, NAME_LANES, (a) => nameOf(client, a.owner));
    return ranked.map((a, i) => ({ ...a, name: named[i] ?? defaultName(a.owner) }));
}

/** The ranked accounts with their names. */
export function useLeaderboard() {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["leaderboard", GHOSTS.registry],
        queryFn: () => fetchBoard(client),
        refetchInterval: REFRESH_MS,
        refetchOnWindowFocus: true,
        placeholderData: keepPreviousData,
    });
}

/** The tiers and the placement floor of the live `Rules`; null until they are read. */
export function useTierBands(): {
    bands: { tiers: TierBand[]; placement: Placement } | null;
    isError: boolean;
    refetch: () => void;
} {
    useEconomy();
    const rules = useRules();
    const data = rules.data;
    return {
        bands: data
            ? {
                  tiers: data.tiers.map((t, i) => ({
                      name: TIERS[i]?.name ?? `Tier ${i + 1}`,
                      min: Number(t.minRating),
                  })),
                  placement: { games: data.placementGames, tier: data.placementTier },
              }
            : null,
        isError: rules.isError && !data,
        refetch: () => void rules.refetch(),
    };
}
