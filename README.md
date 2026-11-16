# Learn Linux

Interactive lessons that teach the Linux terminal to developers. Everything runs in the browser: a simulated Ubuntu shell with an in-memory filesystem, so there is no backend and nothing to install.

## Running

```
npm install
npm run dev        # development server
npm run build      # type-check and build to dist/
npm run preview    # serve the production build on http://localhost:4173
```

To try it on a phone on the same network: `npm run dev -- --host`, then open the printed address.

`dist/` is a static site and can be hosted anywhere. Routes use the URL hash, so no server rewrites are needed.

Every push to `master` runs the tests, builds the site and deploys it to GitHub Pages (`.github/workflows/deploy.yml`).

## Tests

```
npm test           # engine tests, plus a replay of every lesson's reference solution
npm run e2e        # browser smoke test at phone and desktop sizes (needs the preview server running)
```

The browser test uses `playwright-core` with a browser you already have: `CHROME=/path/to/chromium npm run e2e`.

## Layout

- `src/engine/` — the simulator, with no React imports
  - `fs/` virtual filesystem and the seeded machine
  - `shell/` lexer, parser, expansion, executor, tab completion
  - `commands/` command implementations grouped by area, and the manual pages
  - `mocks/` processes, packages, services and the journal
- `src/lessons/` — lesson types, validators, the lesson runner, and one file per module
- `src/ui/` — terminal, editor overlay, lesson view and pages
- `src/state/` — progress, saved in `localStorage`

## Adding a lesson

A lesson is data: see any file in `src/lessons/modules/`. Each step has an explanation, a task, hints, a reference `solution` and a `validate` function that inspects the outcome (files, output, exit code) rather than the exact text typed. `npm test` replays every solution and fails if a step does not accept its own solution, so a new lesson is checked automatically.

## Scope of the simulator

The shell implements the syntax the lessons teach: quoting, variables, `$(...)`, globs, pipes, redirection, `&&`/`||`, `if`/`for`/`while`, functions and job control. Anything else reports `not supported in this simulator` instead of failing silently. Networking, packages, services and SSH are scripted mocks.
