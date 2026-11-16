export type Doc = {
  name: string;
  cat: string;
  summary: string;
  usage: string;
  options?: [string, string][];
  examples: [string, string][];
};

const d = (name: string, cat: string, summary: string, usage: string, options: [string, string][], examples: [string, string][]): Doc => ({ name, cat, summary, usage, options, examples });

/** Reference data for `man`, `--help` and the cheat sheet. Covers what the simulator implements. */
export const DOCS: Doc[] = [
  // Navigation
  d('pwd', 'Navigation', 'Print the current working directory', 'pwd', [], [['pwd', 'Show where you are']]),
  d('ls', 'Navigation', 'List directory contents', 'ls [-alhRtrS] [path...]', [['-l', 'long format: permissions, owner, size, date'], ['-a', 'include hidden files (names starting with a dot)'], ['-h', 'human-readable sizes, with -l'], ['-t', 'sort by modification time, newest first'], ['-S', 'sort by size, largest first'], ['-r', 'reverse the sort order'], ['-R', 'list subdirectories recursively']], [['ls -la', 'Everything in the current directory, with details'], ['ls -lh logs/', 'Details with readable sizes'], ['ls -lt | head', 'The most recently changed files']]),
  d('cd', 'Navigation', 'Change the current directory', 'cd [dir]', [], [['cd project/src', 'Go into a directory (relative path)'], ['cd /var/log', 'Go to an absolute path'], ['cd ..', 'Go up one level'], ['cd ~', 'Go to your home directory (plain `cd` does the same)'], ['cd -', 'Go back to the previous directory']]),
  d('tree', 'Navigation', 'Show a directory as a tree', 'tree [-a] [-d] [-L depth] [dir]', [['-L n', 'descend only n levels'], ['-a', 'include hidden files'], ['-d', 'directories only']], [['tree -L 2', 'Two levels of the current directory']]),

  // Files
  d('touch', 'Files', 'Create an empty file or update its timestamp', 'touch file...', [], [['touch notes.txt', 'Create notes.txt if it does not exist']]),
  d('mkdir', 'Files', 'Create directories', 'mkdir [-p] dir...', [['-p', 'create parent directories as needed; no error if it exists']], [['mkdir -p src/components/ui', 'Create a nested path in one go']]),
  d('cp', 'Files', 'Copy files and directories', 'cp [-r] source... dest', [['-r', 'copy directories recursively'], ['-v', 'print each file as it is copied']], [['cp .env .env.backup', 'Copy a file'], ['cp -r src src-old', 'Copy a whole directory']]),
  d('mv', 'Files', 'Move or rename files', 'mv source... dest', [['-v', 'print each rename']], [['mv old.js new.js', 'Rename a file'], ['mv *.log logs/', 'Move several files into a directory']]),
  d('rm', 'Files', 'Remove files or directories. There is no trash: this is permanent', 'rm [-rf] file...', [['-r', 'remove directories and their contents'], ['-f', 'ignore missing files, never prompt']], [['rm temp.txt', 'Delete a file'], ['rm -r build/', 'Delete a directory and everything in it']]),
  d('rmdir', 'Files', 'Remove empty directories', 'rmdir dir...', [], [['rmdir empty-folder', 'Fails if the directory has contents']]),
  d('ln', 'Files', 'Create links between files', 'ln [-s] target link', [['-s', 'make a symbolic link (a pointer to a path)']], [['ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/', 'Enable an nginx site the Ubuntu way']]),
  d('stat', 'Files', 'Show detailed file status', 'stat file...', [], [['stat server.js', 'Size, permissions, owner and timestamps']]),
  d('file', 'Files', 'Guess the type of a file', 'file file...', [], [['file scripts/deploy.sh', 'Tells you it is a shell script']]),
  d('du', 'Files', 'Estimate disk usage of files and directories', 'du [-sh] [-d depth] [path...]', [['-s', 'only a total for each argument'], ['-h', 'human-readable sizes'], ['-d n', 'limit depth']], [['du -sh *', 'Size of each item in the current directory'], ['du -h -d 1 | sort -h', 'Find the largest subdirectories']]),
  d('df', 'Files', 'Report filesystem disk space usage', 'df [-h]', [['-h', 'human-readable sizes']], [['df -h', 'Is the disk full?']]),
  d('tar', 'Files', 'Create and extract archives', 'tar -c|-x|-t [-z] [-v] -f archive [-C dir] [path...]', [['-c', 'create an archive'], ['-x', 'extract an archive'], ['-t', 'list the contents'], ['-z', 'compress or decompress with gzip'], ['-v', 'list files as they are processed'], ['-f file', 'the archive file (always needed)'], ['-C dir', 'change to dir first']], [['tar -czf backup.tar.gz data/', 'Create a compressed archive'], ['tar -tzf backup.tar.gz', 'Look inside without extracting'], ['tar -xzf backup.tar.gz -C /tmp', 'Extract into /tmp']]),
  d('gzip', 'Files', 'Compress files (replaces file with file.gz)', 'gzip [-dk] file...', [['-d', 'decompress (same as gunzip)'], ['-k', 'keep the original file']], [['gzip -k logs/app.log', 'Compress but keep the original']]),

  // Viewing
  d('cat', 'Viewing', 'Print files to the terminal', 'cat [-n] [file...]', [['-n', 'number the lines']], [['cat package.json', 'Show a short file'], ['cat a.txt b.txt > both.txt', 'Concatenate files']]),
  d('less', 'Viewing', 'View a file one screen at a time (shown in full here)', 'less file', [], [['less logs/app.log', 'On a real system: space to page, / to search, q to quit']]),
  d('head', 'Viewing', 'Print the first lines of a file', 'head [-n N] [file...]', [['-n N', 'print N lines instead of 10']], [['head -n 5 data/users.csv', 'The first five lines']]),
  d('tail', 'Viewing', 'Print the last lines of a file', 'tail [-n N] [-f] [file...]', [['-n N', 'print N lines instead of 10'], ['-n +N', 'print from line N to the end'], ['-f', 'keep following the file as it grows (Ctrl+C to stop)']], [['tail -n 20 logs/app.log', 'The latest log lines'], ['tail -f logs/app.log', 'Watch a log live']]),
  d('nano', 'Viewing', 'Simple text editor', 'nano file', [], [['nano ~/.bashrc', 'Edit, then Ctrl+O to save and Ctrl+X to exit']]),
  d('vim', 'Viewing', 'Modal text editor found on every server', 'vim file', [], [['vim notes.txt', 'i to insert, Esc to stop, :wq to save and quit, :q! to quit without saving']]),

  // Search
  d('grep', 'Search', 'Print lines that match a pattern', 'grep [-inrvcloE] pattern [file...]', [['-i', 'ignore case'], ['-n', 'show line numbers'], ['-r', 'search directories recursively'], ['-v', 'invert: print lines that do not match'], ['-c', 'count matching lines'], ['-l', 'only list files that contain a match'], ['-o', 'print only the matching part'], ['-E', 'extended regular expressions (| + ? without backslashes)'], ['-A n / -B n', 'show n lines after / before each match'], ['--include=GLOB', 'with -r, only search matching files']], [['grep ERROR logs/app.log', 'Lines containing ERROR'], ['grep -rn "TODO" src/', 'Find TODOs with file names and line numbers'], ['grep -c " 500 " logs/access.log', 'Count matching lines'], ['ps aux | grep node', 'Filter the output of another command']]),
  d('find', 'Search', 'Search for files in a directory tree', 'find [path...] [tests] [action]', [['-name GLOB', 'file name matches (quote the pattern)'], ['-iname GLOB', 'same, ignoring case'], ['-type f|d', 'regular files or directories'], ['-size +N[kM]', 'larger than N'], ['-mtime -N', 'modified less than N days ago'], ['-maxdepth N', 'descend at most N levels'], ['-exec CMD {} \\;', 'run CMD on each result'], ['-delete', 'delete each result']], [['find . -name "*.js"', 'All JavaScript files below here'], ['find . -type f -size +1k', 'Files larger than 1 KB'], ['find . -name "*.log" -exec wc -l {} \\;', 'Run a command on each match']]),
  d('xargs', 'Search', 'Build command lines from standard input', 'xargs [-n N] [-I {}] command', [['-n N', 'use at most N items per command'], ['-I {}', 'replace {} with each input line']], [['find . -name "*.js" | xargs grep -l TODO', 'Search only in the files find reports'], ['cat list.txt | xargs -I {} cp {} backup/', 'One command per input line']]),
  d('which', 'Search', 'Show the full path of a command', 'which command', [], [['which node', 'Which node binary will run?']]),

  // Text
  d('wc', 'Text', 'Count lines, words and bytes', 'wc [-lwc] [file...]', [['-l', 'lines'], ['-w', 'words'], ['-c', 'bytes']], [['wc -l logs/access.log', 'How many requests were logged'], ['grep ERROR logs/app.log | wc -l', 'Count matches']]),
  d('sort', 'Text', 'Sort lines of text', 'sort [-rnu] [-k N] [-t SEP] [file...]', [['-n', 'numeric sort'], ['-r', 'reverse'], ['-u', 'drop duplicate lines'], ['-k N', 'sort by field N'], ['-t SEP', 'field separator'], ['-h', 'sort human-readable sizes (2K, 1M)']], [['sort -t, -k2 data/users.csv', 'Sort a CSV by its second column'], ['sort | uniq -c | sort -rn', 'The classic frequency count']]),
  d('uniq', 'Text', 'Collapse adjacent duplicate lines (sort first)', 'uniq [-cd] [file]', [['-c', 'prefix lines with the number of occurrences'], ['-d', 'only print duplicated lines']], [['cut -d" " -f1 logs/access.log | sort | uniq -c', 'Requests per IP address']]),
  d('cut', 'Text', 'Extract columns from each line', 'cut -d SEP -f LIST [file...]', [['-d SEP', 'field delimiter (default: tab)'], ['-f LIST', 'fields to keep, e.g. 1,3 or 2-4'], ['-c LIST', 'character positions to keep']], [['cut -d, -f2,4 data/users.csv', 'Columns 2 and 4 of a CSV']]),
  d('tr', 'Text', 'Translate or delete characters', 'tr [-d] set1 [set2]', [['-d', 'delete characters in set1'], ['-s', 'squeeze repeats']], [['echo hello | tr a-z A-Z', 'Upper-case'], ['tr -d "\\r" < win.txt', 'Strip carriage returns']]),
  d('sed', 'Text', 'Stream editor: transform text line by line', "sed [-n] [-i] [-E] 'script' [file...]", [['s/a/b/', 'replace the first a with b on each line'], ['s/a/b/g', 'replace every occurrence'], ['Nd', 'delete line N'], ['/re/d', 'delete matching lines'], ['-n \'N,Mp\'', 'print only lines N to M'], ['-i', 'edit the file in place']], [["sed 's/localhost/127.0.0.1/g' .env", 'Preview a replacement'], ["sed -i 's/3000/8080/' .env", 'Change the file itself'], ["sed -n '5,10p' logs/app.log", 'Print lines 5 to 10']]),
  d('awk', 'Text', 'Process text by fields', "awk [-F SEP] 'pattern { action }' [file...]", [['$1, $2 ...', 'fields of the current line; $0 is the whole line'], ['NR / NF', 'line number / number of fields'], ['-F SEP', 'field separator'], ['END { }', 'runs after the last line']], [["awk '{print $1, $9}' logs/access.log", 'IP address and status code'], ["awk '$9 >= 500' logs/access.log", 'Lines where field 9 is at least 500'], ["awk -F, '{sum += $2} END {print sum}' report.csv", 'Sum a column']]),
  d('jq', 'Text', 'Query and transform JSON', "jq [-r] 'filter' [file...]", [['.', 'pretty-print the input'], ['.key', 'a field'], ['.[]', 'each array element'], ['select(cond)', 'keep items that match'], ['-r', 'raw strings without quotes']], [["jq '.[].name' data/users.json", 'One field from each element'], ["jq '.[] | select(.role == \"admin\")' data/users.json", 'Filter objects'], ["curl -s api.example.com/users | jq 'length'", 'Works on API responses']]),
  d('diff', 'Text', 'Compare two files line by line', 'diff [-u] file1 file2', [['-u', 'unified format, like git diff']], [['diff -u .env .env.backup', 'What changed?']]),
  d('tee', 'Text', 'Write input to a file and to the terminal', 'tee [-a] file...', [['-a', 'append instead of overwrite']], [['npm test | tee test.log', 'See output and keep a copy'], ['echo "127.0.0.1 myapp.local" | sudo tee -a /etc/hosts', 'Append to a root-owned file']]),

  // Permissions
  d('chmod', 'Permissions', 'Change file permissions', 'chmod [-R] mode file...', [['u g o a', 'user (owner), group, others, all'], ['+ - =', 'add, remove, set exactly'], ['r w x', 'read (4), write (2), execute (1)'], ['-R', 'apply recursively']], [['chmod +x scripts/deploy.sh', 'Make a script executable'], ['chmod 600 ~/.ssh/id_ed25519', 'Owner read/write only'], ['chmod 644 file', 'rw-r--r--: the usual mode for files'], ['chmod 755 dir', 'rwxr-xr-x: the usual mode for directories and scripts']]),
  d('chown', 'Permissions', 'Change file owner and group (needs sudo)', 'chown [-R] owner[:group] file...', [['-R', 'apply recursively']], [['sudo chown -R dev:dev /var/www/myapp', 'Take ownership of a directory tree']]),
  d('sudo', 'Permissions', 'Run one command as root', 'sudo command', [['-u user', 'run as another user instead of root']], [['sudo apt update', 'Run a command that needs root'], ['sudo !!', 'Repeat the previous command with sudo']]),
  d('whoami', 'Permissions', 'Print the current user name', 'whoami', [], [['whoami', 'dev'], ['sudo whoami', 'root']]),
  d('id', 'Permissions', 'Print user and group IDs', 'id [user]', [], [['id', 'Your uid, gid and groups']]),

  // Processes
  d('ps', 'Processes', 'List running processes', 'ps [aux | -ef]', [['aux', 'every process, with user, CPU and memory'], ['-ef', 'every process, with parent PID']], [['ps aux | grep node', 'Find a process by name'], ['ps', 'Only the processes of this terminal']]),
  d('top', 'Processes', 'Live view of processes sorted by CPU', 'top', [], [['top', 'On a real system: q to quit']]),
  d('kill', 'Processes', 'Send a signal to a process', 'kill [-SIGNAL] pid...', [['(default)', 'SIGTERM (15): ask the process to exit'], ['-9', 'SIGKILL: force it; the process cannot clean up'], ['%N', 'a job number instead of a PID']], [['kill 4242', 'Polite stop'], ['kill -9 4242', 'Last resort'], ['kill %1', 'Stop background job 1']]),
  d('pkill', 'Processes', 'Signal processes by name', 'pkill [-f] pattern', [['-f', 'match against the full command line']], [['pkill -f "node server.js"', 'Stop by command line']]),
  d('pgrep', 'Processes', 'Find process IDs by name', 'pgrep [-fl] pattern', [['-l', 'show the name too'], ['-f', 'match against the full command line']], [['pgrep -l node', 'PIDs of node processes']]),
  d('jobs', 'Processes', 'List background jobs of this shell', 'jobs', [], [['sleep 100 &', 'Start a job in the background'], ['jobs', 'See it'], ['fg %1', 'Bring it to the foreground'], ['bg', 'Resume a job stopped with Ctrl+Z, in the background']]),

  // Environment
  d('echo', 'Environment', 'Print text and variables', 'echo [-n] text...', [['-n', 'no trailing newline']], [['echo $HOME', 'Print a variable'], ['echo "PORT=8080" >> .env', 'Append a line to a file']]),
  d('export', 'Environment', 'Make a variable visible to programs you start', 'export NAME=value', [], [['export NODE_ENV=production', 'Set and export'], ['PORT=4000 node server.js', 'Set a variable for one command only']]),
  d('env', 'Environment', 'Print the environment', 'env', [], [['env | grep PATH', 'Find a variable'], ['printenv HOME', 'Print one variable']]),
  d('unset', 'Environment', 'Remove a variable', 'unset NAME', [], [['unset NODE_ENV', 'Remove it from this shell']]),
  d('alias', 'Environment', 'Define a shortcut for a command', "alias name='command'", [], [["alias gs='git status'", 'Define an alias'], ['alias', 'List all aliases'], ['unalias gs', 'Remove one']]),
  d('source', 'Environment', 'Run a file in the current shell', 'source file', [], [['source ~/.bashrc', 'Reload your shell configuration']]),
  d('type', 'Environment', 'Explain how a name would be interpreted', 'type name', [], [['type ll', 'Shows that ll is an alias'], ['type cd', 'A shell builtin']]),
  d('history', 'Environment', 'Show the command history', 'history [N]', [], [['history 10', 'The last ten commands'], ['history | grep ssh', 'Find an earlier command'], ['!!', 'Repeat the previous command']]),

  // Network
  d('curl', 'Network', 'Transfer data from or to a URL', 'curl [-sSiILv] [-X METHOD] [-H header] [-d data] [-o file] url', [['-s', 'silent: no progress meter'], ['-i', 'include response headers'], ['-I', 'headers only'], ['-L', 'follow redirects'], ['-X METHOD', 'request method'], ['-H "K: V"', 'add a request header'], ['-d DATA', 'request body (implies POST)'], ['-o FILE', 'save the response to a file'], ['-v', 'show the whole conversation'], ['-f', 'fail with an error on HTTP 4xx/5xx']], [['curl localhost:3000/health', 'Is my server answering?'], ['curl -I https://example.com', 'Just the headers'], ['curl -s api.example.com/users | jq .', 'Fetch JSON and format it'], ['curl -X POST -H "Content-Type: application/json" -d \'{"name":"Eve"}\' api.example.com/users', 'POST JSON']]),
  d('ping', 'Network', 'Check that a host is reachable', 'ping [-c N] host', [['-c N', 'stop after N packets']], [['ping -c 3 example.com', 'Three packets, then a summary']]),
  d('dig', 'Network', 'Look up DNS records', 'dig [+short] name', [['+short', 'just the answer']], [['dig +short example.com', 'The IP address behind a name']]),
  d('ss', 'Network', 'Show listening sockets', 'ss -tlnp', [['-t', 'TCP'], ['-l', 'listening sockets only'], ['-n', 'numeric ports, no name lookups'], ['-p', 'show the owning process (sudo to see other users\')']], [['ss -tlnp', 'What is listening, and on which port?'], ['sudo ss -tlnp | grep :80', 'Who owns port 80?']]),
  d('lsof', 'Network', 'List open files; with -i, network sockets', 'lsof -i [:port]', [], [['lsof -i :3000', 'Which process holds port 3000?']]),
  d('ip', 'Network', 'Show network interfaces and routes', 'ip addr | ip route', [], [['ip addr', 'Your IP addresses']]),
  d('wget', 'Network', 'Download a file', 'wget [-q] [-O file] url', [['-O file', 'save as file']], [['wget https://example.com/', 'Saves index.html']]),

  // SSH
  d('ssh', 'SSH', 'Log in to a remote machine', 'ssh [-i key] [user@]host [command]', [['-i key', 'use this private key'], ['command', 'run one command and return']], [['ssh deploy@staging.example.com', 'Open a remote shell (exit to leave)'], ['ssh staging uptime', 'Run one command, using an alias from ~/.ssh/config']]),
  d('ssh-keygen', 'SSH', 'Generate an SSH key pair', 'ssh-keygen -t ed25519 [-C comment] [-f file]', [['-t type', 'key type; ed25519 is the modern default'], ['-C comment', 'a label, usually your email']], [['ssh-keygen -t ed25519 -C "dev@example.com"', 'Creates ~/.ssh/id_ed25519 and id_ed25519.pub']]),
  d('ssh-copy-id', 'SSH', 'Install your public key on a server', 'ssh-copy-id [user@]host', [], [['ssh-copy-id deploy@staging.example.com', 'Afterwards ssh logs in without a password']]),
  d('scp', 'SSH', 'Copy files over SSH', 'scp [-r] source target', [['-r', 'copy directories'], ['host:path', 'a remote path, relative to the remote home directory']], [['scp build.tar.gz deploy@staging.example.com:/tmp/', 'Upload'], ['scp staging:/var/www/myapp/logs/app.log .', 'Download']]),

  // System
  d('apt', 'System', 'Install and manage packages on Ubuntu', 'apt update | install | remove | search | show | list', [['update', 'refresh the package index (does not upgrade anything)'], ['install PKG', 'install a package'], ['remove PKG', 'uninstall a package'], ['search TERM', 'find packages'], ['list --installed', 'what is installed']], [['sudo apt update', 'Always do this first'], ['sudo apt install tree', 'Install a package'], ['apt search json', 'Find a package']]),
  d('systemctl', 'System', 'Control systemd services', 'systemctl status|start|stop|restart|enable|disable unit', [['status', 'state, PID and recent log lines'], ['start / stop / restart', 'change the running state (sudo)'], ['enable / disable', 'start at boot or not (sudo)'], ['list-units', 'services that are loaded']], [['systemctl status nginx', 'Is it running?'], ['sudo systemctl restart nginx', 'Restart after a config change'], ['systemctl list-units', 'Spot failed services']]),
  d('journalctl', 'System', 'Read the systemd journal (service logs)', 'journalctl [-u unit] [-n N] [-f] [-p err]', [['-u unit', 'only this service'], ['-n N', 'the last N lines'], ['-f', 'follow new entries'], ['-p err', 'only errors'], ['-e', 'jump to the end']], [['journalctl -u myapp -n 20', 'Why did my service fail?'], ['journalctl -u nginx -f', 'Watch a service live']]),
  d('crontab', 'System', 'Schedule recurring commands', 'crontab -l | -e | -r | file', [['-l', 'show your schedule'], ['-e', 'edit it'], ['m h dom mon dow', 'minute, hour, day of month, month, day of week']], [['crontab -l', 'List scheduled jobs'], ['echo "0 2 * * * /home/dev/project/scripts/backup.sh" | crontab -', 'Run a script every night at 02:00']]),
  d('uname', 'System', 'Print system information', 'uname [-a]', [], [['uname -a', 'Kernel and architecture'], ['lsb_release -a', 'Ubuntu version']]),
  d('free', 'System', 'Show memory usage', 'free -h', [], [['free -h', 'How much RAM is available?']]),

  // Scripting
  d('bash', 'Scripting', 'Run a shell script', 'bash script.sh [args] | ./script.sh [args]', [['#!/bin/bash', 'first line of a script: which interpreter runs it'], ['$1 $2 $@', 'arguments passed to the script'], ['$?', 'exit code of the last command (0 means success)'], ['set -euo pipefail', 'stop on errors, on unset variables, and on failures inside pipes']], [['bash scripts/deploy.sh staging', 'Run without the execute bit'], ['./scripts/deploy.sh', 'Run directly (needs chmod +x)']]),
  d('test', 'Scripting', 'Evaluate a condition; also written [ ... ]', '[ expression ]', [['-f FILE', 'is a regular file'], ['-d DIR', 'is a directory'], ['-z STR / -n STR', 'string is empty / not empty'], ['A = B, A != B', 'string comparison'], ['A -eq B, -lt, -gt', 'number comparison']], [['[ -f .env ] && echo "found"', 'Run a command if a file exists'], ['if [ "$1" = "prod" ]; then echo careful; fi', 'In a script']]),
  d('seq', 'Scripting', 'Print a sequence of numbers', 'seq [first] last', [], [['for i in $(seq 1 3); do echo "run $i"; done', 'Loop three times']]),
  d('date', 'Scripting', 'Print the date and time', 'date [+FORMAT]', [['+%F', 'YYYY-MM-DD'], ['+%T', 'HH:MM:SS']], [['date +%F', 'Useful in file names: backup-$(date +%F).tar.gz']]),
  d('man', 'Scripting', 'Show the manual page of a command', 'man command', [], [['man grep', 'Read about grep'], ['grep --help', 'A shorter summary']]),
];

