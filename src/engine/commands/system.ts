import { COMMAND_PACKAGE, type Unit } from '../mocks/system';
import { C, lines, parseArgs, usage, type CommandFn, type Ctx } from './types';

// ------------------------------------------------------------------ apt

const NOT_UPGRADED = '0 upgraded, 0 newly installed, 0 to remove and 3 not upgraded.\n';

function needRoot(ctx: Ctx, lock: string): boolean {
  if (ctx.shell.user === 'root') return false;
  ctx.err(
    lock === 'lists'
      ? 'E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\n'
      : 'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n',
  );
  return true;
}

const apt: CommandFn = (args, ctx) => {
  const sub = args.find((a) => !a.startsWith('-'));
  const names = args.filter((a) => !a.startsWith('-')).slice(1);
  const pkgs = ctx.sys.packages;
  const reading = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n';
  switch (sub) {
    case 'update':
      if (needRoot(ctx, 'lists')) return 100;
      ctx.out(
        'Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\nGet:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\nGet:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nFetched 252 kB in 1s (311 kB/s)\n' +
          reading +
          "3 packages can be upgraded. Run 'apt list --upgradable' to see them.\n",
      );
      ctx.sys.aptUpdated = true;
      return 0;
    case 'upgrade':
    case 'full-upgrade':
    case 'dist-upgrade':
      if (needRoot(ctx, 'dpkg')) return 100;
      ctx.out(reading + 'Calculating upgrade... Done\nThe following packages will be upgraded:\n  curl libcurl4t64 openssh-client\n3 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\nNeed to get 1,412 kB of archives.\nDo you want to continue? [Y/n] y\nSetting up curl (8.5.0-2ubuntu10.7) ...\nSetting up openssh-client (1:9.6p1-3ubuntu13.15) ...\n');
      return 0;
    case 'install': {
      if (!names.length) return 0;
      if (needRoot(ctx, 'dpkg')) return 100;
      ctx.out(reading);
      const missing = names.find((n) => !pkgs.has(n));
      if (missing) {
        ctx.err(`E: Unable to locate package ${missing}\n`);
        return 100;
      }
      const fresh = names.filter((n) => !pkgs.get(n)!.installed);
      for (const n of names) if (pkgs.get(n)!.installed) ctx.out(`${n} is already the newest version (${pkgs.get(n)!.version}).\n`);
      if (!fresh.length) {
        ctx.out(NOT_UPGRADED);
        return 0;
      }
      ctx.out(`The following NEW packages will be installed:\n  ${fresh.join(' ')}\n0 upgraded, ${fresh.length} newly installed, 0 to remove and 3 not upgraded.\n`);
      fresh.forEach((n, i) => {
        const pkg = pkgs.get(n)!;
        ctx.out(`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble/universe amd64 ${n} amd64 ${pkg.version} [${pkg.size}]\n`);
      });
      for (const n of fresh) {
        const pkg = pkgs.get(n)!;
        ctx.out(`Selecting previously unselected package ${n}.\nUnpacking ${n} (${pkg.version}) ...\nSetting up ${n} (${pkg.version}) ...\n`);
        pkg.installed = true;
        for (const [cmd, owner] of Object.entries(COMMAND_PACKAGE)) if (owner === n) ctx.shell.installBinary(cmd);
      }
      ctx.out('Processing triggers for man-db (2.12.0-4build2) ...\n');
      return 0;
    }
    case 'remove':
    case 'purge': {
      if (!names.length) return 0;
      if (needRoot(ctx, 'dpkg')) return 100;
      ctx.out(reading);
      const missing = names.find((n) => !pkgs.has(n));
      if (missing) {
        ctx.err(`E: Unable to locate package ${missing}\n`);
        return 100;
      }
      const present = names.filter((n) => pkgs.get(n)!.installed);
      for (const n of names) if (!pkgs.get(n)!.installed) ctx.out(`Package '${n}' is not installed, so not removed\n`);
      if (!present.length) {
        ctx.out(NOT_UPGRADED);
        return 0;
      }
      ctx.out(`The following packages will be REMOVED:\n  ${present.join(' ')}\n0 upgraded, 0 newly installed, ${present.length} to remove and 3 not upgraded.\nDo you want to continue? [Y/n] y\n`);
      for (const n of present) {
        ctx.out(`Removing ${n} (${pkgs.get(n)!.version}) ...\n`);
        pkgs.get(n)!.installed = false;
        for (const [cmd, owner] of Object.entries(COMMAND_PACKAGE)) {
          if (owner === n && ctx.fs.lookupRaw(`/usr/bin/${cmd}`)) ctx.fs.remove(`/usr/bin/${cmd}`);
        }
      }
      return 0;
    }
    case 'autoremove':
      if (needRoot(ctx, 'dpkg')) return 100;
      ctx.out(reading + NOT_UPGRADED);
      return 0;
    case 'search': {
      if (!names.length) return usage(ctx, 'E: You must give at least one search pattern', 100);
      ctx.out('Sorting... Done\nFull Text Search... Done\n');
      const term = names[0].toLowerCase();
      for (const pkg of pkgs.values()) {
        if (pkg.name.includes(term) || pkg.desc.toLowerCase().includes(term)) {
          ctx.out(`${ctx.tty ? C.green(pkg.name) : pkg.name}/noble ${pkg.version} amd64${pkg.installed ? ' [installed]' : ''}\n  ${pkg.desc}\n\n`);
        }
      }
      return 0;
    }
    case 'show': {
      const pkg = pkgs.get(names[0] ?? '');
      if (!pkg) {
        ctx.err(`N: Unable to locate package ${names[0] ?? ''}\nE: No packages found\n`);
        return 100;
      }
      ctx.out(`Package: ${pkg.name}\nVersion: ${pkg.version}\nPriority: optional\nSection: utils\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${pkg.size}\nAPT-Manual-Installed: ${pkg.installed ? 'yes' : 'no'}\nDescription: ${pkg.desc}\n\n`);
      return 0;
    }
    case 'list': {
      ctx.out('Listing... Done\n');
      const upgradable = args.includes('--upgradable');
      for (const pkg of pkgs.values()) {
        if (args.includes('--installed') && !pkg.installed) continue;
        if (upgradable && !['curl', 'openssh-client'].includes(pkg.name)) continue;
        if (names.length && !names.includes(pkg.name)) continue;
        ctx.out(`${ctx.tty ? C.green(pkg.name) : pkg.name}/noble${pkg.installed ? ',now' : ''} ${pkg.version} amd64${upgradable ? ' [upgradable]' : pkg.installed ? ' [installed]' : ''}\n`);
      }
      return 0;
    }
    default:
      ctx.err(sub ? `E: Invalid operation ${sub}\n` : 'apt 2.7.14 (amd64)\nUsage: apt [options] command\n\nMost used commands:\n  update, upgrade, install, remove, search, show, list\n');
      return sub ? 100 : 0;
  }
};

