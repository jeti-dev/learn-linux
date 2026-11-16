import type { VirtualFS } from '../fs/VirtualFS';

export type Proc = {
  pid: number;
  ppid: number;
  user: string;
  cmd: string;
  cpu: number;
  mem: number;
  tty: string;
  state: 'S' | 'R' | 'T';
  port?: number;
  /** Ignores SIGTERM; only SIGKILL (-9) removes it. */
  stubborn?: boolean;
  job?: number;
  unit?: string;
  start: string;
};

export type Unit = {
  name: string;
  description: string;
  active: 'active' | 'inactive' | 'failed';
  enabled: boolean;
  procs: { cmd: string; user: string; port?: number }[];
  /** Returns an error line for the journal when the unit cannot start. */
  precheck?: (fs: VirtualFS) => string | null;
};

export type JournalEntry = { time: string; unit: string; msg: string; prio: 'info' | 'warning' | 'err' };

export type Pkg = { name: string; version: string; desc: string; installed: boolean; size: string };

const PACKAGES: [string, string, string, boolean, string][] = [
  ['bash', '5.2.21-2ubuntu4', 'GNU Bourne Again SHell', true, '1,948 kB'],
  ['coreutils', '9.4-3ubuntu6', 'GNU core utilities', true, '7,264 kB'],
  ['curl', '8.5.0-2ubuntu10.6', 'command line tool for transferring data with URL syntax', true, '534 kB'],
  ['git', '1:2.43.0-1ubuntu7.3', 'fast, scalable, distributed revision control system', true, '21.8 MB'],
  ['jq', '1.7.1-3build1', 'lightweight and flexible command-line JSON processor', true, '109 kB'],
  ['nano', '7.2-2ubuntu0.1', 'small, friendly text editor inspired by Pico', true, '856 kB'],
  ['nginx', '1.24.0-2ubuntu7.5', 'small, powerful, scalable web/proxy server', true, '1,576 kB'],
  ['nodejs', '22.11.0-1nodesource1', 'Node.js event-based server-side JavaScript engine', true, '185 MB'],
  ['openssh-client', '1:9.6p1-3ubuntu13.14', 'secure shell (SSH) client', true, '2,864 kB'],
  ['openssh-server', '1:9.6p1-3ubuntu13.14', 'secure shell (SSH) server', true, '1,542 kB'],
  ['postgresql', '16+257build1.1', 'object-relational SQL database', true, '70.4 kB'],
  ['python3', '3.12.3-0ubuntu2.1', 'interactive high-level object-oriented language', true, '92.2 kB'],
  ['vim', '2:9.1.0016-1ubuntu7.9', 'Vi IMproved - enhanced vi editor', true, '4,131 kB'],
  ['build-essential', '12.10ubuntu1', 'Informational list of build-essential packages', false, '4,624 B'],
  ['htop', '3.3.0-4build1', 'interactive processes viewer', false, '434 kB'],
  ['net-tools', '2.10-0.1ubuntu4.4', 'NET-3 networking toolkit (netstat, ifconfig)', false, '820 kB'],
  ['python3-pip', '24.0+dfsg-1ubuntu1.3', 'Python package installer', false, '7,219 kB'],
  ['ripgrep', '14.1.0-1', 'Recursively searches directories for a regex pattern', false, '4,188 kB'],
  ['tmux', '3.4-1ubuntu0.1', 'terminal multiplexer', false, '1,120 kB'],
  ['tree', '2.1.1-2ubuntu3', 'displays an indented directory tree, in color', false, '116 kB'],
];

/** Commands that only work once their package is installed. */
export const COMMAND_PACKAGE: Record<string, string> = {
  tree: 'tree',
  htop: 'htop',
  jq: 'jq',
  netstat: 'net-tools',
  ifconfig: 'net-tools',
  tmux: 'tmux',
  rg: 'ripgrep',
  pip: 'python3-pip',
  pip3: 'python3-pip',
  make: 'build-essential',
  gcc: 'build-essential',
};

/** Per-host mocked state: processes, packages, services, journal. */
export class System {
  procs: Proc[] = [];
  private nextPid = 5200;
  private nextJob = 1;
  packages = new Map<string, Pkg>();
  aptUpdated = false;
  units = new Map<string, Unit>();
  journal: JournalEntry[] = [];
  shellPid = 2301;

