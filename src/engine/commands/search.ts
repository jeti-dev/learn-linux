import type { FsNode } from '../fs/VirtualFS';
import { basename, join } from '../fs/path';
import { matchGlob } from '../shell/expand';
import { sizeOf } from './files';
import { makeRegex } from './regex';
import { C, lines, parseArgs, usage, type CommandFn } from './types';

const grep: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'ivnclrREFowqhHsxP', ['e', 'A', 'B', 'C', 'm', 'include', 'exclude', 'exclude-dir', 'color', 'colour']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const rest = [...p.rest];
  const pattern = f.e !== undefined ? String(f.e) : rest.shift();
  if (pattern === undefined) return usage(ctx, 'Usage: grep [OPTION]... PATTERNS [FILE]...');
  const mode = ctx.name === 'egrep' ? { E: true } : ctx.name === 'fgrep' ? { F: true } : {};
  let re: RegExp;
  try {
    re = makeRegex(pattern, { extended: !!(f.E || f.P || 'E' in mode), fixed: !!(f.F || 'F' in mode), ignoreCase: !!f.i, word: !!f.w, line: !!f.x, global: true });
  } catch {
    ctx.err(`grep: Invalid regular expression: ${pattern}\n`);
    return 2;
  }
  const recursive = !!(f.r || f.R);
  const before = Number(f.B ?? f.C ?? 0);
  const after = Number(f.A ?? f.C ?? 0);
  const max = f.m !== undefined ? Number(f.m) : Infinity;
  let errors = false;

  const inputs: { name: string; text: string }[] = [];
  const addFile = (shown: string, abs: string) => {
    try {
      inputs.push({ name: shown, text: ctx.fs.readFile(abs) });
    } catch (e) {
      if (!f.s) ctx.err(`grep: ${shown}: ${(e as Error).message}\n`);
      errors = true;
    }
  };
  const walk = (shown: string, abs: string) => {
    const node = ctx.fs.lookup(abs);
    if (!node) return;
    if (node.type === 'file') {
      const name = basename(abs);
      if (f.include && !matchGlob(String(f.include), name)) return;
      if (f.exclude && matchGlob(String(f.exclude), name)) return;
      addFile(shown, abs);
    } else if (node.type === 'dir') {
      if (f['exclude-dir'] && matchGlob(String(f['exclude-dir']), basename(abs))) return;
      let names: string[];
      try {
        names = ctx.fs.readdir(abs);
      } catch (e) {
        if (!f.s) ctx.err(`grep: ${shown}: ${(e as Error).message}\n`);
        errors = true;
        return;
      }
      for (const n of names) walk(shown ? join(shown, n) : n, join(abs, n));
    }
  };

  if (!rest.length && !recursive) inputs.push({ name: '(standard input)', text: ctx.stdin });
  else if (!rest.length) walk('', ctx.shell.cwd);
  for (const t of rest) {
    const abs = ctx.shell.abs(t);
    const node = ctx.fs.lookup(abs);
    if (!node) {
      if (!f.s) ctx.err(`grep: ${t}: No such file or directory\n`);
      errors = true;
    } else if (node.type === 'dir') {
      if (recursive) walk(t, abs);
      else {
        ctx.err(`grep: ${t}: Is a directory\n`);
        errors = true;
      }
    } else addFile(t, abs);
  }

  const showName = f.H ? true : f.h ? false : inputs.length > 1 || recursive;
  const color = ctx.tty || f.color === 'always';
  let any = false;
  for (const input of inputs) {
    const ls = lines(input.text);
    const hits: number[] = [];
    for (let i = 0; i < ls.length && hits.length < max; i++) {
      re.lastIndex = 0;
      if (re.test(ls[i]) !== !!f.v) hits.push(i);
    }
    if (hits.length) any = true;
    if (f.q) continue;
    const prefix = (sep: string) => (showName ? (color ? C.magenta(input.name) + C.cyan(sep) : input.name + sep) : '');
    if (f.c) {
      ctx.out(`${prefix(':')}${hits.length}\n`);
      continue;
    }
    if (f.l) {
      if (hits.length) ctx.out((color ? C.magenta(input.name) : input.name) + '\n');
      continue;
    }
    const hitSet = new Set(hits);
    let lastPrinted = -1;
    for (const h of hits) {
      for (let i = Math.max(h - before, lastPrinted + 1); i <= Math.min(h + after, ls.length - 1); i++) {
        if (i <= lastPrinted) continue;
        if ((before || after) && lastPrinted >= 0 && i > lastPrinted + 1) ctx.out('--\n');
        const isHit = hitSet.has(i);
        const sep = isHit ? ':' : '-';
        const num = f.n ? (color ? C.green(String(i + 1)) + C.cyan(sep) : `${i + 1}${sep}`) : '';
        if (isHit && f.o && !f.v) {
          re.lastIndex = 0;
          for (const m of ls[i].matchAll(re)) if (m[0]) ctx.out(`${prefix(sep)}${num}${color ? C.red(m[0]) : m[0]}\n`);
        } else {
          const text = isHit && color && !f.v ? ls[i].replace(re, (m) => (m ? C.red(m) : m)) : ls[i];
          ctx.out(`${prefix(sep)}${num}${text}\n`);
        }
        lastPrinted = i;
      }
    }
  }
  return errors ? 2 : any ? 0 : 1;
};

