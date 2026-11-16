import type { FsNode } from '../fs/VirtualFS';
import { basename, dirname, join, resolvePath } from '../fs/path';
import type { Remote } from '../fs/seed';
import type { Proc, System } from '../mocks/system';
import { ExitSignal } from '../shell/Shell';
import { human, sizeOf } from './files';
import { parseArgs, usage, type CommandFn, type Ctx } from './types';

const DNS: Record<string, string> = {
  'example.com': '93.184.215.14',
  'www.example.com': '93.184.215.14',
  'api.example.com': '93.184.215.20',
  'github.com': '140.82.121.4',
  'google.com': '142.250.185.78',
  'ubuntu.com': '185.125.190.20',
  'archive.ubuntu.com': '185.125.190.83',
  'staging.example.com': '203.0.113.10',
  'prod.example.com': '203.0.113.20',
};
const LOCAL_IP = '10.0.2.15';

/** Resolve a host name the way the system would: /etc/hosts first, then DNS. */
export function resolveHost(ctx: Ctx, host: string): string | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const hosts = ctx.fs.lookupRaw('/etc/hosts');
  if (hosts?.type === 'file') {
    for (const line of hosts.content.split('\n')) {
      const [ip, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
      if (ip && names.includes(host)) return ip;
    }
  }
  return DNS[host.toLowerCase()] ?? null;
}

type Response = { status: number; headers: Record<string, string>; body: string };
const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 301: 'Moved Permanently', 400: 'Bad Request', 404: 'Not Found', 502: 'Bad Gateway' };

const json = (status: number, data: unknown): Response => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) + '\n' });
const html = (status: number, title: string, server = 'nginx/1.24.0 (Ubuntu)'): Response => ({
  status,
  headers: { Server: server, 'Content-Type': 'text/html' },
  body: `<html>\n<head><title>${title}</title></head>\n<body>\n<center><h1>${title}</h1></center>\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\n</body>\n</html>\n`,
});

const FALLBACK_USERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' },
  { id: 2, name: 'Linus Torvalds', email: 'linus@example.com', role: 'developer' },
];

