import { useEffect, useRef, useState } from 'react';
import s from './Editor.module.css';

type Props = {
  kind: 'vim' | 'nano';
  path: string;
  initial: string;
  /** Called with the last saved content, or null if nothing was saved. */
  onClose: (saved: string | null) => void;
};

/** Simplified full-screen editor. Teaches the real key sequences of nano and vim. */
export function Editor({ kind, path, initial, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'normal' | 'insert' | 'command'>(kind === 'nano' ? 'insert' : 'normal');
  const [command, setCommand] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const cmdInput = useRef<HTMLInputElement>(null);
  const dirty = text !== (saved ?? initial);

  useEffect(() => {
    if (mode === 'command') cmdInput.current?.focus();
    else area.current?.focus();
  }, [mode]);

  const save = () => {
    setSaved(text);
    setMessage(kind === 'nano' ? `[ Wrote ${text.split('\n').length - (text.endsWith('\n') ? 1 : 0)} lines ]` : `"${path}" written`);
    return text;
  };

  // ---- nano ----
  const nanoExit = () => {
    if (dirty) setConfirmExit(true);
    else onClose(saved);
  };

  // ---- vim ----
  const runCommand = (raw: string) => {
    const c = raw.trim();
    setCommand('');
    if (c === 'w') {
      save();
      setMode('normal');
    } else if (c === 'wq' || c === 'x' || c === 'wq!') onClose(save());
    else if (c === 'q!') onClose(saved);
    else if (c === 'q') {
      if (dirty) {
        setMessage('E37: No write since last change (add ! to override)');
        setMode('normal');
      } else onClose(saved);
    } else {
      setMessage(c ? `E492: Not an editor command: ${c}` : '');
      setMode('normal');
    }
  };

  const onAreaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (kind === 'nano') {
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        save();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        nanoExit();
      }
      return;
    }
    if (mode === 'insert') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('normal');
        setMessage('');
      }
      return;
    }
    // Normal mode: keys are commands.
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) return;
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (e.key === 'i' || e.key === 'a' || e.key === 'o' || e.key === 'I' || e.key === 'A') {
      setMode('insert');
      setMessage('');
    } else if (e.key === ':') setMode('command');
    else if (e.key.length === 1) setMessage(`Normal mode: press i to insert text, or : for a command`);
  };

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={`${kind} editing ${path}`}>
      <div className={s.title}>
        {kind === 'nano' ? `  GNU nano 7.2` : 'VIM'} <span className={s.path}>{path}</span>
        {dirty && <span className={s.modified}>{kind === 'nano' ? 'Modified' : '[+]'}</span>}
      </div>
      <textarea
        ref={area}
        className={s.area}
        value={text}
        readOnly={kind === 'vim' && mode !== 'insert'}
        inputMode={kind === 'vim' && mode !== 'insert' ? 'none' : 'text'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onAreaKey}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-label="File contents"
      />
      <div className={s.status} aria-live="polite">
        {kind === 'vim' && mode === 'command' ? (
          <label className={s.cmdline}>
            :
            <input
              ref={cmdInput}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runCommand(command);
                else if (e.key === 'Escape') {
                  setCommand('');
                  setMode('normal');
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              aria-label="vim command"
            />
          </label>
        ) : kind === 'vim' && mode === 'insert' ? (
          <strong>-- INSERT --</strong>
        ) : (
          message || (kind === 'vim' ? 'Normal mode' : '')
        )}
      </div>

      {confirmExit ? (
        <div className={s.bar}>
          <span className={s.question}>Save modified buffer?</span>
          <button type="button" className={s.barKey} onClick={() => onClose(save())}>
            <kbd>Y</kbd> Yes
          </button>
          <button type="button" className={s.barKey} onClick={() => onClose(saved)}>
            <kbd>N</kbd> No
          </button>
          <button type="button" className={s.barKey} onClick={() => setConfirmExit(false)}>
            <kbd>^C</kbd> Cancel
          </button>
        </div>
      ) : kind === 'nano' ? (
        <div className={s.bar}>
          <button type="button" className={s.barKey} onClick={save}>
            <kbd>^O</kbd> Write Out
          </button>
          <button type="button" className={s.barKey} onClick={nanoExit}>
            <kbd>^X</kbd> Exit
          </button>
        </div>
      ) : (
        <div className={s.bar}>
          <button type="button" className={s.barKey} onClick={() => { setMode('insert'); setMessage(''); }} disabled={mode === 'insert'}>
            <kbd>i</kbd> insert
          </button>
          <button type="button" className={s.barKey} onClick={() => { setMode('normal'); setCommand(''); setMessage(''); }} disabled={mode === 'normal'}>
            <kbd>Esc</kbd> normal
          </button>
          <button type="button" className={s.barKey} onClick={() => setMode('command')} disabled={mode !== 'normal'}>
            <kbd>:</kbd> command
          </button>
          <span className={s.hint}>:w save · :q quit · :wq both · :q! discard</span>
        </div>
      )}
    </div>
  );
}
