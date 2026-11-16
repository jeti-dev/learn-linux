import { format } from './regex';
import { lines, readInputs, usage, type CommandFn } from './types';

type Tok = { t: 'str' | 'num' | 'regex' | 'ident' | 'op' | 'nl'; v: string };

class AwkUnsupported extends Error {}
const EXIT = Symbol('exit');

/** A numeric-looking field: behaves as a number in arithmetic and prints as its original text. */
class Field {
  constructor(public text: string) {}
  valueOf(): number {
    return Number(this.text);
  }
  toString(): string {
    return this.text;
  }
}

const MULTI_OPS = ['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '!~', '**'];
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'in', 'delete']);
const BUILTIN_VARS = new Set(['NR', 'NF', 'FS', 'OFS', 'FILENAME']);
const BUILTIN_FNS = new Set(['length', 'substr', 'index', 'toupper', 'tolower', 'int', 'sqrt', 'sprintf']);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const operandEnd = () => {
    const last = toks[toks.length - 1];
    if (!last) return false;
    if (last.t === 'str' || last.t === 'num') return true;
    if (last.t === 'ident') return !KEYWORDS.has(last.v) && last.v !== 'print' && last.v !== 'printf';
    return last.t === 'op' && (last.v === ')' || last.v === ']');
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '\\' && src[i + 1] === '\n') i += 2;
    else if (c === '\n') {
      toks.push({ t: 'nl', v: '\n' });
      i++;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[++i];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        } else s += src[i];
        i++;
      }
      if (i >= src.length) throw new AwkUnsupported('unterminated string');
      i++;
      toks.push({ t: 'str', v: s });
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      toks.push({ t: 'ident', v: m[0] });
      i += m[0].length;
    } else if (c === '/' && !operandEnd()) {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\' && src[i + 1] === '/') {
          s += '/';
          i += 2;
        } else s += src[i++];
      }
      if (i >= src.length) throw new AwkUnsupported('unterminated regex');
      i++;
      toks.push({ t: 'regex', v: s });
    } else {
      const op = MULTI_OPS.find((o) => src.startsWith(o, i)) ?? c;
      toks.push({ t: 'op', v: op });
      i += op.length;
    }
  }
  return toks;
}

