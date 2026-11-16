import { FsError } from '../fs/VirtualFS';
import { format, makeRegex } from './regex';
import { guard, lines, parseArgs, readInputs, usage, type CommandFn, type Ctx } from './types';

const joinLines = (ls: string[]) => (ls.length ? ls.join('\n') + '\n' : '');

function readAll(ctx: Ctx, files: string[]): string | null {
  const inputs = readInputs(ctx, files);
  return inputs ? inputs.map((i) => (i.text && !i.text.endsWith('\n') ? i.text + '\n' : i.text)).join('') : null;
}

const HUMAN: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

const sort: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'rnufhbV', ['k', 't', 'o']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const text = readAll(ctx, p.rest);
  if (text === null) return 2;
  const keySpec = f.k !== undefined ? /^(\d+)(?:,(\d+))?([nrh]*)$/.exec(String(f.k)) : null;
  if (f.k !== undefined && !keySpec) return usage(ctx, `invalid key specification '${f.k}'`);
  const numeric = !!f.n || !!keySpec?.[3].includes('n');
  const humanNum = !!f.h || !!keySpec?.[3].includes('h');
  const reverse = !!f.r || !!keySpec?.[3].includes('r');
  const key = (line: string): string => {
    if (!keySpec) return line;
    const fields = f.t !== undefined ? line.split(String(f.t)) : line.trim().split(/\s+/);
    const from = Number(keySpec[1]) - 1;
    const to = keySpec[2] ? Number(keySpec[2]) : fields.length;
    return fields.slice(from, to).join(' ');
  };
  const num = (s: string): number => {
    const m = /^\s*(-?\d*\.?\d+)([KMGT]?)/.exec(s);
    return m ? parseFloat(m[1]) * (humanNum && m[2] ? HUMAN[m[2]] : 1) : 0;
  };
  const cmp = (a: string, b: string): number => {
    const ka = key(a);
    const kb = key(b);
    if (numeric || humanNum) return num(ka) - num(kb);
    if (f.f) return ka.toLowerCase().localeCompare(kb.toLowerCase());
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  let ls = lines(text)
    .map((line, idx) => ({ line, idx }))
    .sort((a, b) => cmp(a.line, b.line) || a.idx - b.idx)
    .map((x) => x.line);
  if (reverse) ls.reverse();
  if (f.u) ls = ls.filter((l, i) => i === 0 || cmp(l, ls[i - 1]) !== 0);
  const out = joinLines(ls);
  if (f.o !== undefined) return guard(ctx, String(f.o), () => ctx.fs.writeFile(ctx.shell.abs(String(f.o)), out)) ? 0 : 2;
  ctx.out(out);
  return 0;
};

const uniq: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'cdui');
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const text = readAll(ctx, p.rest.slice(0, 1));
  if (text === null) return 1;
  const groups: { line: string; count: number }[] = [];
  for (const line of lines(text)) {
    const last = groups[groups.length - 1];
    if (last && (f.i ? last.line.toLowerCase() === line.toLowerCase() : last.line === line)) last.count++;
    else groups.push({ line, count: 1 });
  }
  ctx.out(
    joinLines(
      groups
        .filter((g) => (f.d ? g.count > 1 : f.u ? g.count === 1 : true))
        .map((g) => (f.c ? `${String(g.count).padStart(7)} ${g.line}` : g.line)),
    ),
  );
  return 0;
};

const wc: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'lwcmL');
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const all = !f.l && !f.w && !f.c && !f.m;
  const inputs = readInputs(ctx, p.rest);
  if (!inputs) return 1;
  const rows = inputs.map((input) => {
    const counts: number[] = [];
    if (all || f.l) counts.push((input.text.match(/\n/g) ?? []).length);
    if (all || f.w) counts.push(input.text.split(/\s+/).filter(Boolean).length);
    if (all || f.c || f.m) counts.push(new TextEncoder().encode(input.text).length);
    return { counts, name: p.rest.length ? input.name : '' };
  });
  if (rows.length > 1) rows.push({ counts: rows[0].counts.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0)), name: 'total' });
  const single = rows.length === 1 && rows[0].counts.length === 1;
  const width = single ? 0 : Math.max(...rows.flatMap((r) => r.counts.map((c) => String(c).length)), p.rest.length ? 1 : 7);
  for (const r of rows) ctx.out(r.counts.map((c) => String(c).padStart(width)).join(' ') + (r.name ? ' ' + r.name : '') + '\n');
  return inputs.length < Math.max(1, p.rest.length) ? 1 : 0;
};

