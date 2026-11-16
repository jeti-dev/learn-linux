const CLASSES: Record<string, string> = {
  '[:digit:]': '0-9',
  '[:alpha:]': 'a-zA-Z',
  '[:alnum:]': 'a-zA-Z0-9',
  '[:upper:]': 'A-Z',
  '[:lower:]': 'a-z',
  '[:space:]': '\\s',
  '[:punct:]': '!-\\/:-@\\[-`{-~',
};

/**
 * Convert a POSIX regular expression to JavaScript syntax.
 * In basic mode (grep, sed without -E) `( ) | + ? { }` are literal unless backslash-escaped.
 */
export function posixToJs(pattern: string, extended: boolean): string {
  let out = '';
  let inBracket = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (inBracket) {
      const cls = Object.keys(CLASSES).find((k) => pattern.startsWith(k, i));
      if (cls) {
        out += CLASSES[cls];
        i += cls.length - 1;
      } else {
        if (c === ']') inBracket = false;
        out += c === '\\' ? '\\\\' : c;
      }
    } else if (c === '[') {
      inBracket = true;
      out += c;
      if (pattern[i + 1] === '^') out += pattern[++i];
      if (pattern[i + 1] === ']') out += '\\' + pattern[++i];
    } else if (c === '\\' && i + 1 < pattern.length) {
      const n = pattern[++i];
      if (!extended && '()|+?{}'.includes(n)) out += n;
      else if (n === '<' || n === '>') out += '\\b';
      else out += '\\' + n;
    } else if (!extended && '()|+?{}'.includes(c)) {
      out += '\\' + c;
    } else out += c;
  }
  return out;
}

export function makeRegex(pattern: string, opts: { extended?: boolean; fixed?: boolean; ignoreCase?: boolean; word?: boolean; line?: boolean; global?: boolean }): RegExp {
  let src = opts.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : posixToJs(pattern, !!opts.extended);
  if (opts.word) src = `\\b(?:${src})\\b`;
  if (opts.line) src = `^(?:${src})$`;
  return new RegExp(src, (opts.global ? 'g' : '') + (opts.ignoreCase ? 'i' : ''));
}

/** printf-style formatting shared by the shell's printf and awk. */
export function format(fmt: string, args: unknown[]): string {
  let i = 0;
  const unescaped = fmt.replace(/\\(n|t|\\|"|e|033|x1b)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'e' || c === '033' || c === 'x1b' ? '\x1b' : c));
  return unescaped.replace(/%(-?)(0?)(\d*)(?:\.(\d+))?([sdifxc%])/g, (_, left: string, zero: string, width: string, prec: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[i++];
    let s: string;
    if (conv === 's') s = prec !== undefined ? String(arg ?? '').slice(0, Number(prec)) : String(arg ?? '');
    else if (conv === 'c') s = String(arg ?? '').slice(0, 1);
    else if (conv === 'f') s = (Number(arg) || 0).toFixed(prec !== undefined ? Number(prec) : 6);
    else if (conv === 'x') s = Math.trunc(Number(arg) || 0).toString(16);
    else s = String(Math.trunc(Number(arg) || 0));
    const w = Number(width) || 0;
    return left ? s.padEnd(w) : s.padStart(w, zero && conv !== 's' ? '0' : ' ');
  });
}
