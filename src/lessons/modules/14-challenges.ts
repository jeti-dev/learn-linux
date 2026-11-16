import type { CheckState, Module } from '../types';
import { all, fileHas, linesOf, not, outHas, outIs, read, tried } from '../validators';
import { setupSshAccess } from './10-ssh';
import { LOGS, P, md } from './util';

const staging = (s: CheckState) => s.shell.remotes['staging.example.com'].fs;
const uniqueErrors = [...new Set(LOGS.errors.map((l) => l.replace(/^.*ERROR\s+/, '')))].sort();

export const challenges: Module = {
  id: 'challenge',
  title: 'Challenges',
  summary: 'Realistic scenarios with no walkthrough. Combine what you have learned.',
  challenge: true,
  lessons: [
    {
      id: 'ch-1',
      title: 'Incident: the site is down',
      summary: 'Users see errors on myapp.local. Diagnose and fix it.',
      setup: (sh) => {
        sh.fs.seedFile('/etc/hosts', sh.fs.readFile('/etc/hosts') + '127.0.0.1 myapp.local\n');
        sh.asUser('root', () => sh.fs.symlink('/etc/nginx/sites-available/myapp', '/etc/nginx/sites-enabled/myapp'));
      },
      steps: [
        {
          explain: md('Users report that `http://myapp.local` shows an error page. nginx on this machine forwards that site to the app on port 3000.'),
          task: 'Reproduce the problem from the terminal.',
          hints: ['Request the site with `curl`.', '`curl -i myapp.local`'],
          solution: ['curl -i myapp.local'],
          validate: all(tried(/myapp\.local/), outHas('502')),
        },
        {
          explain: md('A 502 from nginx means it could not reach the application behind it.'),
          task: 'Find the reason the application is not running.',
          hints: ['Is anything listening on port 3000? Which service should be?', 'Look at `systemctl status myapp` and `journalctl -u myapp`.'],
          solution: ['journalctl -u myapp -n 20'],
          validate: outHas('/etc/myapp/config.env'),
        },
        {
          explain: md('You know what is missing.'),
          task: 'Fix the cause and get the `myapp` service running.',
          hints: ['The service needs `/etc/myapp/config.env` with a `PORT=3000` line.', '`echo "PORT=3000" | sudo tee /etc/myapp/config.env`, then `sudo systemctl restart myapp`.'],
          solution: ['echo "PORT=3000" | sudo tee /etc/myapp/config.env', 'sudo systemctl restart myapp'],
          validate: (s) => s.shell.localSys.units.get('myapp')?.active === 'active',
        },
        {
          explain: md('The service reports active. Verify it the way a user would.'),
          task: 'Confirm that `myapp.local` answers correctly through nginx.',
          hints: ['`curl myapp.local`'],
          solution: ['curl myapp.local'],
          validate: all(tried(/myapp\.local/), outHas('Hello from myapp'), not(outHas('502'))),
        },
      ],
    },
    {
      id: 'ch-2',
      title: 'Log forensics',
      summary: 'Answer questions about traffic and errors using only pipelines.',
      cwd: P,
      steps: [
        {
          explain: md('The access log is `logs/access.log`. The status code is the ninth space-separated field.'),
          task: 'Print the number of requests that returned status `500`. The output must be just the number.',
          hints: ['Filter with `awk`, then count lines.', "`awk '$9 == 500' logs/access.log | wc -l`"],
          solution: ["awk '$9 == 500' logs/access.log | wc -l"],
          validate: outIs(String(LOGS.status500.length)),
        },
        {
          explain: md('Next question from the security team.'),
          task: 'Which IP address made the most requests? Print a ranking of request counts per IP, with the busiest on the first line.',
          hints: ['Extract field 1, sort, count duplicates, sort by count.', "`awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn`"],
          solution: ["awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn"],
          validate: (s) => new RegExp(`^\\s*${LOGS.topIp[1]}\\s+${LOGS.topIp[0].replace(/\./g, '\\.')}\\s*$`).test(linesOf(s.out)[0] ?? ''),
        },
        {
          explain: md('Now the application log, `logs/app.log`. Each line is `date time LEVEL message`.'),
          task: 'Write the distinct `ERROR` messages (the text after the level, without date and time) to `errors.txt`, sorted alphabetically, one per line.',
          hints: ['`grep` the lines, strip the prefix with `sed`, then `sort -u`.', "`grep ERROR logs/app.log | sed 's/.*ERROR *//' | sort -u > errors.txt`"],
          solution: ["grep ERROR logs/app.log | sed 's/.*ERROR *//' | sort -u > errors.txt"],
          validate: (s) => linesOf(read(s.fs, `${P}/errors.txt`) ?? '').join('\n') === uniqueErrors.join('\n'),
        },
        {
          explain: md('Finally, preserve the evidence.'),
          task: 'Create a gzip-compressed archive of the `logs` directory at `/tmp/logs.tar.gz`.',
          hints: ['`tar -czf /tmp/logs.tar.gz logs`'],
          solution: ['tar -czf /tmp/logs.tar.gz logs'],
          validate: all(fileHas('/tmp/logs.tar.gz', /access\.log/), fileHas('/tmp/logs.tar.gz', /"gz":true/)),
        },
      ],
    },
    {
      id: 'ch-3',
      title: 'Ship a release',
      summary: 'Package the app, copy it to staging and unpack it there.',
      cwd: P,
      setup: setupSshAccess,
      steps: [
        {
          explain: md('Your SSH key is already installed for `deploy@staging.example.com`. A release consists of `src`, `package.json` and `server.js`.'),
          task: 'Create `release.tar.gz` in the project directory containing those three items.',
          hints: ['`tar -czf release.tar.gz src package.json server.js`'],
          solution: ['tar -czf release.tar.gz src package.json server.js'],
          validate: all(fileHas(`${P}/release.tar.gz`, /"path":"src"/), fileHas(`${P}/release.tar.gz`, /"path":"package\.json"/), fileHas(`${P}/release.tar.gz`, /"path":"server\.js"/)),
        },
        {
          explain: md('Releases on the server live under `/var/www/myapp/releases/`.'),
          task: 'Upload `release.tar.gz` to `/var/www/myapp/releases/` on staging.',
          hints: ['`scp release.tar.gz deploy@staging.example.com:/var/www/myapp/releases/`'],
          solution: ['scp release.tar.gz deploy@staging.example.com:/var/www/myapp/releases/'],
          validate: (s) => staging(s).lookupRaw('/var/www/myapp/releases/release.tar.gz')?.type === 'file',
        },
        {
          explain: md('The archive is on the server but still packed. You can open a remote shell, or pass the commands to `ssh` in quotes.'),
          task: 'On staging, extract the archive into a new directory `/var/www/myapp/releases/v1.5.0`.',
          hints: ['Create the directory first, then use `tar -xzf ... -C ...`.', "`ssh deploy@staging.example.com 'mkdir /var/www/myapp/releases/v1.5.0 && tar -xzf /var/www/myapp/releases/release.tar.gz -C /var/www/myapp/releases/v1.5.0'`"],
          solution: ["ssh deploy@staging.example.com 'mkdir /var/www/myapp/releases/v1.5.0 && tar -xzf /var/www/myapp/releases/release.tar.gz -C /var/www/myapp/releases/v1.5.0'"],
          validate: (s) => staging(s).lookupRaw('/var/www/myapp/releases/v1.5.0/server.js')?.type === 'file' && staging(s).lookupRaw('/var/www/myapp/releases/v1.5.0/src/index.js')?.type === 'file',
        },
        {
          explain: md('Leave the server if you are still connected.'),
          task: 'From your own machine, list the extracted release on staging with a single `ssh` command.',
          hints: ['`ssh deploy@staging.example.com ls /var/www/myapp/releases/v1.5.0`'],
          solution: ['ssh deploy@staging.example.com ls /var/www/myapp/releases/v1.5.0'],
          validate: all((s) => s.shell.remoteDepth === 0, tried(/^ssh\b/), outHas('server.js'), outHas('package.json')),
        },
      ],
    },
  ],
};
