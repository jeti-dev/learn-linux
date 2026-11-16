import { FsError, type FsNode } from '../fs/VirtualFS';
import { basename, join } from '../fs/path';
import type { Proc } from '../mocks/system';
import { C, usage, type CommandFn, type Ctx } from './types';

// ------------------------------------------------------------------ permissions

function applyMode(node: FsNode, spec: string): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = node.mode;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a';
    let bits = 0;
    for (const ch of m[3]) {
      if (ch === 'r') bits |= 4;
      else if (ch === 'w') bits |= 2;
      else if (ch === 'x' || (ch === 'X' && (node.type === 'dir' || node.mode & 0o111))) bits |= 1;
    }
    for (const [letter, shift] of [['u', 6], ['g', 3], ['o', 0]] as const) {
      if (!who.includes(letter) && !who.includes('a')) continue;
      if (m[2] === '+') mode |= bits << shift;
      else if (m[2] === '-') mode &= ~(bits << shift);
      else mode = (mode & ~(7 << shift)) | (bits << shift);
    }
  }
  return mode;
}

function eachTarget(ctx: Ctx, targets: string[], recursive: boolean, verb: string, fn: (abs: string, node: FsNode) => void): number {
  let code = 0;
  const visit = (shown: string, abs: string) => {
    const node = ctx.fs.lookup(abs);
    if (!node) {
      ctx.err(`${ctx.name}: cannot access '${shown}': No such file or directory\n`);
      code = 1;
      return;
    }
    try {
      fn(abs, node);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      ctx.err(`${ctx.name}: ${verb} '${shown}': ${e.message}\n`);
      code = 1;
    }
    if (recursive && node.type === 'dir') for (const name of Object.keys(node.children)) visit(join(shown, name), join(abs, name));
  };
  for (const t of targets) visit(t, ctx.shell.abs(t));
  return code;
}

const chmod: CommandFn = (args, ctx) => {
  const recursive = args.some((a) => a === '-R' || a === '--recursive');
  const rest = args.filter((a) => !/^(-R|-v|-c|-f|--recursive)$/.test(a));
  if (rest.length < 2) return usage(ctx, rest.length ? `missing operand after '${rest[0]}'` : 'missing operand', 1);
  const [spec, ...targets] = rest;
  if (!/^[0-7]{1,4}$/.test(spec) && !/^([ugoa]*[-+=][rwxXst]*)(,[ugoa]*[-+=][rwxXst]*)*$/.test(spec)) {
    ctx.err(`chmod: invalid mode: '${spec}'\n`);
    return 1;
  }
  return eachTarget(ctx, targets, recursive, 'changing permissions of', (abs, node) => ctx.fs.chmod(abs, applyMode(node, spec)!));
};

function knownUsers(ctx: Ctx): string[] {
  try {
    return ctx.shell.asUser('root', () => ctx.fs.readFile('/etc/passwd'))
      .split('\n')
      .map((l) => l.split(':')[0])
      .filter(Boolean);
  } catch {
    return ['root', ctx.shell.user];
  }
}

const chown: CommandFn = (args, ctx) => {
  const recursive = args.some((a) => a === '-R' || a === '--recursive');
  const rest = args.filter((a) => !/^(-R|-v|-c|-f|-h|--recursive)$/.test(a));
  if (rest.length < 2) return usage(ctx, rest.length ? `missing operand after '${rest[0]}'` : 'missing operand', 1);
  const [spec, ...targets] = rest;
  let [owner, group] = ctx.name === 'chgrp' ? ['', spec] : spec.split(/[:.]/);
  if (spec.endsWith(':') && owner) group = owner;
  const users = knownUsers(ctx);
  if (owner && !users.includes(owner)) {
    ctx.err(`chown: invalid user: '${spec}'\n`);
    return 1;
  }
  if (group && !users.includes(group) && !['adm', 'sudo', 'shadow', 'staff', 'docker'].includes(group)) {
    ctx.err(`${ctx.name}: invalid group: '${spec}'\n`);
    return 1;
  }
  const verb = ctx.name === 'chgrp' ? 'changing group of' : 'changing ownership of';
  return eachTarget(ctx, targets, recursive, verb, (abs) => ctx.fs.chown(abs, owner || undefined, group || undefined));
};