/** Translate awk expression/statement tokens into JavaScript source. */
function translate(toks: Tok[], arrays: Set<string>): string {
  const parts: string[] = [];
  let prevEnd = false;
  let operandStart = 0;
  const parenStarts: number[] = [];
  let callNext = false;

  const startOperand = () => {
    if (prevEnd) parts.push('+""+');
    operandStart = parts.length;
  };
  const isOp = (tok: Tok | undefined, v: string) => tok?.t === 'op' && tok.v === v;

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t === 'str') {
      startOperand();
      parts.push(JSON.stringify(tok.v));
      prevEnd = true;
    } else if (tok.t === 'num') {
      startOperand();
      parts.push(tok.v);
      prevEnd = true;
    } else if (tok.t === 'regex') {
      startOperand();
      parts.push(`M(F(0),${JSON.stringify(tok.v)})`);
      prevEnd = true;
    } else if (tok.t === 'nl') {
      parts.push(';');
      prevEnd = false;
    } else if (tok.t === 'ident') {
      const name = tok.v;
      if (name === 'print' || name === 'printf') {
        let depth = 0;
        let j = i + 1;
        const groups: Tok[][] = [[]];
        for (; j < toks.length; j++) {
          const x = toks[j];
          if (depth === 0 && (x.t === 'nl' || isOp(x, ';') || isOp(x, '}'))) break;
          if (isOp(x, '(') || isOp(x, '[')) depth++;
          if (isOp(x, ')') || isOp(x, ']')) depth--;
          if (depth === 0 && isOp(x, ',')) groups.push([]);
          else groups[groups.length - 1].push(x);
        }
        if (groups.some((g) => g.some((x) => isOp(x, '>') || isOp(x, '|')))) throw new AwkUnsupported('print redirection');
        // `print(a, b)` — strip the wrapping parentheses.
        const all = toks.slice(i + 1, j);
        if (groups.length > 1 && isOp(all[0], '(') && isOp(all[all.length - 1], ')')) {
          groups[0].shift();
          groups[groups.length - 1].pop();
        }
        const exprs = groups.filter((g) => g.length).map((g) => translate(g, arrays));
        parts.push(`${name === 'print' ? 'P' : 'PF'}([${exprs.length ? exprs.join(',') : 'F(0)'}])`);
        i = j - 1;
        prevEnd = false;
      } else if (name === 'next') {
        parts.push('return "next"');
        prevEnd = false;
      } else if (name === 'exit') {
        parts.push('throw EXIT');
        prevEnd = false;
      } else if (name === 'in') {
        parts.push(' in ');
        prevEnd = false;
      } else if (name === 'function' || name === 'getline' || name === 'sub' || name === 'gsub' || name === 'split' || name === 'match') {
        throw new AwkUnsupported(name);
      } else if (KEYWORDS.has(name)) {
        parts.push(` ${name} `);
        prevEnd = false;
      } else if (BUILTIN_FNS.has(name)) {
        startOperand();
        if (isOp(toks[i + 1], '(')) {
          parts.push(`B.${name}`);
          callNext = true;
          prevEnd = false;
        } else {
          parts.push(`B.${name}(F(0))`);
          prevEnd = true;
        }
      } else {
        startOperand();
        parts.push(BUILTIN_VARS.has(name) ? `S.${name}` : arrays.has(name) ? `A(${JSON.stringify(name)})` : `V.${name}`);
        prevEnd = true;
      }
    } else {
      const v = tok.v;
      if (v === '$') {
        startOperand();
        const next = toks[i + 1];
        if (next?.t === 'num') {
          parts.push(`F(${next.v})`);
          i++;
          prevEnd = true;
        } else if (next?.t === 'ident') {
          parts.push(`F(${BUILTIN_VARS.has(next.v) ? 'S.' : 'V.'}${next.v})`);
          i++;
          prevEnd = true;
        } else if (isOp(next, '(')) {
          parts.push('F');
          callNext = true;
          prevEnd = false;
        } else throw new AwkUnsupported('$');
      } else if (v === '(') {
        if (callNext) parenStarts.push(parts.length - 1);
        else {
          if (prevEnd) throw new AwkUnsupported('implicit concatenation before (');
          parenStarts.push(parts.length);
        }
        callNext = false;
        parts.push('(');
        prevEnd = false;
      } else if (v === ')') {
        parts.push(')');
        operandStart = parenStarts.pop() ?? operandStart;
        prevEnd = true;
      } else if (v === ']') {
        parts.push(']');
        prevEnd = true;
      } else if (v === '~' || v === '!~') {
        const rhs = toks[i + 1];
        if (!prevEnd || !rhs || (rhs.t !== 'regex' && rhs.t !== 'str')) throw new AwkUnsupported('~');
        parts.splice(operandStart, 0, v === '~' ? 'M(' : '!M(');
        parts.push(`,${JSON.stringify(rhs.v)})`);
        i++;
        prevEnd = true;
      } else if (v === '^' || v === '**') {
        parts.push('**');
        prevEnd = false;
      } else if (v === '++' || v === '--') {
        parts.push(v);
      } else if (['+=', '-=', '*=', '/=', '%='].includes(v)) {
        // awk arithmetic treats non-numeric strings as 0; wrap the right-hand side accordingly.
        let depth = 0;
        let j = i + 1;
        for (; j < toks.length; j++) {
          const x = toks[j];
          if (depth === 0 && (x.t === 'nl' || isOp(x, ';') || isOp(x, '}') || isOp(x, ')') || isOp(x, ','))) break;
          if (isOp(x, '(') || isOp(x, '[')) depth++;
          if (isOp(x, ')') || isOp(x, ']')) depth--;
        }
        parts.push(`${v} N(${translate(toks.slice(i + 1, j), arrays)})`);
        i = j - 1;
        prevEnd = true;
      } else {
        if (!/^[-+*/%<>=!&|,;{}[?:]+$/.test(v)) throw new AwkUnsupported(v);
        parts.push(v);
        prevEnd = false;
      }
    }
  }
  return parts.join(' ');
}

