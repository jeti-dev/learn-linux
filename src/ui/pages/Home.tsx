import { Link } from 'react-router-dom';
import { LESSONS, MODULES } from '../../lessons';
import { progress, useProgress } from '../../state/progress';
import { PageShell } from './Shell';
import s from './Pages.module.css';

export function Home() {
  const p = useProgress();
  const doneCount = LESSONS.filter((l) => p.done[l.id]).length;
  const nextLesson = LESSONS.find((l) => !p.done[l.id]);
  const started = doneCount > 0 || Object.values(p.step).some((n) => n > 0);

  return (
    <PageShell>
      <main className={s.main}>
        <section className={s.hero}>
          <h1>The Linux terminal, learned by using it</h1>
          <p className={s.lead}>Short hands-on lessons for developers, in a simulated Ubuntu machine that runs in your browser. Nothing to install, and nothing you can break.</p>
          <div className={s.heroActions}>
            {nextLesson ? (
              <Link className="btn btn-primary" to={`/lesson/${nextLesson.id}`}>
                {started ? `Continue: ${nextLesson.title}` : 'Start the first lesson'}
              </Link>
            ) : (
              <Link className="btn btn-primary" to="/sandbox">
                All done. Open the sandbox
              </Link>
            )}
            <span className={s.count}>
              {doneCount} of {LESSONS.length} lessons complete
            </span>
          </div>
        </section>

        <ol className={s.modules}>
          {MODULES.map((m, i) => {
            const done = m.lessons.filter((l) => p.done[l.id]).length;
            return (
              <li key={m.id} className={s.moduleCard}>
                <div className={s.moduleHead}>
                  <span className={s.moduleNum}>{m.challenge ? '★' : String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h2 className={s.moduleTitle}>{m.title}</h2>
                    <p className={s.moduleSummary}>{m.summary}</p>
                  </div>
                  <span className={s.moduleCount} aria-label={`${done} of ${m.lessons.length} lessons complete`}>
                    {done}/{m.lessons.length}
                  </span>
                </div>
                <ul className={s.lessons}>
                  {m.lessons.map((l) => {
                    const isDone = !!p.done[l.id];
                    const inProgress = !isDone && (p.step[l.id] ?? 0) > 0;
                    return (
                      <li key={l.id}>
                        <Link to={`/lesson/${l.id}`} className={s.lesson}>
                          <span className={`${s.status} ${isDone ? s.statusDone : inProgress ? s.statusProgress : ''}`} aria-hidden="true">
                            {isDone ? '✓' : ''}
                          </span>
                          <span className={s.lessonText}>
                            <span className={s.lessonTitle}>{l.title}</span>
                            <span className={s.lessonSummary}>{l.summary}</span>
                          </span>
                          <span className={s.lessonMeta}>{isDone ? 'Done' : inProgress ? `Step ${(p.step[l.id] ?? 0) + 1}/${l.steps.length}` : `${l.steps.length} steps`}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>

        <footer className={s.footer}>
          <p>
            Commands run in a simulator, not a real system. It covers what the lessons teach and says so when you step outside it. Progress is saved in this browser only.
          </p>
          {started && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                if (window.confirm('Reset all lesson progress in this browser?')) progress.reset();
              }}
            >
              Reset progress
            </button>
          )}
        </footer>
      </main>
    </PageShell>
  );
}