const byName = new Map(DOCS.map((doc) => [doc.name, doc]));
const ALIASES: Record<string, string> = { '[': 'test', '.': 'source', vi: 'vim', gunzip: 'gzip', 'apt-get': 'apt', sh: 'bash', htop: 'top', egrep: 'grep', printenv: 'env', fg: 'jobs', bg: 'jobs', more: 'less', killall: 'pkill', nslookup: 'dig', unalias: 'alias' };

export function getDoc(name: string): Doc | undefined {
  return byName.get(name) ?? byName.get(ALIASES[name] ?? '');
}

/** Short `--help` output. */
export function helpText(name: string): string | null {
  const doc = getDoc(name);
  if (!doc) return null;
  let out = `Usage: ${doc.usage}\n${doc.summary}.\n`;
  if (doc.options?.length) {
    const w = Math.max(...doc.options.map(([o]) => o.length));
    out += '\n' + doc.options.map(([o, desc]) => `  ${o.padEnd(w)}  ${desc}\n`).join('');
  }
  if (doc.examples.length) out += '\nExamples:\n' + doc.examples.map(([cmd, desc]) => `  ${cmd}\n      ${desc}\n`).join('');
  return out;
}

/** Longer `man` output. */
export function manPage(name: string): string | null {
  const doc = getDoc(name);
  if (!doc) return null;
  const upper = doc.name.toUpperCase();
  let out = `${upper}(1)                    User Commands                    ${upper}(1)\n\n\x1b[1mNAME\x1b[0m\n       ${doc.name} - ${doc.summary.charAt(0).toLowerCase() + doc.summary.slice(1)}\n\n\x1b[1mSYNOPSIS\x1b[0m\n       ${doc.usage}\n`;
  if (doc.options?.length) out += `\n\x1b[1mOPTIONS\x1b[0m\n` + doc.options.map(([o, desc]) => `       \x1b[1m${o}\x1b[0m\n              ${desc}\n`).join('');
  if (doc.examples.length) out += `\n\x1b[1mEXAMPLES\x1b[0m\n` + doc.examples.map(([cmd, desc]) => `       ${cmd}\n              ${desc}\n`).join('');
  out += '\n(simulator: this is a condensed page; the real manual is longer)\n';
  return out;
}