function appRoutes(ctx: Ctx, method: string, path: string, body: string): Response {
  let users: { id: number }[] = FALLBACK_USERS;
  const file = ctx.shell.localFs.lookupRaw('/home/dev/project/data/users.json');
  if (file?.type === 'file') {
    try {
      users = JSON.parse(file.content);
    } catch {
      /* keep the fallback list */
    }
  }
  const withPowered = (r: Response): Response => ({ ...r, headers: { 'X-Powered-By': 'Express', ...r.headers } });
  if (path === '/') return withPowered({ status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Hello from myapp v1.4.2\n' });
  if (path === '/health') return withPowered(json(200, { status: 'ok', uptime: 318 }));
  if (path === '/api/users' && method === 'GET') return withPowered(json(200, users));
  const one = /^\/api\/users\/(\d+)$/.exec(path);
  if (one) {
    const user = users.find((u) => u.id === Number(one[1]));
    return withPowered(user ? json(200, user) : json(404, { error: 'not found' }));
  }
  if (path === '/api/orders' && method === 'POST') {
    let payload: unknown = null;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      return withPowered(json(400, { error: 'invalid JSON body' }));
    }
    return withPowered(json(201, { id: 1001, received: payload }));
  }
  if (path === '/api/orders') return withPowered(json(200, []));
  return withPowered(json(404, { error: 'not found' }));
}

function localRoutes(ctx: Ctx, sys: System, host: string, port: number, method: string, path: string, body: string): Response | 'refused' | 'empty' {
  const proc = sys.listening(port);
  if (!proc) return 'refused';
  if (/nginx/.test(proc.cmd)) {
    if (host === 'myapp.local' && ctx.fs.lookup('/etc/nginx/sites-enabled/myapp')) {
      return sys.listening(3000) ? appRoutes(ctx, method, path, body) : html(502, '502 Bad Gateway');
    }
    const index = ctx.fs.lookupRaw('/var/www/html/index.html');
    if (path === '/' && index?.type === 'file') return { status: 200, headers: { Server: 'nginx/1.24.0 (Ubuntu)', 'Content-Type': 'text/html' }, body: index.content };
    return html(404, '404 Not Found');
  }
  if (/node|npm/.test(proc.cmd)) return appRoutes(ctx, method, path, body);
  if (/http\.server/.test(proc.cmd)) {
    return { status: 200, headers: { Server: 'SimpleHTTP/0.6 Python/3.12.3', 'Content-Type': 'text/html; charset=utf-8' }, body: '<!DOCTYPE HTML>\n<html>\n<head><title>Directory listing for /</title></head>\n<body><h1>Directory listing for /</h1></body>\n</html>\n' };
  }
  return 'empty';
}

function route(ctx: Ctx, host: string, ip: string, port: number, method: string, path: string, body: string): Response | 'refused' | 'empty' | 'timeout' {
  if (ip.startsWith('127.') || ip === LOCAL_IP) return localRoutes(ctx, ctx.sys, host, port, method, path, body);
  const remote = Object.values(ctx.shell.remotes).find((r) => r.ip === ip);
  if (remote) return port === 3000 ? localRoutes(ctx, remote.sys, host, port, method, path, body) : 'refused';
  if (port !== 80 && port !== 443) return 'timeout';
  if (ip === DNS['api.example.com']) {
    if (path === '/users' && method === 'POST') {
      let payload: Record<string, unknown> = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        return json(400, { error: 'invalid JSON body' });
      }
      return json(201, { id: 6, ...payload });
    }
    if (path === '/users') return json(200, FALLBACK_USERS);
    const one = /^\/users\/(\d+)$/.exec(path);
    if (one) return FALLBACK_USERS[Number(one[1]) - 1] ? json(200, FALLBACK_USERS[Number(one[1]) - 1]) : json(404, { error: 'user not found' });
    if (path === '/status' || path === '/') return json(200, { status: 'ok', version: '2.3.1' });
    return json(404, { error: 'not found' });
  }
  if (ip === DNS['example.com']) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'max-age=86400' },
      body: '<!doctype html>\n<html>\n<head>\n    <title>Example Domain</title>\n</head>\n<body>\n<div>\n    <h1>Example Domain</h1>\n    <p>This domain is for use in illustrative examples in documents.</p>\n</div>\n</body>\n</html>\n',
    };
  }
  if (Object.values(DNS).includes(ip)) return { status: 301, headers: { Location: `https://www.${host}${path}`, 'Content-Type': 'text/html' }, body: '' };
  return 'timeout';
}

type Fetched = { res: Response; host: string; ip: string; port: number; path: string } | { error: string; code: number };

function fetchUrl(ctx: Ctx, rawUrl: string, method: string, body: string): Fetched {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : 'http://' + rawUrl);
  } catch {
    return { error: `(3) URL rejected: Malformed input to a URL function`, code: 3 };
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const ip = resolveHost(ctx, host);
  if (!ip) return { error: `(6) Could not resolve host: ${host}`, code: 6 };
  const res = route(ctx, host, ip, port, method, url.pathname, body);
  if (res === 'refused') return { error: `(7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`, code: 7 };
  if (res === 'timeout') return { error: `(28) Failed to connect to ${host} port ${port} after 5002 ms: Timeout was reached`, code: 28 };
  if (res === 'empty') return { error: '(52) Empty reply from server', code: 52 };
  return { res, host, ip, port, path: url.pathname + url.search };
}

const headerLines = (res: Response) =>
  Object.entries({ ...res.headers, 'Content-Length': String(res.body.length), Date: 'Mon, 16 Nov 2026 09:20:41 GMT', Connection: 'keep-alive' }).map(([k, v]) => `${k}: ${v}`);