type Pred = (path: string, node: FsNode, depth: number) => boolean;

const find: CommandFn = (args, ctx) => {
  const starts: string[] = [];
  let i = 0;
  while (i < args.length && !/^(-|!$|\($)/.test(args[i])) starts.push(args[i++]);
  if (!starts.length) starts.push('.');

  const preds: Pred[] = [];
  let maxDepth = Infinity;
  let minDepth = 0;
  let action: 'print' | 'delete' | 'exec' = 'print';
  let execArgv: string[] = [];
  let execBatch = false;
  let negate = false;
  const add = (pr: Pred) => {
    const neg = negate;
    negate = false;
    preds.push(neg ? (a, b, c) => !pr(a, b, c) : pr);
  };
  const need = (opt: string): string | null => {
    if (i >= args.length) {
      ctx.err(`find: missing argument to \`${opt}'\n`);
      return null;
    }
    return args[i++];
  };
  const compare = (spec: string, value: number) => {
    const n = parseFloat(spec.replace(/^[+-]/, ''));
    return spec.startsWith('+') ? value > n : spec.startsWith('-') ? value < n : value === n;
  };

  while (i < args.length) {
    const opt = args[i++];
    let v: string | null;
    switch (opt) {
      case '!':
      case '-not':
        negate = !negate;
        break;
      case '-a':
      case '-and':
        break;
      case '-name':
      case '-iname':
        if ((v = need(opt)) === null) return 1;
        {
          const pat = v;
          const flags = opt === '-iname' ? 'i' : '';
          add((path) => matchGlob(pat, basename(path), flags));
        }
        break;
      case '-path':
        if ((v = need(opt)) === null) return 1;
        {
          const pat = v;
          add((path) => matchGlob(pat, path));
        }
        break;
      case '-type':
        if ((v = need(opt)) === null) return 1;
        {
          const t = v === 'f' ? 'file' : v === 'd' ? 'dir' : v === 'l' ? 'symlink' : '';
          if (!t) {
            ctx.err(`find: Unknown argument to -type: ${v}\n`);
            return 1;
          }
          add((_, node) => node.type === t);
        }
        break;
      case '-maxdepth':
        if ((v = need(opt)) === null) return 1;
        maxDepth = Number(v);
        break;
      case '-mindepth':
        if ((v = need(opt)) === null) return 1;
        minDepth = Number(v);
        break;
      case '-size':
        if ((v = need(opt)) === null) return 1;
        {
          const m = /^([+-]?\d+)([ckMG]?)$/.exec(v);
          if (!m) {
            ctx.err(`find: Invalid argument \`${v}' to -size\n`);
            return 1;
          }
          const unit = { c: 1, k: 1024, M: 1048576, G: 1073741824, '': 512 }[m[2]] ?? 512;
          const spec = m[1];
          add((_, node) => compare(spec, Math.ceil(sizeOf(node) / unit)));
        }
        break;
      case '-mtime':
      case '-mmin':
        if ((v = need(opt)) === null) return 1;
        {
          const spec = v;
          const unit = opt === '-mtime' ? 86400000 : 60000;
          add((_, node) => compare(spec, Math.floor((ctx.fs.now() - node.mtime) / unit)));
        }
        break;
      case '-empty':
        add((_, node) => (node.type === 'dir' ? !Object.keys(node.children).length : node.type === 'file' && !node.content));
        break;
      case '-user':
        if ((v = need(opt)) === null) return 1;
        {
          const user = v;
          add((_, node) => node.owner === user);
        }
        break;
      case '-perm':
        if ((v = need(opt)) === null) return 1;
        {
          const mode = parseInt(v.replace(/^[-/]/, ''), 8);
          const any = v.startsWith('/');
          const all = v.startsWith('-');
          add((_, node) => (any ? (node.mode & mode) !== 0 : all ? (node.mode & mode) === mode : (node.mode & 0o777) === mode));
        }
        break;
      case '-print':
        action = 'print';
        break;
      case '-delete':
        action = 'delete';
        break;
      case '-exec': {
        const end = args.findIndex((a, j) => j >= i && (a === ';' || a === '+'));
        if (end < 0) {
          ctx.err("find: missing argument to `-exec'\n");
          return 1;
        }
        execArgv = args.slice(i, end);
        execBatch = args[end] === '+';
        action = 'exec';
        i = end + 1;
        break;
      }
      case '-o':
      case '-or':
      case '(':
      case ')':
        ctx.err(`find: \`${opt}' is not supported in this simulator; run find twice instead\n`);
        return 1;
      default:
        ctx.err(`find: unknown predicate \`${opt}'\n`);
        return 1;
    }
  }

  const found: string[] = [];
  let code = 0;
  const visit = (path: string, abs: string, depth: number) => {
    const node = ctx.fs.lookup(abs, false);
    if (!node) return;
    const matches = depth >= minDepth && preds.every((pr) => pr(path, node, depth));
    if (matches && action !== 'delete') found.push(path);
    if (node.type === 'dir' && depth < maxDepth) {
      let names: string[];
      try {
        names = ctx.fs.readdir(abs);
      } catch {
        ctx.err(`find: '${path}': Permission denied\n`);
        code = 1;
        names = [];
      }
      for (const n of names) visit(join(path, n), join(abs, n), depth + 1);
    }
    if (matches && action === 'delete') found.push(path);
  };
  for (const s of starts) {
    const abs = ctx.shell.abs(s);
    if (!ctx.fs.lookup(abs, false)) {
      ctx.err(`find: '${s}': No such file or directory\n`);
      code = 1;
      continue;
    }
    visit(s, abs, 0);
  }

  if (action === 'print') {
    if (found.length) ctx.out(found.join('\n') + '\n');
  } else if (action === 'delete') {
    for (const path of found) {
      try {
        ctx.fs.remove(ctx.shell.abs(path));
      } catch (e) {
        ctx.err(`find: cannot delete '${path}': ${(e as Error).message}\n`);
        code = 1;
      }
    }
  } else {
    const run = (paths: string[]) => {
      const argv = execArgv.some((a) => a.includes('{}')) ? execArgv.flatMap((a) => (a === '{}' ? paths : [a.replace(/\{\}/g, paths[0])])) : [...execArgv, ...paths];
      if (ctx.shell.execArgv(argv, { ...ctx.io, stdin: '' }) !== 0) code = 1;
    };
    if (execBatch) {
      if (found.length) run(found);
    } else for (const path of found) run([path]);
  }
  return code;
};

const xargs: CommandFn = (args, ctx) => {
  // Only parse options that appear before the command to run.
  let i = 0;
  let perCall = Infinity;
  let replace: string | null = null;
  let nul = false;
  let noRunIfEmpty = false;
  let trace = false;
  let delim: string | null = null;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    const a = args[i];
    if (a === '-n') perCall = Number(args[++i]);
    else if (/^-n\d+$/.test(a)) perCall = Number(a.slice(2));
    else if (a === '-I') replace = args[++i];
    else if (a.startsWith('-I') && a.length > 2) replace = a.slice(2);
    else if (a === '-0') nul = true;
    else if (a === '-r') noRunIfEmpty = true;
    else if (a === '-t') trace = true;
    else if (a === '-d') delim = args[++i].replace('\\n', '\n');
    else if (a === '-P') i++;
    else return usage(ctx, `invalid option -- '${a.slice(1)}'`, 1);
  }
  const command = args.slice(i);
  if (!command.length) command.push('echo');
  const items = (replace !== null || delim === '\n' ? ctx.stdin.split('\n') : nul ? ctx.stdin.split('\0') : ctx.stdin.split(delim ?? /\s+/)).filter((s) => s !== '');
  let code = 0;
  const run = (argv: string[]) => {
    if (trace) ctx.err(argv.join(' ') + '\n');
    const c = ctx.shell.execArgv(argv, { ...ctx.io, stdin: '' });
    if (c === 127) code = 127;
    else if (c !== 0 && code !== 127) code = 123;
  };
  if (replace !== null) {
    const token = replace;
    for (const item of items) run(command.map((c) => c.split(token).join(item.trim())));
  } else if (!items.length) {
    if (!noRunIfEmpty) run(command);
  } else {
    const size = Number.isFinite(perCall) && perCall > 0 ? perCall : items.length;
    for (let j = 0; j < items.length; j += size) run([...command, ...items.slice(j, j + size)]);
  }
  return code;
};

export const searchCommands: Record<string, CommandFn> = { grep, egrep: grep, fgrep: grep, find, xargs };
