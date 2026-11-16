import type { ReactNode } from 'react';
import s from './Lesson.module.css';

/** Inline formatting: `code` becomes a button that inserts the text into the prompt; **bold**. */
function inline(text: string, onInsert?: (code: string) => void): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = part.slice(1, -1);
      return onInsert ? (
        <button key={i} type="button" className={s.code} onClick={() => onInsert(code)} title="Insert into the terminal">
          {code}
        </button>
      ) : (
        <code key={i} className={s.codeStatic}>
          {code}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

/** Minimal renderer for lesson text: paragraphs, "- " lists and ``` blocks. */
export function Markdown({ text, onInsert }: { text: string; onInsert?: (code: string) => void }) {
  return (
    <>
      {text.split(/\n{2,}/).map((block, i) => {
        if (block.startsWith('```')) {
          return (
            <pre key={i} className={s.pre}>
              {block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')}
            </pre>
          );
        }
        const rows = block.split('\n');
        if (rows.every((r) => r.startsWith('- '))) {
          return (
            <ul key={i} className={s.list}>
              {rows.map((r, j) => (
                <li key={j}>{inline(r.slice(2), onInsert)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(block, onInsert)}</p>;
      })}
    </>
  );
}
