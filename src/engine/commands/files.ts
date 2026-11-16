import { FsError, R, type DirNode, type FsNode } from '../fs/VirtualFS';
import { basename, dirname, join, resolvePath } from '../fs/path';
import { C, guard, lines, parseArgs, readInputs, usage, type CommandFn, type Ctx } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

export function modeString(node: FsNode): string {
  const type = node.type === 'dir' ? 'd' : node.type === 'symlink' ? 'l' : '-';
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  let s = bits.map((b, i) => (node.mode & b ? 'rwx'[i % 3] : '-')).join('');
  if (node.mode & 0o1000) s = s.slice(0, 8) + (node.mode & 1 ? 't' : 'T');
  return type + s;
}

export function sizeOf(node: FsNode): number {
  return node.type === 'file' ? node.content.length : node.type === 'dir' ? 4096 : node.target.length;
}

export function human(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = ['K', 'M', 'G', 'T'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return (v < 10 ? v.toFixed(1) : String(Math.ceil(v))) + units[u];
}

function lsDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function isExec(node: FsNode): boolean {
  return node.type === 'file' && (node.mode & 0o111) !== 0;
}

const ls: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'alhRd1trSFA', ['color']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const color = ctx.tty;
  const targets = p.rest.length ? p.rest : ['.'];
  let code = 0;

  const paint = (name: string, node: FsNode) => {
    let out = name;
    if (color) {
      if (node.type === 'dir') out = C.blue(name);
      else if (node.type === 'symlink') out = C.cyan(name);
      else if (isExec(node)) out = C.green(name);
    }
    if (f.F) out += node.type === 'dir' ? '/' : node.type === 'symlink' ? '@' : isExec(node) ? '*' : '';
    return out;
  };

  const render = (entries: { name: string; node: FsNode }[], showTotal: boolean): string => {
    if (f.t) entries.sort((a, b) => b.node.mtime - a.node.mtime);
    else if (f.S) entries.sort((a, b) => sizeOf(b.node) - sizeOf(a.node));
    if (f.r) entries.reverse();
    if (!f.l) return entries.length ? entries.map((e) => paint(e.name, e.node)).join(color && !f['1'] ? '  ' : '\n') + '\n' : '';
    const rows = entries.map((e) => {
      const n = e.node;
      const links = n.type === 'dir' ? 2 + Object.values(n.children).filter((c) => c.type === 'dir').length : 1;
      const size = f.h ? human(sizeOf(n)) : String(sizeOf(n));
      const name = paint(e.name, n) + (n.type === 'symlink' ? ` -> ${n.target}` : '');
      return [modeString(n), String(links), n.owner, n.group, size, lsDate(n.mtime), name];
    });
    const w = [0, 1, 2, 3, 4].map((i) => Math.max(0, ...rows.map((r) => r[i].length)));
    const body = rows.map((r) => `${r[0]} ${r[1].padStart(w[1])} ${r[2].padEnd(w[2])} ${r[3].padEnd(w[3])} ${r[4].padStart(w[4])} ${r[5]} ${r[6]}\n`).join('');
    const total = Math.ceil(entries.reduce((s, e) => s + sizeOf(e.node), 0) / 1024);
    return (showTotal ? `total ${total}\n` : '') + body;
  };

  const listDir = (shown: string, abs: string, header: boolean) => {
    const ok = guard(ctx, `cannot open directory '${shown}'`, () => {
      const dir = ctx.fs.get(abs) as DirNode;
      let names = ctx.fs.readdir(abs);
      if (!f.a && !f.A) names = names.filter((n) => !n.startsWith('.'));
      const entries = names.map((name) => ({ name, node: dir.children[name] }));
      if (f.a) {
        entries.unshift({ name: '..', node: ctx.fs.lookup(dirname(abs)) ?? dir });
        entries.unshift({ name: '.', node: dir });
      }
      if (header) ctx.out(`${shown}:\n`);
      ctx.out(render(entries, true));
      if (f.R) {
        for (const e of entries) {
          if (e.node.type === 'dir' && e.name !== '.' && e.name !== '..') {
            ctx.out('\n');
            listDir(join(shown, e.name), join(abs, e.name), true);
          }
        }
      }
    });
    if (!ok) code = 2;
  };

  const files: { name: string; node: FsNode }[] = [];
  const dirs: string[] = [];
  for (const t of targets) {
    const node = ctx.fs.lookup(ctx.shell.abs(t), false);
    if (!node) {
      let reason = 'No such file or directory';
      try {
        ctx.fs.get(ctx.shell.abs(t));
      } catch (e) {
        if (e instanceof FsError) reason = e.message;
      }
      ctx.err(`ls: cannot access '${t}': ${reason}\n`);
      code = 2;
    } else {
      const resolved = ctx.fs.lookup(ctx.shell.abs(t)) ?? node;
      if (resolved.type === 'dir' && !f.d && !(f.l && node.type === 'symlink')) dirs.push(t);
      else files.push({ name: t, node });
    }
  }
  if (files.length) ctx.out(render(files, false));
  dirs.forEach((d, i) => {
    const header = targets.length > 1 || !!f.R;
    if (header && (i > 0 || files.length)) ctx.out('\n');
    listDir(d, ctx.shell.abs(d), header);
  });
  return code;
};

