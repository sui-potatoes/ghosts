// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { useLocation, useNavigate } from "react-router-dom";

import { currentTrail, historyIndex, upStep } from "../routes";

/** Back to the parent screen (the menu): see `routes.ts`. */
export function useGoUp(): () => void {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    return () => {
        const step = upStep(pathname, currentTrail(), historyIndex());
        if (!step) return;
        if (step.kind === "pop") navigate(-1);
        else navigate(step.path, { replace: true });
    };
}