/** Parse a list like `1,3-5,7-` into a predicate over 1-based positions. */
function rangeList(spec: string): ((n: number) => boolean) | null {
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : Infinity) : from;
    ranges.push([from, to]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

const cut: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 's', ['d', 'f', 'c', 'output-delimiter']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  if (f.f === undefined && f.c === undefined) return usage(ctx, 'you must specify a list of bytes, characters, or fields', 1);
  const sel = rangeList(String(f.f ?? f.c));
  if (!sel) return usage(ctx, 'invalid field value', 1);
  const text = readAll(ctx, p.rest);
  if (text === null) return 1;
  const delim = f.d !== undefined ? String(f.d) : '\t';
  const outDelim = f['output-delimiter'] !== undefined ? String(f['output-delimiter']) : delim;
  ctx.out(
    joinLines(
      lines(text).flatMap((line) => {
        if (f.c !== undefined) return [[...line].filter((_, i) => sel(i + 1)).join('')];
        if (!line.includes(delim)) return f.s ? [] : [line];
        return [line.split(delim).filter((_, i) => sel(i + 1)).join(outDelim)];
      }),
    ),
  );
  return 0;
};

function expandSet(spec: string): string[] {
  const classes: Record<string, string> = {
    '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
    '[:digit:]': '0123456789',
    '[:space:]': ' \t\n\r',
    '[:alpha:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    '[:alnum:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    '[:punct:]': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  };
  const out: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    const cls = Object.keys(classes).find((k) => spec.startsWith(k, i));
    if (cls) {
      out.push(...classes[cls]);
      i += cls.length - 1;
    } else if (spec[i] === '\\' && i + 1 < spec.length) {
      const n = spec[++i];
      out.push(n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n);
    } else if (spec[i + 1] === '-' && i + 2 < spec.length) {
      for (let c = spec.charCodeAt(i); c <= spec.charCodeAt(i + 2); c++) out.push(String.fromCharCode(c));
      i += 2;
    } else out.push(spec[i]);
  }
  return out;
}

const tr: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'dsc');
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  if (!p.rest.length) return usage(ctx, 'missing operand', 1);
  const set1 = expandSet(p.rest[0]);
  const set2 = p.rest[1] !== undefined ? expandSet(p.rest[1]) : [];
  const in1 = (c: string) => set1.includes(c) !== !!f.c;
  let chars = [...ctx.stdin];
  if (f.d) chars = chars.filter((c) => !in1(c));
  else if (set2.length) chars = chars.map((c) => (in1(c) ? (set2[Math.min(f.c ? set2.length - 1 : set1.indexOf(c), set2.length - 1)] ?? c) : c));
  else if (!f.s) return usage(ctx, `missing operand after '${p.rest[0]}'`, 1);
  if (f.s) {
    const squeeze = f.d || !set2.length ? (set2.length ? set2 : set1) : set2;
    chars = chars.filter((c, i) => !(i > 0 && c === chars[i - 1] && squeeze.includes(c)));
  }
  ctx.out(chars.join(''));
  return 0;
};

const tee: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'ai');
  if (typeof p === 'string') return usage(ctx, p);
  let code = 0;
  for (const file of p.rest) {
    if (!guard(ctx, file, () => ctx.fs.writeFile(ctx.shell.abs(file), ctx.stdin, !!p.flags.a))) code = 1;
  }
  ctx.out(ctx.stdin);
  return code;
};

type Op = { t: ' ' | '-' | '+'; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ t: ' ', line: a[i] });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({ t: '-', line: a[i++] });
    else ops.push({ t: '+', line: b[j++] });
  }
  return ops;
}

