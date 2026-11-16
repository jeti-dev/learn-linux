import { IncompleteInput, ShellSyntaxError, UNSUPPORTED, lex, plainText, type Token, type Word } from './lexer';

export type Redir =
  | { kind: 'out'; fd: 1 | 2 | 'both'; append: boolean; target: Word }
  | { kind: 'in'; target: Word }
  | { kind: 'dup'; from: 1 | 2; to: 1 | 2 };

export type Simple = { k: 'simple'; assigns: { name: string; value: Word }[]; words: Word[]; redirs: Redir[] };
export type If = { k: 'if'; clauses: { cond: List; body: List }[]; otherwise?: List };
export type For = { k: 'for'; name: string; items: Word[]; body: List };
export type While = { k: 'while'; cond: List; body: List; until: boolean };
export type Func = { k: 'func'; name: string; body: List };
export type Group = { k: 'group'; body: List };
export type Command = Simple | If | For | While | Func | Group;
export type Pipeline = { cmds: Command[]; negate: boolean };
export type AndOr = { first: Pipeline; rest: { op: '&&' | '||'; p: Pipeline }[]; bg: boolean };
export type List = AndOr[];

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', '{', '}', 'function', 'case', 'esac', 'select']);
const REDIR_OPS = new Set(['>', '>>', '<', '2>', '2>>', '&>', '2>&1', '>&2', '>&1', '2>&2']);

export function parse(src: string): List {
  return new Parser(lex(src)).parseProgram();
}

