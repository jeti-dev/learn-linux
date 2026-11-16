import { gettingAround } from './modules/01-getting-around';
import { files } from './modules/02-files';
import { pipes } from './modules/03-pipes';
import { searching } from './modules/04-searching';
import { textProcessing } from './modules/05-text';
import { permissions } from './modules/06-permissions';
import { processes } from './modules/07-processes';
import { environment } from './modules/08-environment';
import { networking } from './modules/09-networking';
import { ssh } from './modules/10-ssh';
import { system } from './modules/11-system';
import { scripting } from './modules/12-scripting';
import { productivity } from './modules/13-productivity';
import { challenges } from './modules/14-challenges';
import type { Lesson, Module } from './types';

/** The curriculum, in teaching order. */
export const MODULES: Module[] = [gettingAround, files, pipes, searching, textProcessing, permissions, processes, environment, networking, ssh, system, scripting, productivity, challenges];

export const LESSONS: Lesson[] = MODULES.flatMap((m) => m.lessons);

export function findLesson(id: string): { lesson: Lesson; module: Module; next?: Lesson } | undefined {
  const index = LESSONS.findIndex((l) => l.id === id);
  if (index < 0) return undefined;
  const lesson = LESSONS[index];
  return { lesson, module: MODULES.find((m) => m.lessons.includes(lesson))!, next: LESSONS[index + 1] };
}