const diff: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'uqrNi');
  if (typeof p === 'string') return usage(ctx, p);
  if (p.rest.length !== 2) return usage(ctx, `missing operand after '${p.rest[p.rest.length - 1] ?? 'diff'}'`);
  const texts: string[] = [];
  for (const file of p.rest) {
    try {
      texts.push(ctx.fs.readFile(ctx.shell.abs(file)));
    } catch (e) {
      ctx.err(`diff: ${file}: ${e instanceof FsError ? e.message : 'error'}\n`);
      return 2;
    }
  }
  if (texts[0] === texts[1]) return 0;
  if (p.flags.q) {
    ctx.out(`Files ${p.rest[0]} and ${p.rest[1]} differ\n`);
    return 1;
  }
  const ops = diffOps(lines(texts[0]), lines(texts[1]));
  if (p.flags.u) {
    ctx.out(`--- ${p.rest[0]}\n+++ ${p.rest[1]}\n`);
    const changed = ops.map((o, i) => (o.t === ' ' ? -1 : i)).filter((i) => i >= 0);
    let k = 0;
    while (k < changed.length) {
      let end = k;
      while (end + 1 < changed.length && changed[end + 1] - changed[end] <= 6) end++;
      const from = Math.max(0, changed[k] - 3);
      const to = Math.min(ops.length - 1, changed[end] + 3);
      const aStart = ops.slice(0, from).filter((o) => o.t !== '+').length + 1;
      const bStart = ops.slice(0, from).filter((o) => o.t !== '-').length + 1;
      const hunk = ops.slice(from, to + 1);
      ctx.out(`@@ -${aStart},${hunk.filter((o) => o.t !== '+').length} +${bStart},${hunk.filter((o) => o.t !== '-').length} @@\n`);
      ctx.out(hunk.map((o) => o.t + o.line + '\n').join(''));
      k = end + 1;
    }
    return 1;
  }
  let a = 0;
  let b = 0;
  for (let i = 0; i < ops.length; ) {
    if (ops[i].t === ' ') {
      a++;
      b++;
      i++;
      continue;
    }
    const del: string[] = [];
    const ins: string[] = [];
    while (i < ops.length && ops[i].t !== ' ') {
      (ops[i].t === '-' ? del : ins).push(ops[i].line);
      i++;
    }
    const range = (start: number, len: number) => (len > 1 ? `${start},${start + len - 1}` : String(start));
    if (del.length && ins.length) ctx.out(`${range(a + 1, del.length)}c${range(b + 1, ins.length)}\n`);
    else if (del.length) ctx.out(`${range(a + 1, del.length)}d${b}\n`);
    else ctx.out(`${a}a${range(b + 1, ins.length)}\n`);
    ctx.out(del.map((l) => `< ${l}\n`).join(''));
    if (del.length && ins.length) ctx.out('---\n');
    ctx.out(ins.map((l) => `> ${l}\n`).join(''));
    a += del.length;
    b += ins.length;
  }
  return 1;
};

// ------------------------------------------------------------------ sed

type Addr = { line?: number; last?: boolean; re?: RegExp };
type SedCmd = {
  a1?: Addr;
  a2?: Addr;
  negate: boolean;
  cmd: 's' | 'd' | 'p' | 'q' | 'a' | 'i';
  text?: string;
  re?: RegExp;
  replacement?: (m: string[]) => string;
  global?: boolean;
  print?: boolean;
  active?: boolean;
};