class Parser {
  private pos = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === 'op' && t.v === v;
  }
  /** Keyword at the current position, if the token is an unquoted reserved word. */
  private keyword(): string | undefined {
    const t = this.peek();
    if (t?.t !== 'word') return undefined;
    const text = plainText(t.word);
    return text !== undefined && KEYWORDS.has(text) ? text : undefined;
  }
  private describe(t: Token | undefined): string {
    if (!t) return 'newline';
    if (t.t === 'op') return t.v === '\n' ? 'newline' : t.v;
    return t.word.parts.map((p) => p.text).join('');
  }
  private fail(): never {
    if (!this.peek()) throw new IncompleteInput();
    throw new ShellSyntaxError(`syntax error near unexpected token \`${this.describe(this.peek())}'`);
  }
  private expectKeyword(kw: string): void {
    if (this.keyword() !== kw) this.fail();
    this.pos++;
  }
  private skipNewlines(): void {
    while (this.isOp('\n')) this.pos++;
  }

  parseProgram(): List {
    const list = this.parseList([]);
    if (this.peek()) this.fail();
    return list;
  }

  private parseList(terminators: string[]): List {
    const list: List = [];
    for (;;) {
      while (this.isOp('\n') || this.isOp(';')) this.pos++;
      const t = this.peek();
      if (!t) break;
      const kw = this.keyword();
      if (kw && terminators.includes(kw)) break;
      if (t.t === 'op' && t.v === ')') break;
      const item = this.parseAndOr();
      if (this.isOp('&')) {
        item.bg = true;
        this.pos++;
      } else if (this.peek() && !this.isOp(';') && !this.isOp('\n')) {
        const k = this.keyword();
        if (!(k && terminators.includes(k))) this.fail();
      }
      list.push(item);
    }
    return list;
  }

  private parseAndOr(): AndOr {
    const item: AndOr = { first: this.parsePipeline(), rest: [], bg: false };
    while (this.isOp('&&') || this.isOp('||')) {
      const op = (this.peek() as { v: string }).v as '&&' | '||';
      this.pos++;
      this.skipNewlines();
      if (!this.peek()) throw new IncompleteInput();
      item.rest.push({ op, p: this.parsePipeline() });
    }
    return item;
  }

  private parsePipeline(): Pipeline {
    let negate = false;
    const t = this.peek();
    if (t?.t === 'word' && plainText(t.word) === '!') {
      negate = true;
      this.pos++;
    }
    const cmds = [this.parseCommand()];
    while (this.isOp('|')) {
      this.pos++;
      this.skipNewlines();
      if (!this.peek()) throw new IncompleteInput();
      cmds.push(this.parseCommand());
    }
    return { cmds, negate };
  }

  private parseCommand(): Command {
    const kw = this.keyword();
    if (kw === 'if') return this.parseIf();
    if (kw === 'for') return this.parseFor();
    if (kw === 'while' || kw === 'until') return this.parseWhile(kw === 'until');
    if (kw === '{') {
      this.pos++;
      const body = this.parseList(['}']);
      this.expectKeyword('}');
      return { k: 'group', body };
    }
    if (kw === 'function') {
      this.pos++;
      const t = this.peek();
      const name = t?.t === 'word' ? plainText(t.word) : undefined;
      if (!name) this.fail();
      this.pos++;
      if (this.isOp('(')) {
        this.pos++;
        if (!this.isOp(')')) this.fail();
        this.pos++;
      }
      return this.parseFuncBody(name);
    }
    if (kw === 'case' || kw === 'select') throw new ShellSyntaxError(`\`${kw}' statements are ${UNSUPPORTED}`);
    if (kw) this.fail();
    if (this.isOp('(')) throw new ShellSyntaxError(`subshells with ( ) are ${UNSUPPORTED}`);
    return this.parseSimple();
  }

  private parseFuncBody(name: string): Func {
    this.skipNewlines();
    if (!this.peek()) throw new IncompleteInput();
    this.expectKeyword('{');
    const body = this.parseList(['}']);
    this.expectKeyword('}');
    return { k: 'func', name, body };
  }

  private parseIf(): If {
    this.pos++;
    const node: If = { k: 'if', clauses: [] };
    for (;;) {
      const cond = this.parseList(['then']);
      this.expectKeyword('then');
      const body = this.parseList(['elif', 'else', 'fi']);
      node.clauses.push({ cond, body });
      const kw = this.keyword();
      if (kw === 'elif') {
        this.pos++;
        continue;
      }
      if (kw === 'else') {
        this.pos++;
        node.otherwise = this.parseList(['fi']);
      }
      this.expectKeyword('fi');
      return node;
    }
  }

  private parseFor(): For {
    this.pos++;
    const t = this.peek();
    const name = t?.t === 'word' ? plainText(t.word) : undefined;
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) this.fail();
    this.pos++;
    const items: Word[] = [];
    this.skipNewlines();
    if (this.keyword() === 'in') {
      this.pos++;
      for (let w = this.peek(); w?.t === 'word'; w = this.peek()) {
        items.push(w.word);
        this.pos++;
      }
    } else {
      items.push({ parts: [{ text: '$@', q: 'double' }] });
    }
    while (this.isOp('\n') || this.isOp(';')) this.pos++;
    this.expectKeyword('do');
    const body = this.parseList(['done']);
    this.expectKeyword('done');
    return { k: 'for', name, items, body };
  }

  private parseWhile(until: boolean): While {
    this.pos++;
    const cond = this.parseList(['do']);
    this.expectKeyword('do');
    const body = this.parseList(['done']);
    this.expectKeyword('done');
    return { k: 'while', cond, body, until };
  }

  private parseSimple(): Command {
    const cmd: Simple = { k: 'simple', assigns: [], words: [], redirs: [] };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === 'op') {
        if (!REDIR_OPS.has(t.v)) {
          // `name()` starts a function definition.
          if (t.v === '(' && cmd.words.length === 1 && !cmd.assigns.length && !cmd.redirs.length) {
            const name = plainText(cmd.words[0]);
            this.pos++;
            if (!name || !this.isOp(')')) this.fail();
            this.pos++;
            return this.parseFuncBody(name);
          }
          break;
        }
        this.pos++;
        if (t.v === '2>&1') cmd.redirs.push({ kind: 'dup', from: 2, to: 1 });
        else if (t.v === '>&2') cmd.redirs.push({ kind: 'dup', from: 1, to: 2 });
        else if (t.v === '>&1' || t.v === '2>&2') continue;
        else {
          const target = this.peek();
          if (target?.t !== 'word') this.fail();
          this.pos++;
          if (t.v === '<') cmd.redirs.push({ kind: 'in', target: target.word });
          else
            cmd.redirs.push({
              kind: 'out',
              fd: t.v.startsWith('&') ? 'both' : t.v.startsWith('2') ? 2 : 1,
              append: t.v.endsWith('>>'),
              target: target.word,
            });
        }
        continue;
      }
      const first = t.word.parts[0];
      const m = !cmd.words.length && first?.q === 'none' ? /^([A-Za-z_]\w*)=/.exec(first.text) : null;
      if (m) {
        const rest = first.text.slice(m[0].length);
        const parts = [...(rest ? [{ text: rest, q: 'none' as const }] : []), ...t.word.parts.slice(1)];
        cmd.assigns.push({ name: m[1], value: { parts } });
      } else {
        cmd.words.push(t.word);
      }
      this.pos++;
    }
    if (!cmd.words.length && !cmd.assigns.length && !cmd.redirs.length) this.fail();
    return cmd;
  }
}
