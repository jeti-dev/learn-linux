import { describe, expect, it } from 'vitest';
import { LESSONS, MODULES } from './index';
import { LessonRunner } from './runner';

describe('curriculum', () => {
  it('has unique lesson ids', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MODULES.length).toBe(14);
  });

  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      it('starts with the first step unsolved', () => {
        const runner = new LessonRunner(lesson);
        expect(runner.stepIndex).toBe(0);
        runner.run('true');
        expect(runner.stepIndex).toBe(0);
      });

      it('is completed by its reference solution, one step at a time', () => {
        const runner = new LessonRunner(lesson);
        lesson.steps.forEach((step, i) => {
          expect(runner.stepIndex, `step ${i + 1} should be current`).toBe(i);
          step.solution.forEach((item, j) => {
            runner.applySolution(item);
            if (j < step.solution.length - 1) expect(runner.stepIndex, `step ${i + 1} advanced before its last action`).toBe(i);
          });
          expect(runner.stepIndex, `step ${i + 1} ("${step.task}") was not accepted`).toBe(i + 1);
        });
        expect(runner.finished).toBe(true);
      });

      it('can resume at any step', () => {
        for (let i = 0; i <= lesson.steps.length; i++) expect(new LessonRunner(lesson, i).stepIndex).toBe(i);
      });
    });
  }
});
