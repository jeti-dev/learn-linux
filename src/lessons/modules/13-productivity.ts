import type { Module } from '../types';
import { all, any, cwdIs, fileHas, key, outHas, ran, tried } from '../validators';
import { P, md } from './util';

const LONG_CURL = 'curl -s -H "Accept: application/json" api.example.com/users | jq length';

export const productivity: Module = {
  id: 'prod',
  title: 'Productivity',
  summary: 'History, keyboard shortcuts and just enough vim to get out alive.',
  lessons: [
    {
      id: 'prod-1',
      title: 'Faster at the prompt',
      summary: 'Reuse what you already typed.',
      cwd: P,
      setup: (sh) => {
        sh.history.push('cd ~/project', 'ls -la', LONG_CURL, 'grep -rn TODO src', 'tail -n 20 logs/app.log');
      },
      steps: [
        {
          explain: md('The shell remembers what you type. The **up arrow** steps back through earlier commands, and `history` prints the whole list with numbers.'),
          task: 'Show your command history.',
          hints: ['`history`'],
          solution: ['history'],
          validate: ran(/^history\b/),
        },
        {
          explain: md('`!!` stands for the previous command. Its best-known use is after forgetting `sudo`:', '```\ncat /var/log/syslog\nsudo !!\n```'),
          task: 'Run `cat /var/log/syslog`, watch it fail, then repeat it as root using `!!`.',
          hints: ['`cat /var/log/syslog`', 'Then `sudo !!`.'],
          solution: ['cat /var/log/syslog', 'sudo !!'],
          validate: all(ran(/^sudo\s+cat\s+\/var\/log\/syslog/), outHas('systemd')),
        },
        {
          explain: md(
            '**Ctrl+R** searches your history as you type. Press it, type a few letters of an old command, and the most recent match appears. Enter runs it; Ctrl+R again steps to an older match.',
            'There is a long `curl` command in your history that you do not want to retype.',
          ),
          task: 'Find the earlier `curl` command with Ctrl+R and run it again.',
          hints: ['Press Ctrl+R (on a phone: the `Ctrl` key, then `r`), type `curl`, press Enter.'],
          solution: [LONG_CURL],
          validate: all(ran(/curl.*api\.example\.com\/users.*jq/), outHas(/^\d+$/m)),
        },
        {
          explain: md(
            'A few editing keys that work in almost every terminal:',
            '- **Ctrl+A** / **Ctrl+E** jump to the start / end of the line\n- **Ctrl+W** delete the word before the cursor\n- **Ctrl+U** delete everything before the cursor\n- **Ctrl+L** clear the screen (same as `clear`)',
          ),
          task: 'Clear the screen.',
          hints: ['Press Ctrl+L, or type `clear`.'],
          solution: ['clear'],
          validate: any(key('^L'), ran(/^clear\b/)),
        },
        {
          explain: md('`!$` stands for the last word of the previous command, which is usually the path you just worked with:', '```\nmkdir -p some/long/path\ncd !$\n```'),
          task: 'Create the directory `deploy/releases/v2`, then change into it using `!$`.',
          hints: ['`mkdir -p deploy/releases/v2`', 'Then `cd !$`.'],
          solution: ['mkdir -p deploy/releases/v2', 'cd !$'],
          validate: cwdIs(`${P}/deploy/releases/v2`),
        },
      ],
    },
    {
      id: 'prod-2',
      title: 'Surviving vim',
      summary: 'Open, edit, save and quit: the four things you must know.',
      cwd: P,
      steps: [
        {
          explain: md(
            'Sooner or later a server drops you into `vim`: it is the default editor for many tools and is installed everywhere. It has **modes**:',
            '- You start in **normal mode**, where keys are commands, not text\n- `i` enters **insert mode**, where you type normally\n- **Esc** returns to normal mode\n- `:wq` and Enter writes the file and quits',
          ),
          task: 'Open `notes.txt` in vim, add a line of text, then save and quit.',
          hints: ['`vim notes.txt`', 'Press `i`, type something, press Esc, then type `:wq` and Enter.'],
          solution: ['vim notes.txt', { label: 'Press i, type a line, press Esc, type :wq and Enter', edit: 'vim: i to insert, Esc, :wq to save\n' }],
          validate: all(key(':wq'), fileHas(`${P}/notes.txt`, /\S/)),
        },
        {
          explain: md('The other thing everybody needs: getting out **without** saving, for instance after opening the wrong file or making a mess. From normal mode, `:q!` quits and discards your changes.'),
          task: 'Open `.env` in vim and quit without saving.',
          hints: ['`vim .env`', 'Press Esc to be sure you are in normal mode, then type `:q!` and Enter.'],
          solution: ['vim .env', { label: 'Type :q! and Enter', edit: null }],
          validate: all(key(':q!'), fileHas(`${P}/.env`, /PORT=3000/)),
        },
        {
          explain: md('One real edit to finish. Remember the sequence: `i` to type, Esc when done, `:wq` to save.'),
          task: 'Use vim to change the port in `.env` from `3000` to `5000`.',
          hints: ['`vim .env`', 'Press `i`, change the number, press Esc, type `:wq` and Enter.'],
          solution: ['vim .env', { label: 'Change 3000 to 5000, then :wq', edit: 'NODE_ENV=development\nPORT=5000\nDATABASE_URL=postgres://dev:secret@localhost:5432/myapp\nAPI_KEY=sk_test_51Hxxxxxxxxxxxxxxxx\n' }],
          validate: all(tried(/./), fileHas(`${P}/.env`, /^PORT=5000$/m), fileHas(`${P}/.env`, /NODE_ENV=/)),
        },
      ],
    },
  ],
};
