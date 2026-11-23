// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * A training in chapters, pure (tested in `director.test.ts`): which chapter
 * to open, which comes next, and whether the whole training is done. Each
 * chapter is its own guided run on its own arena; the host remembers which
 * chapters this device completed.
 */

export interface ChapterInfo {
  id: string;
  title: string;
}

/** The chapter to open: the asked one if it exists, else the first not done, else the first. */
export function openingChapter(chapters: readonly ChapterInfo[], done: readonly string[], asked?: string | null): string {
  if (asked && chapters.some((c) => c.id === asked)) return asked;
  return (chapters.find((c) => !done.includes(c.id)) ?? chapters[0]).id;
}

/** The chapter after `id`, or null after the last. */
export function nextChapter(chapters: readonly ChapterInfo[], id: string): string | null {
  const i = chapters.findIndex((c) => c.id === id);
  return i >= 0 && i + 1 < chapters.length ? chapters[i + 1].id : null;
}

/** Every chapter completed. */
export function allDone(chapters: readonly ChapterInfo[], done: readonly string[]): boolean {
  return chapters.every((c) => done.includes(c.id));
}

/** `done` with `id` added once, in chapter order. */
export function withChapter(chapters: readonly ChapterInfo[], done: readonly string[], id: string): string[] {
  return chapters.filter((c) => c.id === id || done.includes(c.id)).map((c) => c.id);
}