const cat: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'n');
  if (typeof p === 'string') return usage(ctx, p);
  const inputs = readInputs(ctx, p.rest);
  if (!inputs) return 1;
  let text = inputs.map((i) => i.text).join('');
  if (p.flags.n) text = lines(text).map((l, i) => `${String(i + 1).padStart(6)}\t${l}\n`).join('');
  ctx.out(text);
  return inputs.length < Math.max(1, p.rest.length) ? 1 : 0;
};

const headTail =
  (tail: boolean): CommandFn =>
  (args, ctx) => {
    // Allow the historic `-20` form.
    const norm = args.flatMap((a) => (/^-\d+$/.test(a) ? ['-n', a.slice(1)] : [a]));
    const p = parseArgs(norm, 'fFq', ['n', 'c']);
    if (typeof p === 'string') return usage(ctx, p);
    const spec = String(p.flags.n ?? '10');
    const fromStart = tail && spec.startsWith('+');
    const n = Math.abs(parseInt(spec, 10));
    if (Number.isNaN(n)) return usage(ctx, `invalid number of lines: '${spec}'`, 1);
    const inputs = readInputs(ctx, p.rest);
    if (!inputs) return 1;
    inputs.forEach((input, i) => {
      if (inputs.length > 1) ctx.out(`${i ? '\n' : ''}==> ${input.name} <==\n`);
      if (p.flags.c) {
        const c = parseInt(String(p.flags.c), 10);
        ctx.out(tail ? input.text.slice(-c) : input.text.slice(0, c));
        return;
      }
      const ls = lines(input.text);
      const picked = fromStart ? ls.slice(n - 1) : tail ? (n ? ls.slice(-n) : []) : ls.slice(0, n);
      if (picked.length) ctx.out(picked.join('\n') + '\n');
    });
    if (tail && (p.flags.f || p.flags.F) && p.rest.length) ctx.shell.hold();
    return 0;
  };

const touch: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'missing file operand', 1);
  let code = 0;
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const abs = ctx.shell.abs(a);
    const ok = guard(ctx, `cannot touch '${a}'`, () => {
      const node = ctx.fs.lookup(abs);
      if (node) node.mtime = ctx.fs.now();
      else ctx.fs.writeFile(abs, '');
    });
    if (!ok) code = 1;
  }
  return code;
};

const mkdir: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'pv', ['m']);
  if (typeof p === 'string') return usage(ctx, p);
  if (!p.rest.length) return usage(ctx, 'missing operand', 1);
  let code = 0;
  for (const a of p.rest) {
    const ok = guard(ctx, `cannot create directory '${a}'`, () => {
      ctx.fs.mkdir(ctx.shell.abs(a), !!p.flags.p);
      if (p.flags.v) ctx.out(`mkdir: created directory '${a}'\n`);
    });
    if (!ok) code = 1;
  }
  return code;
};

const rmdir: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'missing operand', 1);
  let code = 0;
  for (const a of args) {
    const abs = ctx.shell.abs(a);
    const ok = guard(ctx, `failed to remove '${a}'`, () => {
      const node = ctx.fs.get(abs, false);
      if (node.type !== 'dir') throw new FsError('ENOTDIR', abs);
      ctx.fs.remove(abs);
    });
    if (!ok) code = 1;
  }
  return code;
};

