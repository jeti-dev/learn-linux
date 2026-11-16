import type { Module } from '../types';
import { all, fileHas, linesOf, outHas, outIs, outLines, ran, tried } from '../validators';
import { LOGS, P, md } from './util';

export const textProcessing: Module = {
  id: 'text',
  title: 'Text processing',
  summary: 'Slice, count and transform logs, CSV and JSON on the command line.',
  lessons: [
    {
      id: 'text-1',
      title: 'Slice, sort and count',
      summary: 'cut, sort and uniq: answer "how many of each?" in one line.',
      cwd: P,
      steps: [
        {
          explain: md('Look at the data first: `head -n 3 data/users.csv`.', '`cut` extracts columns. `-d` sets the delimiter and `-f` picks the fields.'),
          task: 'Print only the `name` column (the second one) of `data/users.csv`.',
          hints: ['`cut -d, -f2 data/users.csv`'],
          solution: ['cut -d, -f2 data/users.csv'],
          validate: all(outHas(/^name\nAda Lovelace\n/), outLines(8)),
        },
        {
          explain: md('`sort` orders lines. To sort by a column, give it the separator with `-t` and the field number with `-k`.', 'Other useful options: `-n` for numbers, `-r` for reverse.'),
          task: 'Sort `data/users.csv` by city (the fifth column).',
          hints: ['`sort -t, -k5 data/users.csv`'],
          solution: ['sort -t, -k5 data/users.csv'],
          validate: all(tried(/\bsort\b/), outHas(/^\d,[^\n]*,Boston\n\d,[^\n]*,Boston\n/), outLines(8)),
        },
        {
          explain: md('`uniq` collapses identical lines that are next to each other, and `-c` adds a count. Because it only looks at neighbours, you **sort first**:', '```\n... | sort | uniq -c\n```'),
          task: 'Count how many users have each role (the fourth column).',
          hints: ['Cut the column, sort it, then count.', '`cut -d, -f4 data/users.csv | sort | uniq -c`'],
          solution: ['cut -d, -f4 data/users.csv | sort | uniq -c'],
          validate: all(outHas(/4 developer/), outHas(/2 admin/), outHas(/1 ops/)),
        },
        {
          explain: md(
            'Add `sort -rn` at the end to rank by count, and `head` to keep the top entries. This pipeline answers a huge range of questions about logs:',
            '```\ncut ... | sort | uniq -c | sort -rn | head\n```',
            'In `logs/access.log` the client IP is the first space-separated field.',
          ),
          task: 'Show the 3 IP addresses that made the most requests in `logs/access.log`, most active first.',
          hints: ["Extract the first field with `cut -d' ' -f1`.", "`cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -rn | head -n 3`"],
          solution: ["cut -d' ' -f1 logs/access.log | sort | uniq -c | sort -rn | head -n 3"],
          validate: all(outLines(3), outHas(new RegExp(`^\\s*${LOGS.topIp[1]} ${LOGS.topIp[0].replace(/\./g, '\\.')}\\n`))),
        },
        {
          explain: md('`tr` translates characters one for one. It only reads standard input, so it always sits in a pipeline.', '```\necho hello | tr a-z A-Z\n```'),
          task: 'Print the first 3 lines of `data/users.csv` with the commas replaced by tabs.',
          hints: ["`head -n 3 data/users.csv | tr ',' '\\t'`"],
          solution: ["head -n 3 data/users.csv | tr ',' '\\t'"],
          validate: all(outHas('Ada Lovelace\tada@example.com'), outLines(3)),
        },
      ],
    },
    {
      id: 'text-2',
      title: 'sed, awk and jq',
      summary: 'Find-and-replace, column logic, and JSON queries.',
      cwd: P,
      steps: [
        {
          explain: md(
            '`sed` edits text as it streams through. The command you will use 95% of the time is substitute:',
            "```\nsed 's/old/new/' file\n```",
            'It prints the result and leaves the file alone, so you can preview a change safely. Add `g` at the end (`s/old/new/g`) to replace every occurrence on a line.',
          ),
          task: 'Preview `.env` with `development` replaced by `production`.',
          hints: ["`sed 's/development/production/' .env`"],
          solution: ["sed 's/development/production/' .env"],
          validate: all(outHas('NODE_ENV=production'), fileHas(`${P}/.env`, /NODE_ENV=development/)),
        },
        {
          explain: md('When the preview looks right, `-i` applies the change to the file **in place**.'),
          task: 'Change the port in `.env` from `3000` to `8080`, in place.',
          hints: ["`sed -i 's/PORT=3000/PORT=8080/' .env`"],
          solution: ["sed -i 's/PORT=3000/PORT=8080/' .env"],
          validate: all(fileHas(`${P}/.env`, /^PORT=8080$/m), fileHas(`${P}/.env`, /NODE_ENV=development/)),
        },
        {
          explain: md(
            '`awk` splits each line into fields and lets you work with them: `$1` is the first field, `$2` the second, `$0` the whole line. By default fields are separated by whitespace.',
            "```\nawk '{print $1}' file\n```",
            'In the access log, field 1 is the client IP and field 9 is the HTTP status code.',
          ),
          task: 'Print the IP and the status code of every request in `logs/access.log`.',
          hints: ["`awk '{print $1, $9}' logs/access.log`"],
          solution: ["awk '{print $1, $9}' logs/access.log"],
          validate: all(outLines(LOGS.access.length), (s) => linesOf(s.out).every((l) => /^\d+\.\d+\.\d+\.\d+ \d{3}$/.test(l))),
        },
        {
          explain: md("An `awk` program can start with a **condition**. Lines that satisfy it are printed (or passed to the `{ }` block if there is one):", "```\nawk '$9 >= 400' logs/access.log\n```"),
          task: 'Print the requests in `logs/access.log` whose status code is exactly 500.',
          hints: ["`awk '$9 == 500' logs/access.log`"],
          solution: ["awk '$9 == 500' logs/access.log"],
          validate: outIs(() => LOGS.status500.join('\n')),
        },
        {
          explain: md(
            '`awk` can also keep running totals. A block marked `END` runs once after the last line:',
            "```\nawk -F, '{sum += $3} END {print sum}' file.csv\n```",
            '`-F,` sets the field separator to a comma. Take a look at `~/Downloads/report-q3.csv` first.',
          ),
          task: 'Print the total revenue (second column) in `~/Downloads/report-q3.csv`.',
          hints: ['The header line counts as 0, so it does not affect the sum.', "`awk -F, '{sum += $2} END {print sum}' ~/Downloads/report-q3.csv`"],
          solution: ["awk -F, '{sum += $2} END {print sum}' ~/Downloads/report-q3.csv"],
          validate: outIs('59850'),
        },
        {
          explain: md(
            'For JSON, line-based tools are the wrong fit. `jq` understands the structure:',
            "- `jq . file` pretty-prints\n- `.name` reads a field\n- `.[]` goes through each element of an array",
            'These combine: `.[].name` is "the name of every element".',
          ),
          task: 'Print the name of every user in `data/users.json`.',
          hints: ["`jq '.[].name' data/users.json`"],
          solution: ["jq '.[].name' data/users.json"],
          validate: all(ran(/\bjq\b/), outHas('"Ada Lovelace"'), outLines(5)),
        },
        {
          explain: md(
            'Inside a `jq` filter, `|` passes values along just like a shell pipe, and `select(...)` keeps only the ones that match a condition. `-r` prints raw strings without quotes, ready for the next command.',
            "```\njq -r '.[] | select(.active) | .name' file.json\n```",
          ),
          task: 'Print the email address of every user whose role is `developer`, without quotes.',
          hints: ['The condition is `.role == "developer"`.', "`jq -r '.[] | select(.role == \"developer\") | .email' data/users.json`"],
          solution: ["jq -r '.[] | select(.role == \"developer\") | .email' data/users.json"],
          validate: outIs('linus@example.com\ngrace@example.com\nmargaret@example.com'),
        },
      ],
    },
  ],
};
