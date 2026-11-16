import { X } from '../fs/VirtualFS';
import { resolvePath } from '../fs/path';
import { COMMAND_PACKAGE } from '../mocks/system';
import { ExitSignal, LoopSignal, ReturnSignal, shellQuote } from '../shell/Shell';
import { DOCS, helpText, manPage } from './man';
import { usage, type CommandFn, type Ctx } from './types';

/** Names handled by the shell itself rather than a program on disk. */
export const BUILTIN_NAMES = new Set([
  'cd', 'pwd', 'echo', 'export', 'unset', 'alias', 'unalias', 'source', '.', 'history', 'exit', 'logout', 'set', 'shift', 'return', 'break', 'continue',
  'local', 'declare', 'true', 'false', 'test', '[', '[[', 'type', 'command', 'jobs', 'fg', 'bg', 'help', 'read', ':',
]);

const cd: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  const operands = args.filter((a) => a !== '--');
  if (operands.length > 1) {
    ctx.err('bash: cd: too many arguments\n');
    return 1;
  }
  let target = operands[0] ?? sh.vars.HOME ?? '/';
  const print = target === '-';
  if (print) target = sh.vars.OLDPWD ?? sh.cwd;
  const abs = sh.abs(target);
  let reason = '';
  try {
    const node = ctx.fs.get(abs);
    if (node.type !== 'dir') reason = 'Not a directory';
    else if (!ctx.fs.can(node, X)) reason = 'Permission denied';
  } catch (e) {
    reason = (e as Error).message;
  }
  if (reason) {
    ctx.err(`bash: cd: ${target}: ${reason}\n`);
    return 1;
  }
  sh.vars.OLDPWD = sh.cwd;
  sh.cwd = abs;
  sh.vars.PWD = abs;
  if (print) ctx.out(abs + '\n');
  return 0;
};

const echo: CommandFn = (args, ctx) => {
  let newline = true;
  let escapes = false;
  let i = 0;
  for (; i < args.length && /^-[neE]+$/.test(args[i]); i++) {
    if (args[i].includes('n')) newline = false;
    if (args[i].includes('e')) escapes = true;
    if (args[i].includes('E')) escapes = false;
  }
  let text = args.slice(i).join(' ');
  if (escapes) text = text.replace(/\\(n|t|\\|e|033|x1b)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '\\' ? '\\' : '\x1b'));
  ctx.out(text + (newline ? '\n' : ''));
  return 0;
};

const assign = (ctx: Ctx, args: string[], exportIt: boolean): number => {
  let code = 0;
  for (const a of args) {
    const m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(a);
    if (!m) {
      ctx.err(`bash: ${ctx.name}: \`${a}': not a valid identifier\n`);
      code = 1;
      continue;
    }
    if (m[2] !== undefined) ctx.shell.vars[m[1]] = m[2];
    if (exportIt) ctx.shell.exported.add(m[1]);
  }
  return code;
};

const exportCmd: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  const operands = args.filter((a) => !/^-[pfn]$/.test(a));
  if (!operands.length) {
    for (const k of [...sh.exported].sort()) if (k in sh.vars) ctx.out(`declare -x ${k}="${sh.vars[k]}"\n`);
    return 0;
  }
  if (args.includes('-n')) {
    operands.forEach((k) => sh.exported.delete(k));
    return 0;
  }
  return assign(ctx, operands, true);
};

const envCmd: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  let i = 0;
  const extra: [string, string][] = [];
  for (; i < args.length; i++) {
    const m = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(args[i]);
    if (!m) break;
    extra.push([m[1], m[2]]);
  }
  if (i < args.length) {
    const saved = extra.map(([k]) => [k, sh.vars[k], sh.exported.has(k)] as const);
    for (const [k, v] of extra) {
      sh.vars[k] = v;
      sh.exported.add(k);
    }
    try {
      return sh.execArgv(args.slice(i), ctx.io);
    } finally {
      for (const [k, v, was] of saved) {
        if (v === undefined) delete sh.vars[k];
        else sh.vars[k] = v;
        if (!was) sh.exported.delete(k);
      }
    }
  }
  const vars = { ...Object.fromEntries([...sh.exported].filter((k) => k in sh.vars).map((k) => [k, sh.vars[k]])), PWD: sh.cwd, ...Object.fromEntries(extra) };
  ctx.out(Object.entries(vars).map(([k, v]) => `${k}=${v}\n`).join(''));
  return 0;
};

const printenv: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  if (!args.length) return envCmd([], ctx);
  let code = 0;
  for (const k of args) {
    if (sh.exported.has(k) && k in sh.vars) ctx.out(sh.vars[k] + '\n');
    else code = 1;
  }
  return code;
};

