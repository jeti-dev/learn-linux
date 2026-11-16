import { useMemo, useState } from 'react';
import { SandboxHost } from '../../lessons/runner';
import { Terminal } from '../terminal/Terminal';
import { useVisualViewport } from '../terminal/useVisualViewport';
import { PageShell } from './Shell';
import s from './Pages.module.css';

const INTRO = 'Free play: a fresh Ubuntu machine with a sample project in ~/project.\nType `help` for the list of commands. Nothing here affects your lessons.';

export function Sandbox() {
  useVisualViewport();
  const [generation, setGeneration] = useState(0);
  // A new host means a brand-new machine.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const host = useMemo(() => new SandboxHost(), [generation]);
  return (
    <PageShell fill>
      <div className={s.sandboxBar}>
        <span>Sandbox</span>
        <button type="button" className="btn btn-quiet" onClick={() => setGeneration((n) => n + 1)}>
          Reset machine
        </button>
      </div>
      <div className={s.sandboxTerm}>
        <Terminal key={generation} host={host} intro={INTRO} autoFocus />
      </div>
    </PageShell>
  );
}