const dpkg: CommandFn = (args, ctx) => {
  if (args[0] !== '-l' && args[0] !== '-s') {
    ctx.err('dpkg: only `dpkg -l [package]` and `dpkg -s package` are supported in this simulator\n');
    return 2;
  }
  const installed = [...ctx.sys.packages.values()].filter((p) => p.installed && (!args[1] || p.name === args[1]));
  if (args[0] === '-s') {
    if (!installed.length || !args[1]) {
      ctx.err(`dpkg-query: package '${args[1] ?? ''}' is not installed and no information is available\n`);
      return 1;
    }
    ctx.out(`Package: ${installed[0].name}\nStatus: install ok installed\nVersion: ${installed[0].version}\nDescription: ${installed[0].desc}\n`);
    return 0;
  }
  if (!installed.length) {
    ctx.err(`dpkg-query: no packages found matching ${args[1]}\n`);
    return 1;
  }
  ctx.out('Desired=Unknown/Install/Remove/Purge/Hold\n||/ Name                 Version                    Architecture Description\n+++-====================-==========================-============-=================================\n');
  for (const p of installed) ctx.out(`ii  ${p.name.padEnd(20)} ${p.version.padEnd(26)} amd64        ${p.desc}\n`);
  return 0;
};

// ------------------------------------------------------------------ systemd