function parseSed(script: string, extended: boolean): SedCmd[] | string {
  const cmds: SedCmd[] = [];
  let i = 0;
  const readDelimited = (delim: string): string | null => {
    let out = '';
    while (i < script.length && script[i] !== delim) {
      if (script[i] === '\\' && i + 1 < script.length) {
        out += script[i + 1] === delim ? delim : script[i] + script[i + 1];
        i += 2;
      } else out += script[i++];
    }
    if (i >= script.length) return null;
    i++;
    return out;
  };
  const readAddr = (): Addr | undefined | string => {
    if (/\d/.test(script[i] ?? '')) {
      const m = /^\d+/.exec(script.slice(i))!;
      i += m[0].length;
      return { line: Number(m[0]) };
    }
    if (script[i] === '$') {
      i++;
      return { last: true };
    }
    if (script[i] === '/') {
      i++;
      const pat = readDelimited('/');
      if (pat === null) return 'unterminated address regex';
      try {
        return { re: makeRegex(pat, { extended }) };
      } catch {
        return `invalid regular expression: ${pat}`;
      }
    }
    return undefined;
  };
  while (i < script.length) {
    while (i < script.length && /[\s;]/.test(script[i])) i++;
    if (i >= script.length) break;
    const c: SedCmd = { negate: false, cmd: 'p' };
    const a1 = readAddr();
    if (typeof a1 === 'string') return a1;
    c.a1 = a1;
    if (a1 && script[i] === ',') {
      i++;
      const a2 = readAddr();
      if (typeof a2 === 'string') return a2;
      if (!a2) return 'unexpected `,\'';
      c.a2 = a2;
    }
    while (script[i] === ' ') i++;
    if (script[i] === '!') {
      c.negate = true;
      i++;
    }
    const ch = script[i++];
    if (ch === 's') {
      const delim = script[i++];
      if (!delim) return 'unterminated `s\' command';
      const pat = readDelimited(delim);
      const rep = pat === null ? null : readDelimited(delim);
      if (pat === null || rep === null) return 'unterminated `s\' command';
      const flags = /^[gipI]*/.exec(script.slice(i))![0];
      i += flags.length;
      try {
        c.re = makeRegex(pat, { extended, ignoreCase: /[iI]/.test(flags), global: flags.includes('g') });
      } catch {
        return `invalid regular expression: ${pat}`;
      }
      const repl = rep;
      c.replacement = (m) => {
        let out = '';
        for (let k = 0; k < repl.length; k++) {
          const r = repl[k];
          if (r === '&') out += m[0];
          else if (r === '\\' && k + 1 < repl.length) {
            const n = repl[++k];
            out += /\d/.test(n) ? (m[Number(n)] ?? '') : n === 'n' ? '\n' : n === 't' ? '\t' : n;
          } else out += r;
        }
        return out;
      };
      c.cmd = 's';
      c.print = flags.includes('p');
    } else if (ch === 'd' || ch === 'p' || ch === 'q') c.cmd = ch;
    else if (ch === 'a' || ch === 'i') {
      // GNU one-liner form: `2a text` / `1i text`; the text runs to the end of the line.
      const end = script.indexOf('\n', i);
      c.cmd = ch;
      c.text = script.slice(i, end < 0 ? script.length : end).replace(/^\s*\\?\s*/, '');
      i = end < 0 ? script.length : end;
    } else return `command \`${ch ?? ''}' is not supported in this simulator (supported: s, d, p, q, a, i)`;
    cmds.push(c);
  }
  return cmds;
}

function sedRun(cmds: SedCmd[], text: string, quiet: boolean): string {
  const ls = lines(text);
  const out: string[] = [];
  for (const c of cmds) c.active = false;
  const hit = (a: Addr, n: number, line: string) => (a.line !== undefined ? a.line === n : a.last ? n === ls.length : a.re!.test(line));
  outer: for (let idx = 0; idx < ls.length; idx++) {
    let line = ls[idx];
    const n = idx + 1;
    let quit = false;
    const after: string[] = [];
    for (const c of cmds) {
      let selected = true;
      if (c.a1 && !c.a2) selected = hit(c.a1, n, line);
      else if (c.a1 && c.a2) {
        if (c.active) {
          selected = true;
          if (c.a2.line !== undefined ? n >= c.a2.line : hit(c.a2, n, line)) c.active = false;
        } else if (hit(c.a1, n, line)) {
          selected = true;
          c.active = !(c.a2.line !== undefined && c.a2.line <= n);
        } else selected = false;
      }
      if (selected === c.negate) continue;
      if (c.cmd === 'd') continue outer;
      if (c.cmd === 'p') out.push(line);
      if (c.cmd === 'i') out.push(c.text ?? '');
      if (c.cmd === 'a') after.push(c.text ?? '');
      if (c.cmd === 'q') {
        quit = true;
        break;
      }
      if (c.cmd === 's') {
        const re = c.re!;
        re.lastIndex = 0;
        if (re.test(line)) {
          re.lastIndex = 0;
          line = line.replace(re, (...m) => c.replacement!(m.slice(0, typeof m[m.length - 1] === 'object' ? -3 : -2) as string[]));
          if (c.print) out.push(line);
        }
      }
    }
    if (!quiet) out.push(line);
    out.push(...after);
    if (quit) break;
  }
  return joinLines(out);
}

