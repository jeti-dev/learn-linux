import { useMemo, useState } from 'react';
import { DOCS } from '../../engine/commands/man';
import { PageShell } from './Shell';
import s from './Pages.module.css';

const CATEGORIES = [...new Set(DOCS.map((d) => d.cat))];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.copy}
      aria-label={`Copy: ${text}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function CheatSheet() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DOCS.filter((d) => {
      if (cat && d.cat !== cat) return false;
      if (!q) return true;
      return d.name.includes(q) || d.summary.toLowerCase().includes(q) || d.examples.some(([cmd, desc]) => cmd.toLowerCase().includes(q) || desc.toLowerCase().includes(q));
    });
  }, [query, cat]);

  return (
    <PageShell>
      <main className={s.main}>
        <h1 className={s.pageTitle}>Cheat sheet</h1>
        <div className={s.filters}>
          <input
            className={s.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, e.g. port, replace, json"
            aria-label="Search commands"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className={s.chips} role="group" aria-label="Category">
            <button type="button" className={`${s.chip} ${cat === null ? s.chipActive : ''}`} aria-pressed={cat === null} onClick={() => setCat(null)}>
              All
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className={`${s.chip} ${cat === c ? s.chipActive : ''}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {results.length === 0 ? (
          <p className={s.empty}>No command matches "{query}". Try a broader word, or clear the category filter.</p>
        ) : (
          <ul className={s.docs}>
            {results.map((d) => (
              <li key={d.name} className={s.doc}>
                <div className={s.docHead}>
                  <h2 className={s.docName}>{d.name}</h2>
                  <span className={s.docCat}>{d.cat}</span>
                </div>
                <p className={s.docSummary}>{d.summary}</p>
                <code className={s.usage}>{d.usage}</code>
                {!!d.options?.length && (
                  <dl className={s.options}>
                    {d.options.map(([flag, desc]) => (
                      <div key={flag} className={s.option}>
                        <dt>{flag}</dt>
                        <dd>{desc}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <ul className={s.examples}>
                  {d.examples.map(([cmd, desc]) => (
                    <li key={cmd} className={s.example}>
                      <div className={s.exampleCmd}>
                        <code>{cmd}</code>
                        <CopyButton text={cmd} />
                      </div>
                      <span className={s.exampleDesc}>{desc}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageShell>
  );
}