const sudo: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  let target = 'root';
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    const a = args[i];
    if (a === '-u') target = args[++i] ?? 'root';
    else if (a === '-l') {
      ctx.out(`User ${sh.user} may run the following commands on ${sh.hostname}:\n    (ALL : ALL) ALL\n`);
      return 0;
    } else if (a === '-i' || a === '-s') {
      ctx.err('sudo: opening a root shell is not supported in this simulator; prefix single commands with sudo instead\n');
      return 1;
    } else if (a === '-E' || a === '-n' || a === '-k' || a === '-v') continue;
    else return usage(ctx, `invalid option -- '${a.slice(1)}'`, 1);
  }
  const rest = args.slice(i);
  if (!rest.length) return usage(ctx, 'usage: sudo [-u user] command', 1);
  if (sh.user !== 'root' && !(ctx.fs.groups[sh.user] ?? []).includes('sudo')) {
    ctx.err(`${sh.user} is not in the sudoers file.\n`);
    return 1;
  }
  if (rest[0] === 'su' || rest[0] === 'bash' && rest.length === 1) {
    ctx.err('sudo: opening a root shell is not supported in this simulator; prefix single commands with sudo instead\n');
    return 1;
  }
  return sh.asUser(target, () => sh.execArgv(rest, ctx.io));
};

const id: CommandFn = (args, ctx) => {
  const user = args.find((a) => !a.startsWith('-')) ?? ctx.shell.user;
  const uid = user === 'root' ? 0 : user === 'deploy' ? 1001 : 1000;
  const gids: Record<string, number> = { root: 0, sudo: 27, adm: 4, [user]: uid };
  const groups = ctx.fs.groups[user] ?? [user];
  if (args.includes('-u')) ctx.out(`${uid}\n`);
  else if (args.includes('-un')) ctx.out(`${user}\n`);
  else ctx.out(`uid=${uid}(${user}) gid=${uid}(${user}) groups=${groups.map((g) => `${gids[g] ?? 100}(${g})`).join(',')}\n`);
  return 0;
};

// ------------------------------------------------------------------ processes

const procName = (p: Proc) => basename(p.cmd.replace(/^-/, '').split(/[\s:]/)[0]);