const curl: CommandFn = (args, ctx) => {
  const p = parseArgs(
    args,
    'sSiILvfkO',
    ['X', 'd', 'H', 'o', 'w', 'u', 'A', 'm', 'data', 'header', 'request', 'output', 'max-time', 'connect-timeout', 'write-out', 'user-agent'],
    ['silent', 'head', 'include', 'location', 'verbose', 'fail', 'insecure', 'show-error', 'compressed'],
  );
  if (typeof p === 'string') return usage(ctx, p);
  const f = p.flags;
  const url = p.rest[0];
  if (!url) return usage(ctx, 'no URL specified');
  const silent = !!(f.s || f.silent);
  const data = f.d ?? f.data;
  const head = !!(f.I || f.head);
  const method = String(f.X ?? f.request ?? (head ? 'HEAD' : data !== undefined ? 'POST' : 'GET')).toUpperCase();
  const fail = (msg: string, code: number) => {
    if (!silent || f.S) ctx.err(`curl: ${msg}\n`);
    return code;
  };
  let result = fetchUrl(ctx, url, method === 'HEAD' ? 'GET' : method, String(data ?? ''));
  if ('error' in result) return fail(result.error, result.code);
  const verbose = !!(f.v || f.verbose);
  const trace = (r: Extract<Fetched, { res: Response }>) => {
    if (!verbose) return;
    ctx.err(`*   Trying ${r.ip}:${r.port}...\n* Connected to ${r.host} (${r.ip}) port ${r.port}\n> ${method} ${r.path} HTTP/1.1\n> Host: ${r.host}\n> User-Agent: curl/8.5.0\n> Accept: */*\n>\n`);
    ctx.err(`< HTTP/1.1 ${r.res.status} ${STATUS_TEXT[r.res.status] ?? ''}\n${headerLines(r.res).map((h) => `< ${h}\n`).join('')}<\n`);
  };
  trace(result);
  if ((f.L || f.location) && result.res.status === 301) {
    result = { ...result, res: { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: `<!DOCTYPE html>\n<html><head><title>${result.host}</title></head><body>(page content)</body></html>\n` } };
    trace(result);
  }
  const { res } = result;
  if ((f.f || f.fail) && res.status >= 400) return fail(`(22) The requested URL returned error: ${res.status}`, 22);

  const statusLine = `HTTP/1.1 ${res.status} ${STATUS_TEXT[res.status] ?? ''}`;
  let output = '';
  if (head || f.i || f.include) output += [statusLine, ...headerLines(res), '', ''].join('\r\n').replace(/\r/g, '');
  if (!head) output += res.body;

  const outFile = f.O ? basename(new URL(/^[a-z]+:\/\//i.test(url) ? url : 'http://' + url).pathname) || 'index.html' : (f.o ?? f.output);
  if (outFile !== undefined && outFile !== '-') {
    try {
      if (String(outFile) !== '/dev/null') ctx.fs.writeFile(ctx.shell.abs(String(outFile)), output);
    } catch (e) {
      return fail(`(23) Failure writing output to destination: ${(e as Error).message}`, 23);
    }
    if (!silent) {
      const n = String(output.length).padStart(5);
      ctx.err(`  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ${n}  100 ${n}    0     0  48211      0 --:--:-- --:--:-- --:--:-- 48211\n`);
    }
  } else ctx.out(output);
  const writeOut = f.w ?? f['write-out'];
  if (writeOut !== undefined) {
    ctx.out(
      String(writeOut)
        .replace(/%\{http_code\}/g, String(res.status))
        .replace(/%\{time_total\}/g, '0.042113')
        .replace(/%\{size_download\}/g, String(res.body.length))
        .replace(/\\n/g, '\n'),
    );
  }
  return 0;
};

const wget: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'qc', ['O']);
  if (typeof p === 'string') return usage(ctx, p);
  const url = p.rest[0];
  if (!url) return usage(ctx, 'missing URL', 1);
  const result = fetchUrl(ctx, url, 'GET', '');
  const log = (s: string) => {
    if (!p.flags.q) ctx.err(s);
  };
  log(`--2026-11-16 09:20:41--  ${url}\n`);
  if ('error' in result) {
    log(result.code === 6 ? `Resolving ${url}... failed: Name or service not known.\nwget: unable to resolve host address\n` : `Connecting... failed: ${result.error.replace(/^\(\d+\) /, '')}.\n`);
    return 4;
  }
  log(`Resolving ${result.host} (${result.host})... ${result.ip}\nConnecting to ${result.host} (${result.host})|${result.ip}|:${result.port}... connected.\nHTTP request sent, awaiting response... ${result.res.status} ${STATUS_TEXT[result.res.status] ?? ''}\n`);
  if (result.res.status >= 400) {
    log(`2026-11-16 09:20:41 ERROR ${result.res.status}: ${STATUS_TEXT[result.res.status] ?? ''}.\n`);
    return 8;
  }
  const name = String(p.flags.O ?? (basename(result.path.split('?')[0]) || 'index.html'));
  if (name === '-') {
    ctx.out(result.res.body);
    return 0;
  }
  try {
    ctx.fs.writeFile(ctx.shell.abs(name), result.res.body);
  } catch (e) {
    ctx.err(`${name}: ${(e as Error).message}\n`);
    return 3;
  }
  log(`Length: ${result.res.body.length} [${result.res.headers['Content-Type'] ?? 'text/plain'}]\nSaving to: ‘${name}’\n\n${name}  100%[===================>]  ${human(result.res.body.length)}  --.-KB/s    in 0s\n\n2026-11-16 09:20:41 (48.2 MB/s) - ‘${name}’ saved [${result.res.body.length}/${result.res.body.length}]\n`);
  return 0;
};