const rm: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'rRfivd', [], ['no-preserve-root', 'recursive', 'force']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const recursive = !!(f.r || f.R || f.recursive);
  const force = !!(f.f || f.force);
  if (!p.rest.length) return force ? 0 : usage(ctx, 'missing operand', 1);
  let code = 0;
  for (const a of p.rest) {
    const abs = ctx.shell.abs(a);
    if (abs === '/' && !f['no-preserve-root']) {
      ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      code = 1;
      continue;
    }
    const node = ctx.fs.lookup(abs, false);
    if (!node) {
      if (!force) {
        ctx.err(`rm: cannot remove '${a}': No such file or directory\n`);
        code = 1;
      }
      continue;
    }
    if (node.type === 'dir' && !recursive && !(f.d && !Object.keys(node.children).length)) {
      ctx.err(`rm: cannot remove '${a}': Is a directory\n`);
      code = 1;
      continue;
    }
    const ok = guard(ctx, `cannot remove '${a}'`, () => {
      if (abs === '/') {
        for (const name of Object.keys(ctx.fs.root.children)) delete ctx.fs.root.children[name];
      } else ctx.fs.remove(abs, true);
      if (f.v) ctx.out(`removed '${a}'\n`);
    });
    if (!ok) code = 1;
  }
  return code;
};

function copyNode(ctx: Ctx, src: string, dst: string): void {
  const node = ctx.fs.get(src, false);
  if (node.type === 'file') {
    const existed = ctx.fs.exists(dst);
    ctx.fs.writeFile(dst, ctx.fs.readFile(src));
    if (!existed) (ctx.fs.get(dst) as FsNode).mode = node.mode;
  } else if (node.type === 'symlink') {
    if (ctx.fs.lookup(dst, false)) ctx.fs.remove(dst, true);
    ctx.fs.symlink(node.target, dst);
  } else {
    if (!ctx.fs.can(node, R)) throw new FsError('EACCES', src);
    if (!ctx.fs.isDir(dst)) ctx.fs.mkdir(dst);
    for (const name of Object.keys(node.children)) copyNode(ctx, join(src, name), join(dst, name));
  }
}

const cp: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'rRavfpi');
  if (typeof p === 'string') return usage(ctx, p);
  const recursive = !!(p.flags.r || p.flags.R || p.flags.a);
  if (p.rest.length < 2) return usage(ctx, p.rest.length ? `missing destination file operand after '${p.rest[0]}'` : 'missing file operand', 1);
  const dest = p.rest[p.rest.length - 1];
  const sources = p.rest.slice(0, -1);
  const destAbs = ctx.shell.abs(dest);
  const destIsDir = ctx.fs.isDir(destAbs);
  if (sources.length > 1 && !destIsDir) {
    ctx.err(`cp: target '${dest}' is not a directory\n`);
    return 1;
  }
  let code = 0;
  for (const s of sources) {
    const srcAbs = ctx.shell.abs(s);
    const node = ctx.fs.lookup(srcAbs);
    if (!node) {
      ctx.err(`cp: cannot stat '${s}': No such file or directory\n`);
      code = 1;
      continue;
    }
    if (node.type === 'dir' && !recursive) {
      ctx.err(`cp: -r not specified; omitting directory '${s}'\n`);
      code = 1;
      continue;
    }
    const target = destIsDir ? join(destAbs, basename(srcAbs)) : destAbs;
    if (target === srcAbs || target.startsWith(srcAbs + '/')) {
      ctx.err(target === srcAbs ? `cp: '${s}' and '${dest}' are the same file\n` : `cp: cannot copy a directory, '${s}', into itself, '${dest}'\n`);
      code = 1;
      continue;
    }
    const ok = guard(ctx, `cannot create regular file '${dest}'`, () => {
      copyNode(ctx, srcAbs, target);
      if (p.flags.v) ctx.out(`'${s}' -> '${destIsDir ? join(dest, basename(srcAbs)) : dest}'\n`);
    });
    if (!ok) code = 1;
  }
  return code;
};