const sed: CommandFn = (args, ctx) => {
  const scripts: string[] = [];
  const files: string[] = [];
  let quiet = false;
  let inPlace = false;
  let extended = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n') quiet = true;
    else if (a === '-E' || a === '-r') extended = true;
    else if (a === '-i' || a.startsWith('-i.') || a === '--in-place') inPlace = true;
    else if (a === '-e') scripts.push(args[++i] ?? '');
    else if (/^-[nEri]+$/.test(a)) {
      quiet ||= a.includes('n');
      extended ||= /[Er]/.test(a);
      inPlace ||= a.includes('i');
    } else if (a.startsWith('-') && a.length > 1) return usage(ctx, `invalid option -- '${a.slice(1)}'`, 1);
    else if (!scripts.length) scripts.push(a);
    else files.push(a);
  }
  if (!scripts.length) return usage(ctx, 'no script specified', 1);
  const cmds = parseSed(scripts.join('\n'), extended);
  if (typeof cmds === 'string') {
    ctx.err(`sed: -e expression #1: ${cmds}\n`);
    return 1;
  }
  if (inPlace) {
    if (!files.length) return usage(ctx, 'no input files', 1);
    let code = 0;
    for (const file of files) {
      const abs = ctx.shell.abs(file);
      if (!guard(ctx, `can't read ${file}`, () => ctx.fs.writeFile(abs, sedRun(cmds, ctx.fs.readFile(abs), quiet)))) code = 2;
    }
    return code;
  }
  const text = readAll(ctx, files);
  if (text === null) return 2;
  ctx.out(sedRun(cmds, text, quiet));
  return 0;
};

const seq: CommandFn = (args, ctx) => {
  const nums = args.filter((a) => !/^-[sw]/.test(a)).map(Number);
  if (!nums.length || nums.some(Number.isNaN)) return usage(ctx, 'missing or invalid operand', 1);
  const [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  if (step === 0 || Math.abs((last - first) / step) > 100000) return usage(ctx, 'invalid range', 1);
  const out: string[] = [];
  for (let v = first; step > 0 ? v <= last : v >= last; v += step) out.push(String(v));
  ctx.out(joinLines(out));
  return 0;
};

const printf: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'usage: printf format [arguments]');
  const [fmt, ...rest] = args;
  const perRound = (fmt.match(/%(?!%)/g) ?? []).length;
  if (!perRound || !rest.length) ctx.out(format(fmt, rest));
  else for (let i = 0; i < rest.length; i += perRound) ctx.out(format(fmt, rest.slice(i, i + perRound)));
  return 0;
};

const nl: CommandFn = (args, ctx) => {
  const text = readAll(ctx, args.filter((a) => !a.startsWith('-')));
  if (text === null) return 1;
  let n = 0;
  ctx.out(joinLines(lines(text).map((l) => (l ? `${String(++n).padStart(6)}\t${l}` : ''))));
  return 0;
};

export const textCommands: Record<string, CommandFn> = {
  sort,
  uniq,
  wc,
  cut,
  tr,
  tee,
  diff,
  sed,
  seq,
  printf,
  nl,
  rev: (args, ctx) => {
    const text = readAll(ctx, args);
    if (text === null) return 1;
    ctx.out(joinLines(lines(text).map((l) => [...l].reverse().join(''))));
  },
};