const ping: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'q46n', ['c', 'i', 'W', 'w', 's']);
  if (typeof p === 'string') return usage(ctx, p);
  const host = p.rest[0];
  if (!host) return usage(ctx, 'usage error: Destination address required', 1);
  const ip = resolveHost(ctx, host);
  if (!ip) {
    ctx.err(`ping: ${host}: Name or service not known\n`);
    return 2;
  }
  const count = Math.min(Number(p.flags.c ?? 4) || 4, 20);
  const local = ip.startsWith('127.') || ip === LOCAL_IP;
  ctx.out(`PING ${host} (${ip}) 56(84) bytes of data.\n`);
  const times: number[] = [];
  for (let i = 1; i <= count; i++) {
    const t = local ? 0.03 + (i % 3) * 0.01 : 11.2 + ((i * 37) % 23) / 10;
    times.push(t);
    ctx.out(`64 bytes from ${ip}: icmp_seq=${i} ttl=${local ? 64 : 57} time=${t.toFixed(local ? 3 : 1)} ms\n`);
  }
  const avg = times.reduce((a, b) => a + b, 0) / count;
  ctx.out(`\n--- ${host} ping statistics ---\n${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms\nrtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)}/0.412 ms\n`);
  if (p.flags.c === undefined && ctx.tty) ctx.err('(simulator: stopped after 4 packets; the real ping runs until Ctrl+C)\n');
  return 0;
};

