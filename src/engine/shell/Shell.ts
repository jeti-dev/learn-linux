import { FsError, X, type VirtualFS } from '../fs/VirtualFS';
import { resolvePath } from '../fs/path';
import { createLocalFs, createRemotes, type Remote } from '../fs/seed';
import { COMMAND_PACKAGE, System, type Proc } from '../mocks/system';
import { COMMANDS } from '../commands';
import { BUILTIN_NAMES } from '../commands/builtins';
import { helpText } from '../commands/man';
import type { Ctx } from '../commands/types';
import { expandSingle, expandWord } from './expand';
import { IncompleteInput, ShellSyntaxError, plainText } from './lexer';
import { parse, type AndOr, type Command, type List, type Pipeline, type Redir, type Simple } from './parser';

export type IO = { stdin: string; out: (s: string) => void; err: (s: string) => void; tty: boolean };
export type Chunk = { s: 'out' | 'err'; text: string };
export type UIAction = { type: 'clear' } | { type: 'edit'; editor: 'vim' | 'nano'; path: string };
export type RunResult = {
  chunks: Chunk[];
  exitCode: number;
  /** Input was unfinished; the caller should read another line and retry with both joined by a newline. */
  incomplete: boolean;
  action?: UIAction;
  /** The line after history expansion, when it differs from what was typed. */
  expanded?: string;
};

/** An error message to print; aborts the current simple command. */
export class ShellError extends Error {
  constructor(
    message: string,
    public fatalInScript = false,
  ) {
    super(message);
  }
}
export class ExitSignal {
  constructor(public code: number) {}
}
export class ReturnSignal {
  constructor(public code: number) {}
}
export class LoopSignal {
  constructor(public kind: 'break' | 'continue') {}
}

type Session = Pick<Shell, 'fs' | 'sys' | 'hostname' | 'user' | 'cwd' | 'vars' | 'exported' | 'aliases' | 'functions'>;

