import type { VirtualFS } from '../engine/fs/VirtualFS';
import type { System } from '../engine/mocks/system';
import type { Shell } from '../engine/shell/Shell';

/** What a validator can inspect after each action in the terminal. */
export type CheckState = {
  shell: Shell;
  /** Filesystem of the learner's own machine, even while connected over ssh. */
  fs: VirtualFS;
  sys: System;
  /** The command line that just ran (after history expansion), or a key such as `^C`, `^Z`, `^L`, `:wq`, `:q!`. */
  cmd: string;
  out: string;
  err: string;
  code: number;
};

export type Validator = (s: CheckState) => boolean;

/** One action of a reference solution. Strings are typed commands. */
export type SolutionStep =
  | string
  | { label: string; key: 'ctrl-c' | 'ctrl-z' | 'ctrl-l' }
  /** Content to save in the editor that the previous command opened; null quits without saving. */
  | { label: string; edit: string | null };

export type Step = {
  /** Short markdown: paragraphs, `code` (tappable), **bold**, "- " lists. */
  explain: string;
  /** What to achieve, phrased as an outcome. */
  task: string;
  hints: string[];
  /** Reference solution: shown on request, replayed by tests and when resuming a lesson. */
  solution: SolutionStep[];
  validate: Validator;
  setup?: (sh: Shell) => void;
};

export type Lesson = {
  id: string;
  title: string;
  summary: string;
  /** Starting directory; defaults to the home directory. */
  cwd?: string;
  setup?: (sh: Shell) => void;
  steps: Step[];
};

export type Module = {
  id: string;
  title: string;
  summary: string;
  lessons: Lesson[];
  /** Challenge modules give tasks without walkthroughs. */
  challenge?: boolean;
};
