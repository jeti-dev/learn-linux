import { System } from '../mocks/system';
import { VirtualFS } from './VirtualFS';

export type Remote = { name: string; short: string; ip: string; fs: VirtualFS; sys: System; users: string[] };

/** Small deterministic generator so seeded logs are identical on every load. */
function rng(seed: number): () => number {
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const pad = (n: number) => String(n).padStart(2, '0');

export function accessLog(count = 60): string {
  const rnd = rng(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const ips = ['203.0.113.7', '203.0.113.7', '203.0.113.7', '198.51.100.23', '198.51.100.23', '192.0.2.44', '203.0.113.99', '198.51.100.5'];
  const reqs = ['GET /', 'GET /api/users', 'GET /api/users', 'GET /api/users/42', 'POST /api/orders', 'GET /api/orders', 'POST /login', 'GET /static/app.js', 'GET /health', 'GET /api/search?q=linux'];
  const statuses = [200, 200, 200, 200, 200, 304, 404, 500, 201, 401];
  const out: string[] = [];
  let t = 9 * 3600;
  for (let i = 0; i < count; i++) {
    t += 3 + Math.floor(rnd() * 40);
    const time = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
    out.push(`${pick(ips)} - - [16/Nov/2026:${time} +0000] "${pick(reqs)} HTTP/1.1" ${pick(statuses)} ${200 + Math.floor(rnd() * 5000)} "-" "Mozilla/5.0"`);
  }
  return out.join('\n') + '\n';
}

export function appLog(): string {
  const rnd = rng(7);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const info = ['GET /api/users 200 12ms', 'GET /health 200 1ms', 'POST /api/orders 201 48ms', 'GET /api/orders 200 31ms', 'Cache refreshed (214 keys)', 'User 42 logged in'];
  const warn = ['Slow query (1250ms): SELECT * FROM orders', 'Retrying payment gateway request (attempt 2)', 'Memory usage at 81%'];
  const error = [
    'Failed to send email: connection timeout',
    "Unhandled exception in /api/orders: TypeError: Cannot read properties of undefined (reading 'id')",
    'Database connection lost: ECONNRESET',
    'Payment gateway returned 502',
  ];
  const out = ['2026-11-16 09:00:01 INFO  Server started on port 3000', '2026-11-16 09:00:02 INFO  Connected to database'];
  let t = 9 * 3600 + 2;
  for (let i = 0; i < 38; i++) {
    t += 20 + Math.floor(rnd() * 200);
    const r = rnd();
    const [level, msg] = r < 0.62 ? ['INFO ', pick(info)] : r < 0.8 ? ['WARN ', pick(warn)] : ['ERROR', pick(error)];
    out.push(`2026-11-16 ${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)} ${level} ${msg}`);
  }
  return out.join('\n') + '\n';
}

const USERS_JSON = `[
  { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "role": "admin", "active": true },
  { "id": 2, "name": "Linus Torvalds", "email": "linus@example.com", "role": "developer", "active": true },
  { "id": 3, "name": "Grace Hopper", "email": "grace@example.com", "role": "developer", "active": false },
  { "id": 4, "name": "Ken Thompson", "email": "ken@example.com", "role": "ops", "active": true },
  { "id": 5, "name": "Margaret Hamilton", "email": "margaret@example.com", "role": "developer", "active": true }
]
`;

const USERS_CSV = `id,name,email,role,city
1,Ada Lovelace,ada@example.com,admin,London
2,Linus Torvalds,linus@example.com,developer,Portland
3,Grace Hopper,grace@example.com,developer,New York
4,Ken Thompson,ken@example.com,ops,New Orleans
5,Margaret Hamilton,margaret@example.com,developer,Boston
6,Dennis Ritchie,dennis@example.com,developer,New York
7,Barbara Liskov,barbara@example.com,admin,Boston
`;

const BASHRC = `# ~/.bashrc: executed by bash for interactive shells.

# History settings
HISTSIZE=1000
HISTCONTROL=ignoreboth

# Handy aliases
alias ll='ls -alF'
alias la='ls -A'
alias grep='grep --color=auto'

# Default editor
export EDITOR=nano
`;

const PASSWD = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
postgres:x:114:120:PostgreSQL administrator,,,:/var/lib/postgresql:/bin/bash
sshd:x:109:65534::/run/sshd:/usr/sbin/nologin
dev:x:1000:1000:Dev User,,,:/home/dev:/bin/bash
deploy:x:1001:1001:Deploy User,,,:/home/deploy:/bin/bash
`;

const OS_RELEASE = `PRETTY_NAME="Ubuntu 24.04.3 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.3 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
`;

function baseSystem(fs: VirtualFS, hostname: string): void {
  for (const d of ['/bin', '/usr/bin', '/usr/local/bin', '/etc', '/var/log', '/opt', '/srv', '/home', '/dev', '/proc', '/run']) fs.seedDir(d);
  fs.seedDir('/tmp', { mode: 0o1777 });
  fs.seedDir('/root', { mode: 0o700 });
  fs.seedFile('/dev/null', '', { mode: 0o666 });
  fs.seedFile('/etc/hostname', hostname + '\n');
  fs.seedFile('/etc/hosts', `127.0.0.1 localhost\n127.0.1.1 ${hostname}\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n`);
  fs.seedFile('/etc/passwd', PASSWD);
  fs.seedFile('/etc/os-release', OS_RELEASE);
  fs.seedFile('/etc/shadow', 'root:*:19000:0:99999:7:::\ndev:$6$Xy...:19950:0:99999:7:::\n', { mode: 0o640, group: 'shadow' });
  fs.seedFile('/etc/ssh/sshd_config', '# OpenSSH server configuration\nPort 22\nPermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes\n');
  fs.seedFile('/etc/crontab', 'SHELL=/bin/sh\n# m h dom mon dow user  command\n17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly\n25 6    * * *   root    test -x /usr/sbin/anacron || { cd / && run-parts --report /etc/cron.daily; }\n');
  fs.seedDir('/var/spool/cron/crontabs', { mode: 0o1733 });
  fs.seedFile(
    '/var/log/syslog',
    `Nov 16 09:14:02 ${hostname} systemd[1]: Started ssh.service - OpenBSD Secure Shell server.\nNov 16 09:14:03 ${hostname} systemd[1]: Started nginx.service - A high performance web server.\nNov 16 09:17:01 ${hostname} CRON[2190]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)\nNov 16 09:20:44 ${hostname} kernel: [ 4012.118] usb 1-1: new high-speed USB device number 4\n`,
    { mode: 0o640, owner: 'syslog', group: 'adm' },
  );
  fs.seedFile(
    '/var/log/auth.log',
    `Nov 16 08:58:12 ${hostname} sshd[2101]: Failed password for invalid user admin from 198.51.100.77 port 52110 ssh2\nNov 16 08:58:15 ${hostname} sshd[2101]: Failed password for invalid user admin from 198.51.100.77 port 52110 ssh2\nNov 16 08:59:40 ${hostname} sshd[2140]: Failed password for root from 203.0.113.200 port 40022 ssh2\nNov 16 09:14:20 ${hostname} sshd[2290]: Accepted publickey for dev from 192.0.2.10 port 51514 ssh2: ED25519 SHA256:k3Yx\nNov 16 09:14:20 ${hostname} sshd[2290]: pam_unix(sshd:session): session opened for user dev(uid=1000)\n`,
    { mode: 0o640, owner: 'syslog', group: 'adm' },
  );
}

/** The learner's machine: an Ubuntu box with a small Node.js project in the home directory. */
export function createLocalFs(): VirtualFS {
  const fs = new VirtualFS();
  baseSystem(fs, 'ubuntu');
  const dev = { owner: 'dev', group: 'dev' };
  const home = '/home/dev';
  fs.seedDir(home, { ...dev, mode: 0o750 });
  for (const d of ['Documents', 'Downloads', 'project']) fs.seedDir(`${home}/${d}`, dev);
  fs.seedFile(`${home}/.bashrc`, BASHRC);
  fs.seedFile(`${home}/.profile`, '# ~/.profile: executed by the login shell.\nif [ -f "$HOME/.bashrc" ]; then\n  . "$HOME/.bashrc"\nfi\n');
  fs.seedDir(`${home}/.ssh`, { ...dev, mode: 0o700 });
  fs.seedFile(`${home}/.ssh/known_hosts`, 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
  fs.seedFile(`${home}/Documents/notes.txt`, 'Things to learn this week:\n- pipes and redirection\n- file permissions\n- ssh keys\n');
  fs.seedFile(`${home}/Documents/meeting-2026-11-10.md`, '# Sprint planning\n\n- Ship the orders API\n- Fix the flaky deploy script\n');
  fs.seedFile(`${home}/Downloads/report-q3.csv`, 'month,revenue,orders\nJul,18200,412\nAug,21750,468\nSep,19900,431\n');

  const p = `${home}/project`;
  fs.seedFile(`${p}/README.md`, '# myapp\n\nA small Node.js API used throughout these lessons.\n\n## Running\n\n    npm start\n\nThe server listens on port 3000 by default. Set PORT to change it.\n\n## Layout\n\n- `src/` application code\n- `logs/` runtime logs\n- `data/` sample data\n- `scripts/` deployment helpers\n');
  fs.seedFile(`${p}/package.json`, '{\n  "name": "myapp",\n  "version": "1.4.2",\n  "description": "Sample API for the Linux lessons",\n  "main": "server.js",\n  "scripts": {\n    "start": "node server.js",\n    "test": "node --test"\n  },\n  "dependencies": {\n    "express": "^4.19.2",\n    "pg": "^8.12.0"\n  }\n}\n');
  fs.seedFile(`${p}/server.js`, "const app = require('./src/index');\n\nconst PORT = process.env.PORT || 3000;\n\napp.listen(PORT, () => {\n  console.log(`Server listening on http://localhost:${PORT}`);\n});\n");
  fs.seedFile(`${p}/.env`, 'NODE_ENV=development\nPORT=3000\nDATABASE_URL=postgres://dev:secret@localhost:5432/myapp\nAPI_KEY=sk_test_51Hxxxxxxxxxxxxxxxx\n', { mode: 0o644 });
  fs.seedFile(`${p}/.gitignore`, 'node_modules\n.env\nlogs/*.log\n');
  fs.seedFile(`${p}/TODO.md`, '# TODO\n\n- [ ] Add pagination to /api/users\n- [ ] Rotate logs\n- [x] Health check endpoint\n- [ ] TODO: remove debug logging before release\n');
  fs.seedFile(`${p}/src/index.js`, "const express = require('express');\nconst users = require('./routes/users');\nconst orders = require('./routes/orders');\nconst { logger } = require('./utils');\n\nconst app = express();\n\n// TODO: add request id middleware\napp.use(express.json());\napp.use('/api/users', users);\napp.use('/api/orders', orders);\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\n\nlogger.info('App configured');\n\nmodule.exports = app;\n");
  fs.seedFile(`${p}/src/utils.js`, "function logger(level, msg) {\n  console.log(`${new Date().toISOString()} ${level} ${msg}`);\n}\n\nlogger.info = (msg) => logger('INFO', msg);\nlogger.error = (msg) => logger('ERROR', msg);\n\n// FIXME: this does not handle negative numbers\nfunction formatPrice(cents) {\n  return '$' + (cents / 100).toFixed(2);\n}\n\nmodule.exports = { logger, formatPrice };\n");
  fs.seedFile(`${p}/src/routes/users.js`, "const router = require('express').Router();\nconst users = require('../../data/users.json');\n\nrouter.get('/', (req, res) => res.json(users));\n\n// TODO: validate the id parameter\nrouter.get('/:id', (req, res) => {\n  const user = users.find((u) => u.id === Number(req.params.id));\n  if (!user) return res.status(404).json({ error: 'not found' });\n  res.json(user);\n});\n\nmodule.exports = router;\n");
  fs.seedFile(`${p}/src/routes/orders.js`, "const router = require('express').Router();\n\nrouter.get('/', (req, res) => res.json([]));\n\nrouter.post('/', (req, res) => {\n  // TODO: persist the order\n  console.log('DEBUG order payload', req.body);\n  res.status(201).json({ id: 1001 });\n});\n\nmodule.exports = router;\n");
  fs.seedFile(`${p}/data/users.json`, USERS_JSON);
  fs.seedFile(`${p}/data/users.csv`, USERS_CSV);
  fs.seedFile(`${p}/logs/app.log`, appLog());
  fs.seedFile(`${p}/logs/access.log`, accessLog());
  fs.seedFile(`${p}/scripts/deploy.sh`, '#!/bin/bash\n# Deploy the current build to a server.\nset -euo pipefail\n\nTARGET="${1:-staging}"\n\necho "Building myapp..."\necho "Deploying to $TARGET..."\necho "Done."\n');
  fs.seedFile(`${p}/scripts/backup.sh`, '#!/bin/bash\n# Archive the data directory.\ntar -czf "/tmp/myapp-data-$(date +%F).tar.gz" data\n', { mode: 0o755 });

  fs.seedFile('/etc/nginx/nginx.conf', 'user www-data;\nworker_processes auto;\n\nevents {\n    worker_connections 768;\n}\n\nhttp {\n    access_log /var/log/nginx/access.log;\n    error_log /var/log/nginx/error.log;\n    include /etc/nginx/sites-enabled/*;\n}\n');
  fs.seedFile('/etc/nginx/sites-available/myapp', 'server {\n    listen 80;\n    server_name myapp.local;\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n    }\n}\n');
  fs.seedDir('/etc/nginx/sites-enabled');
  fs.seedFile('/var/log/nginx/access.log', accessLog(25), { owner: 'www-data', group: 'adm', mode: 0o640 });
  fs.seedFile('/var/log/nginx/error.log', '2026/11/16 09:31:07 [error] 812#812: *41 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.7, server: myapp.local, request: "GET /api/users HTTP/1.1", upstream: "http://127.0.0.1:3000/api/users"\n', { owner: 'www-data', group: 'adm', mode: 0o640 });
  fs.seedFile('/var/www/html/index.html', '<!DOCTYPE html>\n<html>\n<head><title>Welcome to nginx!</title></head>\n<body><h1>Welcome to nginx!</h1></body>\n</html>\n');
  fs.seedDir('/etc/myapp');
  fs.seedFile('/etc/systemd/system/myapp.service', '[Unit]\nDescription=myapp Node.js API\nAfter=network.target\n\n[Service]\nUser=dev\nWorkingDirectory=/home/dev/project\nEnvironmentFile=/etc/myapp/config.env\nExecStart=/usr/bin/node server.js\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n');
  return fs;
}

