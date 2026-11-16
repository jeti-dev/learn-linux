import type { Module } from '../types';
import { all, exitCode, fileHas, outHas, outIs, ran, tried } from '../validators';
import { P, md } from './util';

export const networking: Module = {
  id: 'net',
  title: 'Networking',
  summary: 'Test APIs with curl and work out whether a problem is DNS, the port, or the app.',
  lessons: [
    {
      id: 'net-1',
      title: 'HTTP with curl',
      summary: 'Requests, headers, JSON bodies and status codes from the terminal.',
      cwd: P,
      setup: (sh) => {
        sh.sys.spawn('node server.js', 'dev', { pid: 4242, ppid: 1, tty: '?', port: 3000, cpu: 0.3, mem: 1.9 });
      },
      steps: [
        {
          explain: md('`curl URL` makes an HTTP request and prints the response body. The app from the earlier lessons is running on port 3000 of this machine, which is reachable as `localhost`.'),
          task: 'Request `localhost:3000/health`.',
          hints: ['`curl localhost:3000/health`'],
          solution: ['curl localhost:3000/health'],
          validate: all(ran(/^curl\b/), outHas('"status":"ok"')),
        },
        {
          explain: md('The body is only part of the story. `-i` includes the status line and the response headers; `-I` asks for the headers alone.'),
          task: 'Make the same request, this time showing the response headers too.',
          hints: ['`curl -i localhost:3000/health`'],
          solution: ['curl -i localhost:3000/health'],
          validate: all(outHas('HTTP/1.1 200 OK'), outHas(/Content-Type: application\/json/)),
        },
        {
          explain: md('JSON APIs return everything on one line. Pipe the response into `jq` to format or query it. Add `-s` (silent) so curl prints no progress information into the pipe.'),
          task: 'Fetch `api.example.com/users` and print only the user names.',
          hints: ["`curl -s api.example.com/users | jq '.[].name'`"],
          solution: ["curl -s api.example.com/users | jq '.[].name'"],
          validate: all(tried(/curl.*\|\s*jq/), outHas('"Ada Lovelace"'), outHas('"Linus Torvalds"')),
        },
        {
          explain: md(
            'To send data:',
            '- `-X POST` sets the method\n- `-H "Name: value"` adds a header\n- `-d \'...\'` is the request body',
            'Wrap JSON in single quotes so the shell leaves the double quotes alone.',
          ),
          task: 'POST the JSON body `{"item":"book"}` to `localhost:3000/api/orders`.',
          hints: ['`curl -X POST -H "Content-Type: application/json" -d \'{"item":"book"}\' localhost:3000/api/orders`'],
          solution: ['curl -X POST -H "Content-Type: application/json" -d \'{"item":"book"}\' localhost:3000/api/orders'],
          validate: all(outHas('"id":1001'), outHas('"item":"book"')),
        },
        {
          explain: md('`-o FILE` saves the response instead of printing it.'),
          task: 'Download `api.example.com/users` into a file called `users-remote.json`.',
          hints: ['`curl -s -o users-remote.json api.example.com/users`'],
          solution: ['curl -s -o users-remote.json api.example.com/users'],
          validate: fileHas(`${P}/users-remote.json`, /Ada Lovelace/),
        },
        {
          explain: md(
            'In scripts and health checks you often care only about the status code. This combination prints nothing but the code:',
            '```\ncurl -s -o /dev/null -w "%{http_code}\\n" URL\n```',
            '`-o /dev/null` discards the body and `-w` prints the fields you ask for.',
          ),
          task: 'Print only the HTTP status code that `localhost:3000/nope` returns.',
          hints: ['`curl -s -o /dev/null -w "%{http_code}\\n" localhost:3000/nope`'],
          solution: ['curl -s -o /dev/null -w "%{http_code}\\n" localhost:3000/nope'],
          validate: outIs('404'),
        },
      ],
    },
    {
      id: 'net-2',
      title: 'Is it the network?',
      summary: 'ping, dig, /etc/hosts and ss: narrow down where a connection fails.',
      steps: [
        {
          explain: md('When something is unreachable, work upwards. First: does the machine respond at all? `ping` sends small packets and reports the replies. `-c 3` stops after three; without it, ping runs until Ctrl+C.'),
          task: 'Ping `example.com` three times.',
          hints: ['`ping -c 3 example.com`'],
          solution: ['ping -c 3 example.com'],
          validate: outHas('3 packets transmitted, 3 received'),
        },
        {
          explain: md('Names are turned into IP addresses by DNS. `dig` shows what a name resolves to, and `+short` cuts the answer down to the address.'),
          task: 'Find the IP address of `example.com`.',
          hints: ['`dig +short example.com`'],
          solution: ['dig +short example.com'],
          validate: all(ran(/^(dig|nslookup|host)\b/), outHas('93.184.215.14')),
        },
        {
          explain: md('nginx on this machine is configured to serve a site under the name `myapp.local`. Try to open it.'),
          task: 'Request `myapp.local` with curl and read the error.',
          hints: ['`curl myapp.local`'],
          solution: ['curl myapp.local'],
          validate: all(tried(/myapp\.local/), exitCode(6)),
        },
        {
          explain: md(
            '"Could not resolve host" is a name problem, not a server problem: nothing knows which IP `myapp.local` stands for.',
            'Before asking DNS, Linux checks the file `/etc/hosts`, which maps addresses to names, one per line. Adding a line there is the standard way to point a development hostname at your own machine (`127.0.0.1`).',
          ),
          task: 'Map `myapp.local` to `127.0.0.1` in `/etc/hosts`, then request it again.',
          hints: ['The file belongs to root: `echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts`', 'Then `curl myapp.local`.'],
          solution: ['echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts', 'curl myapp.local'],
          validate: all(ran(/curl.*myapp\.local/), outHas('nginx')),
        },
        {
          explain: md(
            'The name resolves and something answered. To see what is listening on which port, use `ss -tlnp`:',
            '- `t` TCP\n- `l` listening sockets\n- `n` numeric ports\n- `p` owning process',
          ),
          task: 'List the listening TCP ports on this machine.',
          hints: ['`ss -tlnp`'],
          solution: ['ss -tlnp'],
          validate: all(ran(/^(sudo\s+)?ss\b/), outHas(':80'), outHas(':5432')),
        },
        {
          explain: md('The process column is empty for most rows. Without root, `ss` can only show details of your own processes.'),
          task: 'Find out which program is listening on port 5432.',
          hints: ['Run it with `sudo`.', '`sudo ss -tlnp | grep 5432`'],
          solution: ['sudo ss -tlnp | grep 5432'],
          validate: all(outHas('5432'), outHas('postgres')),
        },
      ],
    },
  ],
};
