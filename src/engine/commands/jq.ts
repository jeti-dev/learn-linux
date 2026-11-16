import { parseArgs, readInputs, usage, type CommandFn } from './types';

type Json = unknown;
class JqError extends Error {}

/** Split `s` on a separator that appears outside strings and brackets. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      // Keep `|` and `//`-style operators apart from longer ones.
      if (sep === '|' && (s[i + 1] === '|' || s[i - 1] === '|')) continue;
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

const typeName = (v: Json) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const cmp = (a: Json, b: Json): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = typeof a === 'string' ? a : JSON.stringify(a);
  const sb = typeof b === 'string' ? b : JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

function evalPath(path: string, input: Json): Json[] {
  let current: Json[] = [input];
  let rest = path;
  while (rest) {
    let m: RegExpExecArray | null;
    let step: (v: Json) => Json[];
    if ((m = /^\.?\[\s*\]\??/.exec(rest))) {
      step = (v) => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') return Object.values(v);
        if (m![0].endsWith('?')) return [];
        throw new JqError(`Cannot iterate over ${typeName(v)}${v === null ? '' : ` (${JSON.stringify(v)})`}`);
      };
    } else if ((m = /^\.?\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]/.exec(rest))) {
      const [from, to] = [m[1], m[2]];
      step = (v) => [(Array.isArray(v) || typeof v === 'string' ? v : []).slice(from ? Number(from) : 0, to ? Number(to) : undefined)];
    } else if ((m = /^\.?\[\s*(-?\d+)\s*\]/.exec(rest))) {
      const idx = Number(m[1]);
      step = (v) => {
        if (v === null) return [null];
        if (!Array.isArray(v)) throw new JqError(`Cannot index ${typeName(v)} with number`);
        return [v.at(idx) ?? null];
      };
    } else if ((m = /^\.?\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(rest)) || (m = /^\."((?:[^"\\]|\\.)*)"/.exec(rest)) || (m = /^\.([A-Za-z_]\w*)\??/.exec(rest))) {
      const key = m[1];
      step = (v) => {
        if (v === null) return [null];
        if (typeof v !== 'object' || Array.isArray(v)) throw new JqError(`Cannot index ${typeName(v)} with "${key}"`);
        return [(v as Record<string, Json>)[key] ?? null];
      };
    } else if ((m = /^\./.exec(rest))) {
      step = (v) => [v];
    } else throw new JqError('unsupported');
    current = current.flatMap(step);
    rest = rest.slice(m[0].length);
  }
  return current;
}

function evalFilter(filter: string, input: Json): Json[] {
  const f = filter.trim();
  if (!f) throw new JqError('unsupported');

  const pipes = splitTop(f, '|');
  if (pipes.length > 1) return pipes.reduce<Json[]>((values, stage) => values.flatMap((v) => evalFilter(stage, v)), [input]);

  const commas = splitTop(f, ',');
  if (commas.length > 1) return commas.flatMap((part) => evalFilter(part, input));

  for (const [word, fn] of [[' or ', (a: boolean, b: boolean) => a || b], [' and ', (a: boolean, b: boolean) => a && b]] as const) {
    const parts = splitTop(f, word);
    if (parts.length > 1) {
      const truth = parts.map((part) => {
        const v = evalFilter(part, input)[0];
        return v !== false && v !== null && v !== undefined;
      });
      return [truth.reduce(fn)];
    }
  }

  for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
    const parts = splitTop(f, op);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      const a = evalFilter(parts[0], input)[0];
      const b = evalFilter(parts[1], input)[0];
      const c = cmp(a, b);
      const eq = JSON.stringify(a) === JSON.stringify(b);
      return [op === '==' ? eq : op === '!=' ? !eq : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0];
    }
  }

  for (const op of [' + ', ' - ', ' * ', ' / ']) {
    const parts = splitTop(f, op);
    if (parts.length > 1) {
      const vals = parts.map((part) => evalFilter(part, input)[0]);
      return [
        vals.reduce((a, b) => {
          if (op === ' + ') {
            if (a === null) return b;
            if (b === null) return a;
            if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
            if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
          }
          const [x, y] = [Number(a), Number(b)];
          return op === ' + ' ? x + y : op === ' - ' ? x - y : op === ' * ' ? x * y : x / y;
        }),
      ];
    }
  }

  // A filter that starts with `[` (paths start with `.`) builds an array.
  if (/^\[\s*\]$/.test(f)) return [[]];
  if (f.startsWith('[') && f.endsWith(']')) return [evalFilter(f.slice(1, -1), input)];
  if (f.startsWith('{') && f.endsWith('}')) {
    const obj: Record<string, Json> = {};
    for (const entry of splitTop(f.slice(1, -1), ',')) {
      if (!entry.trim()) continue;
      const [rawKey, ...valueParts] = splitTop(entry, ':');
      const key = rawKey.trim().replace(/^"(.*)"$/, '$1');
      obj[key] = valueParts.length ? (evalFilter(valueParts.join(':'), input)[0] ?? null) : (evalPath('.' + key, input)[0] ?? null);
    }
    return [obj];
  }
  if (f.startsWith('(') && f.endsWith(')')) return evalFilter(f.slice(1, -1), input);
  if (/^-?\d+(\.\d+)?$/.test(f)) return [Number(f)];
  if (/^"(?:[^"\\]|\\.)*"$/.test(f)) return [JSON.parse(f)];
  if (f === 'true' || f === 'false' || f === 'null') return [JSON.parse(f)];
  if (f.startsWith('.')) return evalPath(f, input);

  const call = /^([a-z_]+)(?:\(([\s\S]*)\))?$/.exec(f);
  if (!call) throw new JqError('unsupported');
  const [, name, arg] = call;
  const list = (): Json[] => {
    if (!Array.isArray(input)) throw new JqError(`Cannot use ${name} on ${typeName(input)}`);
    return input;
  };
  const need = (): string => {
    if (arg === undefined) throw new JqError('unsupported');
    return arg;
  };
  switch (name) {
    case 'length':
      if (input === null) return [0];
      if (typeof input === 'string' || Array.isArray(input)) return [input.length];
      if (typeof input === 'object') return [Object.keys(input).length];
      return [Math.abs(Number(input))];
    case 'keys':
      if (input === null || typeof input !== 'object') throw new JqError(`${typeName(input)} has no keys`);
      return [Array.isArray(input) ? input.map((_, i) => i) : Object.keys(input).sort()];
    case 'values':
      return input === null ? [] : [input];
    case 'type':
      return [typeName(input)];
    case 'not':
      return [input === false || input === null];
    case 'add':
      return [list().reduce((a, b) => evalFilter('.a + .b', { a, b })[0], null)];
    case 'first':
      return [list()[0] ?? null];
    case 'last':
      return [list().at(-1) ?? null];
    case 'reverse':
      return [[...list()].reverse()];
    case 'sort':
      return [[...list()].sort(cmp)];
    case 'unique':
      return [[...new Map(list().map((v) => [JSON.stringify(v), v])).values()].sort(cmp)];
    case 'min':
      return [[...list()].sort(cmp)[0] ?? null];
    case 'max':
      return [[...list()].sort(cmp).at(-1) ?? null];
    case 'tostring':
      return [typeof input === 'string' ? input : JSON.stringify(input)];
    case 'tonumber':
      return [Number(input)];
    case 'ascii_downcase':
      return [String(input).toLowerCase()];
    case 'ascii_upcase':
      return [String(input).toUpperCase()];
    case 'to_entries':
      return [Object.entries(input as object).map(([key, value]) => ({ key, value }))];
    case 'select': {
      const v = evalFilter(need(), input)[0];
      return v !== false && v !== null && v !== undefined ? [input] : [];
    }
    case 'map':
      return [list().flatMap((v) => evalFilter(need(), v))];
    case 'sort_by':
      return [[...list()].sort((a, b) => cmp(evalFilter(need(), a)[0], evalFilter(need(), b)[0]))];
    case 'group_by': {
      const groups = new Map<string, Json[]>();
      for (const v of [...list()].sort((a, b) => cmp(evalFilter(need(), a)[0], evalFilter(need(), b)[0]))) {
        const k = JSON.stringify(evalFilter(need(), v)[0]);
        groups.set(k, [...(groups.get(k) ?? []), v]);
      }
      return [[...groups.values()]];
    }
    case 'has':
      return [Object.prototype.hasOwnProperty.call(input ?? {}, String(evalFilter(need(), input)[0]))];
    case 'join':
      return [list().map((v) => (v === null ? '' : String(v))).join(String(evalFilter(need(), input)[0]))];
    case 'contains':
    case 'startswith':
    case 'endswith':
    case 'test': {
      const needle = String(evalFilter(need(), input)[0]);
      const hay = typeof input === 'string' ? input : JSON.stringify(input);
      return [name === 'startswith' ? hay.startsWith(needle) : name === 'endswith' ? hay.endsWith(needle) : name === 'test' ? new RegExp(needle).test(hay) : hay.includes(needle)];
    }
    default:
      throw new JqError('unsupported');
  }
}

const jq: CommandFn = (args, ctx) => {
  const p = parseArgs(args, 'rcCMSe');
  if (typeof p === 'string') return usage(ctx, p);
  const [filter, ...files] = p.rest;
  if (filter === undefined) return usage(ctx, 'Usage: jq [OPTIONS] FILTER [FILES...]');
  const inputs = readInputs(ctx, files);
  if (!inputs) return 2;
  for (const input of inputs) {
    if (!input.text.trim()) continue;
    let data: Json;
    try {
      data = JSON.parse(input.text);
    } catch {
      ctx.err(`jq: error (at ${input.name || '<stdin>'}:1): Cannot parse input as JSON\n`);
      return 2;
    }
    let results: Json[];
    try {
      results = evalFilter(filter, data);
    } catch (e) {
      if (e instanceof JqError && e.message !== 'unsupported') {
        ctx.err(`jq: error (at ${input.name || '<stdin>'}:0): ${e.message}\n`);
        return 5;
      }
      ctx.err('jq: error: this filter uses syntax that is not supported in this simulator\n');
      return 3;
    }
    const sortKeys = (v: Json): Json =>
      Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;
    for (let r of results) {
      if (p.flags.S) r = sortKeys(r);
      if (p.flags.r && typeof r === 'string') ctx.out(r + '\n');
      else ctx.out(JSON.stringify(r, null, p.flags.c ? undefined : 2) + '\n');
    }
  }
  return 0;
};

export const jqCommands: Record<string, CommandFn> = { jq };