const unitName = (s: string) => s.replace(/\.service$/, '');

function journalLine(ctx: Ctx, e: { time: string; unit: string; msg: string }): string {
  const fromSystemd = /^(Start|Stopp|Stopped|Reload)/.test(e.msg) || e.msg.startsWith(`${e.unit}.service`);
  const pid = ctx.sys.procs.find((p) => p.unit === e.unit)?.pid ?? 5321;
  const who = fromSystemd ? 'systemd[1]' : `${e.unit === 'myapp' ? 'node' : e.unit}[${pid}]`;
  return `${e.time} ${ctx.shell.hostname} ${who}: ${e.msg}`;
}

function unitStatus(ctx: Ctx, u: Unit): string {
  const color = ctx.tty;
  const dot = u.active === 'active' ? (color ? C.green('●') : '●') : u.active === 'failed' ? (color ? C.red('×') : '×') : '○';
  const procs = ctx.sys.procs.filter((p) => p.unit === u.name);
  const file = u.name === 'myapp' ? '/etc/systemd/system' : '/usr/lib/systemd/system';
  let out = `${dot} ${u.name}.service - ${u.description}\n     Loaded: loaded (${file}/${u.name}.service; ${u.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n`;
  if (u.active === 'active') {
    const state = 'active (running)';
    out += `     Active: ${color ? C.green(state) : state} since Mon 2026-11-16 09:14:02 UTC; 6min ago\n   Main PID: ${procs[0]?.pid ?? '?'} (${u.name === 'myapp' ? 'node' : u.name})\n      Tasks: ${Math.max(1, procs.length)} (limit: 4613)\n     Memory: ${(4.2 + procs.length * 1.7).toFixed(1)}M\n        CPU: 112ms\n     CGroup: /system.slice/${u.name}.service\n`;
    procs.forEach((p, i) => (out += `             ${i === procs.length - 1 ? '└─' : '├─'}${p.pid} ${p.cmd}\n`));
  } else if (u.active === 'failed') {
    const state = "failed (Result: exit-code)";
    out += `     Active: ${color ? C.red(state) : state} since Mon 2026-11-16 09:02:10 UTC; 18min ago\n    Process: 5321 ExecStart=/usr/bin/node server.js (code=exited, status=1/FAILURE)\n   Main PID: 5321 (code=exited, status=1/FAILURE)\n        CPU: 41ms\n`;
  } else out += '     Active: inactive (dead)\n';
  const recent = ctx.sys.journal.filter((e) => e.unit === u.name).slice(-5);
  if (recent.length) out += '\n' + recent.map((e) => journalLine(ctx, e) + '\n').join('');
  return out;
}

