// Browser smoke test. Usage:
//   npm run build && npm run preview &        (serves http://localhost:4173)
//   CHROME=/path/to/chromium node e2e/smoke.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const VIEWPORTS = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
];

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });

for (const { name, ...options } of VIEWPORTS) {
  console.log(`\n[${name}]`);
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (label) => shots && page.screenshot({ path: `${shots}/${name}-${label}.png` });
  const noOverflow = async (label) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal overflow`);
  const input = page.getByLabel('Command line');
  const run = async (cmd) => {
    await input.fill(cmd);
    await input.press('Enter');
  };

  await page.goto(BASE);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await noOverflow('home');
  await shot('home');

  await page.getByRole('link', { name: /Start the first lesson/ }).click();
  await page.getByText('Step 1 of 6').waitFor();
  await noOverflow('lesson');
  await shot('lesson-start');

  await run('pwd');
  await page.getByText('Step 2 of 6').waitFor();
  check(true, 'first step advances after `pwd`');

  if (name === 'phone') {
    await input.focus();
    await page.getByRole('button', { name: '~', exact: true }).click();
    check((await input.inputValue()) === '~', 'key bar inserts a character');
    check(await input.evaluate((el) => el === document.activeElement), 'key bar keeps focus on the prompt');
    await input.fill('');
    check(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), 'prompt font is at least 16px (no iOS zoom)');
    const small = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter((el) => el.offsetParent && !el.closest('p, li, [class*="explain"], [class*="task"], [class*="hint"]') && (el.offsetHeight < 36 || el.offsetWidth < 36)).map((el) => el.textContent.trim().slice(0, 20)));
    check(small.length === 0, `touch targets are large enough ${small.length ? JSON.stringify(small) : ''}`);
  }

  // Tab completion, then finish the lesson.
  await run('ls');
  await run('ls -la');
  await input.fill('cd pro');
  await input.press('Tab');
  check((await input.inputValue()) === 'cd project/', 'Tab completes a directory name');
  await input.press('Enter');
  await run('cd /var/log');
  await run('cd');
  await page.getByRole('heading', { name: 'Lesson complete' }).waitFor();
  check(true, 'lesson completes');
  await shot('lesson-done');

  await page.reload();
  await page.goto(BASE);
  await page.getByText(/1 of \d+ lessons complete/).waitFor();
  check(true, 'progress survives a reload');

  // Sandbox: editor round trip and a foreground process.
  await page.goto(`${BASE}/#/sandbox`);
  await run('nano hello.txt');
  await page.getByLabel('File contents').fill('written in nano\n');
  await page.getByRole('button', { name: /Write Out/ }).click();
  await page.getByRole('button', { name: /Exit/ }).click();
  await run('cat hello.txt');
  await page.getByText('written in nano').first().waitFor();
  check(true, 'nano saves a file');
  await run('vim v.txt');
  await page.getByRole('button', { name: /insert/ }).click();
  await page.getByLabel('File contents').fill('written in vim\n');
  await page.getByRole('button', { name: /normal/ }).click();
  await page.getByRole('button', { name: ': command' }).click();
  await page.getByLabel('vim command').fill('wq');
  await page.getByLabel('vim command').press('Enter');
  await run('cat v.txt');
  await page.getByText('written in vim').first().waitFor();
  check(true, 'vim saves a file with :wq');
  await run('cd project && npm start');
  await page.getByText(/Process running in the foreground/).waitFor();
  await input.press('Control+c');
  await run('echo back-at-prompt');
  await page.getByText('back-at-prompt').nth(1).waitFor();
  check(true, 'Ctrl+C stops a foreground process');
  await run('ls -la');
  await noOverflow('sandbox');
  await shot('sandbox');

  await page.goto(`${BASE}/#/cheatsheet`);
  await page.getByLabel('Search commands').fill('port');
  await page.getByRole('heading', { name: 'ss', exact: true }).waitFor();
  await noOverflow('cheat sheet');
  await shot('cheatsheet');

  await page.goto(`${BASE}/#/lesson/files-2`);
  await page.getByText(/Step \d of 6/).waitFor();
  await shot('lesson-files');

  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
