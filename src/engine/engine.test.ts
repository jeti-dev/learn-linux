import { beforeEach, describe, expect, it } from 'vitest';
import { Shell } from './shell/Shell';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
let sh: Shell;
const run = (line: string) => {
  const r = sh.run(line);
  return {
    out: strip(r.chunks.filter((c) => c.s === 'out').map((c) => c.text).join('')),
    err: strip(r.chunks.filter((c) => c.s === 'err').map((c) => c.text).join('')),
    code: r.exitCode,
    r,
  };
};
const out = (line: string) => run(line).out;

beforeEach(() => {
  sh = new Shell();
});

describe('shell syntax', () => {
  it('handles quoting and variables', () => {
    run('NAME=world');
    expect(out('echo "hello $NAME"')).toBe('hello world\n');
    expect(out("echo 'hello $NAME'")).toBe('hello $NAME\n');
    expect(out('echo hello\\ $NAME ${NAME}s "${NAME:-x}" ${MISSING:-fallback}')).toBe('hello world worlds world fallback\n');
    expect(out('echo "a  b"   c')).toBe('a  b c\n');
    expect(out('echo ""')).toBe('\n');
  });

  it('expands command substitution and arithmetic', () => {
    expect(out('echo "in $(pwd) with $(ls | wc -l) entries"')).toBe('in /home/dev with 3 entries\n');
    expect(out('echo $((2 + 3 * 4))')).toBe('14\n');
    run('n=5');
    expect(out('echo $((n + 1))')).toBe('6\n');
  });

  it('expands globs, braces and tilde', () => {
    run('cd project');
    expect(out('echo *.md')).toBe('README.md TODO.md\n');
    expect(out('echo src/*.js')).toBe('src/index.js src/utils.js\n');
    expect(out('echo "*.md" nomatch*')).toBe('*.md nomatch*\n');
    expect(out('echo ~ ~/x')).toBe('/home/dev /home/dev/x\n');
    expect(out('echo f{1..3} {a,b}.txt')).toBe('f1 f2 f3 a.txt b.txt\n');
    expect(out('echo .e*')).toBe('.env\n');
  });

  it('pipes, redirects and chains', () => {
    run('cd project');
    expect(out('cat data/users.csv | grep developer | wc -l')).toBe('4\n');
    run('echo one > /tmp/t.txt; echo two >> /tmp/t.txt');
    expect(out('cat /tmp/t.txt')).toBe('one\ntwo\n');
    expect(out('wc -l < /tmp/t.txt')).toBe('2\n');
    expect(out('false && echo yes || echo no')).toBe('no\n');
    expect(out('true && echo yes')).toBe('yes\n');
    const r = run('ls nope 2> /tmp/err.txt');
    expect(r.err).toBe('');
    expect(out('cat /tmp/err.txt')).toContain('No such file');
    expect(run('ls nope > /dev/null 2>&1').err).toBe('');
    expect(out('ls nope 2>&1 | wc -l')).toBe('1\n');
    expect(out('echo $?')).toBe('0\n');
    run('false');
    expect(out('echo $?')).toBe('1\n');
  });

  it('reports syntax problems and unsupported features', () => {
    expect(run('echo hi |').r.incomplete).toBe(true);
    expect(run('echo "open').r.incomplete).toBe(true);
    expect(run('if true; then').r.incomplete).toBe(true);
    expect(run('cat <<EOF').err).toContain('not supported in this simulator');
    expect(run('echo `date`').err).toContain('$(...)');
    expect(run('nosuchcmd').err).toBe('nosuchcmd: command not found\n');
    expect(run('nosuchcmd').code).toBe(127);
  });

  it('runs control flow and functions', () => {
    expect(out('for i in 1 2 3; do echo "n=$i"; done')).toBe('n=1\nn=2\nn=3\n');
    expect(out('if [ -f /etc/hosts ]; then echo yes; else echo no; fi')).toBe('yes\n');
    expect(out('if [ -d /nope ]; then echo yes; elif [ 3 -gt 2 ]; then echo mid; fi')).toBe('mid\n');
    expect(out('i=0; while [ $i -lt 3 ]; do i=$((i+1)); done; echo $i')).toBe('3\n');
    run('greet() { echo "hi $1"; }');
    expect(out('greet bob')).toBe('hi bob\n');
    expect(out('for f in /etc/host*; do echo $f; done')).toBe('/etc/hostname\n/etc/hosts\n');
    expect(run('for i in 1 2\ndo\necho $i\ndone').out).toBe('1\n2\n');
  });

  it('handles aliases, history expansion and exports', () => {
    expect(out('type ll')).toContain('aliased to');
    expect(out('ll -d /tmp')).toContain('drwxrwxrwt');
    run("alias hi='echo hello'");
    expect(out('hi there')).toBe('hello there\n');
    run('echo first');
    expect(out('!!')).toBe('first\n');
    run('FOO=bar');
    run('echo \'echo "FOO=$FOO"\' > /tmp/s.sh');
    expect(out('bash /tmp/s.sh')).toBe('FOO=\n');
    run('export FOO');
    expect(out('bash /tmp/s.sh')).toBe('FOO=bar\n');
    expect(out('FOO=tmp bash /tmp/s.sh')).toBe('FOO=tmp\n');
    expect(out('env | grep ^FOO')).toBe('FOO=bar\n');
  });

  it('runs scripts with arguments, exit codes and set -e', () => {
    run('cd project');
    expect(run('./scripts/deploy.sh').err).toContain('Permission denied');
    run('chmod +x scripts/deploy.sh');
    expect(out('./scripts/deploy.sh prod')).toBe('Building myapp...\nDeploying to prod...\nDone.\n');
    expect(out('./scripts/deploy.sh')).toContain('Deploying to staging');
    run('printf \'#!/bin/bash\\nset -e\\necho a\\nfalse\\necho b\\n\' > /tmp/e.sh');
    const r = run('bash /tmp/e.sh');
    expect(r.out).toBe('a\n');
    expect(r.code).toBe(1);
    run('printf \'echo "$# args: $@"\\nexit 3\\n\' > /tmp/a.sh');
    const a = run('bash /tmp/a.sh x y');
    expect(a.out).toBe('2 args: x y\n');
    expect(a.code).toBe(3);
  });
});

