// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useEffect, useSyncExternalStore } from "react";

import { useRules } from "../../../chain/ranked";
import {
    applyRules,
    economyRules,
    rulesFromChain,
    subscribeEconomy,
    type EconomyRules,
} from "./index";

/** The rules the economy runs on, re-rendering when the live `Rules` replace them. */
export function useEconomy(): EconomyRules {
    return useSyncExternalStore(subscribeEconomy, economyRules, economyRules);
}

/** Mounted once in the shell: the economy runs on the live `Rules` from the first screen on. */
export function RulesPreload() {
    const { data } = useRules();
    useEffect(() => {
        if (data) applyRules(rulesFromChain(data));
    }, [data]);
    return null;
}
