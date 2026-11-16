export type Quote = 'none' | 'single' | 'double';
export type WordPart = { text: string; q: Quote };
export type Word = { parts: WordPart[] };
export type Token = { t: 'word'; word: Word } | { t: 'op'; v: string };

/** Thrown for input the shell cannot parse. */
export class ShellSyntaxError extends Error {}
/** Thrown when the input is valid so far but unfinished (open quote, `if` without `fi`, trailing `|`). */
export class IncompleteInput extends Error {}

export const UNSUPPORTED = 'not supported in this simulator';

/** Text of a word if it is entirely unquoted, else undefined. Used for keywords and aliases. */
export function plainText(w: Word): string | undefined {
  return w.parts.every((p) => p.q === 'none') ? w.parts.map((p) => p.text).join('') : undefined;
}

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let parts: WordPart[] = [];
  let inWord = false;
  let i = 0;

  const add = (text: string, q: Quote) => {
    inWord = true;
    const last = parts[parts.length - 1];
    if (last && last.q === q && q !== 'single') last.text += text;
    else parts.push({ text, q });
  };
  const endWord = () => {
    if (inWord) tokens.push({ t: 'word', word: { parts } });
    parts = [];
    inWord = false;
  };
  const op = (v: string, len = v.length) => {
    endWord();
    tokens.push({ t: 'op', v });
    i += len;
  };

  /** Read a balanced `$( ... )` starting at index of `$`; returns end index (exclusive). */
  const readSubst = (start: number): number => {
    let depth = 0;
    let j = start + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') j++;
      else if (c === "'") {
        const end = src.indexOf("'", j + 1);
        if (end < 0) throw new IncompleteInput();
        j = end;
      } else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw new IncompleteInput();
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n') {
      op('\n');
    } else if (c === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '\\') {
      if (next === undefined) throw new IncompleteInput();
      if (next !== '\n') add(next, 'single');
      i += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new IncompleteInput();
      add(src.slice(i + 1, end), 'single');
      i = end + 1;
    } else if (c === '"') {
      i++;
      add('', 'double');
      let closed = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && '"\\$`\n'.includes(src[i + 1] ?? '')) {
          if (src[i + 1] !== '\n') add(src[i + 1], 'single');
          i += 2;
        } else if (d === '$' && src[i + 1] === '(') {
          const end = readSubst(i);
          add(src.slice(i, end), 'double');
          i = end;
        } else if (d === '`') {
          throw new ShellSyntaxError(`backtick command substitution is ${UNSUPPORTED}; use $(...) instead`);
        } else {
          add(d, 'double');
          i++;
        }
      }
      if (!closed) throw new IncompleteInput();
    } else if (c === '$' && next === '(') {
      const end = readSubst(i);
      add(src.slice(i, end), 'none');
      i = end;
    } else if (c === '`') {
      throw new ShellSyntaxError(`backtick command substitution is ${UNSUPPORTED}; use $(...) instead`);
    } else if (c === '|') {
      op(next === '|' ? '||' : '|');
    } else if (c === '&') {
      if (next === '&') op('&&');
      else if (next === '>') op('&>');
      else op('&');
    } else if (c === ';') {
      if (next === ';') throw new ShellSyntaxError(`case statements are ${UNSUPPORTED}`);
      op(';');
    } else if (c === '(' || c === ')') {
      if (c === '(' && next === '(') throw new ShellSyntaxError(`(( )) arithmetic commands are ${UNSUPPORTED}; use $(( )) instead`);
      op(c);
    } else if (c === '<') {
      if (next === '<') throw new ShellSyntaxError(`here-documents (<<) are ${UNSUPPORTED}`);
      if (next === '(') throw new ShellSyntaxError(`process substitution is ${UNSUPPORTED}`);
      op('<');
    } else if (c === '>' || ((c === '1' || c === '2') && next === '>' && !inWord)) {
      const fd = c === '2' ? '2' : '';
      const rest = src.slice(c === '>' ? i : i + 1);
      const skip = c === '>' ? 0 : 1;
      if (rest.startsWith('>&1')) op(fd ? '2>&1' : '>&1', skip + 3);
      else if (rest.startsWith('>&2')) op(fd ? '2>&2' : '>&2', skip + 3);
      else if (rest.startsWith('>>')) op(fd + '>>', skip + 2);
      else op(fd + '>', skip + 1);
    } else {
      add(c, 'none');
      i++;
    }
  }
  endWord();
  return tokens;
}
