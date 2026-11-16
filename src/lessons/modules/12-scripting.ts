import type { Module } from '../types';
import { all, executable, failed, fileHas, not, outHas, ran, tried } from '../validators';
import { P, md } from './util';

const RELEASE = '#!/bin/bash\necho "Running tests..."\nfalse   # stands in for a failing test suite\necho "Deploying to production!"\n';

export const scripting: Module = {
  id: 'script',
  title: 'Shell scripting',
  summary: 'Turn the commands you already know into small, safe scripts.',
  lessons: [
    {
      id: 'script-1',
      title: 'Your first script',
      summary: 'Shebang, running a script, arguments and exit codes.',
      cwd: P,
      steps: [
        {
          explain: md(
            'A shell script is a text file with commands, one per line. The first line, the **shebang**, names the program that should interpret it:',
            '```\n#!/bin/bash\necho "Hello from a script"\n```',
            'Write it with `nano hello.sh`, or in one line with `printf`, where `\\n` is a line break.',
          ),
          task: 'Create `hello.sh` with a bash shebang and an `echo` command.',
          hints: ["`printf '#!/bin/bash\\necho \"Hello from a script\"\\n' > hello.sh`"],
          solution: ["printf '#!/bin/bash\\necho \"Hello from a script\"\\n' > hello.sh"],
          validate: all(fileHas(`${P}/hello.sh`, /^#!\s*\/(usr\/)?bin\/(env )?(ba)?sh/), fileHas(`${P}/hello.sh`, /\becho\b/)),
        },
        {
          explain: md('You can always run a script by passing it to the interpreter.'),
          task: 'Run the script with `bash hello.sh`.',
          hints: ['`bash hello.sh`'],
          solution: ['bash hello.sh'],
          validate: all(ran(/^(bash|sh)\s+\S*hello\.sh/), (s) => s.out.trim().length > 0),
        },
        {
          explain: md('To run it like a program, give it the execute bit and call it by path. The `./` matters: the current directory is not in `PATH`, so you must say where the file is.'),
          task: 'Make `hello.sh` executable and run it as `./hello.sh`.',
          hints: ['`chmod +x hello.sh`', 'Then `./hello.sh`.'],
          solution: ['chmod +x hello.sh', './hello.sh'],
          validate: all(executable(`${P}/hello.sh`), ran(/^\.\/hello\.sh/)),
        },
        {
          explain: md(
            'Inside a script, arguments are available as `$1`, `$2` and so on. `$@` is all of them and `$#` is how many.',
            '```\n#!/bin/bash\necho "Hello, $1!"\n```',
            'Use single quotes around the `printf` text here, otherwise your own shell replaces `$1` before the file is written.',
          ),
          task: 'Create an executable script `greet.sh` that prints `Hello, NAME!` for the name given as its first argument, then run it with a name.',
          hints: ["`printf '#!/bin/bash\\necho \"Hello, $1!\"\\n' > greet.sh`", '`chmod +x greet.sh`, then `./greet.sh Linux`.'],
          solution: ["printf '#!/bin/bash\\necho \"Hello, $1!\"\\n' > greet.sh", 'chmod +x greet.sh', './greet.sh Linux'],
          validate: (s) => {
            const m = /greet\.sh\s+(\S+)/.exec(s.cmd);
            return !!m && s.code === 0 && s.out.includes(`Hello, ${m[1].replace(/['"]/g, '')}!`);
          },
        },
        {
          explain: md('Every command returns an **exit code**. `0` means success and anything else means failure. The special variable `$?` holds the code of the command that just finished.', '`grep -q` prints nothing; it only reports through its exit code whether it found a match.'),
          task: 'Run `grep -q admin data/users.csv`, then print its exit code.',
          hints: ['`grep -q admin data/users.csv`', 'Then `echo $?`.'],
          solution: ['grep -q admin data/users.csv', 'echo $?'],
          validate: all(tried(/\$\?/), outHas(/^\d+$/m)),
        },
      ],
    },
    {
      id: 'script-2',
      title: 'Logic and failing safely',
      summary: 'if, for, command substitution, and set -euo pipefail.',
      cwd: P,
      setup: (sh) => sh.fs.seedFile('/home/dev/project/scripts/release.sh', RELEASE, { mode: 0o755 }),
      steps: [
        {
          explain: md(
            '`if` runs a command and looks at its exit code. The command is usually `[ ... ]`, which tests a condition:',
            '```\nif [ -f .env ]; then echo "found"; else echo "missing"; fi\n```',
            '`-f` is true for an existing file and `-d` for a directory. The spaces inside the brackets are required.',
          ),
          task: 'Write a one-line `if` that prints `found` when `.env` exists and `missing` otherwise.',
          hints: ['`if [ -f .env ]; then echo "found"; else echo "missing"; fi`'],
          solution: ['if [ -f .env ]; then echo "found"; else echo "missing"; fi'],
          validate: all(ran(/\bif\b[\s\S]*\bfi\b/), outHas('found')),
        },
        {
          explain: md('`for` repeats commands for each item in a list. Combined with a wildcard it loops over files:', '```\nfor f in *.md; do echo "$f"; done\n```', 'Quote `"$f"` so file names with spaces stay in one piece.'),
          task: 'Loop over the `.js` files in `src` and print the line count of each with `wc -l`.',
          hints: ['`for f in src/*.js; do wc -l "$f"; done`'],
          solution: ['for f in src/*.js; do wc -l "$f"; done'],
          validate: all(ran(/\bfor\b[\s\S]*\bdone\b/), outHas(/\d+ src\/index\.js/), outHas(/\d+ src\/utils\.js/)),
        },
        {
          explain: md('`$(command)` runs a command and substitutes its output into the line. It lets you store results in variables or build messages:', '```\necho "Today is $(date +%F)"\n```'),
          task: 'Print a sentence that includes the number of entries in `src`, computed with `$(...)`.',
          hints: ['`echo "src has $(ls src | wc -l) entries"`'],
          solution: ['echo "src has $(ls src | wc -l) entries"'],
          validate: all(ran(/\$\(/), outHas(/\b3\b/)),
        },
        {
          explain: md('Here is why scripts need care. `scripts/release.sh` runs the tests and then deploys. Read it with `cat scripts/release.sh`: the test step fails.'),
          task: 'Run `scripts/release.sh` and watch what happens after the failure.',
          hints: ['`./scripts/release.sh`'],
          solution: ['./scripts/release.sh'],
          validate: all(tried(/release\.sh/), outHas('Deploying to production!')),
        },
        {
          explain: md(
            'By default bash carries on after a failed command. For a release script that is dangerous. Put this at the top of every script:',
            '```\nset -euo pipefail\n```',
            '- `-e` stop at the first command that fails\n- `-u` treat unset variables as errors\n- `pipefail` a pipeline fails if any stage fails',
            'Add the line with `nano`, or with `sed`: `1a` means "append after line 1".',
          ),
          task: 'Add `set -euo pipefail` to `scripts/release.sh`, right after the shebang.',
          hints: ["`sed -i '1a set -euo pipefail' scripts/release.sh`"],
          solution: ["sed -i '1a set -euo pipefail' scripts/release.sh"],
          validate: all(fileHas(`${P}/scripts/release.sh`, /^#!.*\n\s*set -\w*e/), fileHas(`${P}/scripts/release.sh`, /Deploying/)),
        },
        {
          explain: md('Now the failure should stop the script before it reaches the deploy step.'),
          task: 'Run `scripts/release.sh` again.',
          hints: ['`./scripts/release.sh`'],
          solution: ['./scripts/release.sh'],
          validate: all(tried(/release\.sh/), failed, not(outHas('Deploying'))),
        },
      ],
    },
  ],
};