const alias: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  const show = (k: string) => ctx.out(`alias ${k}='${sh.aliases[k].replace(/'/g, `'\\''`)}'\n`);
  if (!args.length) {
    Object.keys(sh.aliases).sort().forEach(show);
    return 0;
  }
  let code = 0;
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) sh.aliases[a.slice(0, eq)] = a.slice(eq + 1);
    else if (a in sh.aliases) show(a);
    else {
      ctx.err(`bash: alias: ${a}: not found\n`);
      code = 1;
    }
  }
  return code;
};

/** Where a command name resolves to, as `type` reports it. */
function resolveCommand(ctx: Ctx, name: string): { kind: 'alias' | 'function' | 'builtin' | 'file'; detail: string } | null {
  const sh = ctx.shell;
  if (name in sh.aliases) return { kind: 'alias', detail: sh.aliases[name] };
  if (name in sh.functions) return { kind: 'function', detail: '' };
  if (BUILTIN_NAMES.has(name)) return { kind: 'builtin', detail: '' };
  const path = findOnPath(ctx, name);
  return path ? { kind: 'file', detail: path } : null;
}

function findOnPath(ctx: Ctx, name: string): string | null {
  const sh = ctx.shell;
  if (name.includes('/')) {
    const node = ctx.fs.lookup(sh.abs(name));
    return node?.type === 'file' && ctx.fs.can(node, X) ? name : null;
  }
  for (const dir of (sh.vars.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = resolvePath(sh.cwd, dir + '/' + name);
    const node = ctx.fs.lookup(candidate);
    if (node?.type === 'file' && ctx.fs.can(node, X)) return candidate;
  }
  return null;
}

const which: CommandFn = (args, ctx) => {
  let code = 0;
  for (const name of args.filter((a) => !a.startsWith('-'))) {
    const path = findOnPath(ctx, name);
    if (path && !(COMMAND_PACKAGE[name] && !ctx.sys.packages.get(COMMAND_PACKAGE[name])?.installed)) ctx.out(path + '\n');
    else code = 1;
  }
  return code;
};

const type: CommandFn = (args, ctx) => {
  let code = 0;
  for (const name of args.filter((a) => !a.startsWith('-'))) {
    const r = resolveCommand(ctx, name);
    if (!r) {
      ctx.err(`bash: type: ${name}: not found\n`);
      code = 1;
    } else if (r.kind === 'alias') ctx.out(`${name} is aliased to \`${r.detail}'\n`);
    else if (r.kind === 'function') ctx.out(`${name} is a function\n`);
    else if (r.kind === 'builtin') ctx.out(`${name} is a shell builtin\n`);
    else ctx.out(`${name} is ${r.detail}\n`);
  }
  return code;
};

const source: CommandFn = (args, ctx) => {
  if (!args.length) {
    ctx.err(`bash: ${ctx.name}: filename argument required\n`);
    return 2;
  }
  let content: string;
  try {
    content = ctx.fs.readFile(ctx.shell.abs(args[0]));
  } catch (e) {
    ctx.err(`bash: ${args[0]}: ${(e as Error).message}\n`);
    return 1;
  }
  return ctx.shell.source(content, args.slice(1), ctx.io);
};

const history: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  if (args[0] === '-c') {
    sh.history.length = 0;
    return 0;
  }
  const n = args[0] !== undefined ? Number(args[0]) : sh.history.length;
  const start = Math.max(0, sh.history.length - (Number.isNaN(n) ? sh.history.length : n));
  ctx.out(sh.history.slice(start).map((h, i) => `${String(start + i + 1).padStart(5)}  ${h}\n`).join(''));
  return 0;
};

