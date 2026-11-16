import type { Shell } from '../../engine/shell/Shell';
import type { CheckState, Module } from '../types';
import { all, exitCode, fileHas, isFile, modeIs, outHas, outIs, ran, read, tried } from '../validators';
import { md } from './util';

const HOST = 'staging.example.com';
const stagingFs = (s: CheckState) => s.shell.remotes[HOST].fs;

/** True once the learner's public key is installed for deploy@staging. */
const keyInstalled = (s: CheckState) => {
  const pub = read(s.fs, '~/.ssh/id_ed25519.pub');
  const id = pub ? /KEYID:(\S+)/.exec(pub)?.[1] : null;
  const auth = stagingFs(s).lookupRaw('/home/deploy/.ssh/authorized_keys');
  return !!id && auth?.type === 'file' && auth.content.includes(id);
};

/** Give later lessons a working key so they can start where the first one ended. */
export function setupSshAccess(sh: Shell): void {
  sh.run('ssh-keygen -t ed25519 -C dev@example.com');
  sh.run(`ssh-copy-id deploy@${HOST}`);
}

export const ssh: Module = {
  id: 'ssh',
  title: 'SSH and remote work',
  summary: 'Set up keys, log in to a server, run remote commands and copy files.',
  lessons: [
    {
      id: 'ssh-1',
      title: 'Keys and logging in',
      summary: 'Create a key pair, install it on a server and open a remote shell.',
      steps: [
        {
          explain: md('`ssh user@host` opens a shell on another machine. There is a staging server at `staging.example.com` with an account called `deploy`. It accepts keys only, no passwords, which is the usual setup.'),
          task: 'Try to log in as `deploy` on `staging.example.com`.',
          hints: ['`ssh deploy@staging.example.com`', 'It will be refused; that is expected.'],
          solution: [`ssh deploy@${HOST}`],
          validate: all(tried(/^ssh\b/), exitCode(255)),
        },
        {
          explain: md(
            '"Permission denied (publickey)" means the server did not recognise any key you offered. You do not have one yet.',
            'An SSH key is a pair of files: a **private key** that never leaves your machine, and a **public key** you can hand to any server. `ssh-keygen` creates both. `ed25519` is the modern key type, and `-C` adds a comment so you can tell keys apart later.',
          ),
          task: 'Generate an `ed25519` key pair.',
          hints: ['`ssh-keygen -t ed25519 -C "dev@example.com"`'],
          solution: ['ssh-keygen -t ed25519 -C "dev@example.com"'],
          validate: all(isFile('~/.ssh/id_ed25519'), isFile('~/.ssh/id_ed25519.pub')),
        },
        {
          explain: md('Look at what was created with `ls -l ~/.ssh`. The private key `id_ed25519` is `rw-------`: only you can read it, and SSH refuses to use it otherwise. The `.pub` file is the part you share.'),
          task: 'Print your public key.',
          hints: ['`cat ~/.ssh/id_ed25519.pub`'],
          solution: ['cat ~/.ssh/id_ed25519.pub'],
          validate: all(tried(/\.pub/), outHas(/^ssh-ed25519 /)),
        },
        {
          explain: md('A server lets you in if your public key is listed in `~/.ssh/authorized_keys` of the account you log in to. `ssh-copy-id` appends it there for you. Normally it asks for the account password once; here that part is simulated.'),
          task: 'Install your public key for `deploy` on the staging server.',
          hints: ['`ssh-copy-id deploy@staging.example.com`'],
          solution: [`ssh-copy-id deploy@${HOST}`],
          validate: keyInstalled,
        },
        {
          explain: md('Now the server knows your key.'),
          task: 'Log in to the staging server.',
          hints: ['`ssh deploy@staging.example.com`'],
          solution: [`ssh deploy@${HOST}`],
          validate: (s) => s.shell.remoteDepth === 1,
        },
        {
          explain: md('Look at the prompt: `deploy@staging`. Every command you type now runs **on the server**. It has its own files, processes and users.'),
          task: 'On the server, print the file `/var/www/myapp/VERSION`.',
          hints: ['`cat /var/www/myapp/VERSION`'],
          solution: ['cat /var/www/myapp/VERSION'],
          validate: all((s) => s.shell.remoteDepth === 1, outHas('1.4.2-rc1')),
        },
        {
          explain: md('`exit` (or Ctrl+D on a real terminal) closes the remote shell and returns you to your own machine. Always check the prompt before running anything destructive.'),
          task: 'Leave the server.',
          hints: ['`exit`'],
          solution: ['exit'],
          validate: all(tried(/^(exit|logout)\b/), (s) => s.shell.remoteDepth === 0),
        },
      ],
    },
    {
      id: 'ssh-2',
      title: 'Config, remote commands and scp',
      summary: 'Shorter logins, one-off remote commands and copying files both ways.',
      setup: setupSshAccess,
      steps: [
        {
          explain: md('Your key is already installed on the staging server in this lesson.', 'If you add a command after the host, `ssh` runs just that command remotely, prints its output here, and returns. It is ideal for quick checks and for scripts.'),
          task: 'Without opening a remote shell, print the last 3 lines of `/var/www/myapp/logs/app.log` on staging.',
          hints: ['`ssh deploy@staging.example.com tail -n 3 /var/www/myapp/logs/app.log`'],
          solution: [`ssh deploy@${HOST} tail -n 3 /var/www/myapp/logs/app.log`],
          validate: all(outHas('Out of memory'), (s) => s.shell.remoteDepth === 0),
        },
        {
          explain: md(
            'Typing `deploy@staging.example.com` gets old. `~/.ssh/config` lets you define short names:',
            '```\nHost staging\n  HostName staging.example.com\n  User deploy\n```',
            'Create it with `nano ~/.ssh/config`, or in one line with `printf`, where `\\n` is a line break.',
          ),
          task: 'Create `~/.ssh/config` with a host alias `staging` for user `deploy` on `staging.example.com`.',
          hints: ['`printf "Host staging\\n  HostName staging.example.com\\n  User deploy\\n" > ~/.ssh/config`'],
          solution: ['printf "Host staging\\n  HostName staging.example.com\\n  User deploy\\n" > ~/.ssh/config'],
          validate: all(fileHas('~/.ssh/config', /^\s*Host\s+staging\s*$/m), fileHas('~/.ssh/config', /^\s*HostName\s+staging\.example\.com\s*$/im), fileHas('~/.ssh/config', /^\s*User\s+deploy\s*$/im)),
        },
        {
          explain: md('The alias now works everywhere SSH is used, including `scp` and `git`.'),
          task: 'Use the alias to run `hostname` on the server.',
          hints: ['`ssh staging hostname`'],
          solution: ['ssh staging hostname'],
          validate: all(ran(/^ssh\s+staging\b/), outIs('staging')),
        },
        {
          explain: md('`scp` copies files over SSH. It works like `cp`, except that one side is written as `host:path`. A relative remote path starts from the remote home directory.'),
          task: 'Upload `project/README.md` to `/tmp/` on staging.',
          hints: ['`scp project/README.md staging:/tmp/`'],
          solution: ['scp project/README.md staging:/tmp/'],
          validate: (s) => stagingFs(s).lookupRaw('/tmp/README.md')?.type === 'file',
        },
        {
          explain: md('The other direction: put the remote path first and a local destination second. A dot means "here".'),
          task: 'Download `/var/www/myapp/logs/app.log` from staging into your current directory.',
          hints: ['`scp staging:/var/www/myapp/logs/app.log .`'],
          solution: ['scp staging:/var/www/myapp/logs/app.log .'],
          validate: fileHas('~/app.log', /Out of memory/),
        },
        {
          explain: md('One more thing that bites everyone eventually. Someone "fixed" the permissions of your private key. Try `ssh staging` and read the warning.', 'SSH ignores a private key that other users could read.'),
          setup: (sh) => sh.fs.chmod('/home/dev/.ssh/id_ed25519', 0o644),
          task: 'Restore the correct permissions on `~/.ssh/id_ed25519` so that SSH accepts it again.',
          hints: ['Private keys must be readable by the owner only.', '`chmod 600 ~/.ssh/id_ed25519`'],
          solution: ['chmod 600 ~/.ssh/id_ed25519'],
          validate: modeIs('~/.ssh/id_ed25519', 0o600),
        },
      ],
    },
  ],
};
