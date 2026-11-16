import s from './Terminal.module.css';

export type BarKey = { label: string; action: 'tab' | 'ctrl' | 'ctrl-c' | 'ctrl-z' | 'up' | 'down' | 'left' | 'right' | 'esc' | 'insert'; text?: string; aria?: string };

const KEYS: BarKey[] = [
  { label: 'Tab', action: 'tab' },
  { label: '^C', action: 'ctrl-c', aria: 'Control C' },
  { label: 'Ctrl', action: 'ctrl' },
  { label: '↑', action: 'up', aria: 'Previous command' },
  { label: '↓', action: 'down', aria: 'Next command' },
  { label: '←', action: 'left', aria: 'Cursor left' },
  { label: '→', action: 'right', aria: 'Cursor right' },
  ...['|', '/', '-', '~', '>', '$', '&', '*', '"', "'", '.', '_', '=', ';', '\\', '{', '}'].map((c): BarKey => ({ label: c, action: 'insert', text: c })),
  { label: '^Z', action: 'ctrl-z', aria: 'Control Z' },
  { label: 'Esc', action: 'esc' },
];

/** Row of helper keys that phone keyboards lack. Buttons never take focus away from the prompt. */
export function KeyBar({ onKey, ctrlArmed }: { onKey: (key: BarKey) => void; ctrlArmed: boolean }) {
  return (
    <div className={s.keybar} role="toolbar" aria-label="Terminal keys">
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          tabIndex={-1}
          className={`${s.key} ${k.action === 'ctrl' && ctrlArmed ? s.keyActive : ''} ${k.action !== 'insert' ? s.keyWide : ''}`}
          aria-label={k.aria ?? k.label}
          aria-pressed={k.action === 'ctrl' ? ctrlArmed : undefined}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onKey(k)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