const dig: CommandFn = (args, ctx) => {
  const short = args.includes('+short');
  const host = args.find((a) => !a.startsWith('+') && !a.startsWith('@') && !a.startsWith('-') && !/^(A|AAAA|MX|NS|TXT|CNAME)$/.test(a));
  if (!host) return usage(ctx, 'usage: dig [+short] name', 1);
  const ip = resolveHostDns(host);
  if (ctx.name === 'nslookup') {
    ctx.out(`Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\n${ip ? `Non-authoritative answer:\nName:\t${host}\nAddress: ${ip}\n` : `** server can't find ${host}: NXDOMAIN\n`}\n`);
    return ip ? 0 : 1;
  }
  if (ctx.name === 'host') {
    ctx.out(ip ? `${host} has address ${ip}\n` : `Host ${host} not found: 3(NXDOMAIN)\n`);
    return ip ? 0 : 1;
  }
  if (short) {
    if (ip) ctx.out(ip + '\n');
    return 0;
  }
  ctx.out(
    `\n; <<>> DiG 9.18.30-0ubuntu0.24.04.2-Ubuntu <<>> ${host}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${ip ? 'NOERROR' : 'NXDOMAIN'}, id: 41822\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${ip ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${host}.\t\t\tIN\tA\n\n` +
      (ip ? `;; ANSWER SECTION:\n${host}.\t\t300\tIN\tA\t${ip}\n\n` : '') +
      ';; Query time: 12 msec\n;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)\n;; WHEN: Mon Nov 16 09:20:41 UTC 2026\n;; MSG SIZE  rcvd: 56\n\n',
  );
  return 0;
};

/** DNS only: dig and friends do not read /etc/hosts. */
function resolveHostDns(host: string): string | null {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : (DNS[host.toLowerCase()] ?? null);
}

function bindAddress(p: Proc): string {
  if (/postgres/.test(p.cmd)) return '127.0.0.1';
  if (/node|npm|http\.server/.test(p.cmd)) return '*';
  return '0.0.0.0';
}
const shortName = (p: Proc) => basename(p.cmd.split(/[\s:]/)[0]);

const ss: CommandFn = (args, ctx) => {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const showProc = flags.includes('p');
  const listeners = ctx.sys.procs.filter((p) => p.port !== undefined).sort((a, b) => a.port! - b.port!);
  if (ctx.name === 'netstat') {
    ctx.out('Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n');
    for (const p of listeners) {
      const owner = ctx.shell.user === 'root' || p.user === ctx.shell.user ? `${p.pid}/${shortName(p)}` : '-';
      ctx.out(`tcp        0      0 ${`${bindAddress(p).replace('*', ':::')}:${p.port}`.padEnd(23)} ${'0.0.0.0:*'.padEnd(23)} LISTEN      ${owner}\n`);
    }
    return 0;
  }
  ctx.out(`Netid State  Recv-Q Send-Q ${'Local Address:Port'.padStart(22)}  Peer Address:Port${showProc ? ' Process' : ''}\n`);
  for (const p of listeners) {
    const visible = showProc && (ctx.shell.user === 'root' || p.user === ctx.shell.user);
    ctx.out(`tcp   LISTEN 0      511    ${`${bindAddress(p)}:${p.port}`.padStart(22)}  ${'0.0.0.0:*'.padStart(17)}${visible ? ` users:(("${shortName(p)}",pid=${p.pid},fd=18))` : ''}\n`);
  }
  return 0;
};

const lsof: CommandFn = (args, ctx) => {
  const i = args.findIndex((a) => a.startsWith('-i'));
  if (i < 0) {
    ctx.err('lsof: only `lsof -i [:port]` is supported in this simulator\n');
    return 1;
  }
  const spec = args[i].length > 2 ? args[i].slice(2) : (args[i + 1] ?? '');
  const port = /:(\d+)/.exec(spec)?.[1];
  const list = ctx.sys.procs.filter((p) => p.port !== undefined && (!port || p.port === Number(port)) && (ctx.shell.user === 'root' || p.user === ctx.shell.user));
  if (!list.length) return 1;
  ctx.out('COMMAND     PID     USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n');
  for (const p of list) ctx.out(`${shortName(p).padEnd(9)} ${String(p.pid).padStart(5)} ${p.user.padStart(8)}   18u  IPv${bindAddress(p) === '*' ? 6 : 4}  41822      0t0  TCP ${bindAddress(p)}:${p.port} (LISTEN)\n`);
  return 0;
};

const ip: CommandFn = (args, ctx) => {
  const sub = args.find((a) => !a.startsWith('-')) ?? '';
  if (/^a(d|dd|ddr|ddress)?$/.test(sub)) {
    ctx.out(
      `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether 08:00:27:4e:66:a1 brd ff:ff:ff:ff:ff:ff\n    inet ${LOCAL_IP}/24 metric 100 brd 10.0.2.255 scope global dynamic eth0\n       valid_lft 84211sec preferred_lft 84211sec\n`,
    );
    return 0;
  }
  if (/^r(o|ou|out|oute)?$/.test(sub)) {
    ctx.out(`default via 10.0.2.2 dev eth0 proto dhcp src ${LOCAL_IP} metric 100\n10.0.2.0/24 dev eth0 proto kernel scope link src ${LOCAL_IP} metric 100\n`);
    return 0;
  }
  ctx.err('ip: only `ip addr` and `ip route` are supported in this simulator\n');
  return 1;
};

// ------------------------------------------------------------------ ssh

type SshConfig = { HostName?: string; User?: string; IdentityFile?: string; Port?: string };

function sshConfig(ctx: Ctx, alias: string): SshConfig {
  const file = ctx.fs.lookup(`${ctx.shell.vars.HOME}/.ssh/config`);
  const out: SshConfig = {};
  if (file?.type !== 'file') return out;
  let active = false;
  for (const raw of file.content.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, ...rest] = line.split(/[\s=]+/);
    const value = rest.join(' ');
    if (key.toLowerCase() === 'host') active = rest.some((pat) => pat === alias || pat === '*');
    else if (active) {
      const k = (['HostName', 'User', 'IdentityFile', 'Port'] as const).find((n) => n.toLowerCase() === key.toLowerCase());
      if (k && out[k] === undefined) out[k] = value;
    }
  }
  return out;
}

const keyId = (text: string) => /KEYID:(\S+)/.exec(text)?.[1] ?? null;

type Connection = { remote: Remote; user: string; shown: string };