describe('file commands', () => {
  it('navigates', () => {
    expect(out('pwd')).toBe('/home/dev\n');
    run('cd project/src');
    expect(out('pwd')).toBe('/home/dev/project/src\n');
    run('cd ../..');
    expect(out('pwd')).toBe('/home/dev\n');
    run('cd /var/log');
    expect(out('cd -')).toBe('/home/dev\n');
    expect(run('cd nope').err).toBe('bash: cd: nope: No such file or directory\n');
    expect(run('cd /root').err).toContain('Permission denied');
    expect(out('ls')).toBe('Documents  Downloads  project\n');
    expect(out('ls -a')).toContain('.bashrc');
    expect(out('ls -l project/package.json')).toMatch(/^-rw-r--r-- 1 dev dev \d+ Nov {2}2 09:14 project\/package.json\n$/);
  });

  it('creates, copies, moves and removes', () => {
    run('mkdir -p a/b/c && touch a/b/c/f.txt');
    expect(out('find a')).toBe('a\na/b\na/b/c\na/b/c/f.txt\n');
    run('cp -r a a2 && mv a2 a3');
    expect(out('ls a3/b/c')).toBe('f.txt\n');
    expect(run('rm a').err).toContain('Is a directory');
    expect(run('cp a x').err).toContain('-r not specified');
    run('rm -r a a3');
    expect(out('ls')).toBe('Documents  Downloads  project\n');
    expect(run('rmdir Documents').err).toContain('Directory not empty');
    run('ln -s project/README.md link');
    expect(out('head -n 1 link')).toBe('# myapp\n');
    expect(out('ls -l link')).toContain('link -> project/README.md');
  });

  it('views files', () => {
    run('cd project');
    expect(out('head -n 2 data/users.csv')).toBe('id,name,email,role,city\n1,Ada Lovelace,ada@example.com,admin,London\n');
    expect(out('tail -n 1 data/users.csv')).toContain('Barbara');
    expect(out('tail -n +7 data/users.csv | wc -l')).toBe('2\n');
    expect(out('cat -n TODO.md | head -1')).toBe('     1\t# TODO\n');
    expect(run('cat nope').err).toBe('cat: nope: No such file or directory\n');
  });

  it('archives', () => {
    run('cd project');
    run('tar -czf /tmp/data.tar.gz data');
    expect(out('tar -tzf /tmp/data.tar.gz')).toBe('data/\ndata/users.csv\ndata/users.json\n');
    run('mkdir /tmp/x && tar -xzf /tmp/data.tar.gz -C /tmp/x');
    expect(out('ls /tmp/x/data')).toBe('users.csv  users.json\n');
    expect(out('file /tmp/data.tar.gz')).toContain('gzip compressed');
  });
});

