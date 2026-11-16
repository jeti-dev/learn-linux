import type { VirtualFS } from '../fs/VirtualFS';
import { resolvePath } from '../fs/path';
import type { Word } from './lexer';
import { ShellError, type Shell } from './Shell';

type Seg = { s: string; q: boolean };
type Piece = { s: string; exp: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeGlob = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&');
const hasGlob = (s: string) => /(^|[^\\])(\\\\)*[*?[]/.test(s);

/** Convert one glob path component to an anchored RegExp. */
export function globRe(pattern: string, flags = ''): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) re += escapeRe(pattern[++i]);
    else if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) re += '\\[';
      else {
        let body = pattern.slice(i + 1, end);
        if (body[0] === '!') body = '^' + body.slice(1);
        re += '[' + body.replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$', flags);
}

export function matchGlob(pattern: string, name: string, flags = ''): boolean {
  return globRe(pattern, flags).test(name);
}

/** Expand a glob pattern against the filesystem. Returns paths in the form they were typed. */
export function glob(fs: VirtualFS, cwd: string, pattern: string): string[] {
  const absolute = pattern.startsWith('/');
  const comps = pattern.split('/').filter(Boolean);
  let results = [absolute ? '/' : ''];
  for (const comp of comps) {
    const next: string[] = [];
    for (const base of results) {
      const add = (name: string) => next.push(base === '' ? name : base.endsWith('/') ? base + name : base + '/' + name);
      const dirAbs = resolvePath(cwd, base || '.');
      if (!hasGlob(comp)) {
        const name = comp.replace(/\\(.)/g, '$1');
        if (name === '.' || name === '..' || fs.lookup(resolvePath(dirAbs, name), false)) add(name);
        continue;
      }
      let names: string[] = [];
      try {
        names = fs.readdir(dirAbs);
      } catch {
        /* unreadable or not a directory: no matches */
      }
      const re = globRe(comp);
      for (const name of names) {
        if (name.startsWith('.') && !comp.startsWith('.')) continue;
        if (re.test(name)) add(name);
      }
    }
    results = next;
  }
  return results.filter((r) => r !== '' && !(absolute && r === '/' && comps.length));
}

function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (c === "'") {
      const end = text.indexOf("'", j + 1);
      if (end > 0) j = end;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return text.length - 1;
}

function arithmetic(sh: Shell, expr: string): string {
  const withValues = expandDollar(sh, expr)
    .map((p) => p.s)
    .join('')
    .replace(/[A-Za-z_]\w*/g, (name) => String(Number(sh.vars[name] ?? 0) || 0));
  if (!/^[\d\s+\-*/%()<>=!&|]*$/.test(withValues)) throw new ShellError(`bash: ${expr}: arithmetic syntax error`);
  try {
    const value = new Function(`return (${withValues || 0});`)() as number | boolean;
    return String(typeof value === 'boolean' ? Number(value) : Math.trunc(value));
  } catch {
    throw new ShellError(`bash: ${expr}: arithmetic syntax error`);
  }
}

function lookupVar(sh: Shell, name: string): string | undefined {
  if (/^\d+$/.test(name)) return name === '0' ? sh.scriptName : sh.positional[Number(name) - 1];
  switch (name) {
    case '?':
      return String(sh.lastExit);
    case '#':
      return String(sh.positional.length);
    case '@':
    case '*':
      return sh.positional.join(' ');
    case '$':
      return String(sh.sys.shellPid);
    case '!':
      return String(sh.lastBgPid || '');
    case 'PWD':
      return sh.cwd;
    case 'RANDOM':
      return String(Math.floor(Math.random() * 32768));
  }
  return sh.vars[name];
}

function valueOf(sh: Shell, name: string): string {
  const v = lookupVar(sh, name);
  if (v === undefined && sh.opts.nounset && !/^[@*]$/.test(name)) throw new ShellError(`bash: ${name}: unbound variable`, true);
  return v ?? '';
}

