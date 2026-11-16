import { FsError, type VirtualFS } from '../fs/VirtualFS';
import type { System } from '../mocks/system';
import type { IO, Shell } from '../shell/Shell';

export interface Ctx {
  shell: Shell;
  fs: VirtualFS;
  sys: System;
  stdin: string;
  /** True when stdout goes to the terminal (not a pipe or file). */
  tty: boolean;
  /** Name the command was invoked as, for error messages. */
  name: string;
  out(s: string): void;
  err(s: string): void;
  io: IO;
}

/** A command writes to ctx.out / ctx.err and returns its exit code (default 0). */
export type CommandFn = (args: string[], ctx: Ctx) => number | void;

export type Parsed = { flags: Record<string, string | true>; rest: string[] };

/**
 * Parse short and long options.
 * `bools` lists single-letter flags; `values` lists options taking a value (short letters or long names).
 * Returns an error string for an unknown option.
 */
export function parseArgs(args: string[], bools: string, values: string[] = [], longBools: string[] = []): Parsed | string {
  const flags: Parsed['flags'] = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      if (values.includes(name)) flags[name] = eq < 0 ? (args[++i] ?? '') : a.slice(eq + 1);
      else if (longBools.includes(name)) flags[name] = true;
      else return `unrecognized option '--${name}'`;
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d+(\.\d+)?$/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (values.includes(ch)) {
          flags[ch] = a.slice(j + 1) || (args[++i] ?? '');
          break;
        } else if (bools.includes(ch)) flags[ch] = true;
        else return `invalid option -- '${ch}'`;
      }
    } else rest.push(a);
  }
  return { flags, rest };
}

/** Print a usage error in the common GNU style. */
export function usage(ctx: Ctx, msg: string, code = 2): number {
  ctx.err(`${ctx.name}: ${msg}\nTry '${ctx.name} --help' for more information.\n`);
  return code;
}

/** Run fn; on a filesystem error print `name: <what>: <reason>` and return false. */
export function guard(ctx: Ctx, what: string, fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof FsError) {
      ctx.err(`${ctx.name}: ${what}: ${e.message}\n`);
      return false;
    }
    throw e;
  }
}

/** Read each operand (or stdin when none / `-`), reporting errors per file. */
export function readInputs(ctx: Ctx, files: string[]): { name: string; text: string }[] | null {
  if (!files.length) return [{ name: '', text: ctx.stdin }];
  const inputs: { name: string; text: string }[] = [];
  let ok = true;
  for (const f of files) {
    if (f === '-') inputs.push({ name: '(standard input)', text: ctx.stdin });
    else if (!guard(ctx, f, () => inputs.push({ name: f, text: ctx.fs.readFile(ctx.shell.abs(f)) }))) ok = false;
  }
  return ok || inputs.length ? inputs : null;
}

/** Split text into lines, without a trailing empty entry. */
export function lines(text: string): string[] {
  if (!text) return [];
  const out = text.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
}

export const C = {
  blue: (s: string) => `\x1b[1;34m${s}\x1b[0m`,
  green: (s: string) => `\x1b[1;32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[1;36m${s}\x1b[0m`,
  red: (s: string) => `\x1b[1;31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
};
