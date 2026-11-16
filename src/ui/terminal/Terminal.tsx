import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { complete } from '../../engine/shell/completion';
import type { Chunk } from '../../engine/shell/Shell';
import type { TerminalHost } from '../../lessons/runner';
import { Editor } from './Editor';
import { KeyBar, type BarKey } from './KeyBar';
import { renderAnsi } from './ansi';
import s from './Terminal.module.css';

type Line = { id: number; kind: 'cmd' | 'out' | 'err' | 'note'; prompt?: PromptParts | string; text: string };
type PromptParts = { userHost: string; path: string; sigil: string };
type EditState = { kind: 'vim' | 'nano'; path: string; initial: string };

export type TerminalHandle = {
  /** Insert text at the cursor, as if typed. */
  insert(text: string): void;
  focus(): void;
  /** Print a message from the app (not from the shell). */
  note(text: string): void;
};

const MAX_LINES = 1500;
let nextId = 1;

function Prompt({ p, trailingSpace = true }: { p: PromptParts | string; trailingSpace?: boolean }) {
  if (typeof p === 'string') return <span className={s.promptPlain}>{trailingSpace ? p : p.trimEnd()}</span>;
  return (
    <span className={s.prompt}>
      <span className={s.promptUser}>{p.userHost}</span>:<span className={s.promptPath}>{p.path}</span>
      {p.sigil}
      {trailingSpace ? ' ' : ''}
    </span>
  );
}

type Props = {
  host: TerminalHost;
  /** Called after anything that may have changed lesson state. */
  onActivity?: () => void;
  autoFocus?: boolean;
  intro?: string;
};