function createRemote(name: string, short: string, ip: string): Remote {
  const fs = new VirtualFS();
  baseSystem(fs, short);
  const deploy = { owner: 'deploy', group: 'deploy' };
  fs.groups.deploy = ['deploy', 'sudo'];
  fs.seedDir('/home/deploy', { ...deploy, mode: 0o750 });
  fs.seedDir('/home/deploy/.ssh', { ...deploy, mode: 0o700 });
  fs.seedFile('/home/deploy/.ssh/authorized_keys', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJq0ci-runner-key ci@buildserver\n', { mode: 0o600 });
  fs.seedFile('/home/deploy/.bashrc', "alias ll='ls -alF'\n");
  fs.seedDir('/var/www/myapp', deploy);
  fs.seedFile('/var/www/myapp/VERSION', short === 'prod' ? '1.4.1\n' : '1.4.2-rc1\n');
  fs.seedFile('/var/www/myapp/server.js', "require('./src/index').listen(process.env.PORT || 3000);\n");
  fs.seedFile('/var/www/myapp/logs/app.log', appLog().split('\n').slice(0, 14).join('\n') + `\n2026-11-16 09:41:55 ERROR Out of memory: worker 3 restarted\n`);
  fs.seedDir('/var/www/myapp/releases', deploy);
  const sys = new System(short);
  sys.shellPid = 3107;
  sys.procs.push({ pid: 1450, ppid: 1, user: 'deploy', cmd: 'node /var/www/myapp/server.js', cpu: 1.2, mem: 3.4, tty: '?', state: 'S', port: 3000, start: 'Nov12' });
  return { name, short, ip, fs, sys, users: ['deploy'] };
}

export function createRemotes(): Record<string, Remote> {
  return {
    'staging.example.com': createRemote('staging.example.com', 'staging', '203.0.113.10'),
    'prod.example.com': createRemote('prod.example.com', 'prod', '203.0.113.20'),
  };
}
