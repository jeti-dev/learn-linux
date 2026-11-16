import { Shell, type Chunk, type RunResult } from '../engine/shell/Shell';
import type { Lesson, SolutionStep, Step } from './types';

const text = (chunks: Chunk[], s: Chunk['s']) =>
  chunks
    .filter((c) => c.s === s)
    .map((c) => c.text)
    .join('')
    .replace(/\x1b\[[0-9;]*m/g, '');

/** What a terminal needs from whatever drives it: a lesson or the free-play sandbox. */
export interface TerminalHost {
  shell: Shell;
  run(line: string): RunResult;
  key(k: 'ctrl-c' | 'ctrl-z' | 'ctrl-l'): Chunk[];
  /** The editor closed. `content` is null when the learner quit without saving. */
  edited(path: string, content: string | null): string | null;
}

/** Free play: a shell with no lesson attached. */
export class SandboxHost implements TerminalHost {
  shell = new Shell();
  run(line: string): RunResult {
    return this.shell.run(line);
  }
  key(k: 'ctrl-c' | 'ctrl-z' | 'ctrl-l'): Chunk[] {
    return k === 'ctrl-c' ? this.shell.interrupt() : k === 'ctrl-z' ? this.shell.suspend() : [];
  }
  edited(path: string, content: string | null): string | null {
    return saveEdit(this.shell, path, content);
  }
}

function saveEdit(shell: Shell, path: string, content: string | null): string | null {
  if (content === null) return null;
  try {
    shell.fs.writeFile(path, content);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Runs one lesson: owns the shell, checks the current step after every action, and advances. */
export class LessonRunner implements TerminalHost {
  shell!: Shell;
  stepIndex = 0;
  /** Called whenever the current step changes. */
  onAdvance?: () => void;

  constructor(
    readonly lesson: Lesson,
    startStep = 0,
  ) {
    this.restart(startStep);
  }

  /** Fresh machine; replays reference solutions to reach `startStep`. */
  restart(startStep = 0): void {
    this.shell = new Shell();
    this.stepIndex = 0;
    if (this.lesson.cwd) this.shell.run(`cd ${this.lesson.cwd}`);
    this.lesson.setup?.(this.shell);
    this.shell.history.length = 0;
    this.lesson.steps[0]?.setup?.(this.shell);
    const target = Math.min(startStep, this.lesson.steps.length);
    const notify = this.onAdvance;
    this.onAdvance = undefined;
    while (this.stepIndex < target) {
      const before = this.stepIndex;
      for (const item of this.lesson.steps[before].solution) this.applySolution(item);
      if (this.stepIndex === before) break;
    }
    this.onAdvance = notify;
  }

  get step(): Step | undefined {
    return this.lesson.steps[this.stepIndex];
  }
  get finished(): boolean {
    return this.stepIndex >= this.lesson.steps.length;
  }

  private check(cmd: string, chunks: Chunk[], code: number): void {
    const step = this.step;
    if (!step) return;
    const sh = this.shell;
    const ok = step.validate({ shell: sh, fs: sh.localFs, sys: sh.sys, cmd, out: text(chunks, 'out'), err: text(chunks, 'err'), code });
    if (!ok) return;
    this.stepIndex++;
    this.step?.setup?.(sh);
    this.onAdvance?.();
  }

  run(line: string): RunResult {
    const result = this.shell.run(line);
    if (!result.incomplete && line.trim()) this.check((result.expanded ?? line).trim(), result.chunks, result.exitCode);
    return result;
  }

  key(k: 'ctrl-c' | 'ctrl-z' | 'ctrl-l'): Chunk[] {
    const chunks = k === 'ctrl-c' ? this.shell.interrupt() : k === 'ctrl-z' ? this.shell.suspend() : [];
    this.check(k === 'ctrl-c' ? '^C' : k === 'ctrl-z' ? '^Z' : '^L', chunks, this.shell.lastExit);
    return chunks;
  }

  edited(path: string, content: string | null): string | null {
    const error = saveEdit(this.shell, path, content);
    this.check(content === null ? ':q!' : ':wq', [], error ? 1 : 0);
    return error;
  }

  /** Perform one reference-solution action exactly as the learner would. */
  applySolution(item: SolutionStep): void {
    if (typeof item === 'string') {
      this.run(item);
    } else if ('key' in item) {
      this.key(item.key);
    } else {
      const action = this.shell.action;
      if (action?.type === 'edit') {
        this.shell.action = undefined;
        this.edited(action.path, item.edit);
      }
    }
  }
}