const systemctl: CommandFn = (args, ctx) => {
  const operands = args.filter((a) => !a.startsWith('-'));
  const sub = operands[0] ?? 'list-units';
  const names = operands.slice(1).map(unitName);
  const units = ctx.sys.units;

  if (sub === 'list-units' || sub === 'list-unit-files') {
    ctx.out(sub === 'list-units' ? '  UNIT                LOAD   ACTIVE   SUB     DESCRIPTION\n' : 'UNIT FILE           STATE    PRESET\n');
    for (const u of units.values()) {
      if (sub === 'list-unit-files') ctx.out(`${(u.name + '.service').padEnd(19)} ${(u.enabled ? 'enabled' : 'disabled').padEnd(8)} enabled\n`);
      else if (u.active !== 'inactive' || args.includes('--all') || args.includes('-a')) {
        const mark = u.active === 'failed' ? (ctx.tty ? C.red('●') : '●') : ' ';
        ctx.out(`${mark} ${(u.name + '.service').padEnd(19)} loaded ${u.active.padEnd(8)} ${(u.active === 'active' ? 'running' : u.active === 'failed' ? 'failed' : 'dead').padEnd(7)} ${u.description}\n`);
      }
    }
    if (sub === 'list-units') ctx.out(`\n${[...units.values()].filter((u) => u.active !== 'inactive').length} loaded units listed.\n`);
    return 0;
  }
  if (sub === 'daemon-reload') {
    if (ctx.shell.user !== 'root') {
      ctx.err('Failed to reload daemon: Access denied\n');
      return 1;
    }
    return 0;
  }
  if (!['status', 'start', 'stop', 'restart', 'reload', 'enable', 'disable', 'is-active', 'is-enabled', 'cat'].includes(sub)) {
    ctx.err(`Unknown command verb '${sub}'.\n`);
    return 1;
  }
  if (!names.length) {
    if (sub === 'status') {
      const failed = [...units.values()].filter((u) => u.active === 'failed').length;
      ctx.out(`● ${ctx.shell.hostname}\n    State: ${failed ? 'degraded' : 'running'}\n    Units: ${units.size} loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: ${failed} units\n`);
      return 0;
    }
    ctx.err('Too few arguments.\n');
    return 1;
  }

  let code = 0;
  for (const name of names) {
    const u = units.get(name);
    if (!u) {
      ctx.err(sub === 'status' || sub.startsWith('is-') ? `Unit ${name}.service could not be found.\n` : `Failed to ${sub} ${name}.service: Unit ${name}.service not found.\n`);
      code = sub === 'status' ? 4 : 5;
      continue;
    }
    if (sub === 'status') {
      ctx.out(unitStatus(ctx, u));
      if (u.active !== 'active') code = 3;
    } else if (sub === 'is-active') {
      ctx.out(u.active + '\n');
      if (u.active !== 'active') code = 3;
    } else if (sub === 'is-enabled') {
      ctx.out((u.enabled ? 'enabled' : 'disabled') + '\n');
      if (!u.enabled) code = 1;
    } else if (sub === 'cat') {
      const path = `/etc/systemd/system/${name}.service`;
      const file = ctx.fs.lookupRaw(path);
      ctx.out(file?.type === 'file' ? `# ${path}\n${file.content}` : `# /usr/lib/systemd/system/${name}.service\n[Unit]\nDescription=${u.description}\n\n[Service]\nExecStart=${u.procs[0]?.cmd ?? ''}\n\n[Install]\nWantedBy=multi-user.target\n`);
    } else if (ctx.shell.user !== 'root') {
      ctx.err(`==== AUTHENTICATING FOR org.freedesktop.systemd1.manage-units ====\nAuthentication is required to ${sub} '${name}.service'.\nFailed to ${sub} ${name}.service: Access denied\nSee system logs and 'systemctl status ${name}.service' for details.\n`);
      code = 4;
    } else if (sub === 'enable' || sub === 'disable') {
      u.enabled = sub === 'enable';
      ctx.err(sub === 'enable' ? `Created symlink /etc/systemd/system/multi-user.target.wants/${name}.service → /usr/lib/systemd/system/${name}.service.\n` : `Removed "/etc/systemd/system/multi-user.target.wants/${name}.service".\n`);
    } else if (sub === 'reload') {
      if (u.active !== 'active') {
        ctx.err(`${name}.service is not active, cannot reload.\n`);
        code = 1;
      } else ctx.sys.log(name, `Reloaded ${name}.service - ${u.description}.`);
    } else {
      if (sub !== 'start') ctx.sys.stopUnit(name);
      if (sub !== 'stop' && !ctx.sys.startUnit(name, ctx.shell.localFs)) {
        ctx.err(`Job for ${name}.service failed because the control process exited with error code.\nSee "systemctl status ${name}.service" and "journalctl -xeu ${name}.service" for details.\n`);
        code = 1;
      }
    }
  }
  return code;
};