const mv: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'fvin');
  if (typeof p === 'string') return usage(ctx, p);
  if (p.rest.length < 2) return usage(ctx, p.rest.length ? `missing destination file operand after '${p.rest[0]}'` : 'missing file operand', 1);
  const dest = p.rest[p.rest.length - 1];
  const sources = p.rest.slice(0, -1);
  const destAbs = ctx.shell.abs(dest);
  const destIsDir = ctx.fs.isDir(destAbs);
  if (sources.length > 1 && !destIsDir) {
    ctx.err(`mv: target '${dest}' is not a directory\n`);
    return 1;
  }
  let code = 0;
  for (const s of sources) {
    const srcAbs = ctx.shell.abs(s);
    const node = ctx.fs.lookup(srcAbs, false);
    if (!node) {
      ctx.err(`mv: cannot stat '${s}': No such file or directory\n`);
      code = 1;
      continue;
    }
    const target = destIsDir ? join(destAbs, basename(srcAbs)) : destAbs;
    if (target === srcAbs) {
      ctx.err(`mv: '${s}' and '${dest}' are the same file\n`);
      code = 1;
      continue;
    }
    if (target.startsWith(srcAbs + '/')) {
      ctx.err(`mv: cannot move '${s}' to a subdirectory of itself, '${dest}'\n`);
      code = 1;
      continue;
    }
    const ok = guard(ctx, `cannot move '${s}' to '${dest}'`, () => {
      const parent = ctx.fs.get(dirname(srcAbs));
      if (!ctx.fs.can(parent, 2)) throw new FsError('EACCES', srcAbs);
      ctx.fs.attach(target, node);
      delete (parent as DirNode).children[basename(srcAbs)];
      if (p.flags.v) ctx.out(`renamed '${s}' -> '${dest}'\n`);
    });
    if (!ok) code = 1;
  }
  return code;
};

const ln: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'sfv');
  if (typeof p === 'string') return usage(ctx, p);
  if (p.rest.length < 2) return usage(ctx, 'missing file operand', 1);
  const [target, link] = p.rest;
  let linkAbs = ctx.shell.abs(link);
  if (ctx.fs.isDir(linkAbs)) linkAbs = join(linkAbs, basename(target));
  const ok = guard(ctx, `failed to create ${p.flags.s ? 'symbolic' : 'hard'} link '${link}'`, () => {
    if (p.flags.f && ctx.fs.lookup(linkAbs, false)) ctx.fs.remove(linkAbs, true);
    if (p.flags.s) ctx.fs.symlink(target, linkAbs);
    else {
      const node = ctx.fs.get(ctx.shell.abs(target));
      if (node.type === 'dir') throw new FsError('EPERM', target);
      if (ctx.fs.lookup(linkAbs, false)) throw new FsError('EEXIST', linkAbs);
      ctx.fs.attach(linkAbs, node);
    }
  });
  return ok ? 0 : 1;
};

const stat: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'missing operand', 1);
  let code = 0;
  for (const a of args) {
    const node = ctx.fs.lookup(ctx.shell.abs(a), false);
    if (!node) {
      ctx.err(`stat: cannot statx '${a}': No such file or directory\n`);
      code = 1;
      continue;
    }
    const kind = node.type === 'dir' ? 'directory' : node.type === 'symlink' ? 'symbolic link' : node.content ? 'regular file' : 'regular empty file';
    const d = new Date(node.mtime).toISOString().replace('T', ' ').replace('Z', '000000 +0000');
    const uid = node.owner === 'root' ? 0 : 1000;
    ctx.out(
      `  File: ${a}${node.type === 'symlink' ? ` -> ${node.target}` : ''}\n` +
        `  Size: ${String(sizeOf(node)).padEnd(10)}\tBlocks: 8          IO Block: 4096   ${kind}\n` +
        `Access: (${(node.mode & 0o7777).toString(8).padStart(4, '0')}/${modeString(node)})  Uid: (${String(uid).padStart(5)}/${node.owner.padStart(8)})   Gid: (${String(uid).padStart(5)}/${node.group.padStart(8)})\n` +
        `Modify: ${d}\n`,
    );
  }
  return code;
};

export const TAR_MAGIC = '\u0000ustar-sim\n';
export const GZ_MAGIC = '\u001f\u008b-sim\n';