const ps: CommandFn = (args, ctx) => {
  const spec = args.join(' ');
  const all = /\b(a?u?x|aux|axu)\b|-e|-A|-ef|-eF/.test(spec) && /x|-e|-A/.test(spec);
  const full = /-\w*f/.test(spec);
  const userFmt = !spec.startsWith('-') && /u/.test(args[0] ?? '');
  const self: Proc = { pid: 5100 + ctx.sys.procs.length * 3, ppid: ctx.sys.shellPid, user: ctx.shell.user, cmd: ['ps', ...args].join(' '), cpu: 0, mem: 0.1, tty: 'pts/0', state: 'R', start: '09:20' };
  let list = [...ctx.sys.procs, self].sort((a, b) => a.pid - b.pid);
  if (!all) list = list.filter((p) => p.tty === 'pts/0');
  const uFlag = args.indexOf('-u');
  if (uFlag >= 0 && args[uFlag + 1]) list = [...ctx.sys.procs].filter((p) => p.user === args[uFlag + 1]);
  if (userFmt) {
    ctx.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
    for (const p of list) {
      const rss = Math.round(p.mem * 40960);
      ctx.out(`${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(rss * 6).padStart(6)} ${String(rss).padStart(5)} ${p.tty.padEnd(8)} ${(p.state + (p.ppid === 1 ? 's' : '')).padEnd(4)} ${p.start.padEnd(5)}   0:00 ${p.cmd}\n`);
    }
  } else if (full) {
    ctx.out('UID          PID    PPID  C STIME TTY          TIME CMD\n');
    for (const p of list) ctx.out(`${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  0 ${p.start.padEnd(5)} ${p.tty.padEnd(8)} 00:00:00 ${p.cmd}\n`);
  } else {
    ctx.out('    PID TTY          TIME CMD\n');
    for (const p of list) ctx.out(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:00 ${procName(p)}\n`);
  }
  return 0;
};

const top: CommandFn = (_args, ctx) => {
  const list = [...ctx.sys.procs].sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, 12);
  const running = ctx.sys.procs.filter((p) => p.state === 'R').length;
  ctx.out(
    `top - 09:20:41 up 14 days,  6 min,  1 user,  load average: ${(list[0]?.cpu ?? 0) > 50 ? '1.42, 0.61, 0.27' : '0.08, 0.12, 0.09'}\n` +
      `Tasks: ${ctx.sys.procs.length} total, ${Math.max(1, running)} running, ${ctx.sys.procs.length - running} sleeping\n` +
      `%Cpu(s): ${Math.min(99, list.reduce((s, p) => s + p.cpu, 0) / 2).toFixed(1)} us,  0.7 sy,  0.0 ni\n` +
      'MiB Mem :   3920.0 total,    412.3 free,   1228.8 used,   2560.0 buff/cache\n\n' +
      '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n',
  );
  for (const p of list) {
    const res = Math.round(p.mem * 40960);
    ctx.out(`${String(p.pid).padStart(7)} ${p.user.padEnd(8)}  20   0 ${String(res * 6).padStart(7)} ${String(res).padStart(6)}   4096 ${p.state} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)}   0:0${p.pid % 10}.${String(p.pid % 97).padStart(2, '0')} ${procName(p)}\n`);
  }
  if (ctx.tty) ctx.out(C.dim('\n(simulator: one snapshot; the real program refreshes until you press q)\n'));
  return 0;
};

const SIGNALS: Record<string, string> = { '1': 'HUP', '2': 'INT', '9': 'KILL', '15': 'TERM', '18': 'CONT', '19': 'STOP', '20': 'TSTP' };

function parseSignal(arg: string): string | null {
  const raw = arg.replace(/^-/, '').replace(/^SIG/i, '').toUpperCase();
  if (SIGNALS[raw]) return SIGNALS[raw];
  return Object.values(SIGNALS).includes(raw) ? raw : null;
}

function signalProc(ctx: Ctx, p: Proc, signal: string): string | null {
  // The login shell and init ignore signals here so the session cannot be destroyed.
  if (p.pid === ctx.sys.shellPid || p.pid === 1) return null;
  const wasJob = p.job;
  const err = ctx.sys.kill(p.pid, signal, ctx.shell.user);
  if (err) return err;
  if (ctx.shell.foreground?.pid === p.pid && !ctx.sys.procs.includes(p)) ctx.shell.foreground = undefined;
  if (wasJob !== undefined && !ctx.sys.procs.includes(p)) ctx.out(`[${wasJob}]+  ${signal === 'KILL' ? 'Killed' : 'Terminated'}              ${p.cmd}\n`);
  return null;
}

const kill: CommandFn = (args, ctx) => {
  if (args[0] === '-l') {
    ctx.out(' 1) SIGHUP\t 2) SIGINT\t 9) SIGKILL\t15) SIGTERM\t18) SIGCONT\t19) SIGSTOP\t20) SIGTSTP\n');
    return 0;
  }
  let signal = 'TERM';
  let rest = args;
  if (args[0] === '-s' && args[1]) {
    const s = parseSignal(args[1]);
    if (!s) {
      ctx.err(`bash: kill: ${args[1]}: invalid signal specification\n`);
      return 1;
    }
    signal = s;
    rest = args.slice(2);
  } else if (args[0]?.startsWith('-') && args[0] !== '--') {
    const s = parseSignal(args[0]);
    if (!s) {
      ctx.err(`bash: kill: ${args[0].slice(1)}: invalid signal specification\n`);
      return 1;
    }
    signal = s;
    rest = args.slice(1);
  }
  if (!rest.length) {
    ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...\n');
    return 2;
  }
  let code = 0;
  for (const target of rest) {
    let p: Proc | undefined;
    if (target.startsWith('%')) p = ctx.sys.jobs().find((j) => String(j.job) === target.slice(1));
    else if (/^\d+$/.test(target)) p = ctx.sys.procs.find((x) => x.pid === Number(target));
    else {
      ctx.err(`bash: kill: ${target}: arguments must be process or job IDs\n`);
      code = 1;
      continue;
    }
    const err = p ? signalProc(ctx, p, signal) : target.startsWith('%') ? 'no such job' : 'No such process';
    if (err) {
      ctx.err(`bash: kill: (${target}) - ${err}\n`);
      code = 1;
    }
  }
  return code;
};

const pmatch =
  (mode: 'pgrep' | 'pkill' | 'killall'): CommandFn =>
  (args, ctx) => {
    let signal = 'TERM';
    let fullCmd = false;
    let list = false;
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-f') fullCmd = true;
      else if (a === '-l' || a === '-a') list = true;
      else if (a === '-u') i++;
      else if (a === '-s') signal = parseSignal(args[++i] ?? '') ?? signal;
      else if (a.startsWith('-') && parseSignal(a)) signal = parseSignal(a)!;
      else if (a.startsWith('-')) return usage(ctx, `invalid option -- '${a.slice(1)}'`);
      else operands.push(a);
    }
    if (!operands.length) return usage(ctx, 'no matching criteria specified');
    let re: RegExp;
    try {
      re = new RegExp(mode === 'killall' ? `^${operands[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` : operands[0]);
    } catch {
      return usage(ctx, 'invalid pattern');
    }
    const matches = ctx.sys.procs.filter((p) => p.pid !== ctx.sys.shellPid && re.test(fullCmd ? p.cmd : procName(p)));
    if (!matches.length) {
      if (mode === 'killall') ctx.err(`${operands[0]}: no process found\n`);
      return 1;
    }
    if (mode === 'pgrep') {
      for (const p of matches) ctx.out(list ? `${p.pid} ${fullCmd || args.includes('-a') ? p.cmd : procName(p)}\n` : `${p.pid}\n`);
      return 0;
    }
    let code = 0;
    for (const p of matches) {
      const err = signalProc(ctx, p, signal);
      if (err) {
        ctx.err(`${mode}: ${mode === 'killall' ? `${procName(p)}(${p.pid})` : `killing pid ${p.pid} failed`}: ${err}\n`);
        code = 1;
      }
    }
    return code;
  };

// ------------------------------------------------------------------ runtimes

const NODE_VERSION = 'v22.11.0';

function startServer(ctx: Ctx, file: string): number {
  const sh = ctx.shell;
  const port = Number(sh.exported.has('PORT') ? sh.vars.PORT : '') || 3000;
  const holder = ctx.sys.listening(port);
  if (holder) {
    ctx.err(
      `node:events:497\n      throw er; // Unhandled 'error' event\n      ^\n\nError: listen EADDRINUSE: address already in use :::${port}\n    at Server.setupListenHandle [as _listen2] (node:net:1908:16)\n    at listenInCluster (node:net:1965:12)\n    at Server.listen (node:net:2067:7)\n    at Object.<anonymous> (${sh.abs(file)}:5:5) {\n  code: 'EADDRINUSE',\n  errno: -98,\n  syscall: 'listen',\n  address: '::',\n  port: ${port}\n}\n\nNode.js ${NODE_VERSION}\n`,
    );
    return 1;
  }
  ctx.out(`Server listening on http://localhost:${port}\n`);
  sh.hold({ port, cpu: 0.3, mem: 1.8 });
  return 0;
}

