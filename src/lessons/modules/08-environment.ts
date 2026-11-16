import type { Module } from '../types';
import { all, any, fileHas, outHas, ran, tried } from '../validators';
import { md } from './util';

const SHOW_ENV = '#!/bin/bash\necho "APP_ENV is \'${APP_ENV:-}\'"\n';

export const environment: Module = {
  id: 'env',
  title: 'Environment',
  summary: 'Variables, PATH, aliases, and making your settings permanent.',
  lessons: [
    {
      id: 'env-1',
      title: 'Variables and PATH',
      summary: 'How configuration reaches programs, and how the shell finds commands.',
      setup: (sh) => {
        sh.fs.seedFile('/home/dev/project/scripts/show-env.sh', SHOW_ENV, { mode: 0o755 });
        sh.fs.seedFile('/home/dev/bin/hello', '#!/bin/bash\necho "Hello from ~/bin"\n', { mode: 0o755 });
      },
      steps: [
        {
          explain: md('The shell keeps named values called **variables**. Write `$NAME` to use one. `echo` prints its arguments, which makes it the standard way to inspect a variable.', 'Some are set for you: `$HOME`, `$USER`, `$PATH`.'),
          task: 'Print the value of `PATH`.',
          hints: ['`echo $PATH`'],
          solution: ['echo $PATH'],
          validate: all(tried(/PATH/), outHas('/usr/bin')),
        },
        {
          explain: md('Set a variable with `NAME=value`. There must be **no spaces** around the `=`; with spaces the shell would try to run a command called `NAME`.'),
          task: 'Create a variable `APP_ENV` with the value `staging`, then print it.',
          hints: ['`APP_ENV=staging`', 'Then `echo $APP_ENV`.'],
          solution: ['APP_ENV=staging', 'echo $APP_ENV'],
          validate: all((s) => s.shell.vars.APP_ENV === 'staging', outHas('staging')),
        },
        {
          explain: md('A plain variable lives only in the shell itself. Programs you start do not see it. The script `project/scripts/show-env.sh` prints the `APP_ENV` it receives.'),
          task: 'Run `project/scripts/show-env.sh` and see what it gets.',
          hints: ['`project/scripts/show-env.sh`'],
          solution: ['project/scripts/show-env.sh'],
          validate: all(ran(/show-env/), outHas("APP_ENV is ''")),
        },
        {
          explain: md('`export` marks a variable to be passed on to every program the shell starts. That set of exported variables is the **environment**, and it is how most tools receive configuration.', 'You can set and export in one go: `export NAME=value`.'),
          task: 'Export `APP_ENV`, then run the script again.',
          hints: ['`export APP_ENV`', 'Then `project/scripts/show-env.sh`.'],
          solution: ['export APP_ENV', 'project/scripts/show-env.sh'],
          validate: all(ran(/show-env/), outHas("APP_ENV is 'staging'"), (s) => s.shell.exported.has('APP_ENV')),
        },
        {
          explain: md('To override a variable for a **single command**, put the assignment in front of it. Nothing changes in your shell afterwards.', '```\nPORT=4000 node server.js\n```'),
          task: 'Run the script once with `APP_ENV` set to `production`, without changing the variable in your shell.',
          hints: ['`APP_ENV=production project/scripts/show-env.sh`'],
          solution: ['APP_ENV=production project/scripts/show-env.sh'],
          validate: all(outHas("APP_ENV is 'production'"), (s) => s.shell.vars.APP_ENV === 'staging'),
        },
        {
          explain: md(
            'When you type a command, the shell looks for a program with that name in each directory listed in `PATH`, in order. `which node` shows where one was found.',
            'There is a script at `~/bin/hello`, but `~/bin` is not in `PATH`, so typing `hello` fails. Add a directory like this:',
            '```\nexport PATH="$HOME/bin:$PATH"\n```',
          ),
          task: 'Make the command `hello` work from any directory, then run it.',
          hints: ['Put `$HOME/bin` in front of the existing `PATH`.', '`export PATH="$HOME/bin:$PATH"`, then `hello`.'],
          solution: ['export PATH="$HOME/bin:$PATH"', 'hello'],
          validate: all(ran(/^hello\b/), outHas('Hello from ~/bin')),
        },
      ],
    },
    {
      id: 'env-2',
      title: 'Aliases and .bashrc',
      summary: 'Shortcuts for long commands, kept across sessions.',
      steps: [
        {
          explain: md("An **alias** is a short name for a longer command. `ss -tlnp` (list listening ports) is a good candidate:", "```\nalias name='command with options'\n```"),
          task: 'Define an alias `ports` for `ss -tlnp`.',
          hints: ["`alias ports='ss -tlnp'`"],
          solution: ["alias ports='ss -tlnp'"],
          validate: (s) => /ss\s+-\w+/.test(s.shell.aliases.ports ?? ''),
        },
        {
          explain: md('An alias is used like any other command.'),
          task: 'Run your new `ports` command.',
          hints: ['`ports`'],
          solution: ['ports'],
          validate: all(ran(/^ports\b/), outHas('LISTEN')),
        },
        {
          explain: md('When a command behaves unexpectedly, `type` tells you what the shell will actually run: an alias, a builtin, or a program on disk.'),
          task: 'Ask the shell what `ll` is.',
          hints: ['`type ll`'],
          solution: ['type ll'],
          validate: all(ran(/^type\b/), outHas('aliased')),
        },
        {
          explain: md(
            'Aliases and variables disappear when you close the terminal. To keep them, put them in `~/.bashrc`, a script that bash runs every time an interactive shell starts. Have a look: `cat ~/.bashrc`.',
            'Append with `>>`. A single `>` would wipe the file.',
          ),
          task: 'Append your `ports` alias to `~/.bashrc`.',
          hints: ['Wrap the whole line in double quotes so the single quotes survive.', "`echo \"alias ports='ss -tlnp'\" >> ~/.bashrc`"],
          solution: ["echo \"alias ports='ss -tlnp'\" >> ~/.bashrc"],
          validate: all(fileHas('~/.bashrc', /^alias ports=/m), fileHas('~/.bashrc', /alias ll=/)),
        },
        {
          explain: md('Editing `.bashrc` does not affect the shell you are already in. `source ~/.bashrc` runs the file in the current shell, so the changes apply immediately.'),
          task: 'Add `export EDITOR=vim` to `~/.bashrc`, then reload the file.',
          hints: ["`echo 'export EDITOR=vim' >> ~/.bashrc`", 'Then `source ~/.bashrc`.'],
          solution: ["echo 'export EDITOR=vim' >> ~/.bashrc", 'source ~/.bashrc'],
          validate: all(any(ran(/^(source|\.)\s/), ran(/bashrc/)), fileHas('~/.bashrc', /^export EDITOR=vim$/m), (s) => s.shell.vars.EDITOR === 'vim'),
        },
      ],
    },
  ],
};
