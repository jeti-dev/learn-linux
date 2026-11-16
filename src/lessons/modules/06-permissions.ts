import type { Module } from '../types';
import { all, executable, exitCode, failed, fileHas, isDir, modeIs, outHas, ownedBy, ran, tried } from '../validators';
import { P, md } from './util';

export const permissions: Module = {
  id: 'perm',
  title: 'Permissions',
  summary: 'Read rwx, fix "Permission denied", and use sudo without fear.',
  lessons: [
    {
      id: 'perm-1',
      title: 'Reading and changing permissions',
      summary: 'What rwxr-xr-x means and how chmod changes it.',
      cwd: P,
      steps: [
        {
          explain: md(
            'Every file has an owner, a group, and three sets of permissions. `ls -l` shows them at the start of each line:',
            '```\n-rw-r--r-- 1 dev dev  152 Nov  2 09:14 deploy.sh\n```',
            'After the first character (`-` file, `d` directory) come three triplets: what the **owner** may do, what the **group** may do, and what **everyone else** may do. Each triplet is `r` read, `w` write, `x` execute, or `-` for "not allowed".',
          ),
          task: 'Show the permissions of the files in `scripts`.',
          hints: ['`ls -l scripts`'],
          solution: ['ls -l scripts'],
          validate: all(ran(/^(ls|ll)\b.*scripts/), outHas(/^-rw.*deploy\.sh$/m)),
        },
        {
          explain: md('`deploy.sh` shows `rw-` for its owner: readable and writable, but not executable. See what happens when you try to run it.'),
          task: 'Try to run `./scripts/deploy.sh`.',
          hints: ['Type `./scripts/deploy.sh` and expect an error.'],
          solution: ['./scripts/deploy.sh'],
          validate: all(tried(/deploy\.sh/), exitCode(126)),
        },
        {
          explain: md('"Permission denied" here means the execute bit is missing. `chmod` changes permissions, and `+x` adds execute:', '```\nchmod +x file\n```'),
          task: 'Make `scripts/deploy.sh` executable.',
          hints: ['`chmod +x scripts/deploy.sh`'],
          solution: ['chmod +x scripts/deploy.sh'],
          validate: executable(`${P}/scripts/deploy.sh`),
        },
        {
          explain: md('Check with `ls -l scripts`: the file is now `-rwxr-xr-x`, and it is shown in green.'),
          task: 'Run `./scripts/deploy.sh` again.',
          hints: ['`./scripts/deploy.sh`'],
          solution: ['./scripts/deploy.sh'],
          validate: all(ran(/deploy\.sh/), outHas('Done.')),
        },
        {
          explain: md(
            'Permissions are often written as three digits, one per triplet, where `r`=4, `w`=2, `x`=1 added together:',
            '- `644` is `rw-r--r--`: the normal mode for files\n- `755` is `rwxr-xr-x`: directories and scripts\n- `600` is `rw-------`: private to the owner',
            '`.env` contains an API key, and right now everyone on this machine can read it.',
          ),
          task: 'Make `.env` readable and writable by you only.',
          hints: ['`chmod 600 .env`'],
          solution: ['chmod 600 .env'],
          validate: modeIs(`${P}/.env`, 0o600),
        },
        {
          explain: md('On a directory the bits mean something slightly different: `r` lets you list it, `w` lets you create and delete entries, and `x` lets you enter it.'),
          task: 'Create a directory `private` that only you can list, modify and enter.',
          hints: ['Create it, then set mode `700`.', '`mkdir private && chmod 700 private`'],
          solution: ['mkdir private && chmod 700 private'],
          validate: all(isDir(`${P}/private`), modeIs(`${P}/private`, 0o700)),
        },
      ],
    },
    {
      id: 'perm-2',
      title: 'sudo and ownership',
      summary: 'Act as root for one command, and fix files owned by the wrong user.',
      cwd: P,
      setup: (sh) => {
        sh.fs.seedDir('/var/www/myapp');
        sh.fs.seedFile('/var/www/myapp/index.html', '<h1>myapp</h1>\n');
      },
      steps: [
        {
          explain: md('System files belong to `root`, the administrator account. As a normal user you can read most of them but change very few, and some you cannot read at all.'),
          task: 'Try to read `/var/log/auth.log`, the log of login attempts.',
          hints: ['`cat /var/log/auth.log`'],
          solution: ['cat /var/log/auth.log'],
          validate: all(tried(/auth\.log/), failed),
        },
        {
          explain: md('`sudo` runs **one command** as root. Your user is allowed to use it because it is in the `sudo` group.', 'A handy shortcut: `sudo !!` repeats the previous command with `sudo` in front.'),
          task: 'Read `/var/log/auth.log` as root.',
          hints: ['`sudo cat /var/log/auth.log`'],
          solution: ['sudo cat /var/log/auth.log'],
          validate: outHas('Failed password'),
        },
        {
          explain: md(
            'A classic trap: this does **not** work.',
            '```\nsudo echo "text" >> /etc/hosts\n```',
            'The redirection is done by your own shell before `sudo` even starts, so it still lacks permission. The fix is to let a root process do the writing: pipe into `sudo tee -a file` (`-a` appends).',
          ),
          task: 'Append the line `127.0.0.1 myapp.local` to `/etc/hosts`.',
          hints: ['`echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts`'],
          solution: ['echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts'],
          validate: all(fileHas('/etc/hosts', /^127\.0\.0\.1\s+myapp\.local\s*$/m), fileHas('/etc/hosts', /127\.0\.0\.1 localhost/)),
        },
        {
          explain: md(
            'Needing `sudo` for every change inside your own app directory is a sign that the files have the wrong owner. Look at `ls -l /var/www/myapp`.',
            '`chown owner:group` changes ownership, and `-R` applies it to everything inside. Changing ownership itself requires root.',
          ),
          task: 'Make `dev` the owner of `/var/www/myapp` and everything in it.',
          hints: ['`sudo chown -R dev:dev /var/www/myapp`'],
          solution: ['sudo chown -R dev:dev /var/www/myapp'],
          validate: all(ownedBy('/var/www/myapp', 'dev'), ownedBy('/var/www/myapp/index.html', 'dev')),
        },
        {
          explain: md('Now the directory is yours, and ordinary commands work in it.'),
          task: 'Without `sudo`, create `/var/www/myapp/VERSION` containing `1.5.0`.',
          hints: ['`echo 1.5.0 > /var/www/myapp/VERSION`'],
          solution: ['echo 1.5.0 > /var/www/myapp/VERSION'],
          validate: all(fileHas('/var/www/myapp/VERSION', /1\.5\.0/), ownedBy('/var/www/myapp/VERSION', 'dev')),
        },
      ],
    },
  ],
};