const set: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  if (!args.length) {
    ctx.out(Object.entries(sh.vars).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${shellQuote(v)}\n`).join(''));
    return 0;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      sh.positional = args.slice(i + 1);
      break;
    }
    const on = a.startsWith('-');
    if (a === '-o' || a === '+o') {
      if (args[++i] === 'pipefail') sh.opts.pipefail = on;
      else if (args[i] === 'errexit') sh.opts.errexit = on;
      else if (args[i] === 'nounset') sh.opts.nounset = on;
      continue;
    }
    if (!/^[-+][a-zA-Z]+$/.test(a)) {
      sh.positional = args.slice(i);
      break;
    }
    for (const ch of a.slice(1)) {
      if (ch === 'e') sh.opts.errexit = on;
      else if (ch === 'u') sh.opts.nounset = on;
      else if (ch === 'o' && args[i + 1]) {
        if (args[++i] === 'pipefail') sh.opts.pipefail = on;
      }
    }
  }
  return 0;
};

/** Evaluate a `test` / `[` expression. Throws a string for malformed input. */
function evalTest(ctx: Ctx, a: string[]): boolean {
  let pos = 0;
  const fileTest = (op: string, path: string): boolean => {
    const node = ctx.fs.lookup(ctx.shell.abs(path), op !== '-L' && op !== '-h');
    if (!node) return false;
    switch (op) {
      case '-e':
        return true;
      case '-f':
        return node.type === 'file';
      case '-d':
        return node.type === 'dir';
      case '-L':
      case '-h':
        return node.type === 'symlink';
      case '-r':
        return ctx.fs.can(node, 4);
      case '-w':
        return ctx.fs.can(node, 2);
      case '-x':
        return ctx.fs.can(node, 1);
      case '-s':
        return node.type === 'file' && node.content.length > 0;
    }
    return false;
  };
  const num = (s: string): number => {
    if (!/^\s*-?\d+\s*$/.test(s)) throw `${s}: integer expression expected`;
    return Number(s);
  };
  const primary = (): boolean => {
    const t = a[pos];
    if (t === undefined) throw 'argument expected';
    if (t === '!') {
      pos++;
      return !primary();
    }
    if (t === '(') {
      pos++;
      const v = or();
      if (a[pos++] !== ')') throw "`)' expected";
      return v;
    }
    const next = a[pos + 1];
    const binary = ['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '<', '>', '=~'];
    if (next !== undefined && binary.includes(next) && a[pos + 2] !== undefined) {
      const l = t;
      const r = a[pos + 2];
      pos += 3;
      switch (next) {
        case '=':
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return l < r;
        case '>':
          return l > r;
        case '=~':
          return new RegExp(r).test(l);
        case '-eq':
          return num(l) === num(r);
        case '-ne':
          return num(l) !== num(r);
        case '-lt':
          return num(l) < num(r);
        case '-le':
          return num(l) <= num(r);
        case '-gt':
          return num(l) > num(r);
        default:
          return num(l) >= num(r);
      }
    }
    if (/^-[a-zA-Z]$/.test(t) && next !== undefined) {
      pos += 2;
      if (t === '-z') return next.length === 0;
      if (t === '-n') return next.length > 0;
      if ('efdLhrwxs'.includes(t[1])) return fileTest(t, next);
      throw `${t}: unary operator expected`;
    }
    pos++;
    return t.length > 0;
  };
  const and = (): boolean => {
    let v = primary();
    while (a[pos] === '-a' || a[pos] === '&&') {
      pos++;
      const r = primary();
      v = v && r;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (a[pos] === '-o' || a[pos] === '||') {
      pos++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  if (!a.length) return false;
  const result = or();
  if (pos < a.length) throw 'too many arguments';
  return result;
}

const test: CommandFn = (args, ctx) => {
  let expr = args;
  const closer = ctx.name === '[' ? ']' : ctx.name === '[[' ? ']]' : null;
  if (closer) {
    if (args[args.length - 1] !== closer) {
      ctx.err(`bash: ${ctx.name}: missing \`${closer}'\n`);
      return 2;
    }
    expr = args.slice(0, -1);
  }
  try {
    return evalTest(ctx, expr) ? 0 : 1;
  } catch (e) {
    if (typeof e === 'string') {
      ctx.err(`bash: ${ctx.name}: ${e}\n`);
      return 2;
    }
    throw e;
  }
};

const jobs: CommandFn = (_args, ctx) => {
  const list = ctx.sys.jobs();
  list.forEach((p, i) => {
    const mark = i === list.length - 1 ? '+' : i === list.length - 2 ? '-' : ' ';
    ctx.out(`[${p.job}]${mark}  ${(p.state === 'T' ? 'Stopped' : 'Running').padEnd(24)}${p.cmd}${p.state === 'T' ? '' : ' &'}\n`);
  });
  return 0;
};

const fgbg =
  (fg: boolean): CommandFn =>
  (args, ctx) => {
    const list = ctx.sys.jobs();
    const spec = args[0]?.replace(/^%/, '');
    const job = spec ? list.find((p) => String(p.job) === spec) : list[list.length - 1];
    if (!job) {
      ctx.err(`bash: ${ctx.name}: ${spec ? `%${spec}: no such job` : 'current: no such job'}\n`);
      return 1;
    }
    job.state = 'R';
    if (fg) {
      ctx.out(job.cmd + '\n');
      ctx.shell.foreground = job;
    } else ctx.out(`[${job.job}]+ ${job.cmd} &\n`);
    return 0;
  };

const bash: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  if (args[0] === '-c') {
    if (args[1] === undefined) return usage(ctx, '-c: option requires an argument');
    return sh.runScript(args[1], args[2] ?? ctx.name, args.slice(3), ctx.io);
  }
  if (args[0] === '--version') {
    ctx.out('GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n');
    return 0;
  }
  const flags = args.filter((a) => /^-[a-z]+$/.test(a));
  const [file, ...rest] = args.filter((a) => !/^-[a-z]+$/.test(a));
  if (!file) {
    if (ctx.stdin) return sh.runScript(ctx.stdin, ctx.name, [], ctx.io);
    ctx.err(`${ctx.name}: starting a nested interactive shell is not supported in this simulator\n`);
    return 1;
  }
  let content: string;
  try {
    content = ctx.fs.readFile(sh.abs(file));
  } catch (e) {
    ctx.err(`${ctx.name}: ${file}: ${(e as Error).message}\n`);
    return 127;
  }
  if (flags.some((f) => f.includes('n'))) {
    return sh.runScript('true', file, [], ctx.io);
  }
  return sh.runScript(content, file, rest, ctx.io);
};

const date: CommandFn = (args, ctx) => {
  const d = new Date(ctx.fs.now());
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = args.find((a) => a.startsWith('+'));
  const utc = args.includes('-u');
  const get = {
    Y: () => String(utc ? d.getUTCFullYear() : d.getFullYear()),
    m: () => pad((utc ? d.getUTCMonth() : d.getMonth()) + 1),
    d: () => pad(utc ? d.getUTCDate() : d.getDate()),
    H: () => pad(utc ? d.getUTCHours() : d.getHours()),
    M: () => pad(utc ? d.getUTCMinutes() : d.getMinutes()),
    S: () => pad(utc ? d.getUTCSeconds() : d.getSeconds()),
    a: () => days[utc ? d.getUTCDay() : d.getDay()],
    b: () => months[utc ? d.getUTCMonth() : d.getMonth()],
    s: () => String(Math.floor(d.getTime() / 1000)),
    Z: () => (utc ? 'UTC' : 'UTC'),
  };
  const expand = (f: string) =>
    f
      .replace(/%F/g, '%Y-%m-%d')
      .replace(/%T/g, '%H:%M:%S')
      .replace(/%([YmdHMSabsZ%])/g, (_, c: string) => (c === '%' ? '%' : get[c as keyof typeof get]()));
  ctx.out(expand(fmt ? fmt.slice(1) : '%a %b %d %T %Z %Y') + '\n');
  return 0;
};

const man: CommandFn = (args, ctx) => {
  const name = args.find((a) => !a.startsWith('-'));
  if (!name) {
    ctx.err("What manual page do you want?\nFor example, try 'man ls'.\n");
    return 1;
  }
  const page = manPage(name);
  if (!page) {
    ctx.err(`No manual entry for ${name}\n`);
    return 16;
  }
  ctx.out(page);
  return 0;
};

const help: CommandFn = (args, ctx) => {
  if (args[0]) {
    const text = helpText(args[0]);
    if (text) {
      ctx.out(text);
      return 0;
    }
    ctx.err(`bash: help: no help topics match \`${args[0]}'. Try \`man ${args[0]}'.\n`);
    return 1;
  }
  const byCat = new Map<string, string[]>();
  for (const d of DOCS) byCat.set(d.cat, [...(byCat.get(d.cat) ?? []), d.name]);
  ctx.out('Commands available in this simulator. Use `man <command>` or `<command> --help` for details.\n\n');
  for (const [cat, names] of byCat) ctx.out(`${cat}:\n  ${names.join('  ')}\n\n`);
  return 0;
};

const read: CommandFn = (args, ctx) => {
  const names = args.filter((a) => !a.startsWith('-'));
  const line = ctx.stdin.split('\n')[0] ?? '';
  if (!ctx.stdin) {
    ctx.err('bash: read: interactive input is not supported in this simulator; pipe a value in, e.g. echo hi | read x\n');
    return 1;
  }
  const words = line.trim().split(/\s+/);
  (names.length ? names : ['REPLY']).forEach((n, i, all) => {
    ctx.shell.vars[n] = i === all.length - 1 ? words.slice(i).join(' ') : (words[i] ?? '');
  });
  return 0;
};

export const builtinCommands: Record<string, CommandFn> = {
  cd,
  pwd: (_a, ctx) => ctx.out(ctx.shell.cwd + '\n'),
  echo,
  export: exportCmd,
  declare: (args, ctx) => assign(ctx, args.filter((a) => !a.startsWith('-')), args.includes('-x')),
  local: (args, ctx) => assign(ctx, args, false),
  unset: (args, ctx) => {
    for (const k of args.filter((a) => !a.startsWith('-'))) {
      delete ctx.shell.vars[k];
      delete ctx.shell.functions[k];
      ctx.shell.exported.delete(k);
    }
  },
  env: envCmd,
  printenv,
  alias,
  unalias: (args, ctx) => {
    let code = 0;
    for (const a of args) {
      if (a === '-a') ctx.shell.aliases = {};
      else if (a in ctx.shell.aliases) delete ctx.shell.aliases[a];
      else {
        ctx.err(`bash: unalias: ${a}: not found\n`);
        code = 1;
      }
    }
    return code;
  },
  which,
  type,
  command: (args, ctx) => {
    if (args[0] === '-v') {
      const r = args[1] ? resolveCommand(ctx, args[1]) : null;
      if (!r) return 1;
      ctx.out((r.kind === 'file' ? r.detail : r.kind === 'alias' ? `alias ${args[1]}='${r.detail}'` : args[1]) + '\n');
      return 0;
    }
    return args.length ? ctx.shell.execArgv(args, ctx.io) : 0;
  },
  source,
  '.': source,
  history,
  exit: (args) => {
    throw new ExitSignal(args[0] !== undefined ? Number(args[0]) & 255 : 0);
  },
  logout: () => {
    throw new ExitSignal(0);
  },
  return: (args, ctx) => {
    throw new ReturnSignal(args[0] !== undefined ? Number(args[0]) & 255 : ctx.shell.lastExit);
  },
  break: () => {
    throw new LoopSignal('break');
  },
  continue: () => {
    throw new LoopSignal('continue');
  },
  set,
  shift: (args, ctx) => {
    const n = args[0] !== undefined ? Number(args[0]) : 1;
    if (n > ctx.shell.positional.length) return 1;
    ctx.shell.positional = ctx.shell.positional.slice(n);
  },
  true: () => 0,
  ':': () => 0,
  false: () => 1,
  test,
  '[': test,
  '[[': test,
  jobs,
  fg: fgbg(true),
  bg: fgbg(false),
  bash,
  sh: bash,
  clear: (_a, ctx) => {
    ctx.shell.action = { type: 'clear' };
  },
  date,
  man,
  help,
  read,
  sleep: (args, ctx) => {
    const secs = parseFloat(args[0] ?? '');
    if (Number.isNaN(secs)) return usage(ctx, args.length ? `invalid time interval '${args[0]}'` : 'missing operand', 1);
    ctx.shell.hold({}, secs >= 10);
  },
  time: (args, ctx) => {
    const code = args.length ? ctx.shell.execArgv(args, ctx.io) : 0;
    ctx.err('\nreal\t0m0.012s\nuser\t0m0.004s\nsys\t0m0.003s\n');
    return code;
  },
  yes: (args, ctx) => {
    ctx.out(((args.join(' ') || 'y') + '\n').repeat(20));
    ctx.err('(simulator: yes stops after 20 lines)\n');
  },
  uname: (args, ctx) => {
    const all = args.includes('-a');
    ctx.out(
      all
        ? `Linux ${ctx.shell.hostname} 6.8.0-87-generic #88-Ubuntu SMP PREEMPT_DYNAMIC Sat Oct 11 09:28:41 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\n`
        : args.includes('-r')
          ? '6.8.0-87-generic\n'
          : args.includes('-m')
            ? 'x86_64\n'
            : 'Linux\n',
    );
  },
  hostname: (args, ctx) => ctx.out(args.includes('-I') ? '10.0.2.15 \n' : ctx.shell.hostname + '\n'),
  uptime: (_a, ctx) => ctx.out(' 09:20:41 up 14 days,  6 min,  1 user,  load average: 0.08, 0.12, 0.09\n'),
  free: (args, ctx) => {
    const h = args.some((a) => /^-\w*h/.test(a));
    ctx.out(
      h
        ? '               total        used        free      shared  buff/cache   available\nMem:           3.8Gi       1.2Gi       412Mi        18Mi       2.5Gi       2.6Gi\nSwap:          2.0Gi          0B       2.0Gi\n'
        : '               total        used        free      shared  buff/cache   available\nMem:         4014080     1258291      421888       18432     2621440     2755789\nSwap:        2097148           0     2097148\n',
    );
  },
  lsb_release: (_a, ctx) => ctx.out('Distributor ID:\tUbuntu\nDescription:\tUbuntu 24.04.3 LTS\nRelease:\t24.04\nCodename:\tnoble\n'),
  nproc: (_a, ctx) => ctx.out('2\n'),
};
