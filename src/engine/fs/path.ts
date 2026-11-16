/** Normalize an absolute path: collapse `//`, `.` and `..`. */
export function normalize(abs: string): string {
  const out: string[] = [];
  for (const part of abs.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

/** Resolve `p` against `cwd` into a normalized absolute path. */
export function resolvePath(cwd: string, p: string): string {
  if (!p) return normalize(cwd);
  return normalize(p.startsWith('/') ? p : cwd + '/' + p);
}

export function dirname(p: string): string {
  const stripped = p.length > 1 ? p.replace(/\/+$/, '') : p;
  const i = stripped.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return stripped.slice(0, i);
}

export function basename(p: string): string {
  const stripped = p.length > 1 ? p.replace(/\/+$/, '') : p;
  if (stripped === '/') return '/';
  return stripped.slice(stripped.lastIndexOf('/') + 1);
}

export function join(a: string, b: string): string {
  if (!a) return b;
  return a.endsWith('/') ? a + b : a + '/' + b;
}
