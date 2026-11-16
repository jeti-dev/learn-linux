import type { Module } from '../types';
import { all, fileHas, isFile, linesOf, outHas, outIs, ran, read, tried } from '../validators';
import { LOGS, P, md } from './util';

export const pipes: Module = {
  id: 'pipes',
  title: 'Pipes and redirection',
  summary: 'Send output to files and chain small commands into powerful ones.',
  lessons: [
    {
      id: 'pipes-1',
      title: 'Redirecting output',
      summary: 'Where output goes: > >> 2> and /dev/null.',
      cwd: P,
      steps: [
        {
          explain: md('Every command writes its results to **standard output**, which is normally your screen. `>` sends it to a file instead.', '`>` creates the file, or **overwrites** it if it exists.'),
          task: 'Save the output of `ls -la` to a file called `listing.txt`.',
          hints: ['`ls -la > listing.txt`'],
          solution: ['ls -la > listing.txt'],
          validate: fileHas(`${P}/listing.txt`, /package\.json/),
        },
        {
          explain: md('`>>` appends to the end of a file instead of replacing it. Use it for logs, and for adding lines to configuration files.'),
          task: 'Append the output of `date` to `listing.txt` without losing what is there.',
          hints: ['`date >> listing.txt`'],
          solution: ['date >> listing.txt'],
          validate: all(fileHas(`${P}/listing.txt`, /package\.json/), fileHas(`${P}/listing.txt`, /\b20\d\d\b\s*$/)),
        },
        {
          explain: md(
            'Commands have a second output channel for errors: **standard error**. That is why error messages still show up when you redirect with `>`.',
            'Run `ls src missing-dir` to see both at once. Redirect the error channel with `2>`.',
          ),
          task: 'Run `ls src missing-dir` again, sending only the error message to `errors.txt`.',
          hints: ['`ls src missing-dir 2> errors.txt`'],
          solution: ['ls src missing-dir 2> errors.txt'],
          validate: all(fileHas(`${P}/errors.txt`, /No such file/), (s) => !/index\.js/.test(read(s.fs, `${P}/errors.txt`) ?? '')),
        },
        {
          explain: md(
            '`/dev/null` is a special file that discards everything written to it. Redirecting errors there hides them:',
            '```\ncommand 2> /dev/null\n```',
            'You will also see `> file 2>&1`, which sends errors to the same place as normal output.',
          ),
          task: 'Run `ls src missing-dir` so the listing is shown but the error is thrown away.',
          hints: ['`ls src missing-dir 2> /dev/null`'],
          solution: ['ls src missing-dir 2> /dev/null'],
          validate: all(tried(/2>\s*\/dev\/null/), outHas('index.js'), (s) => s.err === ''),
        },
        {
          explain: md('Redirection works the other way too. `<` feeds a file to a command as its **standard input**.'),
          task: 'Count the lines of `logs/app.log` by feeding it to `wc -l` with `<`.',
          hints: ['`wc -l < logs/app.log`'],
          solution: ['wc -l < logs/app.log'],
          validate: all(tried(/<\s*logs\/app\.log/), outIs(String(LOGS.app.length))),
        },
      ],
    },
    {
      id: 'pipes-2',
      title: 'Pipes',
      summary: 'Connect commands with | and combine them with && and ||.',
      cwd: P,
      steps: [
        {
          explain: md(
            'A **pipe** `|` connects the output of one command to the input of the next. Each tool does one small job, and pipes let you combine them.',
            '```\nls /usr/bin | wc -l\n```',
            'This lists the programs in `/usr/bin` and counts the lines, without creating a file in between.',
          ),
          task: 'Count how many programs are in `/usr/bin`.',
          hints: ['`ls /usr/bin | wc -l`'],
          solution: ['ls /usr/bin | wc -l'],
          validate: all(ran(/\|\s*wc\b/), outHas(/^\d+$/m)),
        },
        {
          explain: md('`grep` prints only the lines that contain a pattern. It is the filter you will put in the middle of most pipelines.', 'It reads a file if you give it one, or standard input if you do not.'),
          task: 'Show only the lines of `logs/app.log` that contain `ERROR`.',
          hints: ['`grep ERROR logs/app.log`', 'Or as a pipeline: `cat logs/app.log | grep ERROR`'],
          solution: ['grep ERROR logs/app.log'],
          validate: outIs(() => LOGS.errors.join('\n')),
        },
        {
          explain: md('Pipelines can be as long as you need. Add one more stage to turn the list into a number.'),
          task: 'Count the `ERROR` lines in `logs/app.log`.',
          hints: ['`grep ERROR logs/app.log | wc -l`', '`grep -c ERROR logs/app.log` does the same in one step.'],
          solution: ['grep ERROR logs/app.log | wc -l'],
          validate: outIs(String(LOGS.errors.length)),
        },
        {
          explain: md('`head` and `tail` work in pipelines too, which is handy when a command produces more than you want to read.'),
          task: 'Show only the first 3 `ERROR` lines.',
          hints: ['`grep ERROR logs/app.log | head -n 3`'],
          solution: ['grep ERROR logs/app.log | head -n 3'],
          validate: outIs(() => LOGS.errors.slice(0, 3).join('\n')),
        },
        {
          explain: md('`tee` writes its input to a file **and** passes it on. Use it to keep a copy of what flows through a pipeline, or to save output while still seeing it.'),
          task: 'Save the `ERROR` lines to `errors.log` and, in the same pipeline, count them.',
          hints: ['`grep ERROR logs/app.log | tee errors.log | wc -l`'],
          solution: ['grep ERROR logs/app.log | tee errors.log | wc -l'],
          validate: all((s) => linesOf(read(s.fs, `${P}/errors.log`) ?? '').length === LOGS.errors.length, outIs(String(LOGS.errors.length))),
        },
        {
          explain: md(
            'Every command finishes with an **exit code**: 0 for success, anything else for failure. Two operators use it:',
            '- `a && b` runs `b` only if `a` succeeded\n- `a || b` runs `b` only if `a` failed',
            '`&&` is how you write "do this, and if it worked, do that".',
          ),
          task: 'Create a `reports` directory and, only if that works, move `errors.log` into it. Use one line.',
          hints: ['`mkdir reports && mv errors.log reports/`'],
          solution: ['mkdir reports && mv errors.log reports/'],
          validate: isFile(`${P}/reports/errors.log`),
        },
      ],
    },
  ],
};