type Rule = { kind: 'begin' | 'end' | 'main'; pattern?: string; action?: string };

function parseProgram(src: string): Rule[] {
  const toks = tokenize(src);
  const arrays = new Set<string>();
  toks.forEach((tok, i) => {
    if (tok.t !== 'ident') return;
    const next = toks[i + 1];
    const prev = toks[i - 1];
    if ((next?.t === 'op' && next.v === '[') || (prev?.t === 'ident' && prev.v === 'in')) arrays.add(tok.v);
  });
  const rules: Rule[] = [];
  let i = 0;
  const isOp = (tok: Tok | undefined, v: string) => tok?.t === 'op' && tok.v === v;
  const block = (): Tok[] => {
    let depth = 0;
    const start = ++i;
    for (; i < toks.length; i++) {
      if (isOp(toks[i], '{')) depth++;
      else if (isOp(toks[i], '}')) {
        if (depth === 0) return toks.slice(start, i++);
        depth--;
      }
    }
    throw new AwkUnsupported('missing }');
  };
  while (i < toks.length) {
    if (toks[i].t === 'nl' || isOp(toks[i], ';')) {
      i++;
      continue;
    }
    const tok = toks[i];
    if (tok.t === 'ident' && (tok.v === 'BEGIN' || tok.v === 'END')) {
      i++;
      if (!isOp(toks[i], '{')) throw new AwkUnsupported(`${tok.v} without a block`);
      rules.push({ kind: tok.v === 'BEGIN' ? 'begin' : 'end', action: translate(block(), arrays) });
      continue;
    }
    const patStart = i;
    while (i < toks.length && !isOp(toks[i], '{') && toks[i].t !== 'nl') i++;
    const patToks = toks.slice(patStart, i);
    if (patToks.some((x) => isOp(x, ','))) throw new AwkUnsupported('range patterns');
    const rule: Rule = { kind: 'main' };
    if (patToks.length) rule.pattern = translate(patToks, arrays);
    if (isOp(toks[i], '{')) rule.action = translate(block(), arrays);
    rules.push(rule);
  }
  return rules;
}

