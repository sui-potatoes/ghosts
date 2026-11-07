// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import ReactDOM from "react-dom/client";
import "./index.css";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.tsx";
import { registerServiceWorker } from "./serviceWorker.ts";
import { initSettings } from "./settings/store.ts";
import { dAppKit } from "./sui.ts";

// Display preferences go on <html> before anything renders, so there is no
// flash of the default look.
initSettings();
// Game assets cached in the browser, kept in step with each deploy.
registerServiceWorker();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
        <DAppKitProvider dAppKit={dAppKit}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </DAppKitProvider>
    </QueryClientProvider>,
);