const journalctl: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'fexrbkqa', ['u', 'n', 'p', 'since', 'until', 'S', 'U', 'o'], ['no-pager']);
  if (typeof p === 'string') return usage(ctx, p, 1);
  const f = p.flags;
  let entries = ctx.sys.journal;
  if (f.u !== undefined) {
    const name = unitName(String(f.u));
    entries = entries.filter((e) => e.unit === name);
  }
  if (f.p !== undefined) {
    const level = String(f.p);
    const rank = { err: 0, '3': 0, warning: 1, '4': 1, info: 2, '6': 2 }[level];
    if (rank === undefined) return usage(ctx, `Unknown log level ${level}`, 1);
    entries = entries.filter((e) => ({ err: 0, warning: 1, info: 2 })[e.prio] <= rank);
  }
  if (f.n !== undefined) entries = entries.slice(-Math.max(0, Number(f.n) || 10));
  else if (f.e || f.f) entries = entries.slice(-20);
  if (f.r) entries = [...entries].reverse();
  if (!entries.length) {
    ctx.out('-- No entries --\n');
    return 0;
  }
  for (const e of entries) {
    const line = journalLine(ctx, e);
    ctx.out((ctx.tty && e.prio === 'err' ? C.red(line) : ctx.tty && e.prio === 'warning' ? C.bold(line) : line) + '\n');
  }
  if (f.f) ctx.shell.hold();
  return 0;
};

const service: CommandFn = (args, ctx) => {
  if (args.length < 2) return usage(ctx, 'Usage: service <name> <start|stop|restart|status>', 1);
  return systemctl([args[1], args[0]], { ...ctx, name: 'systemctl' });
};

// ------------------------------------------------------------------ cron

const crontab: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  const path = `/var/spool/cron/crontabs/${sh.user}`;
  const existing = ctx.fs.lookupRaw(path);
  if (args.includes('-l')) {
    if (existing?.type !== 'file') {
      ctx.err(`no crontab for ${sh.user}\n`);
      return 1;
    }
    ctx.out(existing.content);
    return 0;
  }
  if (args.includes('-r')) {
    if (existing?.type !== 'file') {
      ctx.err(`no crontab for ${sh.user}\n`);
      return 1;
    }
    ctx.fs.remove(path);
    return 0;
  }
  if (args.includes('-e')) {
    if (!ctx.tty || sh.inScript) {
      ctx.err('crontab: an editor needs an interactive terminal\n');
      return 1;
    }
    if (!existing) ctx.fs.seedFile(path, '# m h  dom mon dow   command\n', { owner: sh.user, group: 'crontab', mode: 0o600 });
    sh.action = { type: 'edit', editor: 'nano', path };
    return 0;
  }
  const source = args.find((a) => !a.startsWith('-') || a === '-');
  if (!source) return usage(ctx, 'usage: crontab [-l | -e | -r] [file | -]', 1);
  let text: string;
  try {
    text = source === '-' ? ctx.stdin : ctx.fs.readFile(sh.abs(source));
  } catch (e) {
    ctx.err(`crontab: ${source}: ${(e as Error).message}\n`);
    return 1;
  }
  const bad = lines(text).findIndex((l) => {
    const t = l.trim();
    if (!t || t.startsWith('#') || /^[A-Z_]+=/.test(t) || t.startsWith('@')) return false;
    const fields = t.split(/\s+/);
    return fields.length < 6 || !fields.slice(0, 5).every((x) => /^[\d*/,-]+$|^[a-zA-Z]{3}$/.test(x));
  });
  if (bad >= 0) {
    ctx.err(`"${source}":${bad + 1}: bad minute\nerrors in crontab file, can't install.\n`);
    return 1;
  }
  ctx.fs.seedFile(path, text.endsWith('\n') || !text ? text : text + '\n', { owner: sh.user, group: 'crontab', mode: 0o600 });
  return 0;
};

export const systemCommands: Record<string, CommandFn> = {
  apt,
  'apt-get': apt,
  dpkg,
  systemctl,
  journalctl,
  service,
  crontab,
};
