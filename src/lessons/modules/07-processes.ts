import type { Module } from '../types';
import { all, any, failed, key, listening, not, outHas, procGone, ran, tried } from '../validators';
import { P, md } from './util';

const jobState = (state: 'R' | 'T') => (s: { shell: { localSys: { jobs(): { state: string }[] } } }) => s.shell.localSys.jobs().some((j) => j.state === state);

export const processes: Module = {
  id: 'proc',
  title: 'Processes',
  summary: 'See what is running, free a busy port, and control jobs in your terminal.',
  lessons: [
    {
      id: 'proc-1',
      title: 'What is running?',
      summary: 'ps, top and kill, applied to the classic "port already in use".',
      cwd: P,
      setup: (sh) => {
        sh.sys.spawn('node server.js', 'dev', { pid: 4242, ppid: 1, tty: '?', port: 3000, cpu: 0.4, mem: 1.9, start: 'Nov15' });
        sh.sys.spawn('python3 worker.py', 'dev', { pid: 4310, ppid: 1, tty: '?', cpu: 97.5, mem: 6.2, state: 'R', stubborn: true, start: '08:51' });
      },
      steps: [
        {
          explain: md('Every running program is a **process** with a numeric ID, the PID. `ps aux` lists all of them with their owner, CPU and memory use, and the command that started them.'),
          task: 'List every process on the machine.',
          hints: ['`ps aux`'],
          solution: ['ps aux'],
          validate: all(ran(/^ps\b/), outHas('/sbin/init'), outHas('node server.js')),
        },
        {
          explain: md('That list is long on a real server. Filter it with `grep`.'),
          task: 'Show only the processes whose command mentions `node`.',
          hints: ['`ps aux | grep node`', '`pgrep -fl node` is a shorter alternative.'],
          solution: ['ps aux | grep node'],
          validate: all(any(tried(/grep/), tried(/pgrep/)), outHas('node server.js'), not(outHas('/sbin/init'))),
        },
        {
          explain: md('Somebody left a server running. See what that does to your own.'),
          task: 'Try to start the app with `npm start`.',
          hints: ['Expect an error that mentions `EADDRINUSE`.'],
          solution: ['npm start'],
          validate: all(tried(/npm|node/), failed, (s) => s.err.includes('EADDRINUSE')),
        },
        {
          explain: md(
            '`EADDRINUSE` means another process is already listening on port 3000. Two ways to find out which one:',
            '- `ss -tlnp` lists every listening TCP port with its process\n- `lsof -i :3000` shows who has that one port open',
          ),
          task: 'Find the PID of the process that is listening on port 3000.',
          hints: ['`ss -tlnp`', 'Look for `:3000` and the `pid=` next to it.'],
          solution: ['ss -tlnp'],
          validate: all(outHas('3000'), outHas('4242')),
        },
        {
          explain: md('`kill PID` sends a process the TERM signal: a polite request to shut down, which lets it close files and connections first.'),
          task: 'Stop the process that holds port 3000.',
          hints: ['`kill 4242`'],
          solution: ['kill 4242'],
          validate: procGone(4242),
        },
        {
          explain: md('The machine also feels slow. `top` shows processes sorted by CPU usage, refreshing live (press `q` to quit on a real system).'),
          task: 'Find out which process is using the most CPU.',
          hints: ['`top`', 'Look at the `%CPU` column of the first row.'],
          solution: ['top'],
          validate: all(any(ran(/^(top|htop)\b/), ran(/^ps\b/)), outHas('4310')),
        },
        {
          explain: md(
            'A process can ignore TERM, and a stuck one often does. `kill -9 PID` sends KILL, which the kernel enforces: the process is removed immediately and gets no chance to clean up.',
            'Always try plain `kill` first and reach for `-9` only when it has no effect.',
          ),
          task: 'Stop the runaway `python3 worker.py` process (PID 4310).',
          hints: ['Try `kill 4310`, then check with `ps aux | grep worker`.', 'It ignores TERM, so use `kill -9 4310`.'],
          solution: ['kill 4310', 'kill -9 4310'],
          validate: procGone(4310),
        },
      ],
    },
    {
      id: 'proc-2',
      title: 'Foreground and background',
      summary: 'Ctrl+C, Ctrl+Z, &, jobs, fg and bg.',
      cwd: P,
      steps: [
        {
          explain: md('A server keeps running until you stop it. Started normally, it runs in the **foreground**: it owns the terminal and you get no prompt back.'),
          task: 'Start the app with `npm start`.',
          hints: ['`npm start`'],
          solution: ['npm start'],
          validate: (s) => s.shell.foreground !== undefined && listening(3000)(s),
        },
        {
          explain: md('The terminal is now busy. **Ctrl+C** sends the foreground process an interrupt signal, which stops it.'),
          task: 'Stop the server with Ctrl+C.',
          hints: ['On a phone, use the `^C` key above the keyboard.'],
          solution: [{ label: 'Press Ctrl+C', key: 'ctrl-c' }],
          validate: all(key('^C'), not(listening(3000))),
        },
        {
          explain: md('Add `&` to the end of a command to start it in the **background**. The shell prints a job number and the PID, and gives you the prompt back right away.'),
          task: 'Start the app in the background.',
          hints: ['`npm start &`'],
          solution: ['npm start &'],
          validate: all(listening(3000), jobState('R'), (s) => s.shell.foreground === undefined),
        },
        {
          explain: md('The server is running and the terminal is free, so you can test it from the same window. `jobs` lists what this shell has in the background.'),
          task: 'Request `localhost:3000/health` with `curl` to confirm the server answers.',
          hints: ['`curl localhost:3000/health`'],
          solution: ['curl localhost:3000/health'],
          validate: outHas('"status":"ok"'),
        },
        {
          explain: md('`fg` brings a background job to the foreground. **Ctrl+Z** does the opposite of what many expect: it does not stop the program for good, it **suspends** it and returns you to the prompt.'),
          task: 'Bring the server to the foreground with `fg`, then suspend it with Ctrl+Z.',
          hints: ['Run `fg`.', 'Then press Ctrl+Z (the `^Z` key on a phone).'],
          solution: ['fg', { label: 'Press Ctrl+Z', key: 'ctrl-z' }],
          validate: all(key('^Z'), jobState('T')),
        },
        {
          explain: md('A suspended job is frozen: it keeps its port but answers nothing. `bg` lets it continue in the background, `fg` in the foreground.'),
          task: 'Let the suspended server continue in the background.',
          hints: ['`bg`'],
          solution: ['bg'],
          validate: all(ran(/^bg\b/), jobState('R')),
        },
        {
          explain: md('`kill` accepts a job number with a percent sign, so you do not need to look up the PID.'),
          task: 'Stop the background server using its job number.',
          hints: ['`jobs` shows the number.', '`kill %1`'],
          solution: ['kill %1'],
          validate: all(not(listening(3000)), (s) => s.shell.localSys.jobs().length === 0),
        },
      ],
    },
  ],
};
