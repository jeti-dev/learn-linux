import { COMMANDS } from '../commands';
import { COMMAND_PACKAGE } from '../mocks/system';
import { resolvePath } from '../fs/path';
import type { Shell } from './Shell';

export type Completion = { line: string; cursor: number; options: string[] };

const WRAPPERS = new Set(['sudo', 'xargs', 'time', 'man', 'which', 'type', 'command', 'env']);
const DIR_ONLY = new Set(['cd', 'rmdir', 'mkdir']);

function commonPrefix(items: string[]): string {
  let prefix = items[0] ?? '';
  for (const item of items) {
    while (!item.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

/** Tab completion for the word ending at the cursor: command names first, paths elsewhere. */
export function complete(sh: Shell, line: string, cursor: number): Completion {
  const before = line.slice(0, cursor);
  const after = line.slice(cursor);
  const wordStart = Math.max(0, ...[...before.matchAll(/(?<!\\)[\s|;&(<>]/g)].map((m) => m.index + 1));
  const word = before.slice(wordStart);
  const head = before.slice(0, wordStart);
  const prevWords = head.trim().split(/\s+/).filter(Boolean);
  const segment = head.split(/[|;&(]/).pop()!.trim().split(/\s+/).filter(Boolean);
  const commandPosition = segment.length === 0 || (segment.length === 1 && WRAPPERS.has(segment[0]));
  const unescaped = word.replace(/\\(.)/g, '$1');

  let candidates: { text: string; dir: boolean }[] = [];
  if (commandPosition && !word.includes('/')) {
    const names = new Set([
      ...Object.keys(COMMANDS).filter((n) => /^[a-z]/.test(n) && (!COMMAND_PACKAGE[n] || sh.sys.packages.get(COMMAND_PACKAGE[n])?.installed)),
      ...Object.keys(sh.aliases),
      ...Object.keys(sh.functions),
    ]);
    candidates = [...names].filter((n) => n.startsWith(unescaped)).sort().map((text) => ({ text, dir: false }));
  }
  if (!candidates.length) {
    const slash = unescaped.lastIndexOf('/');
    const dirPart = slash >= 0 ? unescaped.slice(0, slash + 1) : '';
    const base = unescaped.slice(slash + 1);
    const home = sh.vars.HOME ?? '/';
    const dirAbs = resolvePath(sh.cwd, dirPart.replace(/^~(?=\/|$)/, home) || '.');
    let names: string[] = [];
    try {
      names = sh.fs.readdir(dirAbs);
    } catch {
      /* nothing to complete in an unreadable directory */
    }
    const dirOnly = DIR_ONLY.has(segment[0] ?? prevWords[0] ?? '');
    candidates = names
      .filter((n) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.')))
      .map((n) => ({ text: dirPart + n, dir: sh.fs.isDir(resolvePath(dirAbs, n)) }))
      .filter((c) => !dirOnly || c.dir);
  }
  if (!candidates.length) return { line, cursor, options: [] };

  const escape = (s: string) => s.replace(/([ '"$&|;()<>*?])/g, '\\$1');
  let replacement: string;
  let options: string[] = [];
  if (candidates.length === 1) {
    replacement = escape(candidates[0].text) + (candidates[0].dir ? '/' : ' ');
  } else {
    replacement = escape(commonPrefix(candidates.map((c) => c.text)));
    if (replacement.length <= word.length) replacement = word;
    options = candidates.map((c) => c.text.slice(c.text.lastIndexOf('/') + 1) + (c.dir ? '/' : ''));
  }
  const newBefore = head + replacement;
  const rest = replacement.endsWith(' ') && after.startsWith(' ') ? after.slice(1) : after;
  return { line: newBefore + rest, cursor: newBefore.length, options };
}