  constructor(public hostname: string) {
    for (const [name, version, desc, installed, size] of PACKAGES) {
      this.packages.set(name, { name, version, desc, installed, size });
    }
    const boot = (pid: number, user: string, cmd: string, extra: Partial<Proc> = {}) =>
      this.procs.push({ pid, ppid: 1, user, cmd, cpu: 0, mem: 0.1, tty: '?', state: 'S', start: 'Nov02', ...extra });
    boot(1, 'root', '/sbin/init', { ppid: 0, mem: 0.3 });
    boot(412, 'root', '/usr/lib/systemd/systemd-journald', { mem: 0.4 });
    boot(2290, 'dev', 'sshd: dev@pts/0', { ppid: 801 });
    boot(this.shellPid, 'dev', '-bash', { ppid: 2290, tty: 'pts/0', start: '09:14' });

    this.addUnit({ name: 'ssh', description: 'OpenBSD Secure Shell server', active: 'inactive', enabled: true, procs: [{ cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', user: 'root', port: 22 }] });
    this.addUnit({ name: 'cron', description: 'Regular background program processing daemon', active: 'inactive', enabled: true, procs: [{ cmd: '/usr/sbin/cron -f -P', user: 'root' }] });
    this.addUnit({
      name: 'nginx',
      description: 'A high performance web server and a reverse proxy server',
      active: 'inactive',
      enabled: true,
      procs: [
        { cmd: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', user: 'root', port: 80 },
        { cmd: 'nginx: worker process', user: 'www-data' },
      ],
    });
    this.addUnit({ name: 'postgresql', description: 'PostgreSQL RDBMS', active: 'inactive', enabled: true, procs: [{ cmd: '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main', user: 'postgres', port: 5432 }] });
    for (const u of ['ssh', 'cron', 'nginx', 'postgresql']) this.startUnit(u, undefined, true);

    if (hostname === 'ubuntu') {
      // A deliberately broken service for the learner to diagnose and fix.
      this.addUnit({
        name: 'myapp',
        description: 'myapp Node.js API',
        active: 'failed',
        enabled: true,
        procs: [{ cmd: '/usr/bin/node server.js', user: 'dev', port: 3000 }],
        precheck: (fs) => {
          const env = fs.lookupRaw('/etc/myapp/config.env');
          if (env?.type !== 'file') return 'Failed to load environment files: No such file or directory (/etc/myapp/config.env)';
          const holder = this.listening(3000);
          if (holder && holder.unit !== 'myapp') return 'Error: listen EADDRINUSE: address already in use :::3000';
          return null;
        },
      });
      this.log('myapp', 'Starting myapp.service - myapp Node.js API...', 'info', 'Nov 16 09:02:10');
      this.log('myapp', 'Failed to load environment files: No such file or directory (/etc/myapp/config.env)', 'err', 'Nov 16 09:02:10');
      this.log('myapp', 'myapp.service: Main process exited, code=exited, status=1/FAILURE', 'err', 'Nov 16 09:02:10');
      this.log('myapp', "myapp.service: Failed with result 'exit-code'.", 'warning', 'Nov 16 09:02:10');
    }
  }

  // ---- processes ----

  spawn(cmd: string, user: string, extra: Partial<Proc> = {}): Proc {
    const p: Proc = { pid: this.nextPid, ppid: this.shellPid, user, cmd, cpu: 0, mem: 0.2, tty: 'pts/0', state: 'S', start: '09:20', ...extra };
    this.nextPid += 1 + ((this.nextPid * 7) % 23);
    this.procs.push(p);
    return p;
  }

  spawnJob(cmd: string, user: string, extra: Partial<Proc> = {}): Proc {
    return this.spawn(cmd, user, { job: this.nextJob++, state: 'R', ...extra });
  }

  assignJob(p: Proc): void {
    if (p.job === undefined) p.job = this.nextJob++;
  }

  jobs(): Proc[] {
    return this.procs.filter((p) => p.job !== undefined).sort((a, b) => a.job! - b.job!);
  }

  /** Send a signal. Returns an error message, or null on success. */
  kill(pid: number, signal: string, asUser: string): string | null {
    const p = this.procs.find((x) => x.pid === pid);
    if (!p) return 'No such process';
    if (asUser !== 'root' && p.user !== asUser) return 'Operation not permitted';
    if (signal === 'STOP' || signal === 'TSTP') p.state = 'T';
    else if (signal === 'CONT') p.state = 'R';
    else if (signal === 'KILL' || !p.stubborn) this.remove(pid);
    return null;
  }

  remove(pid: number): void {
    const p = this.procs.find((x) => x.pid === pid);
    this.procs = this.procs.filter((x) => x.pid !== pid && x.ppid !== pid);
    if (p?.unit) {
      const unit = this.units.get(p.unit);
      if (unit && !this.procs.some((x) => x.unit === p.unit)) unit.active = 'inactive';
    }
    if (!this.jobs().length) this.nextJob = 1;
  }

  listening(port: number): Proc | undefined {
    return this.procs.find((p) => p.port === port);
  }

  // ---- services ----

  addUnit(u: Unit): void {
    this.units.set(u.name, u);
  }

  log(unit: string, msg: string, prio: JournalEntry['prio'] = 'info', time = 'Nov 16 09:20:11'): void {
    this.journal.push({ time, unit, msg, prio });
  }

  stopUnit(name: string, quiet = false): void {
    const u = this.units.get(name)!;
    this.procs = this.procs.filter((p) => p.unit !== name);
    if (!quiet && u.active === 'active') {
      this.log(name, `Stopping ${name}.service - ${u.description}...`);
      this.log(name, `${name}.service: Deactivated successfully.`);
    }
    u.active = 'inactive';
  }

  /** Start a unit. Returns false when its precheck fails. */
  startUnit(name: string, fs?: VirtualFS, boot = false): boolean {
    const u = this.units.get(name)!;
    if (u.active === 'active') return true;
    const time = boot ? 'Nov 02 09:14:02' : undefined;
    this.log(name, `Starting ${name}.service - ${u.description}...`, 'info', time);
    const problem = u.precheck && fs ? u.precheck(fs) : null;
    if (problem) {
      this.log(name, problem, 'err');
      this.log(name, `${name}.service: Main process exited, code=exited, status=1/FAILURE`, 'err');
      this.log(name, `${name}.service: Failed with result 'exit-code'.`, 'warning');
      u.active = 'failed';
      return false;
    }
    let parent: number | undefined;
    for (const spec of u.procs) {
      const p = this.spawn(spec.cmd, spec.user, { ppid: parent ?? 1, tty: '?', unit: name, port: spec.port, start: boot ? 'Nov02' : '09:20' });
      if (boot) p.pid = 780 + this.procs.length * 7;
      parent ??= p.pid;
    }
    this.log(name, `Started ${name}.service - ${u.description}.`, 'info', time);
    u.active = 'active';
    return true;
  }
}