function param(sh: Shell, body: string): string {
  if (body.startsWith('#')) return String(valueOf(sh, body.slice(1)).length);
  const m = /^([A-Za-z_]\w*|\d+|[?#@*$!])(?:(:?[-=+])([\s\S]*))?$/.exec(body);
  if (!m) throw new ShellError(`bash: \${${body}}: bad substitution`);
  const [, name, op, arg] = m;
  if (!op) return valueOf(sh, name);
  const current = lookupVar(sh, name);
  const isSet = op.startsWith(':') ? !!current : current !== undefined;
  const alt = () => expandDollar(sh, arg).map((p) => p.s).join('');
  if (op.endsWith('+')) return isSet ? alt() : '';
  if (isSet) return current!;
  const value = alt();
  if (op.endsWith('=')) sh.vars[name] = value;
  return value;
}

/** Expand `$var`, `${var}`, `$(cmd)` and `$((expr))` in text. */
export function expandDollar(sh: Shell, text: string): Piece[] {
  const out: Piece[] = [];
  let lit = '';
  const flush = () => {
    if (lit) out.push({ s: lit, exp: false });
    lit = '';
  };
  const emit = (s: string) => {
    flush();
    out.push({ s, exp: true });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c !== '$' || n === undefined) {
      lit += c;
      i++;
    } else if (n === '(') {
      const end = matchParen(text, i + 1);
      const inner = text.slice(i + 2, end);
      if (inner.startsWith('(') && inner.endsWith(')')) emit(arithmetic(sh, inner.slice(1, -1)));
      else emit(sh.capture(inner));
      i = end + 1;
    } else if (n === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) throw new ShellError('bash: bad substitution: no closing `}`');
      emit(param(sh, text.slice(i + 2, end)));
      i = end + 1;
    } else if (/[A-Za-z_]/.test(n)) {
      const name = /^[A-Za-z_]\w*/.exec(text.slice(i + 1))![0];
      emit(valueOf(sh, name));
      i += 1 + name.length;
    } else if (/[0-9?#@*$!]/.test(n)) {
      emit(valueOf(sh, n));
      i += 2;
    } else {
      lit += c;
      i++;
    }
  }
  flush();
  return out;
}

function braces(segs: Seg[]): Seg[][] {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.q) continue;
    const m = /\{([^{}]*)\}/.exec(seg.s);
    if (!m) continue;
    let alts: string[] | null = null;
    const range = /^(-?\d+)\.\.(-?\d+)$/.exec(m[1]);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Math.abs(b - a) > 1000) continue;
      alts = [];
      for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? 1 : -1) alts.push(String(v));
    } else if (m[1].includes(',')) alts = m[1].split(',');
    if (!alts) continue;
    const pre = seg.s.slice(0, m.index);
    const post = seg.s.slice(m.index + m[0].length);
    return alts.flatMap((a) => braces([...segs.slice(0, i), { s: pre + a + post, q: false }, ...segs.slice(i + 1)]));
  }
  return [segs];
}

function globField(sh: Shell, segs: Seg[]): string[] {
  const plain = segs.map((s) => s.s).join('');
  if (!segs.some((s) => !s.q && /[*?[]/.test(s.s))) return [plain];
  const pattern = segs.map((s) => (s.q ? escapeGlob(s.s) : s.s)).join('');
  const matches = glob(sh.fs, sh.cwd, pattern);
  return matches.length ? matches : [plain];
}

/** Full word expansion: tilde, parameters, command substitution, field splitting, braces, globs. */
export function expandWord(sh: Shell, word: Word): string[] {
  const fields: Seg[][] = [];
  let cur: Seg[] | null = null;
  const push = (s: string, q: boolean) => {
    if (!cur) {
      cur = [];
      fields.push(cur);
    }
    cur.push({ s, q });
  };
  const brk = () => {
    cur = null;
  };

  word.parts.forEach((part, idx) => {
    if (part.q === 'single') {
      push(part.text, true);
    } else if (part.q === 'double') {
      if (part.text === '$@') {
        sh.positional.forEach((p, i) => {
          if (i) brk();
          push(p, true);
        });
      } else {
        push(expandDollar(sh, part.text).map((x) => x.s).join(''), true);
      }
    } else {
      let text = part.text;
      if (idx === 0 && (text === '~' || text.startsWith('~/'))) {
        push(sh.vars.HOME ?? '/', true);
        text = text.slice(1);
      }
      for (const piece of expandDollar(sh, text)) {
        if (!piece.exp) {
          push(piece.s, false);
          continue;
        }
        const words = piece.s.split(/[ \t\n]+/).filter(Boolean);
        if (/^[ \t\n]/.test(piece.s)) brk();
        words.forEach((w, i) => {
          if (i) brk();
          push(w, false);
        });
        if (words.length && /[ \t\n]$/.test(piece.s)) brk();
      }
    }
  });
  return fields.flatMap(braces).flatMap((f) => globField(sh, f));
}

/** Expansion without field splitting or globbing: for assignments and redirect targets. */
export function expandSingle(sh: Shell, word: Word): string {
  return word.parts
    .map((part, idx) => {
      if (part.q === 'single') return part.text;
      let text = part.text;
      let prefix = '';
      if (part.q === 'none' && idx === 0 && (text === '~' || text.startsWith('~/'))) {
        prefix = sh.vars.HOME ?? '/';
        text = text.slice(1);
      }
      return prefix + expandDollar(sh, text).map((x) => x.s).join('');
    })
    .join('');
}