export const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ host, onActivity, autoFocus, intro }, ref) {
  const [lines, setLines] = useState<Line[]>(() => (intro ? [{ id: nextId++, kind: 'note', text: intro }] : []));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState<{ query: string; skip: number } | null>(null);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [, bump] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);

  const shell = host.shell;
  const running = shell.foreground !== undefined;

  const push = useCallback((items: Omit<Line, 'id'>[]) => {
    if (!items.length) return;
    setLines((prev) => [...prev, ...items.map((l) => ({ ...l, id: nextId++ }))].slice(-MAX_LINES));
  }, []);

  const pushChunks = useCallback(
    (chunks: Chunk[]) => {
      push(
        chunks
          .filter((c) => c.text)
          .map((c) => ({ kind: c.s === 'err' ? ('err' as const) : ('out' as const), text: c.text.replace(/\n$/, '') })),
      );
    },
    [push],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, input, pending, running, search]);

  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [autoFocus]);

  // Restore the caret after programmatic edits of the input.
  useEffect(() => {
    if (caret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const setLine = (value: string, cursor = value.length) => {
    setInput(value);
    caret.current = cursor;
  };

  const insert = useCallback((text: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? el?.value.length ?? 0;
    const end = el?.selectionEnd ?? start;
    setInput((prev) => prev.slice(0, start) + text + prev.slice(end));
    caret.current = start + text.length;
    el?.focus();
  }, []);

  useImperativeHandle(ref, () => ({ insert, focus: () => inputRef.current?.focus(), note: (text) => push([{ kind: 'note', text }]) }), [insert, push]);

  const searchMatch = (st: { query: string; skip: number } | null): string | null => {
    if (!st || !st.query) return null;
    const matches = [...shell.history].reverse().filter((h) => h.includes(st.query));
    return matches[Math.min(st.skip, matches.length - 1)] ?? null;
  };

  const submit = (line: string) => {
    const promptNow: PromptParts | string = pending !== null ? '> ' : shell.prompt();
    push([{ kind: 'cmd', prompt: promptNow, text: line }]);
    setInput('');
    setHistIdx(null);
    setSearch(null);
    const full = pending !== null ? pending + '\n' + line : line;
    const result = host.run(full);
    if (result.incomplete) {
      setPending(full);
      return;
    }
    setPending(null);
    if (result.expanded) push([{ kind: 'out', text: result.expanded }]);
    if (result.action?.type === 'clear') setLines([]);
    pushChunks(result.chunks);
    if (result.action?.type === 'edit') {
      const { path, editor } = result.action;
      let initial = '';
      try {
        initial = shell.fs.isFile(path) ? shell.fs.readFile(path) : '';
      } catch (e) {
        push([{ kind: 'err', text: `${editor}: ${path}: ${(e as Error).message}` }]);
        return;
      }
      setEditing({ kind: editor, path, initial });
    }
    onActivity?.();
    bump((n) => n + 1);
  };

  const control = (ch: string): boolean => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? input.length;
    switch (ch) {
      case 'c':
        if (running) pushChunks(host.key('ctrl-c'));
        else {
          push([{ kind: 'cmd', prompt: pending !== null ? '> ' : shell.prompt(), text: (search ? '' : input) + '^C' }]);
          setInput('');
          setPending(null);
        }
        setSearch(null);
        setHistIdx(null);
        onActivity?.();
        bump((n) => n + 1);
        return true;
      case 'z':
        if (running) {
          pushChunks(host.key('ctrl-z'));
          onActivity?.();
          bump((n) => n + 1);
        }
        return true;
      case 'l':
        setLines([]);
        host.key('ctrl-l');
        onActivity?.();
        return true;
      case 'a':
        setLine(input, 0);
        return true;
      case 'e':
        setLine(input, input.length);
        return true;
      case 'u':
        setLine(input.slice(pos), 0);
        return true;
      case 'k':
        setLine(input.slice(0, pos), pos);
        return true;
      case 'w': {
        const before = input.slice(0, pos).replace(/\S+\s*$/, '');
        setLine(before + input.slice(pos), before.length);
        return true;
      }
      case 'r':
        if (running) return true;
        setSearch((prev) => (prev ? { ...prev, skip: prev.skip + 1 } : { query: '', skip: 0 }));
        return true;
      case 'g':
        setSearch(null);
        return true;
      case 'd':
        if (!input && !running) submit('exit');
        return true;
      default:
        return false;
    }
  };

  const historyStep = (dir: -1 | 1) => {
    const hist = shell.history;
    if (!hist.length) return;
    let idx = histIdx;
    if (idx === null) {
      if (dir === 1) return;
      setDraft(input);
      idx = hist.length - 1;
    } else idx += dir;
    if (idx < 0) idx = 0;
    if (idx >= hist.length) {
      setHistIdx(null);
      setLine(draft);
      return;
    }
    setHistIdx(idx);
    setLine(hist[idx].split('\n').join('; '));
  };

  const tab = () => {
    if (running || search) return;
    const el = inputRef.current;
    const result = complete(shell, input, el?.selectionStart ?? input.length);
    if (result.options.length) {
      push([
        { kind: 'cmd', prompt: shell.prompt(), text: input },
        { kind: 'out', text: result.options.join('  ') },
      ]);
    }
    setLine(result.line, result.cursor);
  };

  const acceptSearch = (run: boolean) => {
    const match = searchMatch(search);
    setSearch(null);
    if (match === null) return;
    if (run) submit(match);
    else setLine(match);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1) {
      // Let the browser handle copy when text is selected, and paste always.
      if (k.toLowerCase() === 'v') return;
      if (k.toLowerCase() === 'c' && window.getSelection()?.toString()) return;
      if (control(k.toLowerCase())) e.preventDefault();
      return;
    }
    if (search) {
      if (k === 'Enter') {
        e.preventDefault();
        acceptSearch(true);
      } else if (k === 'Escape') {
        e.preventDefault();
        setSearch(null);
      } else if (k.startsWith('Arrow') || k === 'Tab') {
        e.preventDefault();
        acceptSearch(false);
      }
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      if (!running) submit(input);
    } else if (k === 'Tab') {
      e.preventDefault();
      tab();
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      historyStep(-1);
    } else if (k === 'ArrowDown') {
      e.preventDefault();
      historyStep(1);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (ctrlArmed) {
      // The sticky Ctrl key from the key bar turns the next typed character into a control key.
      setCtrlArmed(false);
      const typed = (e.nativeEvent as InputEvent).data ?? value.slice(-1);
      if (typed && control(typed.toLowerCase())) return;
    }
    if (running) return;
    if (search) setSearch({ query: value, skip: 0 });
    else setInput(value);
  };

  const onBarKey = (key: BarKey) => {
    const el = inputRef.current;
    el?.focus();
    switch (key.action) {
      case 'insert':
        if (ctrlArmed) {
          setCtrlArmed(false);
          return;
        }
        if (search) setSearch({ query: search.query + key.text!, skip: 0 });
        else if (!running) insert(key.text!);
        break;
      case 'tab':
        tab();
        break;
      case 'ctrl':
        setCtrlArmed((v) => !v);
        break;
      case 'ctrl-c':
        control('c');
        break;
      case 'ctrl-z':
        control('z');
        break;
      case 'up':
        if (search) acceptSearch(false);
        else historyStep(-1);
        break;
      case 'down':
        if (search) acceptSearch(false);
        else historyStep(1);
        break;
      case 'left':
      case 'right': {
        const pos = el?.selectionStart ?? input.length;
        const next = Math.max(0, Math.min(input.length, pos + (key.action === 'left' ? -1 : 1)));
        el?.setSelectionRange(next, next);
        break;
      }
      case 'esc':
        setSearch(null);
        setCtrlArmed(false);
        break;
    }
  };

  const closeEditor = (saved: string | null) => {
    if (!editing) return;
    const error = host.edited(editing.path, saved);
    if (error) push([{ kind: 'err', text: `${editing.kind}: ${editing.path}: ${error}` }]);
    setEditing(null);
    onActivity?.();
    bump((n) => n + 1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const match = searchMatch(search);

  return (
    <div className={s.terminal}>
      <div
        ref={scrollRef}
        className={s.scroll}
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        <div role="log" aria-label="Terminal output" aria-live="polite">
          {lines.map((l) => (
            <div key={l.id} className={`${s.line} ${s[l.kind]}`}>
              {l.prompt && <Prompt p={l.prompt} />}
              {renderAnsi(l.text)}
            </div>
          ))}
        </div>
        <div className={s.inputRow}>
          {search ? (
            <span className={s.promptPlain}>
              (reverse-i-search)`{search.query}': <span className={s.searchMatch}>{match ?? ''}</span>
            </span>
          ) : running ? null : (
            <Prompt p={pending !== null ? '> ' : shell.prompt()} trailingSpace={false} />
          )}
          <input
            ref={inputRef}
            className={`${s.input} ${search ? s.inputHidden : ''}`}
            value={search ? search.query : running ? '' : input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            aria-label={search ? 'History search' : 'Command line'}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            inputMode="text"
          />
        </div>
        {running && <div className={s.runningHint}>Process running in the foreground. Ctrl+C stops it, Ctrl+Z suspends it.</div>}
      </div>
      <KeyBar onKey={onBarKey} ctrlArmed={ctrlArmed} />
      {editing && <Editor kind={editing.kind} path={editing.path} initial={editing.initial} onClose={closeEditor} />}
    </div>
  );
});
