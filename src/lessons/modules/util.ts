import { accessLog, appLog } from '../../engine/fs/seed';

/** Join paragraphs of lesson text. */
export const md = (...paragraphs: string[]) => paragraphs.join('\n\n');

/** The project directory every lesson works in. */
export const P = '~/project';

const lines = (text: string) => text.split('\n').filter(Boolean);

/** Facts about the seeded logs, so validators can compare against the right answer. */
export const LOGS = {
  app: lines(appLog()),
  access: lines(accessLog()),
  get errors() {
    return this.app.filter((l) => l.includes('ERROR'));
  },
  get status500() {
    return this.access.filter((l) => l.split(' ')[8] === '500');
  },
  get topIp() {
    const counts = new Map<string, number>();
    for (const l of this.access) counts.set(l.split(' ')[0], (counts.get(l.split(' ')[0]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  },
};