describe('search and text', () => {
  beforeEach(() => run('cd project'));

  it('greps', () => {
    expect(out('grep -c ERROR logs/app.log')).toMatch(/^\d+\n$/);
    expect(out('grep -rn TODO src | head -1')).toBe('src/index.js:8:// TODO: add request id middleware\n');
    expect(out('grep -rl TODO .')).toContain('./TODO.md');
    expect(out('grep -i ADA data/users.csv | cut -d, -f2')).toBe('Ada Lovelace\n');
    expect(out('grep -v developer data/users.csv | wc -l')).toBe('4\n');
    expect(out('grep -E "admin|ops" data/users.csv | wc -l')).toBe('3\n');
    expect(out('grep -o "[a-z]*@example.com" data/users.csv | head -2')).toBe('ada@example.com\nlinus@example.com\n');
    expect(run('grep zzz data/users.csv').code).toBe(1);
  });

  it('finds', () => {
    expect(out('find . -name "*.js" | sort')).toBe('./server.js\n./src/index.js\n./src/routes/orders.js\n./src/routes/users.js\n./src/utils.js\n');
    expect(out('find src -type d')).toBe('src\nsrc/routes\n');
    expect(out('find . -maxdepth 1 -name "*.md" | wc -l')).toBe('2\n');
    expect(out('find . -name "*.csv" -exec wc -l {} \\;')).toBe('8 ./data/users.csv\n');
    expect(out('find . -name "*.js" | xargs grep -l TODO | wc -l')).toBe('3\n');
  });

  it('sorts, counts and cuts', () => {
    expect(out('cut -d, -f4 data/users.csv | tail -n +2 | sort | uniq -c | sort -rn | head -1')).toBe('      4 developer\n');
    expect(out('sort -t, -k2 data/users.csv | head -2 | cut -d, -f2')).toBe('Ada Lovelace\nBarbara Liskov\n');
    expect(out('echo hello | tr a-z A-Z')).toBe('HELLO\n');
    expect(out('wc -l data/users.csv')).toBe('8 data/users.csv\n');
    expect(out('printf "b\\na\\nb\\n" | sort -u')).toBe('a\nb\n');
    expect(out('printf "10\\n9\\n100\\n" | sort -n | tail -1')).toBe('100\n');
  });

  it('seds', () => {
    expect(out("echo 'a b a' | sed 's/a/X/'")).toBe('X b a\n');
    expect(out("echo 'a b a' | sed 's/a/X/g'")).toBe('X b X\n');
    expect(out("sed -n '2,3p' data/users.csv | wc -l")).toBe('2\n');
    expect(out("sed '1d' data/users.csv | head -1")).toContain('Ada');
    expect(out("echo 'port=3000' | sed -E 's/([a-z]+)=([0-9]+)/\\2:\\1/'")).toBe('3000:port\n');
    run("sed -i 's/PORT=3000/PORT=8080/' .env");
    expect(out('grep PORT .env')).toBe('PORT=8080\n');
    expect(out("grep -c TODO TODO.md; sed '/TODO/d' TODO.md | grep -c TODO")).toBe('2\n0\n');
  });

  it('awks', () => {
    expect(out("awk -F, '{print $2}' data/users.csv | head -2")).toBe('name\nAda Lovelace\n');
    expect(out("awk -F, 'NR > 1 && $4 == \"admin\" {print $2 \" (\" $5 \")\"}' data/users.csv")).toBe('Ada Lovelace (London)\nBarbara Liskov (Boston)\n');
    expect(out("awk -F, '{sum += $2} END {print sum}' ~/Downloads/report-q3.csv")).toBe('59850\n');
    expect(out("awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn | head -1")).toMatch(/^\s+\d+ 203\.0\.113\.7\n$/);
    expect(out("awk '$9 >= 500' logs/access.log | wc -l")).toBe(out('grep -c "\\" 500 " logs/access.log'));
    expect(out("awk -F, 'NR>1 {c[$4]++} END {for (k in c) print k, c[k]}' data/users.csv | sort")).toBe('admin 2\ndeveloper 4\nops 1\n');
    expect(out("awk '/ERROR/ {n++} END {print n}' logs/app.log")).toBe(out('grep -c ERROR logs/app.log'));
    expect(out("echo 'a b c' | awk '{print NF, $NF}'")).toBe('3 c\n');
    expect(out("echo 'x 2.50' | awk '{printf \"%s costs %.1f\\n\", $1, $2}'")).toBe('x costs 2.5\n');
  });

  it('jqs', () => {
    expect(out("jq '.[0].name' data/users.json")).toBe('"Ada Lovelace"\n');
    expect(out("jq -r '.[].email' data/users.json | wc -l")).toBe('5\n');
    expect(out("jq 'length' data/users.json")).toBe('5\n');
    expect(out("jq -r '.[] | select(.role == \"developer\" and .active) | .name' data/users.json")).toBe('Linus Torvalds\nMargaret Hamilton\n');
    expect(out("jq -c '[.[] | {id, name}] | .[0]' data/users.json")).toBe('{"id":1,"name":"Ada Lovelace"}\n');
    expect(out("jq -r '.scripts.start' package.json")).toBe('node server.js\n');
    expect(out("jq -c 'map(.id)' data/users.json")).toBe('[1,2,3,4,5]\n');
    expect(out("jq 'keys' package.json | head -2")).toBe('[\n  "dependencies",\n');
  });

  it('diffs', () => {
    run('cp .env .env.bak && sed -i "s/3000/4000/" .env');
    const d = run('diff .env.bak .env');
    expect(d.code).toBe(1);
    expect(d.out).toBe('2c2\n< PORT=3000\n---\n> PORT=4000\n');
    expect(out('diff -u .env.bak .env')).toContain('-PORT=3000\n+PORT=4000\n');
  });
});