/** Resolve and authenticate an ssh target. Prints the same errors ssh would and returns an exit code on failure. */
function connect(ctx: Ctx, spec: string, identity?: string): Connection | number {
  const sh = ctx.shell;
  const at = spec.lastIndexOf('@');
  const alias = at >= 0 ? spec.slice(at + 1) : spec;
  const cfg = sshConfig(ctx, alias);
  const hostName = cfg.HostName ?? alias;
  const user = at >= 0 ? spec.slice(0, at) : (cfg.User ?? sh.user);
  const ipAddr = resolveHost(ctx, hostName);
  if (!ipAddr) {
    ctx.err(`ssh: Could not resolve hostname ${hostName}: Name or service not known\n`);
    return 255;
  }

  const home = sh.vars.HOME ?? '/';
  const expand = (p: string) => resolvePath(sh.cwd, p.replace(/^~/, home));
  const candidates = identity ? [expand(identity)] : cfg.IdentityFile ? [expand(cfg.IdentityFile)] : [`${home}/.ssh/id_ed25519`, `${home}/.ssh/id_rsa`];
  const ids: string[] = [];
  for (const path of candidates) {
    const node = ctx.fs.lookup(path);
    if (node?.type !== 'file') {
      if (identity) ctx.err(`Warning: Identity file ${identity} not accessible: No such file or directory.\n`);
      continue;
    }
    if (node.mode & 0o077) {
      ctx.err(
        `@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0${(node.mode & 0o777).toString(8)} for '${path}' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key "${path}": bad permissions\n`,
      );
      continue;
    }
    const idOfKey = keyId(node.content);
    if (idOfKey) ids.push(idOfKey);
  }

  const shown = `${user}@${hostName}`;
  if (hostName === 'github.com' || ipAddr === DNS['github.com']) {
    if (ids.length && user === 'git') ctx.out("Hi dev! You've successfully authenticated, but GitHub does not provide shell access.\n");
    else ctx.err(`${shown}: Permission denied (publickey).\n`);
    return ids.length && user === 'git' ? 1 : 255;
  }
  const remote = Object.values(sh.remotes).find((r) => r.ip === ipAddr);
  if (!remote || remote.fs === sh.fs) {
    ctx.err(`ssh: connect to host ${hostName} port ${cfg.Port ?? 22}: Connection timed out\n`);
    return 255;
  }

  const known = `${home}/.ssh/known_hosts`;
  const knownNode = ctx.fs.lookup(known);
  if (!(knownNode?.type === 'file' && knownNode.content.includes(hostName + ' '))) {
    ctx.err(
      `The authenticity of host '${hostName} (${ipAddr})' can't be established.\nED25519 key fingerprint is SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes\nWarning: Permanently added '${hostName}' (ED25519) to the list of known hosts.\n`,
    );
    try {
      ctx.fs.mkdir(`${home}/.ssh`, true);
      ctx.fs.writeFile(known, `${hostName} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${remote.short}HostKey\n`, true);
    } catch {
      /* known_hosts is a convenience; ignore write failures */
    }
  }

  const authorized = remote.fs.lookupRaw(`/home/${user}/.ssh/authorized_keys`);
  const ok = remote.users.includes(user) && authorized?.type === 'file' && ids.some((k) => authorized.content.includes(k));
  if (!ok) {
    ctx.err(`${shown}: Permission denied (publickey).\n`);
    return 255;
  }
  return { remote, user, shown };
}

const ssh: CommandFn = (args, ctx) => {
  const sh = ctx.shell;
  let identity: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest.length) rest.push(a);
    else if (a === '-i') identity = args[++i];
    else if (a === '-p' || a === '-o' || a === '-l' || a === '-L' || a === '-J') i++;
    else if (/^-[TtvAqNfC4]+$/.test(a)) continue;
    else if (a === '-V') {
      ctx.err('OpenSSH_9.6p1 Ubuntu-3ubuntu13.14, OpenSSL 3.0.13 30 Jan 2024\n');
      return 0;
    } else if (a.startsWith('-')) return usage(ctx, `unknown option -- ${a.slice(1)}`, 255);
    else rest.push(a);
  }
  const [target, ...command] = rest;
  if (!target) return usage(ctx, 'usage: ssh [-i identity_file] [user@]hostname [command]', 255);
  const conn = connect(ctx, target, identity);
  if (typeof conn === 'number') return conn;

  if (command.length) {
    sh.pushSession(conn.remote, conn.user);
    try {
      return sh.exec(command.join(' '), ctx.io);
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      throw e;
    } finally {
      sh.popSession();
    }
  }
  if (!ctx.tty || sh.inScript) {
    ctx.err('Pseudo-terminal will not be allocated because stdin is not a terminal.\n');
    return 1;
  }
  sh.pushSession(conn.remote, conn.user);
  ctx.out(`Welcome to Ubuntu 24.04.3 LTS (GNU/Linux 6.8.0-87-generic x86_64)\n\n  System load:  0.08              Processes:             112\n  Usage of /:   61.4% of 47.93GB  Users logged in:       0\n\nLast login: Fri Nov 13 16:02:11 2026 from 192.0.2.10\n`);
  return 0;
};