const LOOP_LIMIT = 10000;
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export class Shell {
  fs: VirtualFS;
  sys: System;
  hostname = 'ubuntu';
  user = 'dev';
  cwd = '/home/dev';
  vars: Record<string, string> = {};
  exported = new Set<string>();
  aliases: Record<string, string> = {};
  functions: Record<string, List> = {};
  positional: string[] = [];
  scriptName = 'bash';
  history: string[] = [];
  lastExit = 0;
  lastBgPid = 0;
  opts = { errexit: false, nounset: false, pipefail: false };
  remotes: Record<string, Remote>;
  /** Process holding the terminal; while set, the prompt is unavailable until Ctrl+C or Ctrl+Z. */
  foreground?: Proc;
  action?: UIAction;

  private sessions: Session[] = [];
  private aliasGuard = new Set<string>();
  private inCondition = 0;
  private scriptDepth = 0;
  private captureDepth = 0;
  private errSink: (s: string) => void = () => {};
  private cmdText = '';
  private bgMode = false;
  private heldBg?: Proc;

  constructor() {
    this.fs = createLocalFs();
    this.sys = new System('ubuntu');
    this.remotes = createRemotes();
    this.initVars();
    for (const name of Object.keys(COMMANDS)) {
      if (BUILTIN_NAMES.has(name)) continue;
      if (!COMMAND_PACKAGE[name] || this.sys.packages.get(COMMAND_PACKAGE[name])?.installed) this.installBinary(name);
    }
    this.loadRc();
  }

  private initVars(): void {
    const home = this.user === 'root' ? '/root' : `/home/${this.user}`;
    this.vars = {
      HOME: home,
      USER: this.user,
      LOGNAME: this.user,
      SHELL: '/bin/bash',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      EDITOR: 'nano',
      HOSTNAME: this.hostname,
      OLDPWD: home,
    };
    this.exported = new Set(Object.keys(this.vars));
    this.aliases = {};
    this.functions = {};
  }

  private loadRc(): void {
    const rc = this.vars.HOME + '/.bashrc';
    if (!this.fs.isFile(rc)) return;
    const sink = () => {};
    try {
      this.exec(this.fs.readFile(rc), { stdin: '', out: sink, err: sink, tty: false });
    } catch {
      /* a broken rc file must not stop the shell from starting */
    }
  }

  installBinary(name: string): void {
    this.fs.seedFile(`/usr/bin/${name}`, `\u007fELF (binary: ${name})\n`, { mode: 0o755, owner: 'root', group: 'root' });
  }

  /** The filesystem of the machine the learner started on, even while connected over ssh. */
  get localFs(): VirtualFS {
    return this.sessions.length ? this.sessions[0].fs : this.fs;
  }
  get localSys(): System {
    return this.sessions.length ? this.sessions[0].sys : this.sys;
  }
  get remoteDepth(): number {
    return this.sessions.length;
  }

  abs(p: string): string {
    return resolvePath(this.cwd, p);
  }

  /** Path with the home directory shown as `~`. */
  tilde(p: string): string {
    const home = this.vars.HOME;
    if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length);
    return p;
  }

  prompt(): { userHost: string; path: string; sigil: string } {
    return { userHost: `${this.user}@${this.hostname}`, path: this.tilde(this.cwd), sigil: this.user === 'root' ? '#' : '$' };
  }

  // ---------------------------------------------------------------- top level

  /** Run one interactive line and collect its output. */
  run(line: string): RunResult {
    this.action = undefined;
    const chunks: Chunk[] = [];
    const push = (s: Chunk['s']) => (text: string) => {
      if (!text) return;
      const last = chunks[chunks.length - 1];
      if (last && last.s === s) last.text += text;
      else chunks.push({ s, text });
    };
    const io: IO = { stdin: '', out: push('out'), err: push('err'), tty: true };

    let src = line;
    let expanded: string | undefined;
    const prev = this.history[this.history.length - 1];
    if (prev && /!!|!\$/.test(src)) {
      src = src.replace(/!!/g, prev).replace(/!\$/g, prev.trim().split(/\s+/).pop() ?? '');
      expanded = src;
    }
    if (!src.trim()) return { chunks, exitCode: this.lastExit, incomplete: false };

    let code: number;
    try {
      const list = parse(src);
      this.history.push(src);
      code = this.runList(list, io);
    } catch (e) {
      if (e instanceof IncompleteInput) return { chunks: [], exitCode: 0, incomplete: true };
      if (e instanceof ShellSyntaxError) {
        this.history.push(src);
        io.err(`bash: ${e.message}\n`);
        code = 2;
      } else if (e instanceof ExitSignal) {
        code = e.code;
        if (this.sessions.length) {
          const host = this.hostname;
          this.popSession();
          io.out(`logout\nConnection to ${host} closed.\n`);
        } else {
          io.out('logout\n');
          io.err('(simulator: this is your only session, so it stays open)\n');
        }
      } else if (e instanceof ReturnSignal || e instanceof LoopSignal) {
        code = 1;
      } else throw e;
    }
    this.lastExit = code;
    return { chunks, exitCode: code, incomplete: false, action: this.action, expanded };
  }

  /** Parse and run source text against the given IO. */
  exec(src: string, io: IO): number {
    return this.runList(parse(src), io);
  }

  /** Run a command for `$(...)`: returns stdout without trailing newlines. */
  capture(src: string): string {
    let buf = '';
    this.captureDepth++;
    try {
      this.lastExit = this.exec(src, { stdin: '', out: (s) => (buf += s), err: this.errSink, tty: false });
    } catch (e) {
      if (e instanceof IncompleteInput || e instanceof ShellSyntaxError) {
        throw new ShellError(`bash: command substitution: ${e instanceof ShellSyntaxError ? e.message : 'unexpected end of input'}`);
      }
      throw e;
    } finally {
      this.captureDepth--;
    }
    return buf.replace(/\n+$/, '');
  }

  // ---------------------------------------------------------------- execution

  private runList(list: List, io: IO): number {
    let code = 0;
    for (const item of list) code = this.runAndOr(item, io);
    return code;
  }

  private runAndOr(item: AndOr, io: IO): number {
    if (item.bg) return this.runBackground(item, io);
    let code = this.runPipeline(item.first, io);
    let last = item.first;
    let ranFinal = item.rest.length === 0;
    item.rest.forEach(({ op, p }, i) => {
      if (op === '&&' ? code === 0 : code !== 0) {
        code = this.runPipeline(p, io);
        last = p;
        ranFinal = i === item.rest.length - 1;
      }
    });
    this.lastExit = code;
    if (code !== 0 && this.opts.errexit && this.scriptDepth > 0 && !this.inCondition && ranFinal && !last.negate) {
      throw new ExitSignal(code);
    }
    return code;
  }

  private runBackground(item: AndOr, io: IO): number {
    const first = item.first.cmds[0];
    const text = first.k === 'simple' ? simpleText(first) : '(command)';
    let buf: Chunk[] = [];
    const bio: IO = {
      stdin: '',
      out: (s) => buf.push({ s: 'out', text: s }),
      err: (s) => buf.push({ s: 'err', text: s }),
      tty: io.tty,
    };
    this.bgMode = true;
    this.heldBg = undefined;
    let code: number;
    try {
      code = this.runAndOr({ ...item, bg: false }, bio);
    } finally {
      this.bgMode = false;
    }
    const flush = () => {
      for (const c of buf) (c.s === 'out' ? io.out : io.err)(c.text);
      buf = [];
    };
    const held = this.heldBg as Proc | undefined;
    if (held) {
      this.lastBgPid = held.pid;
      io.out(`[${held.job}] ${held.pid}\n`);
      flush();
      return 0;
    }
    const job = this.sys.jobs().length + 1;
    const pid = this.sys.spawn(text, this.user).pid;
    this.sys.remove(pid);
    this.lastBgPid = pid;
    io.out(`[${job}] ${pid}\n`);
    flush();
    io.out(`[${job}]+  ${code === 0 ? 'Done' : `Exit ${code}`}                    ${text}\n`);
    return 0;
  }

  private runPipeline(p: Pipeline, io: IO): number {
    let stdin = io.stdin;
    const codes: number[] = [];
    p.cmds.forEach((cmd, i) => {
      const isLast = i === p.cmds.length - 1;
      let buf = '';
      const cio: IO = { stdin, out: isLast ? io.out : (s) => (buf += s), err: io.err, tty: isLast && io.tty };
      codes.push(this.runCommand(cmd, cio));
      stdin = buf;
    });
    let code = codes[codes.length - 1];
    if (this.opts.pipefail) code = [...codes].reverse().find((c) => c !== 0) ?? 0;
    return p.negate ? (code === 0 ? 1 : 0) : code;
  }

  private condition(list: List, io: IO): number {
    this.inCondition++;
    try {
      return this.runList(list, io);
    } finally {
      this.inCondition--;
    }
  }

  private runCommand(cmd: Command, io: IO): number {
    switch (cmd.k) {
      case 'simple':
        return this.runSimple(cmd, io);
      case 'group':
        return this.runList(cmd.body, io);
      case 'func':
        this.functions[cmd.name] = cmd.body;
        return 0;
      case 'if':
        for (const clause of cmd.clauses) {
          if (this.condition(clause.cond, io) === 0) return this.runList(clause.body, io);
        }
        return cmd.otherwise ? this.runList(cmd.otherwise, io) : 0;
      case 'for': {
        this.errSink = io.err;
        const items = cmd.items.flatMap((w) => expandWord(this, w));
        return this.loop(io, (i) => {
          if (i >= items.length) return false;
          this.vars[cmd.name] = items[i];
          return true;
        }, cmd.body);
      }
      case 'while':
        return this.loop(io, () => (this.condition(cmd.cond, io) === 0) !== cmd.until, cmd.body);
    }
  }

  private loop(io: IO, more: (i: number) => boolean, body: List): number {
    let code = 0;
    for (let i = 0; more(i); i++) {
      if (i >= LOOP_LIMIT) {
        io.err(`bash: loop stopped after ${LOOP_LIMIT} iterations (simulator limit)\n`);
        return 1;
      }
      try {
        code = this.runList(body, io);
      } catch (e) {
        if (!(e instanceof LoopSignal)) throw e;
        if (e.kind === 'break') break;
      }
    }
    return code;
  }

  private applyRedirs(redirs: Redir[], io: IO): IO {
    const next = { ...io };
    for (const r of redirs) {
      if (r.kind === 'dup') {
        if (r.from === 2) next.err = next.out;
        else {
          next.out = next.err;
          next.tty = false;
        }
        continue;
      }
      const shown = expandSingle(this, r.target);
      const path = this.abs(shown);
      try {
        if (r.kind === 'in') {
          next.stdin = path === '/dev/null' ? '' : this.fs.readFile(path);
          continue;
        }
        let write: (s: string) => void = () => {};
        if (path !== '/dev/null') {
          if (!r.append || !this.fs.exists(path)) this.fs.writeFile(path, '');
          else this.fs.writeFile(path, '', true);
          const fs = this.fs;
          write = (s) => fs.writeFile(path, s, true);
        }
        if (r.fd !== 2) {
          next.out = write;
          next.tty = false;
        }
        if (r.fd !== 1) next.err = write;
      } catch (e) {
        if (e instanceof FsError) throw new ShellError(`bash: ${shown}: ${e.message}`);
        throw e;
      }
    }
    return next;
  }

  private runSimple(cmd: Simple, io: IO): number {
    this.errSink = io.err;
    try {
      if (!cmd.words.length) {
        this.lastExit = 0;
        for (const a of cmd.assigns) this.vars[a.name] = expandSingle(this, a.value);
        this.applyRedirs(cmd.redirs, io);
        return cmd.assigns.length ? this.lastExit : 0;
      }
      const argv = cmd.words.flatMap((w) => expandWord(this, w));
      if (!argv.length) return 0;
      const rio = this.applyRedirs(cmd.redirs, io);
      this.cmdText = simpleText(cmd);

      const first = plainText(cmd.words[0]);
      if (first !== undefined && first in this.aliases && !this.aliasGuard.has(first)) {
        this.aliasGuard.add(first);
        try {
          return this.exec([this.aliases[first], ...argv.slice(1).map(shellQuote)].join(' '), rio);
        } finally {
          this.aliasGuard.delete(first);
        }
      }

      const saved = cmd.assigns.map((a) => [a.name, this.vars[a.name], this.exported.has(a.name)] as const);
      for (const a of cmd.assigns) {
        this.vars[a.name] = expandSingle(this, a.value);
        this.exported.add(a.name);
      }
      try {
        return this.execArgv(argv, rio);
      } finally {
        for (const [name, value, wasExported] of saved) {
          if (value === undefined) delete this.vars[name];
          else this.vars[name] = value;
          if (!wasExported) this.exported.delete(name);
        }
      }
    } catch (e) {
      if (e instanceof ShellError) {
        io.err(e.message + '\n');
        if (e.fatalInScript && this.scriptDepth > 0) throw new ExitSignal(1);
        return 1;
      }
      throw e;
    }
  }

  /** Run an already-expanded command line: functions, then commands, then files on disk. */
  execArgv(argv: string[], io: IO): number {
    const [name, ...args] = argv;
    if (name in this.functions) return this.callFunction(name, args, io);

    if (Object.prototype.hasOwnProperty.call(COMMANDS, name)) {
      const pkg = COMMAND_PACKAGE[name];
      if (pkg && !this.sys.packages.get(pkg)?.installed) {
        io.err(`Command '${name}' not found, but can be installed with:\nsudo apt install ${pkg}\n`);
        return 127;
      }
      if (args.includes('--help') && name !== 'echo') {
        const help = helpText(name);
        if (help) {
          io.out(help);
          return 0;
        }
      }
      const ctx: Ctx = { shell: this, fs: this.fs, sys: this.sys, stdin: io.stdin, tty: io.tty, name, out: io.out, err: io.err, io };
      try {
        return COMMANDS[name](args, ctx) ?? 0;
      } catch (e) {
        if (e instanceof FsError) {
          io.err(`${name}: ${this.tilde(e.path)}: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }

    if (name.includes('/')) return this.runFile(name, args, io);
    for (const dir of (this.vars.PATH ?? '').split(':')) {
      if (!dir) continue;
      const candidate = resolvePath(this.cwd, dir + '/' + name);
      const node = this.fs.lookup(candidate);
      if (node?.type === 'file' && this.fs.can(node, X)) return this.runScript(node.content, name, args, io);
    }
    io.err(`${name}: command not found\n`);
    return 127;
  }

  runFile(shown: string, args: string[], io: IO): number {
    const node = this.fs.lookup(this.abs(shown));
    if (!node) {
      io.err(`bash: ${shown}: No such file or directory\n`);
      return 127;
    }
    if (node.type === 'dir') {
      io.err(`bash: ${shown}: Is a directory\n`);
      return 126;
    }
    if (node.type !== 'file' || !this.fs.can(node, X)) {
      io.err(`bash: ${shown}: Permission denied\n`);
      return 126;
    }
    return this.runScript(node.content, shown, args, io);
  }

  /** Run script text as a child process: unexported variables and directory changes do not leak back. */
  runScript(content: string, name: string, args: string[], io: IO): number {
    if (this.scriptDepth > 20) {
      io.err(`bash: ${name}: too many nested scripts\n`);
      return 1;
    }
    const saved = {
      vars: this.vars,
      exported: this.exported,
      cwd: this.cwd,
      aliases: this.aliases,
      functions: this.functions,
      positional: this.positional,
      scriptName: this.scriptName,
      opts: this.opts,
    };
    this.vars = Object.fromEntries(Object.entries(this.vars).filter(([k]) => this.exported.has(k)));
    this.exported = new Set(this.exported);
    this.aliases = {};
    this.functions = { ...this.functions };
    this.positional = args;
    this.scriptName = name;
    this.opts = { errexit: false, nounset: false, pipefail: false };
    this.scriptDepth++;
    try {
      return this.exec(content, io);
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      if (e instanceof ReturnSignal) return e.code;
      if (e instanceof ShellSyntaxError) {
        io.err(`${name}: ${e.message}\n`);
        return 2;
      }
      if (e instanceof IncompleteInput) {
        io.err(`${name}: syntax error: unexpected end of file\n`);
        return 2;
      }
      throw e;
    } finally {
      this.scriptDepth--;
      Object.assign(this, saved);
    }
  }

  /** Run text in the current shell, as `source` does. */
  source(content: string, args: string[], io: IO): number {
    const savedPositional = this.positional;
    if (args.length) this.positional = args;
    try {
      return this.exec(content, io);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.code;
      if (e instanceof ShellSyntaxError) {
        io.err(`bash: ${e.message}\n`);
        return 2;
      }
      if (e instanceof IncompleteInput) {
        io.err('bash: syntax error: unexpected end of file\n');
        return 2;
      }
      throw e;
    } finally {
      this.positional = savedPositional;
    }
  }

  private callFunction(name: string, args: string[], io: IO): number {
    const savedPositional = this.positional;
    this.positional = args;
    try {
      return this.runList(this.functions[name], io);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.code;
      throw e;
    } finally {
      this.positional = savedPositional;
    }
  }

  /** Run a command as another user (sudo). */
  asUser<T>(user: string, fn: () => T): T {
    const prev = this.user;
    this.user = user;
    this.fs.user = user;
    try {
      return fn();
    } finally {
      this.user = prev;
      this.fs.user = prev;
    }
  }

  get inScript(): boolean {
    return this.scriptDepth > 0;
  }

  // ---------------------------------------------------------------- job control

  /**
   * Called by commands that would keep running (servers, `tail -f`, long sleeps).
   * In the background it becomes a job; interactively it takes over the terminal.
   */
  hold(extra: Partial<Proc> = {}, force = true): void {
    if (this.bgMode) {
      this.heldBg = this.sys.spawnJob(this.cmdText, this.user, extra);
    } else if (force && this.scriptDepth === 0 && this.captureDepth === 0) {
      this.foreground = this.sys.spawn(this.cmdText, this.user, { ...extra, state: 'R' });
    }
  }

  /** Ctrl+C. */
  interrupt(): Chunk[] {
    const p = this.foreground;
    if (!p) return [];
    this.foreground = undefined;
    this.sys.remove(p.pid);
    this.lastExit = 130;
    return [{ s: 'out', text: '^C\n' }];
  }

  /** Ctrl+Z. */
  suspend(): Chunk[] {
    const p = this.foreground;
    if (!p) return [];
    this.foreground = undefined;
    p.state = 'T';
    this.sys.assignJob(p);
    this.lastExit = 148;
    return [{ s: 'out', text: `^Z\n[${p.job}]+  Stopped                 ${p.cmd}\n` }];
  }

  // ---------------------------------------------------------------- ssh sessions

  pushSession(remote: Remote, user: string): void {
    const { fs, sys, hostname, cwd, vars, exported, aliases, functions } = this;
    this.sessions.push({ fs, sys, hostname, user: this.user, cwd, vars, exported, aliases, functions });
    this.fs = remote.fs;
    this.sys = remote.sys;
    this.hostname = remote.short;
    this.user = user;
    this.fs.user = user;
    this.cwd = user === 'root' ? '/root' : `/home/${user}`;
    this.initVars();
    this.loadRc();
  }

  popSession(): void {
    const s = this.sessions.pop();
    if (!s) return;
    Object.assign(this, s);
    this.fs.user = this.user;
  }
}

function simpleText(cmd: Simple): string {
  return cmd.words.map((w) => w.parts.map((p) => p.text).join('')).join(' ');
}
