// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

const PATHS = {
  cross: (
    <>
      <path d="M12 3v4m0 10v4M3 12h4m10 0h4" />
      <circle cx="12" cy="12" r="5" />
    </>
  ),
  move: <path d="m12 3 4 4m-4-4L8 7m4-4v18M3 12l4-4m-4 4 4 4M3 12h18m0 0-4-4m4 4-4 4" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
      <path d="M12 7v9" />
    </>
  ),
  reload: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M5 8a8 8 0 0 1 14-3l1 7M4 12l1 7a8 8 0 0 0 14-3" />
    </>
  ),
  grenade: <path d="m13 4 3-2 3 3-2 3M8 6l8 8M6 8c-4 4-4 8-1 11s7 3 11-1 4-8 1-11-7-3-11 1Z" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  gun: <path d="M3 8h16v5H9l-2 7H3l2-8H2V9m17-1V6h3v6h-3M9 13v3h5v-3" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  map: <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16" />,
  focus: (
    <>
      <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7h4l2-3h6l2 3h4v14H3z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />,
  extract: <path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4" />,
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M8 3v3l4 5 4-5V3M8 21v-3l4-5 4 5v3" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path d="m22 3 17 9v20L22 41 5 32V12z" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12 16 10 6 10-6v7l-10 6-10-6zm0 12 10 6 10-6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