const file: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'missing operand', 1);
  for (const a of args) {
    const node = ctx.fs.lookup(ctx.shell.abs(a), false);
    let desc: string;
    if (!node) desc = 'cannot open (No such file or directory)';
    else if (node.type === 'dir') desc = 'directory';
    else if (node.type === 'symlink') desc = `symbolic link to ${node.target}`;
    else if (!node.content) desc = 'empty';
    else if (node.content.startsWith(TAR_MAGIC)) desc = /"gz":true/.test(node.content.slice(0, 60)) ? 'gzip compressed data, from Unix' : 'POSIX tar archive (GNU)';
    else if (node.content.startsWith(GZ_MAGIC)) desc = 'gzip compressed data, from Unix';
    else if (node.content.startsWith('\u007fELF')) desc = 'ELF 64-bit LSB pie executable, x86-64, dynamically linked';
    else if (/^#!.*\b(ba)?sh\b/.test(node.content)) desc = 'Bourne-Again shell script, ASCII text executable';
    else if (/\.json$/.test(a)) desc = 'JSON text data';
    else if (/\.csv$/.test(a)) desc = 'CSV text';
    else desc = 'ASCII text';
    ctx.out(`${a}: ${desc}\n`);
  }
  return 0;
};

const tree: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'adF', ['L']);
  if (typeof p === 'string') return usage(ctx, p);
  const maxDepth = p.flags.L ? parseInt(String(p.flags.L), 10) : Infinity;
  const root = p.rest[0] ?? '.';
  const abs = ctx.shell.abs(root);
  const node = ctx.fs.lookup(abs);
  if (!node || node.type !== 'dir') {
    ctx.out(`${root}  [error opening dir]\n\n0 directories, 0 files\n`);
    return 2;
  }
  let dirs = 0;
  let files = 0;
  const paint = (name: string, n: FsNode) => (ctx.tty && n.type === 'dir' ? C.blue(name) : ctx.tty && isExec(n) ? C.green(name) : name);
  const walk = (dir: DirNode, prefix: string, depth: number) => {
    let names = Object.keys(dir.children).sort((a, b) => a.localeCompare(b));
    if (!p.flags.a) names = names.filter((n) => !n.startsWith('.'));
    if (p.flags.d) names = names.filter((n) => dir.children[n].type === 'dir');
    names.forEach((name, i) => {
      const child = dir.children[name];
      const last = i === names.length - 1;
      ctx.out(`${prefix}${last ? '└── ' : '├── '}${paint(name, child)}${child.type === 'symlink' ? ` -> ${child.target}` : ''}\n`);
      if (child.type === 'dir') {
        dirs++;
        if (depth < maxDepth) walk(child, prefix + (last ? '    ' : '│   '), depth + 1);
      } else files++;
    });
  };
  ctx.out(paint(root, node) + '\n');
  walk(node, '', 1);
  ctx.out(`\n${dirs} director${dirs === 1 ? 'y' : 'ies'}${p.flags.d ? '' : `, ${files} file${files === 1 ? '' : 's'}`}\n`);
  return 0;
};

function totalSize(node: FsNode): number {
  return node.type === 'dir' ? 4096 + Object.values(node.children).reduce((s, c) => s + totalSize(c), 0) : sizeOf(node);
}

const du: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'shac', ['d', 'max-depth']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const maxDepth = f.s ? 0 : f.d !== undefined ? Number(f.d) : f['max-depth'] !== undefined ? Number(f['max-depth']) : Infinity;
  const fmt = (bytes: number) => (f.h ? human(bytes) : String(Math.ceil(bytes / 1024)));
  let code = 0;
  let grand = 0;
  for (const t of p.rest.length ? p.rest : ['.']) {
    const node = ctx.fs.lookup(ctx.shell.abs(t));
    if (!node) {
      ctx.err(`du: cannot access '${t}': No such file or directory\n`);
      code = 1;
      continue;
    }
    const walk = (n: FsNode, shown: string, depth: number) => {
      if (n.type === 'dir') {
        for (const [name, child] of Object.entries(n.children).sort(([a], [b]) => a.localeCompare(b))) {
          if (child.type === 'dir' || f.a) walk(child, join(shown, name), depth + 1);
        }
      }
      if (depth <= maxDepth) ctx.out(`${fmt(totalSize(n))}\t${shown}\n`);
    };
    walk(node, t, 0);
    grand += totalSize(node);
  }
  if (f.c) ctx.out(`${fmt(grand)}\ttotal\n`);
  return code;
};

