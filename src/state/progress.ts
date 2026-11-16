import { useSyncExternalStore } from 'react';

export type Progress = {
  /** Lessons completed at least once. */
  done: Record<string, true>;
  /** Step index to resume at, for lessons in progress. */
  step: Record<string, number>;
  theme?: 'light' | 'dark';
};

const KEY = 'learn-linux:v1';
const EMPTY: Progress = { done: {}, step: {} };

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return { done: parsed.done ?? {}, step: parsed.step ?? {}, theme: parsed.theme };
  } catch {
    // Private mode or blocked storage: the app works, progress just is not kept.
    return EMPTY;
  }
}

let state = load();
const listeners = new Set<() => void>();

function update(next: Progress): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* see load() */
  }
  listeners.forEach((l) => l());
}

export const progress = {
  get: () => state,
  setStep(lessonId: string, step: number): void {
    update({ ...state, step: { ...state.step, [lessonId]: step } });
  },
  complete(lessonId: string): void {
    const step = { ...state.step };
    delete step[lessonId];
    update({ ...state, done: { ...state.done, [lessonId]: true }, step });
  },
  setTheme(theme: 'light' | 'dark'): void {
    update({ ...state, theme });
  },
  reset(): void {
    update({ ...EMPTY, theme: state.theme });
  },
};

export function useProgress(): Progress {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