describe('permissions', () => {
  it('enforces and changes modes', () => {
    expect(run('cat /var/log/auth.log').err).toBe('cat: /var/log/auth.log: Permission denied\n');
    expect(out('sudo cat /var/log/auth.log')).toContain('Failed password');
    expect(run('echo x > /etc/motd').err).toBe('bash: /etc/motd: Permission denied\n');
    expect(run('sudo echo x > /etc/motd').err).toContain('Permission denied');
    run('echo x | sudo tee /etc/motd');
    expect(out('cat /etc/motd')).toBe('x\n');
    run('touch f && chmod 600 f');
    expect(out('ls -l f')).toMatch(/^-rw-------/);
    run('chmod u+x,g+r f');
    expect(out('stat f')).toContain('(0740/-rwxr-----)');
    expect(run('chmod 644 /etc/hosts').err).toContain('Operation not permitted');
    expect(run('chown root f').err).toContain('Operation not permitted');
    run('sudo chown root:root f');
    expect(out('ls -l f')).toContain('root root');
    expect(out('whoami; sudo whoami')).toBe('dev\nroot\n');
  });
});

describe('processes', () => {
  it('lists, backgrounds and kills', () => {
    expect(out('ps aux')).toContain('nginx: master process');
    expect(out('ps')).toContain('bash');
    const bg = run('sleep 100 &');
    expect(bg.out).toMatch(/^\[1\] \d+\n$/);
    expect(out('jobs')).toContain('Running');
    expect(out('kill %1')).toContain('Terminated');
    expect(out('jobs')).toBe('');
    expect(run('kill 99999').err).toContain('No such process');
    const nginx = out('pgrep nginx').split('\n')[0];
    expect(run(`kill ${nginx}`).err).toContain('Operation not permitted');
  });

  it('simulates a server holding a port', () => {
    run('cd project');
    expect(run('curl -s localhost:3000/health').code).toBe(7);
    const start = run('node server.js &');
    expect(start.out).toContain('Server listening on http://localhost:3000');
    expect(out('curl -s localhost:3000/health')).toBe('{"status":"ok","uptime":318}\n');
    expect(out('ss -tlnp')).toContain('*:3000');
    expect(run('node server.js').err).toContain('EADDRINUSE');
    expect(out('PORT=4000 node server.js &')).toContain(':4000');
    const pid = out('lsof -i :3000').split('\n')[1].trim().split(/\s+/)[1];
    run(`kill ${pid}`);
    expect(run('curl -s localhost:3000/health').code).toBe(7);
    run('npm start');
    expect(sh.foreground).toBeDefined();
    expect(sh.interrupt()[0].text).toBe('^C\n');
    expect(sh.foreground).toBeUndefined();
    run('npm start');
    expect(sh.suspend()[0].text).toContain('Stopped');
    expect(out('jobs')).toContain('Stopped');
    expect(out('bg')).toContain('npm start &');
  });
});