const df: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'hTk');
  if (typeof p === 'string') return usage(ctx, p);
  const rows: [string, number, number, string][] = [
    ['tmpfs', 401408, 1320, '/run'],
    ['/dev/sda1', 50254368, 38412240, '/'],
    ['tmpfs', 2007040, 0, '/dev/shm'],
    ['/dev/sda15', 106832, 6246, '/boot/efi'],
    ['/dev/sdb1', 205375464, 184631820, '/var/lib/postgresql'],
  ];
  const fmt = (kb: number) => (p.flags.h ? human(kb * 1024) : String(kb));
  ctx.out(`${'Filesystem'.padEnd(15)}${(p.flags.h ? 'Size' : '1K-blocks').padStart(10)}${'Used'.padStart(10)}${(p.flags.h ? 'Avail' : 'Available').padStart(10)} Use% Mounted on\n`);
  for (const [dev, size, used, mount] of rows) {
    const pct = Math.ceil((used / size) * 100);
    ctx.out(`${dev.padEnd(15)}${fmt(size).padStart(10)}${fmt(used).padStart(10)}${fmt(size - used).padStart(10)} ${String(pct).padStart(3)}% ${mount}\n`);
  }
  return 0;
};

type TarData = { gz: boolean; entries: { path: string; node: FsNode }[] };