const node: CommandFn = (args, ctx) => {
  if (args[0] === '-v' || args[0] === '--version') {
    ctx.out(NODE_VERSION + '\n');
    return 0;
  }
  const file = args.find((a) => !a.startsWith('-'));
  if (!file || args[0] === '-e' || args[0] === '-p') {
    ctx.err('node: running JavaScript is not supported in this simulator (only `node <server file>` and `node -v`)\n');
    return 1;
  }
  const abs = ctx.shell.abs(file);
  let content: string;
  try {
    content = ctx.fs.readFile(abs);
  } catch {
    ctx.err(`node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: Cannot find module '${abs}'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15) {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js ${NODE_VERSION}\n`);
    return 1;
  }
  if (/\blisten\(/.test(content)) return startServer(ctx, file);
  ctx.err(`(simulator: ${file} was not executed; only server scripts are simulated)\n`);
  return 0;
};

const npm: CommandFn = (args, ctx) => {
  if (args[0] === '-v' || args[0] === '--version') {
    ctx.out('10.9.0\n');
    return 0;
  }
  const script = args[0] === 'run' ? args[1] : args[0];
  const pkgPath = ctx.shell.abs('package.json');
  if (!ctx.fs.isFile(pkgPath)) {
    ctx.err(`npm error code ENOENT\nnpm error syscall open\nnpm error path ${pkgPath}\nnpm error errno -2\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${pkgPath}'\n`);
    return 254;
  }
  let pkg: { name?: string; version?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(ctx.fs.readFile(pkgPath));
  } catch {
    ctx.err('npm error code EJSONPARSE\nnpm error JSON.parse Invalid package.json\n');
    return 1;
  }
  if (script === 'install' || script === 'i' || script === 'ci') {
    ctx.out('\nadded 68 packages, and audited 69 packages in 2s\n\nfound 0 vulnerabilities\n');
    return 0;
  }
  const command = script ? pkg.scripts?.[script] : undefined;
  if (!script || !command) {
    ctx.err(script ? `npm error Missing script: "${script}"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run\n` : 'npm: give a script to run, for example: npm start\n');
    return 1;
  }
  ctx.out(`\n> ${pkg.name}@${pkg.version} ${script}\n> ${command}\n\n`);
  if (/^node\s+\S+$/.test(command)) return node(command.split(/\s+/).slice(1), ctx);
  if (script === 'test') {
    ctx.out('✔ health endpoint returns ok (4.1ms)\n✔ users endpoint returns a list (2.3ms)\nℹ tests 2\nℹ pass 2\nℹ fail 0\n');
    return 0;
  }
  return ctx.shell.exec(command, ctx.io);
};

const python3: CommandFn = (args, ctx) => {
  if (args[0] === '--version' || args[0] === '-V') {
    ctx.out('Python 3.12.3\n');
    return 0;
  }
  if (args[0] === '-m' && args[1] === 'http.server') {
    const port = Number(args[2]) || 8000;
    if (ctx.sys.listening(port)) {
      ctx.err(`OSError: [Errno 98] Address already in use\n`);
      return 1;
    }
    ctx.out(`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...\n`);
    ctx.shell.hold({ port, mem: 0.9 });
    return 0;
  }
  ctx.err('python3: running Python is not supported in this simulator (only `python3 -m http.server` and `--version`)\n');
  return 1;
};

const notSimulated =
  (what: string): CommandFn =>
  (_args, ctx) => {
    ctx.err(`${ctx.name}: ${what}\n`);
    return 1;
  };

export const adminCommands: Record<string, CommandFn> = {
  chmod,
  chown,
  chgrp: chown,
  sudo,
  id,
  whoami: (_a, ctx) => ctx.out(ctx.shell.user + '\n'),
  groups: (args, ctx) => ctx.out((ctx.fs.groups[args[0] ?? ctx.shell.user] ?? [args[0] ?? ctx.shell.user]).join(' ') + '\n'),
  umask: (_a, ctx) => ctx.out('0022\n'),
  su: notSimulated('switching users is not supported in this simulator; prefix single commands with sudo instead'),
  passwd: notSimulated('changing passwords is not supported in this simulator'),
  ps,
  top,
  htop: top,
  kill,
  pgrep: pmatch('pgrep'),
  pkill: pmatch('pkill'),
  killall: pmatch('killall'),
  node,
  npm,
  python3,
  python: notSimulated("command not found; on Ubuntu the interpreter is called 'python3'"),
  git: (args, ctx) => {
    if (args[0] === '--version') {
      ctx.out('git version 2.43.0\n');
      return 0;
    }
    ctx.err('git: version control is outside the scope of this simulator\n');
    return 1;
  },
};