const sshKeygen: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'qly', ['t', 'C', 'f', 'N', 'b']);
  if (typeof p === 'string') return usage(ctx, p, 1);
  const sh = ctx.shell;
  const type = String(p.flags.t ?? 'ed25519');
  if (!['ed25519', 'rsa', 'ecdsa'].includes(type)) {
    ctx.err(`unknown key type ${type}\n`);
    return 1;
  }
  const home = sh.vars.HOME ?? '/';
  const path = p.flags.f !== undefined ? sh.abs(String(p.flags.f).replace(/^~/, home)) : `${home}/.ssh/id_${type}`;
  const comment = String(p.flags.C ?? `${sh.user}@${sh.hostname}`);
  if (p.flags.l) {
    const node = ctx.fs.lookup(path);
    if (node?.type !== 'file') {
      ctx.err(`${path}: No such file or directory\n`);
      return 1;
    }
    ctx.out(`256 SHA256:${keyId(node.content) ?? 'unknown'} ${comment} (${type.toUpperCase()})\n`);
    return 0;
  }
  ctx.out(`Generating public/private ${type} key pair.\n`);
  if (ctx.fs.lookup(path)) {
    ctx.out(`${path} already exists.\nOverwrite (y/n)? n\n`);
    ctx.err('(simulator: remove the existing key first, or choose another file with -f)\n');
    return 1;
  }
  let h = 5381;
  for (const ch of path + comment + sh.history.length) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  const idText = `${h.toString(36)}${(h * 31 >>> 0).toString(36)}Zx${type.slice(0, 2)}`;
  try {
    ctx.fs.mkdir(dirname(path), true);
    if (dirname(path) === `${home}/.ssh`) ctx.fs.chmod(dirname(path), 0o700);
    ctx.fs.writeFile(path, `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nKEYID:${idText}\n-----END OPENSSH PRIVATE KEY-----\n`);
    ctx.fs.chmod(path, 0o600);
    ctx.fs.writeFile(path + '.pub', `ssh-${type} AAAAC3NzaC1lZDI1NTE5AAAAIKEYID:${idText} ${comment}\n`);
  } catch (e) {
    ctx.err(`Saving key "${path}" failed: ${(e as Error).message}\n`);
    return 1;
  }
  ctx.out(`Your identification has been saved in ${path}\nYour public key has been saved in ${path}.pub\nThe key fingerprint is:\nSHA256:${idText} ${comment}\n`);
  return 0;
};

const sshCopyId: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'fn', ['i', 'p']);
  if (typeof p === 'string') return usage(ctx, p, 1);
  const sh = ctx.shell;
  const target = p.rest[0];
  if (!target) return usage(ctx, 'Usage: ssh-copy-id [-i identity_file] [user@]hostname', 1);
  const home = sh.vars.HOME ?? '/';
  const candidates = p.flags.i !== undefined ? [sh.abs(String(p.flags.i).replace(/^~/, home)).replace(/(\.pub)?$/, '.pub')] : [`${home}/.ssh/id_ed25519.pub`, `${home}/.ssh/id_rsa.pub`];
  const pubPath = candidates.find((c) => ctx.fs.isFile(c));
  if (!pubPath) {
    ctx.err('/usr/bin/ssh-copy-id: ERROR: No identities found\n');
    return 1;
  }
  const pub = ctx.fs.readFile(pubPath).trim();
  const at = target.lastIndexOf('@');
  const alias = at >= 0 ? target.slice(at + 1) : target;
  const cfg = sshConfig(ctx, alias);
  const hostName = cfg.HostName ?? alias;
  const user = at >= 0 ? target.slice(0, at) : (cfg.User ?? sh.user);
  const ipAddr = resolveHost(ctx, hostName);
  const remote = Object.values(sh.remotes).find((r) => r.ip === ipAddr);
  if (!ipAddr || !remote) {
    ctx.err(`/usr/bin/ssh-copy-id: ERROR: ssh: ${ipAddr ? `connect to host ${hostName} port 22: Connection timed out` : `Could not resolve hostname ${hostName}: Name or service not known`}\n`);
    return 1;
  }
  ctx.err(`/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${pubPath}"\n/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed\n`);
  if (!remote.users.includes(user)) {
    ctx.err(`${user}@${hostName}'s password: (simulated)\nPermission denied, please try again.\n`);
    return 1;
  }
  const authPath = `/home/${user}/.ssh/authorized_keys`;
  const existing = remote.fs.lookupRaw(authPath);
  const current = existing?.type === 'file' ? existing.content : '';
  if (current.includes(keyId(pub) ?? pub)) {
    ctx.err('\n/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.\n');
    return 0;
  }
  remote.fs.seedFile(authPath, current + pub + '\n', { mode: 0o600, owner: user, group: user });
  ctx.err(`${user}@${hostName}'s password: (simulated: password accepted)\n`);
  ctx.out(`\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh '${target}'"\nand check to make sure that only the key(s) you wanted were added.\n\n`);
  return 0;
};

