import type { Module } from '../types';
import { all, any, exitCode, fileHas, hasFileBelow, outHas, ran, read, tried } from '../validators';
import { md } from './util';

export const system: Module = {
  id: 'sys',
  title: 'System administration',
  summary: 'Install packages, manage services, read their logs, and schedule jobs.',
  lessons: [
    {
      id: 'sys-1',
      title: 'Packages with apt',
      summary: 'Install software the Ubuntu way.',
      steps: [
        {
          explain: md('Ubuntu installs software as **packages** from its repositories, using `apt`. When you type a command that is not installed, Ubuntu usually tells you which package provides it.'),
          task: 'Try to run `tree`.',
          hints: ['Type `tree` and read the message.'],
          solution: ['tree'],
          validate: all(tried(/^tree\b/), exitCode(127)),
        },
        {
          explain: md('Before installing anything, refresh the list of available packages. `apt update` downloads the current index; it does not upgrade or install anything. It changes system state, so it needs `sudo`.'),
          task: 'Refresh the package index.',
          hints: ['`sudo apt update`'],
          solution: ['sudo apt update'],
          validate: (s) => s.shell.localSys.aptUpdated,
        },
        {
          explain: md('`apt install NAME` downloads a package and everything it depends on. In scripts, add `-y` to answer the confirmation question automatically.'),
          task: 'Install the `tree` package.',
          hints: ['`sudo apt install tree`'],
          solution: ['sudo apt install tree'],
          validate: (s) => !!s.shell.localSys.packages.get('tree')?.installed,
        },
        {
          explain: md('`tree` draws a directory as a tree. `-L 2` limits it to two levels.'),
          task: 'Show two levels of the `project` directory as a tree.',
          hints: ['`tree -L 2 project`'],
          solution: ['tree -L 2 project'],
          validate: all(ran(/^tree\b/), outHas('directories')),
        },
        {
          explain: md('Other `apt` commands you will use:', '- `apt search TERM` finds packages\n- `apt show NAME` describes one\n- `apt list --installed` lists what is installed\n- `sudo apt remove NAME` uninstalls'),
          task: 'Check whether `nginx` is installed.',
          hints: ['`apt list --installed | grep nginx`'],
          solution: ['apt list --installed | grep nginx'],
          validate: all(any(tried(/apt|dpkg/), tried(/which/)), outHas('nginx')),
        },
      ],
    },
    {
      id: 'sys-2',
      title: 'Services and logs',
      summary: 'systemctl and journalctl: find out why a service is down and bring it back.',
      steps: [
        {
          explain: md('Long-running programs such as web servers and databases are managed by **systemd** as services. `systemctl status NAME` shows whether one is running, its main PID, and its latest log lines.'),
          task: 'Check the status of the `nginx` service.',
          hints: ['`systemctl status nginx`'],
          solution: ['systemctl status nginx'],
          validate: all(ran(/systemctl\s+status\s+nginx/), outHas('active (running)')),
        },
        {
          explain: md('`systemctl list-units` gives an overview of every loaded service. A failed one stands out.'),
          task: 'List the services and find the one that has failed.',
          hints: ['`systemctl list-units`'],
          solution: ['systemctl list-units'],
          validate: all(tried(/systemctl/), outHas('myapp'), outHas('failed')),
        },
        {
          explain: md('Services do not print to your terminal. systemd collects their output in the **journal**, which you read with `journalctl`. `-u NAME` selects one service and `-n 20` shows the last 20 lines.'),
          task: 'Read the journal of the `myapp` service to find out why it failed.',
          hints: ['`journalctl -u myapp -n 20`'],
          solution: ['journalctl -u myapp -n 20'],
          validate: all(ran(/journalctl/), outHas('/etc/myapp/config.env')),
        },
        {
          explain: md('The service expects an environment file at `/etc/myapp/config.env` and it does not exist. You can see the requirement in the unit definition: `systemctl cat myapp`.', '`/etc` belongs to root, so remember the `sudo tee` technique.'),
          task: 'Create `/etc/myapp/config.env` containing the line `PORT=3000`.',
          hints: ['`echo "PORT=3000" | sudo tee /etc/myapp/config.env`'],
          solution: ['echo "PORT=3000" | sudo tee /etc/myapp/config.env'],
          validate: fileHas('/etc/myapp/config.env', /^PORT=\d+/m),
        },
        {
          explain: md('Changing a service needs root: `sudo systemctl start`, `stop` or `restart`. `restart` is the usual choice after a configuration change.'),
          task: 'Start the `myapp` service.',
          hints: ['`sudo systemctl restart myapp`'],
          solution: ['sudo systemctl restart myapp'],
          validate: (s) => s.shell.localSys.units.get('myapp')?.active === 'active',
        },
        {
          explain: md('Never trust "it started". Check the status, and check that it actually answers.'),
          task: 'Confirm that the app responds on `localhost:3000/health`.',
          hints: ['`curl localhost:3000/health`'],
          solution: ['curl localhost:3000/health'],
          validate: outHas('"status":"ok"'),
        },
        {
          explain: md('Running now and starting at boot are separate settings. `enable` makes a service start automatically after a reboot and `disable` turns that off. Neither changes whether it is running right now.'),
          task: 'This is a development machine: stop `nginx` from starting at boot.',
          hints: ['`sudo systemctl disable nginx`'],
          solution: ['sudo systemctl disable nginx'],
          validate: (s) => s.shell.localSys.units.get('nginx')?.enabled === false,
        },
      ],
    },
    {
      id: 'sys-3',
      title: 'Disk space, archives and cron',
      summary: 'df, du, tar and a scheduled backup.',
      steps: [
        {
          explain: md('"No space left on device" breaks things in confusing ways. `df -h` shows how full each filesystem is.'),
          task: 'Show disk usage for all filesystems in human-readable units.',
          hints: ['`df -h`'],
          solution: ['df -h'],
          validate: all(ran(/^df\b/), outHas('Use%')),
        },
        {
          explain: md('`df` tells you a disk is full; `du` tells you what is filling it. `-s` prints one total per argument and `-h` makes it readable.'),
          task: 'Show the size of each item inside `project`.',
          hints: ['`du -sh project/*`'],
          solution: ['du -sh project/*'],
          validate: all(ran(/^du\b/), outHas('project/logs')),
        },
        {
          explain: md(
            '`tar` bundles files into one archive. The letters to remember:',
            '- `c` create, `x` extract, `t` list\n- `z` compress with gzip\n- `f FILE` the archive name, always last in the group',
            'So `tar -czf out.tar.gz dir` reads as "create, gzip, file".',
          ),
          task: 'Create `backup.tar.gz` containing the `project/data` directory.',
          hints: ['`tar -czf backup.tar.gz project/data`'],
          solution: ['tar -czf backup.tar.gz project/data'],
          validate: (s) => /users\.csv/.test(read(s.fs, '~/backup.tar.gz') ?? ''),
        },
        {
          explain: md('Check an archive before you rely on it. `t` lists the contents without extracting.'),
          task: 'List the contents of `backup.tar.gz`.',
          hints: ['`tar -tzf backup.tar.gz`'],
          solution: ['tar -tzf backup.tar.gz'],
          validate: all(ran(/^tar\b/), outHas('users.json')),
        },
        {
          explain: md('`x` extracts. By default files land in the current directory; `-C DIR` extracts somewhere else. The directory must exist.'),
          task: 'Extract the archive into a new directory `/tmp/restore`.',
          hints: ['`mkdir /tmp/restore && tar -xzf backup.tar.gz -C /tmp/restore`'],
          solution: ['mkdir /tmp/restore && tar -xzf backup.tar.gz -C /tmp/restore'],
          validate: hasFileBelow('/tmp/restore', 'users.csv'),
        },
        {
          explain: md(
            '**cron** runs commands on a schedule. Each line of your crontab has five time fields and a command:',
            '```\nminute hour day-of-month month day-of-week command\n0      2    *            *     *           /path/to/script\n```',
            'That example runs every day at 02:00. `crontab -e` opens your schedule in an editor; piping a line into `crontab -` replaces it in one step.',
          ),
          task: 'Schedule `/home/dev/project/scripts/backup.sh` to run every day at 02:00.',
          hints: ['`echo "0 2 * * * /home/dev/project/scripts/backup.sh" | crontab -`'],
          solution: ['echo "0 2 * * * /home/dev/project/scripts/backup.sh" | crontab -'],
          validate: fileHas('/var/spool/cron/crontabs/dev', /^0\s+2\s+\*\s+\*\s+\*\s+\S*backup\.sh/m),
        },
        {
          explain: md('Always confirm what is installed.'),
          task: 'List your scheduled jobs.',
          hints: ['`crontab -l`'],
          solution: ['crontab -l'],
          validate: all(ran(/^crontab\s+-l/), outHas('backup.sh')),
        },
      ],
    },
  ],
};
