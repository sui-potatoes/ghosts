// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/** What the package reads from its Vite host; the host's own `vite/client` types agree. */
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
  /** Present only under the dev server; stateful modules reload the page on edit. */
  readonly hot?: { accept(callback: () => void): void };
}
