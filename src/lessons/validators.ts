import type { FsNode, VirtualFS } from '../engine/fs/VirtualFS';
import { resolvePath } from '../engine/fs/path';
import type { CheckState, Validator } from './types';

const HOME = '/home/dev';
/** Resolve a lesson path: `~/x` and relative paths are taken from the home directory. */
export const abs = (p: string) => resolvePath(HOME, p.replace(/^~(?=\/|$)/, HOME));

const node = (fs: VirtualFS, p: string): FsNode | undefined => fs.lookupRaw(abs(p));
/** File content regardless of permissions, or null. */
export const read = (fs: VirtualFS, p: string): string | null => {
  const n = node(fs, p);
  return n?.type === 'file' ? n.content : null;
};

export const all =
  (...vs: Validator[]): Validator =>
  (s) =>
    vs.every((v) => v(s));
export const any =
  (...vs: Validator[]): Validator =>
  (s) =>
    vs.some((v) => v(s));
export const not =
  (v: Validator): Validator =>
  (s) =>
    !v(s);

/** The command line matches and exited successfully. */
export const ran =
  (re: RegExp): Validator =>
  (s) =>
    re.test(s.cmd) && s.code === 0;
/** The command line matches, whatever the exit code. */
export const tried =
  (re: RegExp): Validator =>
  (s) =>
    re.test(s.cmd);
export const failed: Validator = (s) => s.code !== 0;
export const exitCode =
  (code: number): Validator =>
  (s) =>
    s.code === code;
export const key =
  (k: '^C' | '^Z' | '^L' | ':wq' | ':q!'): Validator =>
  (s) =>
    s.cmd === k;

export const outHas =
  (what: RegExp | string): Validator =>
  (s) =>
    typeof what === 'string' ? s.out.includes(what) : what.test(s.out);
export const outIs =
  (expected: string | ((s: CheckState) => string)): Validator =>
  (s) =>
    s.out.trim() === (typeof expected === 'string' ? expected : expected(s)).trim();
export const outLines =
  (n: number): Validator =>
  (s) =>
    s.out.split('\n').filter(Boolean).length === n;

export const cwdIs =
  (p: string): Validator =>
  (s) =>
    s.shell.remoteDepth === 0 && s.shell.cwd === abs(p);

export const exists =
  (p: string): Validator =>
  (s) =>
    node(s.fs, p) !== undefined;
export const isDir =
  (p: string): Validator =>
  (s) =>
    node(s.fs, p)?.type === 'dir';
export const isFile =
  (p: string): Validator =>
  (s) =>
    node(s.fs, p)?.type === 'file';
export const missing =
  (p: string): Validator =>
  (s) =>
    node(s.fs, p) === undefined;
export const fileHas =
  (p: string, re: RegExp): Validator =>
  (s) =>
    re.test(read(s.fs, p) ?? '\u0000missing');
export const modeIs =
  (p: string, mode: number): Validator =>
  (s) =>
    ((node(s.fs, p)?.mode ?? -1) & 0o777) === mode;
export const executable =
  (p: string): Validator =>
  (s) =>
    ((node(s.fs, p)?.mode ?? 0) & 0o100) !== 0;
export const ownedBy =
  (p: string, owner: string): Validator =>
  (s) =>
    node(s.fs, p)?.owner === owner;

/** True when a file with this name exists anywhere below `root`. */
export const hasFileBelow =
  (root: string, name: string): Validator =>
  (s) => {
    const walk = (n: FsNode | undefined): boolean => n?.type === 'dir' && Object.entries(n.children).some(([k, child]) => k === name || walk(child));
    return walk(node(s.fs, root));
  };

export const listening =
  (port: number): Validator =>
  (s) =>
    s.shell.localSys.listening(port) !== undefined;
export const procGone =
  (pid: number): Validator =>
  (s) =>
    !s.shell.localSys.procs.some((p) => p.pid === pid);

/** Lines of text, without empty ones. */
export const linesOf = (text: string) => text.split('\n').filter(Boolean);
