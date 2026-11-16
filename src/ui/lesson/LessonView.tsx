import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { findLesson } from '../../lessons';
import { LessonRunner } from '../../lessons/runner';
import type { Lesson, Module, SolutionStep } from '../../lessons/types';
import { progress } from '../../state/progress';
import { Terminal, type TerminalHandle } from '../terminal/Terminal';
import { useVisualViewport } from '../terminal/useVisualViewport';
import { Markdown } from './Markdown';
import s from './Lesson.module.css';

export function LessonPage() {
  const { id = '' } = useParams();
  const found = findLesson(id);
  if (!found) {
    return (
      <div className={s.missing}>
        <h1>Lesson not found</h1>
        <Link className="btn btn-primary" to="/">
          Back to lessons
        </Link>
      </div>
    );
  }
  // Remount when the lesson changes so every lesson starts with a fresh machine.
  return <LessonView key={found.lesson.id} lesson={found.lesson} module={found.module} next={found.next} />;
}

const solutionText = (item: SolutionStep) => (typeof item === 'string' ? item : item.label);

function LessonView({ lesson, module, next }: { lesson: Lesson; module: Module; next?: Lesson }) {
  const navigate = useNavigate();
  const viewport = useVisualViewport();
  const terminal = useRef<TerminalHandle>(null);
  const [attempt, setAttempt] = useState(0);
  const runner = useMemo(() => {
    const saved = attempt === 0 ? (progress.get().step[lesson.id] ?? 0) : 0;
    return new LessonRunner(lesson, saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, attempt]);
  const [stepIndex, setStepIndex] = useState(runner.stepIndex);
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setStepIndex(runner.stepIndex);
    runner.onAdvance = () => {
      setStepIndex(runner.stepIndex);
      setHints(0);
      setShowSolution(false);
      setCollapsed(false);
      const finishedNow = runner.finished;
      const stepDone = runner.stepIndex;
      if (finishedNow) progress.complete(lesson.id);
      else progress.setStep(lesson.id, stepDone);
      // Deferred so the note lands after the output of the command that completed the step.
      setTimeout(() => terminal.current?.note(finishedNow ? '✓ Lesson complete' : `✓ Step ${stepDone} of ${lesson.steps.length} complete`), 0);
    };
    return () => {
      runner.onAdvance = undefined;
    };
  }, [runner, lesson]);

  const step = lesson.steps[stepIndex];
  const finished = stepIndex >= lesson.steps.length;
  const total = lesson.steps.length;
  // With the on-screen keyboard open there is little room: show only the task.
  const cramped = viewport < 520;
  const compact = !finished && (collapsed || cramped);
  const insert = (code: string) => terminal.current?.insert(code);
  const restart = () => {
    progress.setStep(lesson.id, 0);
    setHints(0);
    setShowSolution(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <Link to="/" className={s.back} aria-label="Back to lessons">
          ←
        </Link>
        <div className={s.titles}>
          <span className={s.module}>{module.title}</span>
          <h1 className={s.title}>{lesson.title}</h1>
        </div>
        <button type="button" className="btn btn-quiet" onClick={restart} title="Start this lesson again with a fresh machine">
          Restart
        </button>
      </header>
      <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(stepIndex, total)} aria-label="Lesson progress">
        <div className={s.progressFill} style={{ width: `${(Math.min(stepIndex, total) / total) * 100}%` }} />
      </div>

      <div className={s.body}>
        <section className={`${s.card} ${compact ? s.cardCompact : ''}`} aria-label="Instructions">
          {finished ? (
            <div className={s.done}>
              <h2>Lesson complete</h2>
              <p>{lesson.summary}</p>
              <p className={s.muted}>The terminal is still live if you want to keep experimenting.</p>
              <div className={s.actions}>
                {next ? (
                  <button type="button" className="btn btn-primary" onClick={() => navigate(`/lesson/${next.id}`)}>
                    Next: {next.title}
                  </button>
                ) : (
                  <Link className="btn btn-primary" to="/">
                    All lessons
                  </Link>
                )}
                <button type="button" className="btn" onClick={restart}>
                  Do it again
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={s.stepHead}>
                <span className={s.stepCount}>
                  Step {stepIndex + 1} of {total}
                </span>
                {!cramped && (
                  <button type="button" className={s.toggle} onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>
                    {collapsed ? 'Show explanation' : 'Hide explanation'}
                  </button>
                )}
              </div>
              {!compact && (
                <div className={s.explain}>
                  <Markdown text={step.explain} onInsert={insert} />
                </div>
              )}
              <div className={s.task}>
                <span className={s.taskLabel}>Task</span>
                <div>
                  <Markdown text={step.task} onInsert={insert} />
                </div>
              </div>
              {!compact && (
                <div className={s.help}>
                  {step.hints.slice(0, hints).map((h, i) => (
                    <div key={i} className={s.hint}>
                      <Markdown text={h} onInsert={insert} />
                    </div>
                  ))}
                  {showSolution && (
                    <div className={s.hint}>
                      <strong>Solution</strong>
                      <ol className={s.solution}>
                        {step.solution.map((item, i) => (
                          <li key={i}>
                            {typeof item === 'string' ? (
                              <button type="button" className={s.code} onClick={() => insert(item)}>
                                {item}
                              </button>
                            ) : (
                              solutionText(item)
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div className={s.helpButtons}>
                    {hints < step.hints.length && (
                      <button type="button" className="btn btn-quiet" onClick={() => setHints((n) => n + 1)}>
                        {hints === 0 ? 'Show a hint' : 'Another hint'}
                      </button>
                    )}
                    {hints >= step.hints.length && !showSolution && (
                      <button type="button" className="btn btn-quiet" onClick={() => setShowSolution(true)}>
                        Show solution
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className={s.term} aria-label="Terminal">
          <Terminal key={attempt} ref={terminal} host={runner} autoFocus />
        </section>
      </div>
    </div>
  );
}