const scp: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'rpqvC', ['i', 'P']);
  if (typeof p === 'string') return usage(ctx, p, 1);
  if (p.rest.length < 2) return usage(ctx, 'usage: scp [-r] [-i identity_file] source ... target', 1);
  const sh = ctx.shell;
  const parse = (spec: string) => {
    const m = /^([^/:]+):(.*)$/.exec(spec);
    return m ? { host: m[1], path: m[2] } : { host: null, path: spec };
  };
  const dest = parse(p.rest[p.rest.length - 1]);
  const sources = p.rest.slice(0, -1).map(parse);
  const remoteSpec = dest.host ?? sources.find((s) => s.host)?.host;
  if (!remoteSpec || (dest.host && sources.some((s) => s.host))) {
    ctx.err('scp: exactly one side must be remote, written as [user@]host:path\n');
    return 1;
  }
  const conn = connect(ctx, remoteSpec, p.flags.i !== undefined ? String(p.flags.i) : undefined);
  if (typeof conn === 'number') return conn === 255 ? 255 : 1;
  const rfs = conn.remote.fs;
  const remoteHome = `/home/${conn.user}`;
  const prevUser = rfs.user;
  rfs.user = conn.user;
  let code = 0;
  try {
    for (const src of sources) {
      const fromFs = src.host ? rfs : ctx.fs;
      const toFs = dest.host ? rfs : ctx.fs;
      const srcAbs = src.host ? resolvePath(remoteHome, src.path || '.') : sh.abs(src.path);
      let dstAbs = dest.host ? resolvePath(remoteHome, dest.path || '.') : sh.abs(dest.path);
      try {
        const node: FsNode = fromFs.get(srcAbs);
        if (node.type === 'dir' && !p.flags.r) {
          ctx.err(`scp: ${src.path}: not a regular file\n`);
          code = 1;
          continue;
        }
        if (node.type === 'file') fromFs.readFile(srcAbs);
        if (toFs.isDir(dstAbs)) dstAbs = join(dstAbs, basename(srcAbs));
        const existing = toFs.lookup(dstAbs);
        if (existing?.type === 'file' && node.type === 'file') toFs.writeFile(dstAbs, node.content);
        else toFs.attach(dstAbs, toFs.cloneNode(node));
        if (!p.flags.q && ctx.tty && node.type === 'file') ctx.out(`${basename(srcAbs).padEnd(40)} 100% ${String(sizeOf(node)).padStart(5)}   ${human(sizeOf(node) * 12)}B/s   00:00\n`);
      } catch (e) {
        ctx.err(`scp: ${src.path}: ${(e as Error).message}\n`);
        code = 1;
      }
    }
  } finally {
    rfs.user = prevUser;
  }
  return code;
};

export const networkCommands: Record<string, CommandFn> = {
  curl,
  wget,
  ping,
  dig,
  nslookup: dig,
  host: dig,
  ss,
  netstat: ss,
  lsof,
  ip,
  ssh,
  scp,
  'ssh-keygen': sshKeygen,
  'ssh-copy-id': sshCopyId,
};