const awk: CommandFn = (args, ctx) => {
  let fs = ' ';
  const preset: Record<string, string> = {};
  let i = 0;
  for (; i < args.length && args[i].startsWith('-') && args[i] !== '-'; i++) {
    const a = args[i];
    if (a === '-F') fs = args[++i] ?? ' ';
    else if (a.startsWith('-F')) fs = a.slice(2);
    else if (a === '-v') {
      const [k, ...v] = (args[++i] ?? '').split('=');
      preset[k] = v.join('=');
    } else return usage(ctx, `option ${a} is not supported in this simulator`);
  }
  const program = args[i++];
  if (program === undefined) return usage(ctx, 'usage: awk [-F fs] [-v var=value] \'program\' [file ...]');
  fs = fs.replace(/\\t/g, '\t');

  let out = '';
  const str = (v: unknown): string => {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(6)));
    if (typeof v === 'boolean') return v ? '1' : '0';
    return v === undefined || v === null ? '' : String(v);
  };
  const S = { NR: 0, NF: 0, FS: fs, OFS: ' ', FILENAME: '' };
  let line = '';
  let fields: string[] = [];
  const defaults = { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : 0) };
  const V = new Proxy<Record<string, unknown>>({}, defaults);
  for (const [k, v] of Object.entries(preset)) V[k] = v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
  const arrayStore: Record<string, Record<string, unknown>> = {};
  const A = (name: string) => (arrayStore[name] ??= new Proxy<Record<string, unknown>>({}, defaults));
  const F = (n: unknown) => {
    const idx = Number(n);
    const text = idx === 0 ? line : (fields[idx - 1] ?? '');
    return text !== '' && !Number.isNaN(Number(text)) ? new Field(text) : text;
  };
  const P = (vals: unknown[]) => (out += vals.map(str).join(S.OFS) + '\n');
  const PF = (vals: unknown[]) => (out += format(str(vals[0]), vals.slice(1).map((v) => (v instanceof Field ? v.text : v))));
  const M = (value: unknown, re: string) => new RegExp(re).test(str(value));
  const N = (value: unknown) => Number(value) || 0;
  const B = {
    length: (x: unknown) => (x !== null && typeof x === 'object' && !(x instanceof Field) ? Object.keys(x).length : str(x).length),
    substr: (s: unknown, start: number, len?: number) => str(s).substr(Math.max(0, Number(start) - 1), len === undefined ? undefined : Number(len)),
    index: (s: unknown, t: unknown) => str(s).indexOf(str(t)) + 1,
    toupper: (s: unknown) => str(s).toUpperCase(),
    tolower: (s: unknown) => str(s).toLowerCase(),
    int: (x: unknown) => Math.trunc(Number(x) || 0),
    sqrt: (x: unknown) => Math.sqrt(Number(x)),
    sprintf: (fmt: unknown, ...rest: unknown[]) => format(str(fmt), rest.map((v) => (v instanceof Field ? v.text : v))),
  };

  type Compiled = { kind: Rule['kind']; pattern?: () => unknown; action?: () => unknown };
  let rules: Compiled[];
  try {
    const compile = (body: string) => new Function('F', 'V', 'A', 'S', 'B', 'P', 'PF', 'M', 'N', 'EXIT', body).bind(null, F, V, A, S, B, P, PF, M, N, EXIT) as () => unknown;
    rules = parseProgram(program).map((r) => ({
      kind: r.kind,
      pattern: r.pattern !== undefined ? compile(`return (${r.pattern});`) : undefined,
      action: r.action !== undefined ? compile(r.action) : undefined,
    }));
  } catch (e) {
    ctx.err(`awk: ${e instanceof AwkUnsupported ? `\`${e.message}' is` : 'this program uses syntax that is'} not supported in this simulator\n`);
    return 2;
  }

  const needsInput = rules.some((r) => r.kind !== 'begin');
  const inputs = needsInput ? readInputs(ctx, args.slice(i)) : [];
  if (!inputs) return 2;
  const split = (text: string): string[] => {
    if (S.FS === ' ') return text.trim() ? text.trim().split(/\s+/) : [];
    return text.split(S.FS.length === 1 ? S.FS : new RegExp(S.FS));
  };
  const truthy = (v: unknown) => (v instanceof Field ? v.valueOf() !== 0 : !!v);
  try {
    try {
      for (const r of rules) if (r.kind === 'begin') r.action?.();
      for (const input of inputs) {
        S.FILENAME = input.name;
        for (const l of lines(input.text)) {
          S.NR++;
          line = l;
          fields = split(l);
          S.NF = fields.length;
          for (const r of rules) {
            if (r.kind !== 'main') continue;
            if (r.pattern && !truthy(r.pattern())) continue;
            if (!r.action) P([line]);
            else if (r.action() === 'next') break;
          }
        }
      }
    } catch (e) {
      if (e !== EXIT) throw e;
    }
    for (const r of rules) if (r.kind === 'end') r.action?.();
  } catch (e) {
    if (e !== EXIT) {
      ctx.out(out);
      ctx.err('awk: this program uses syntax that is not supported in this simulator\n');
      return 2;
    }
  }
  ctx.out(out);
  return 0;
};

export const awkCommands: Record<string, CommandFn> = { awk, gawk: awk, mawk: awk };
