import type { Module } from '../types';
import { all, any, linesOf, not, outHas, outIs, ran, tried } from '../validators';
import { LOGS, P, md } from './util';

export const searching: Module = {
  id: 'search',
  title: 'Searching',
  summary: 'Find text inside files with grep and find files themselves with find.',
  lessons: [
    {
      id: 'search-1',
      title: 'grep: search inside files',
      summary: 'The options that cover nearly every search you will do.',
      cwd: P,
      steps: [
        {
          explain: md('`grep PATTERN FILE` prints every line of the file that contains the pattern.'),
          task: 'Find the `TODO` comment in `src/index.js`.',
          hints: ['`grep TODO src/index.js`'],
          solution: ['grep TODO src/index.js'],
          validate: outHas('TODO: add request id middleware'),
        },
        {
          explain: md('Two options turn `grep` into a code search tool:', '- `-r` searches a directory recursively\n- `-n` prefixes each match with its line number', 'The output is `file:line:text`, which most editors can jump to.'),
          task: 'Find every `TODO` under `src`, with file names and line numbers.',
          hints: ['`grep -rn TODO src`'],
          solution: ['grep -rn TODO src'],
          validate: all(outHas('src/index.js:8:'), outHas('src/routes/orders.js:6:')),
        },
        {
          explain: md('`grep` is case-sensitive by default. `-i` ignores case.'),
          task: 'Show the lines of `src/utils.js` that mention `error` in any letter case.',
          hints: ['`grep -i error src/utils.js`'],
          solution: ['grep -i error src/utils.js'],
          validate: all(outHas('logger.error'), outHas("'ERROR'")),
        },
        {
          explain: md('Sometimes you only want to know **which files** match. `-l` prints file names instead of lines.'),
          task: 'List the files under `src` that still contain `console.log`.',
          hints: ['`grep -rl "console.log" src`'],
          solution: ['grep -rl "console.log" src'],
          validate: (s) => linesOf(s.out).sort().join(' ') === 'src/routes/orders.js src/utils.js',
        },
        {
          explain: md('`-v` inverts the match: it prints the lines that do **not** contain the pattern. It is the standard way to filter noise out of a log.'),
          task: 'Print `logs/app.log` without the `INFO` lines.',
          hints: ['`grep -v INFO logs/app.log`'],
          solution: ['grep -v INFO logs/app.log'],
          validate: outIs(() => LOGS.app.filter((l) => !l.includes('INFO')).join('\n')),
        },
        {
          explain: md(
            'Patterns are **regular expressions**. With `-E` you get the modern syntax, where `|` means "or":',
            '```\ngrep -E "WARN|ERROR" logs/app.log\n```',
            'Quote the pattern so the shell does not treat `|` as a pipe. `-c` prints a count instead of the lines.',
          ),
          task: 'Count the lines in `logs/app.log` that are `WARN` or `ERROR`.',
          hints: ['Combine `-c` and `-E`.', '`grep -cE "WARN|ERROR" logs/app.log`'],
          solution: ['grep -cE "WARN|ERROR" logs/app.log'],
          validate: outIs(String(LOGS.app.filter((l) => /WARN|ERROR/.test(l)).length)),
        },
      ],
    },
    {
      id: 'search-2',
      title: 'find and xargs',
      summary: 'Locate files by name, type or size, and act on the results.',
      cwd: P,
      steps: [
        {
          explain: md(
            '`find` walks a directory tree and prints the paths that match your tests:',
            '```\nfind WHERE -name "PATTERN"\n```',
            'Always quote the pattern. Otherwise the shell expands the `*` before `find` sees it.',
          ),
          task: 'Find every `.json` file below the current directory.',
          hints: ['`find . -name "*.json"`'],
          solution: ['find . -name "*.json"'],
          validate: all(outHas('./package.json'), outHas('./data/users.json'), not(outHas('.js\n'))),
        },
        {
          explain: md('`-type` limits results to files (`f`) or directories (`d`).'),
          task: 'List only the directories under `src`.',
          hints: ['`find src -type d`'],
          solution: ['find src -type d'],
          validate: outIs('src\nsrc/routes'),
        },
        {
          explain: md('`find` works anywhere, not just in your project. System configuration lives in `/etc`.'),
          task: 'Find all `.conf` files under `/etc`.',
          hints: ['`find /etc -name "*.conf"`'],
          solution: ['find /etc -name "*.conf"'],
          validate: all(ran(/^find\b/), outHas('/etc/nginx/nginx.conf')),
        },
        {
          explain: md('Tests can be combined; all of them must match. `-size +2k` means "larger than 2 kilobytes". There are also `-mtime -1` (modified in the last day) and many more.'),
          task: 'Find regular files in the project that are larger than 2 KB.',
          hints: ['`find . -type f -size +2k`'],
          solution: ['find . -type f -size +2k'],
          validate: all(tried(/^find\b/), outHas('./logs/access.log'), not(outHas('package.json'))),
        },
        {
          explain: md(
            'Finding files is usually step one. `-exec` runs a command on each result:',
            '```\nfind src -name "*.js" -exec wc -l {} \\;\n```',
            '`{}` is replaced by the file path, and `\\;` marks the end of the command.',
          ),
          task: 'Print the line count of every `.js` file under `src`.',
          hints: ['`find src -name "*.js" -exec wc -l {} \\;`'],
          solution: ['find src -name "*.js" -exec wc -l {} \\;'],
          validate: all(outHas(/\d+ src\/index\.js/), outHas(/\d+ src\/routes\/users\.js/)),
        },
        {
          explain: md('`xargs` does a similar job in a pipeline: it takes the lines it receives and appends them as arguments to a command.', 'That lets you search only in the files that `find` selected.'),
          task: 'Using `find` and `xargs`, list the `.js` files under `src` that contain `TODO`.',
          hints: ['Pipe the file list into `xargs grep -l TODO`.', '`find src -name "*.js" | xargs grep -l TODO`'],
          solution: ['find src -name "*.js" | xargs grep -l TODO'],
          validate: all(any(tried(/xargs/), tried(/-exec/)), (s) => linesOf(s.out).sort().join(' ') === 'src/index.js src/routes/orders.js src/routes/users.js'),
        },
      ],
    },
  ],
};
