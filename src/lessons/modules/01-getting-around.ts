import type { Module } from '../types';
import { all, any, cwdIs, outHas, ran, tried } from '../validators';
import { md } from './util';

export const gettingAround: Module = {
  id: 'nav',
  title: 'Getting around',
  summary: 'Know where you are, look around, and move between directories.',
  lessons: [
    {
      id: 'nav-1',
      title: 'Where am I?',
      summary: 'pwd, ls and cd: the three commands you will type most.',
      steps: [
        {
          explain: md(
            'A terminal always has a **current directory**, the folder your commands act on. The prompt shows it:',
            '```\ndev@ubuntu:~$\n```',
            'That reads: user `dev`, on the machine `ubuntu`, in the directory `~`. The `~` is shorthand for your home directory.',
            'To see the full path, use `pwd` (print working directory).',
          ),
          task: 'Print the current directory.',
          hints: ['Type `pwd` and press Enter.'],
          solution: ['pwd'],
          validate: ran(/^pwd\b/),
        },
        {
          explain: md('`ls` lists what is in a directory. With no arguments it lists the current one.'),
          task: 'List the contents of your home directory.',
          hints: ['Type `ls`.'],
          solution: ['ls'],
          validate: ran(/^(ls|ll|la)\b/),
        },
        {
          explain: md(
            'Most commands take **options** that start with a dash. Two you will use constantly with `ls`:',
            '- `-l` long format: permissions, owner, size and date\n- `-a` all files, including hidden ones (names that start with a dot)',
            'Short options can be combined: `ls -la`.',
          ),
          task: 'List everything in your home directory, including hidden files, in long format.',
          hints: ['Combine both options: `ls -la`.', 'Configuration files such as `.bashrc` are hidden because their names start with a dot.'],
          solution: ['ls -la'],
          validate: all(ran(/^(ls|ll)\b/), outHas('.bashrc'), outHas(/^[d-]rw/m)),
        },
        {
          explain: md('`cd` changes the current directory. Give it the name of a directory inside the current one.', 'Watch the prompt change after you run it.'),
          task: 'Move into the `project` directory.',
          hints: ['`cd project`'],
          solution: ['cd project'],
          validate: cwdIs('~/project'),
        },
        {
          explain: md(
            'There are two ways to write a path:',
            '- **Relative**: starts from where you are, such as `src/routes` or `..` (the parent directory)\n- **Absolute**: starts from the root of the filesystem with a slash, such as `/var/log`',
            'An absolute path means the same thing wherever you are.',
          ),
          task: 'Go to `/var/log`, where Linux keeps its log files.',
          hints: ['Use the absolute path: `cd /var/log`.'],
          solution: ['cd /var/log'],
          validate: cwdIs('/var/log'),
        },
        {
          explain: md('Three shortcuts worth memorising:', '- `cd ..` goes up one level\n- `cd -` goes back to the directory you were in before\n- `cd` on its own (or `cd ~`) goes home'),
          task: 'Return to your home directory.',
          hints: ['Type `cd` with no arguments.'],
          solution: ['cd'],
          validate: cwdIs('~'),
        },
      ],
    },
    {
      id: 'nav-2',
      title: 'Paths, Tab and help',
      summary: 'Type less with Tab completion and learn to look things up.',
      steps: [
        {
          explain: md(
            'You rarely need to type a whole path. Type the first letters and press **Tab**: the shell completes the name. If several names match, it shows the candidates.',
            'Try it: type `cd pro`, press Tab, then `s`, Tab, `r`, Tab.',
          ),
          task: 'Go to `~/project/src/routes`, using Tab to complete each part.',
          hints: ['On a phone, the Tab key is in the bar above the keyboard.', 'The full command is `cd project/src/routes`.'],
          solution: ['cd project/src/routes'],
          validate: cwdIs('~/project/src/routes'),
        },
        {
          explain: md('`..` can be chained. `../..` means "two levels up", and you can keep going into another directory from there: `../../logs`.'),
          task: 'From here, go to `~/project` with a single relative `cd`.',
          hints: ['`cd ../..`'],
          solution: ['cd ../..'],
          validate: cwdIs('~/project'),
        },
        {
          explain: md('You do not have to `cd` somewhere to look at it. Most commands accept a path.'),
          task: 'List the contents of `/etc/nginx` without leaving the project directory.',
          hints: ['`ls /etc/nginx`'],
          solution: ['ls /etc/nginx'],
          validate: all(ran(/^(ls|ll)\b.*\/etc\/nginx/), cwdIs('~/project')),
        },
        {
          explain: md(
            'Nobody remembers every option. Two ways to look them up:',
            '- `man ls` opens the manual page\n- `ls --help` prints a shorter summary',
            'In this simulator both show a condensed version.',
          ),
          task: 'Open the manual page or the help text for `ls`.',
          hints: ['`man ls`'],
          solution: ['man ls'],
          validate: any(ran(/^man\s+ls\b/), ran(/^ls\s+--help/)),
        },
        {
          explain: md('Now use what the help told you. `-S` sorts by size and `-h` prints sizes in a readable form such as `6.1K`.'),
          task: 'List `logs` in long format, largest file first, with human-readable sizes.',
          hints: ['Combine three options.', '`ls -lSh logs`'],
          solution: ['ls -lSh logs'],
          validate: all(tried(/^(ls|ll)\b.*-\w*S/), tried(/-\w*h|ll\b/), outHas(/access\.log[\s\S]*app\.log/)),
        },
      ],
    },
  ],
};