describe('network and ssh', () => {
  it('curls', () => {
    expect(out('curl -s api.example.com/users | jq length')).toBe('2\n');
    expect(out('curl -sI example.com | head -1')).toBe('HTTP/1.1 200 OK\n');
    expect(run('curl nope.invalid').err).toContain('Could not resolve host');
    expect(out('curl -s -o /dev/null -w "%{http_code}" api.example.com/nope')).toBe('404');
    expect(out('curl -s -X POST -H "Content-Type: application/json" -d \'{"name":"Eve"}\' api.example.com/users')).toBe('{"id":6,"name":"Eve"}\n');
    expect(run('curl -s myapp.local').code).toBe(6);
    run('echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts');
    expect(out('curl -s myapp.local')).toContain('Welcome to nginx');
    expect(out('dig +short example.com')).toBe('93.184.215.14\n');
    expect(out('ping -c 2 example.com')).toContain('2 packets transmitted, 2 received');
  });

  it('sets up ssh keys and connects', () => {
    expect(run('ssh deploy@staging.example.com').err).toContain('Permission denied (publickey)');
    expect(out('ssh-keygen -t ed25519 -C dev@example.com')).toContain('Your public key has been saved');
    expect(out('ls -l ~/.ssh/id_ed25519')).toMatch(/^-rw-------/);
    run('ssh-copy-id deploy@staging.example.com');
    run('ssh deploy@staging.example.com');
    expect(sh.prompt().userHost).toBe('deploy@staging');
    expect(out('pwd; whoami; hostname')).toBe('/home/deploy\ndeploy\nstaging\n');
    expect(out('cat /var/www/myapp/VERSION')).toBe('1.4.2-rc1\n');
    expect(out('exit')).toContain('Connection to staging closed.');
    expect(sh.prompt().userHost).toBe('dev@ubuntu');
    expect(out('ssh deploy@staging.example.com cat /var/www/myapp/VERSION')).toBe('1.4.2-rc1\n');
    run('printf "Host staging\\n  HostName staging.example.com\\n  User deploy\\n" > ~/.ssh/config');
    expect(out('ssh staging hostname')).toBe('staging\n');
    run('scp project/README.md staging:/tmp/');
    expect(out('ssh staging ls /tmp')).toBe('README.md\n');
    run('scp staging:/var/www/myapp/VERSION .');
    expect(out('cat VERSION')).toBe('1.4.2-rc1\n');
    run('chmod 644 ~/.ssh/id_ed25519');
    expect(run('ssh staging').err).toContain('UNPROTECTED PRIVATE KEY FILE');
  });
});

describe('system', () => {
  it('manages packages', () => {
    expect(run('tree').err).toContain('sudo apt install tree');
    expect(run('apt install tree').err).toContain('are you root?');
    expect(out('sudo apt install -y tree')).toContain('Setting up tree');
    expect(out('tree -L 1 project | tail -1')).toBe('4 directories, 4 files\n');
    expect(out('which tree')).toBe('/usr/bin/tree\n');
    expect(out('apt list --installed | grep -c tree')).toBe('1\n');
  });

  it('manages services', () => {
    expect(out('systemctl is-active nginx')).toBe('active\n');
    expect(run('systemctl stop nginx').err).toContain('Access denied');
    run('sudo systemctl stop nginx');
    expect(out('systemctl is-active nginx')).toBe('inactive\n');
    expect(run('curl -s localhost').code).toBe(7);
    run('sudo systemctl start nginx');
    expect(out('systemctl status nginx')).toContain('active (running)');
    expect(out('systemctl status myapp')).toContain('failed');
    expect(out('journalctl -u myapp -n 5')).toContain('/etc/myapp/config.env');
    expect(run('sudo systemctl restart myapp').code).toBe(1);
    run('echo PORT=3000 | sudo tee /etc/myapp/config.env');
    expect(run('sudo systemctl restart myapp').code).toBe(0);
    expect(out('curl -s localhost:3000/health')).toContain('ok');
  });

  it('installs crontabs', () => {
    expect(run('crontab -l').err).toBe('no crontab for dev\n');
    run('echo "0 2 * * * /home/dev/project/scripts/backup.sh" | crontab -');
    expect(out('crontab -l')).toBe('0 2 * * * /home/dev/project/scripts/backup.sh\n');
    expect(run('echo "nonsense" | crontab -').code).toBe(1);
  });

  it('offers help', () => {
    expect(out('man grep')).toContain('NAME');
    expect(out('grep --help')).toContain('Usage: grep');
    expect(out('help')).toContain('Navigation');
  });
});
