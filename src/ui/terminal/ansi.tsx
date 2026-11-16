import type { ReactNode } from 'react';

const COLORS: Record<string, string> = { '31': 'red', '32': 'green', '33': 'yellow', '34': 'blue', '35': 'magenta', '36': 'cyan', '90': 'dim' };

/** Render text containing the small set of ANSI colour codes the simulator emits. */
export function renderAnsi(text: string): ReactNode {
  if (!text.includes('\x1b')) return text;
  const out: ReactNode[] = [];
  let bold = false;
  let color = '';
  text.split(/(\x1b\[[0-9;]*m)/).forEach((part, i) => {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      for (const code of m[1].split(';')) {
        if (code === '' || code === '0') {
          bold = false;
          color = '';
        } else if (code === '1') bold = true;
        else if (COLORS[code]) color = COLORS[code];
      }
    } else if (part) {
      out.push(
        bold || color ? (
          <span key={i} className={`${bold ? 'ansi-bold ' : ''}${color ? `ansi-${color}` : ''}`}>
            {part}
          </span>
        ) : (
          part
        ),
      );
    }
  });
  return out;
}
