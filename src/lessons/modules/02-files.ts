import type { Module } from '../types';
import { all, exists, fileHas, isDir, isFile, key, missing, outHas, outIs, ran, read, tried } from '../validators';
import { LOGS, P, md } from './util';

export const files: Module = {
  id: 'files',
  title: 'Working with files',
  summary: 'Create, copy, move, delete and read files without leaving the keyboard.',
  lessons: [
    {
      id: 'files-1',
      title: 'Create, copy, move, delete',
      summary: 'mkdir, cp, mv and rm, plus wildcards.',
      cwd: P,
      steps: [
        {
          explain: md('You are in a small Node.js project. Run `ls` any time to see what is here.', '`mkdir` creates a directory.'),
          task: 'Create a directory called `backup`.',
          hints: ['`mkdir backup`'],
          solution: ['mkdir backup'],
          validate: isDir(`${P}/backup`),
        },
        {
          explain: md('`mkdir` refuses to create `a/b/c` if `a` does not exist yet. The `-p` option creates all missing parents, and does not complain if the directory is already there. That makes it safe to use in scripts.'),
          task: 'Create the nested path `tmp/cache/images` with one command.',
          hints: ['`mkdir -p tmp/cache/images`'],
          solution: ['mkdir -p tmp/cache/images'],
          validate: isDir(`${P}/tmp/cache/images`),
        },
        {
          explain: md('`cp source destination` copies a file. If the destination is a directory, the copy keeps its name and lands inside it.'),
          task: 'Copy `.env` into the `backup` directory.',
          hints: ['`.env` is hidden, so `ls -a` shows it.', '`cp .env backup/`'],
          solution: ['cp .env backup/'],
          validate: (s) => read(s.fs, `${P}/backup/.env`) !== null && read(s.fs, `${P}/backup/.env`) === read(s.fs, `${P}/.env`),
        },
        {
          explain: md('Copying a directory needs `-r` (recursive), otherwise `cp` skips it with a warning.'),
          task: 'Copy the whole `src` directory into `backup`.',
          hints: ['`cp -r src backup/`'],
          solution: ['cp -r src backup/'],
          validate: isFile(`${P}/backup/src/routes/users.js`),
        },
        {
          explain: md('`mv` moves files. Renaming is the same operation: you move a file to a new name in the same directory.'),
          task: 'Rename `TODO.md` to `ROADMAP.md`.',
          hints: ['`mv TODO.md ROADMAP.md`'],
          solution: ['mv TODO.md ROADMAP.md'],
          validate: all(isFile(`${P}/ROADMAP.md`), missing(`${P}/TODO.md`)),
        },
        {
          explain: md(
            'The shell expands **wildcards** before the command runs. `*` matches any characters, so `*.md` becomes the list of every file ending in `.md`.',
            'You can check what a pattern matches with `echo *.md`.',
          ),
          task: 'Copy every `.md` file into `backup` with one command.',
          hints: ['`cp *.md backup/`'],
          solution: ['cp *.md backup/'],
          validate: all(isFile(`${P}/backup/README.md`), isFile(`${P}/backup/ROADMAP.md`)),
        },
        {
          explain: md(
            '`rm` deletes files. There is **no trash can**: what you remove is gone.',
            'Deleting a directory with its contents needs `-r`. Read the command twice before pressing Enter, especially when it contains a wildcard.',
          ),
          task: 'Delete the `tmp` directory and everything in it.',
          hints: ['`rm -r tmp`'],
          solution: ['rm -r tmp'],
          validate: all(missing(`${P}/tmp`), exists(`${P}/src`), exists(`${P}/backup`)),
        },
      ],
    },
    {
      id: 'files-2',
      title: 'Reading and editing files',
      summary: 'cat, head, tail, following a log, and a quick edit in nano.',
      cwd: P,
      steps: [
        {
          explain: md('`cat` prints a whole file. It is the quickest way to read something short.'),
          task: 'Print `package.json`.',
          hints: ['`cat package.json`'],
          solution: ['cat package.json'],
          validate: all(ran(/package\.json/), outHas('"name": "myapp"')),
        },
        {
          explain: md('Log files are too long for `cat`. `head` prints only the beginning: 10 lines by default, or as many as you ask for with `-n`.'),
          task: 'Print the first 5 lines of `logs/access.log`.',
          hints: ['`head -n 5 logs/access.log`'],
          solution: ['head -n 5 logs/access.log'],
          validate: outIs(() => LOGS.access.slice(0, 5).join('\n')),
        },
        {
          explain: md('`tail` is the mirror image, and the one you will use more: the newest entries of a log are at the end.'),
          task: 'Print the last 3 lines of `logs/app.log`.',
          hints: ['`tail -n 3 logs/app.log`'],
          solution: ['tail -n 3 logs/app.log'],
          validate: outIs(() => LOGS.app.slice(-3).join('\n')),
        },
        {
          explain: md(
            '`tail -f` (follow) keeps the file open and prints new lines as they arrive. It is how you watch a server log live.',
            'A command like that never finishes on its own. **Ctrl+C** interrupts whatever is running in the foreground and gives you the prompt back.',
          ),
          task: 'Start following `logs/app.log`, then stop it with Ctrl+C.',
          hints: ['Run `tail -f logs/app.log`.', 'Then press Ctrl+C. On a phone, use the `^C` key above the keyboard.'],
          solution: ['tail -f logs/app.log', { label: 'Press Ctrl+C', key: 'ctrl-c' }],
          validate: all(key('^C'), (s) => /tail\b.*-\w*f/i.test(s.shell.history[s.shell.history.length - 1] ?? '')),
        },
        {
          explain: md('`wc -l` counts lines. For a log with one request per line, that is the number of requests.', 'On a real system you would page through a long file with `less` (space to scroll, `q` to quit).'),
          task: 'Count the lines in `logs/access.log`.',
          hints: ['`wc -l logs/access.log`'],
          solution: ['wc -l logs/access.log'],
          validate: all(tried(/access\.log/), outHas(new RegExp(`\\b${LOGS.access.length}\\b`))),
        },
        {
          explain: md(
            'To change a file you need an editor. `nano` is the friendly one: what you type goes into the file, and the shortcuts are listed at the bottom.',
            '- **Ctrl+O** writes the file (save)\n- **Ctrl+X** exits',
            'In this simulator the editor also has Save and Exit buttons.',
          ),
          task: 'Create `notes.md` with nano. Write a line that contains the word `deploy`, then save and exit.',
          hints: ['`nano notes.md`', 'Type your text, then save and exit.'],
          solution: ['nano notes.md', { label: 'Type "deploy checklist", save and exit', edit: 'deploy checklist\n' }],
          validate: fileHas(`${P}/notes.md`, /deploy/i),
        },
      ],
    },
  ],
};