const tar: CommandFn = (args, ctx) => {
  if (!args.length) return usage(ctx, 'You must specify one of the \'-Acdtrux\' options');
  // Old-style: first argument may be a bundle of letters without a dash.
  const first = args[0].startsWith('-') ? args[0] : '-' + args[0];
  const p = parseArgs([first, ...args.slice(1)], 'cxtzjvp', ['f', 'C']);
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  if (!f.f) return usage(ctx, 'Refusing to read or write archive contents to the terminal (missing -f option?)');
  const archive = String(f.f);
  const archiveAbs = ctx.shell.abs(archive);
  const base = f.C ? ctx.shell.abs(String(f.C)) : ctx.shell.cwd;

  if (f.c) {
    if (!p.rest.length) return usage(ctx, 'Cowardly refusing to create an empty archive');
    const data: TarData = { gz: !!(f.z || f.j), entries: [] };
    let code = 0;
    for (const item of p.rest) {
      const node = ctx.fs.lookup(resolvePath(base, item));
      if (!node) {
        ctx.err(`tar: ${item}: Cannot stat: No such file or directory\n`);
        code = 2;
        continue;
      }
      const path = item.replace(/^\/+/, '').replace(/\/+$/, '');
      data.entries.push({ path, node: structuredClone(node) });
      if (f.v) listTar([{ path, node }], ctx);
    }
    if (!guard(ctx, archive, () => ctx.fs.writeFile(archiveAbs, TAR_MAGIC + JSON.stringify(data)))) return 2;
    if (code) ctx.err('tar: Exiting with failure status due to previous errors\n');
    return code;
  }

  let content: string;
  try {
    content = ctx.fs.readFile(archiveAbs);
  } catch (e) {
    ctx.err(`tar: ${archive}: Cannot open: ${e instanceof FsError ? e.message : 'error'}\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }
  if (!content.startsWith(TAR_MAGIC)) {
    ctx.err('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n');
    return 2;
  }
  const data = JSON.parse(content.slice(TAR_MAGIC.length)) as TarData;
  if (f.t) {
    listTar(data.entries, ctx);
    return 0;
  }
  if (f.x) {
    let code = 0;
    for (const e of data.entries) {
      const target = resolvePath(base, e.path);
      const ok = guard(ctx, e.path, () => {
        ctx.fs.mkdir(dirname(target), true);
        if (ctx.fs.lookup(target, false)) ctx.fs.remove(target, true);
        ctx.fs.attach(target, ctx.fs.cloneNode(e.node));
      });
      if (!ok) code = 2;
      else if (f.v) listTar([e], ctx);
    }
    return code;
  }
  return usage(ctx, "You must specify one of the '-Acdtrux' options");
};

function listTar(entries: TarData['entries'], ctx: Ctx): void {
  const walk = (path: string, node: FsNode) => {
    ctx.out(node.type === 'dir' ? `${path}/\n` : `${path}\n`);
    if (node.type === 'dir') for (const [name, child] of Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b))) walk(`${path}/${name}`, child);
  };
  for (const e of entries) walk(e.path, e.node);
}

const gzip =
  (decompress: boolean): CommandFn =>
  (args, ctx) => {
    const p = parseArgs(args, 'dkfv');
    if (typeof p === 'string') return usage(ctx, p);
    const unzip = decompress || !!p.flags.d;
    if (!p.rest.length) return usage(ctx, 'compressed data not written to a terminal', 1);
    let code = 0;
    for (const a of p.rest) {
      const abs = ctx.shell.abs(a);
      const ok = guard(ctx, a, () => {
        const text = ctx.fs.readFile(abs);
        if (unzip) {
          if (!a.endsWith('.gz') || !text.startsWith(GZ_MAGIC)) {
            ctx.err(`gzip: ${a}: ${a.endsWith('.gz') ? 'not in gzip format' : 'unknown suffix -- ignored'}\n`);
            code = 1;
            return;
          }
          ctx.fs.writeFile(abs.slice(0, -3), text.slice(GZ_MAGIC.length));
        } else ctx.fs.writeFile(abs + '.gz', GZ_MAGIC + text);
        if (!p.flags.k) ctx.fs.remove(abs);
      });
      if (!ok) code = 1;
    }
    return code;
  };

const editor =
  (kind: 'vim' | 'nano'): CommandFn =>
  (args, ctx) => {
    const target = args.find((a) => !a.startsWith('-'));
    if (!target) {
      ctx.err(`${ctx.name}: give a file name to edit, for example: ${ctx.name} notes.txt\n`);
      return 1;
    }
    const abs = ctx.shell.abs(target);
    if (ctx.fs.isDir(abs)) {
      ctx.err(`${ctx.name}: ${target}: Is a directory\n`);
      return 1;
    }
    if (!ctx.fs.isDir(dirname(abs))) {
      ctx.err(`${ctx.name}: ${target}: No such file or directory\n`);
      return 1;
    }
    if (!ctx.tty || ctx.shell.inScript) {
      ctx.err(`${ctx.name}: an editor needs an interactive terminal\n`);
      return 1;
    }
    ctx.shell.action = { type: 'edit', editor: kind, path: abs };
    return 0;
  };

const pathTool =
  (fn: (p: string, ctx: Ctx) => string | null): CommandFn =>
  (args, ctx) => {
    const operands = args.filter((a) => !a.startsWith('-'));
    if (!operands.length) return usage(ctx, 'missing operand', 1);
    let code = 0;
    for (const a of operands) {
      const result = fn(a, ctx);
      if (result === null) {
        ctx.err(`${ctx.name}: ${a}: No such file or directory\n`);
        code = 1;
      } else ctx.out(result + '\n');
    }
    return code;
  };

function realpath(p: string, ctx: Ctx): string | null {
  // Resolve symlinks one component at a time.
  let cur = '/';
  for (const part of ctx.shell.abs(p).split('/').filter(Boolean)) {
    let next = join(cur, part);
    for (let hops = 0; hops < 20; hops++) {
      const node = ctx.fs.lookup(next, false);
      if (node?.type !== 'symlink') break;
      next = resolvePath(dirname(next), node.target);
    }
    cur = next;
  }
  return ctx.fs.lookup(cur, false) ? cur : null;
}

export const fileCommands: Record<string, CommandFn> = {
  ls,
  cat,
  less: cat,
  more: cat,
  head: headTail(false),
  tail: headTail(true),
  touch,
  mkdir,
  rmdir,
  rm,
  cp,
  mv,
  ln,
  stat,
  file,
  tree,
  du,
  df,
  tar,
  gzip: gzip(false),
  gunzip: gzip(true),
  vim: editor('vim'),
  vi: editor('vim'),
  nano: editor('nano'),
  basename: (args, ctx) => {
    if (!args.length) return usage(ctx, 'missing operand', 1);
    const name = basename(args[0]);
    ctx.out((args[1] && name.endsWith(args[1]) && name !== args[1] ? name.slice(0, -args[1].length) : name) + '\n');
  },
  dirname: pathTool((p) => dirname(p)),
  realpath: pathTool(realpath),
  readlink: pathTool((p, ctx) => {
    const node = ctx.fs.lookup(ctx.shell.abs(p), false);
    return node?.type === 'symlink' ? node.target : null;
  }),
};
