import { basename, dirname, normalize } from './path';

type NodeBase = { mode: number; owner: string; group: string; mtime: number };
export type FileNode = NodeBase & { type: 'file'; content: string };
export type DirNode = NodeBase & { type: 'dir'; children: Record<string, FsNode> };
export type LinkNode = NodeBase & { type: 'symlink'; target: string };
export type FsNode = FileNode | DirNode | LinkNode;

const MESSAGES: Record<string, string> = {
  ENOENT: 'No such file or directory',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  ELOOP: 'Too many levels of symbolic links',
};

export class FsError extends Error {
  code: string;
  path: string;
  constructor(code: string, path: string) {
    super(MESSAGES[code] ?? code);
    this.code = code;
    this.path = path;
  }
}

export const R = 4;
export const W = 2;
export const X = 1;

/** In-memory POSIX-like filesystem. All paths passed in must be absolute. */
export class VirtualFS {
  root: DirNode = { type: 'dir', children: {}, mode: 0o755, owner: 'root', group: 'root', mtime: 0 };
  /** The user operations are performed as. Commands like sudo switch this temporarily. */
  user = 'dev';
  groups: Record<string, string[]> = { dev: ['dev', 'sudo'], root: ['root'] };

  now(): number {
    return Date.now();
  }

  can(node: FsNode, perm: number): boolean {
    if (this.user === 'root') return true;
    const m = node.mode;
    if (node.owner === this.user) return ((m >> 6) & perm) === perm;
    if ((this.groups[this.user] ?? [this.user]).includes(node.group)) return ((m >> 3) & perm) === perm;
    return (m & perm) === perm;
  }

  /** Walk to a node. Returns undefined if missing; throws for ENOTDIR / EACCES / ELOOP. */
  private walk(abs: string, follow: boolean, depth = 0): FsNode | undefined {
    if (depth > 20) throw new FsError('ELOOP', abs);
    const parts = normalize(abs).split('/').filter(Boolean);
    let node: FsNode = this.root;
    let cur = '';
    for (let i = 0; i < parts.length; i++) {
      if (node.type !== 'dir') throw new FsError('ENOTDIR', abs);
      if (!this.can(node, X)) throw new FsError('EACCES', abs);
      const next: FsNode | undefined = Object.prototype.hasOwnProperty.call(node.children, parts[i])
        ? node.children[parts[i]]
        : undefined;
      if (!next) return undefined;
      const isLast = i === parts.length - 1;
      if (next.type === 'symlink' && (follow || !isLast)) {
        const target = next.target.startsWith('/') ? next.target : cur + '/' + next.target;
        const rest = parts.slice(i + 1).join('/');
        return this.walk(rest ? target + '/' + rest : target, follow, depth + 1);
      }
      node = next;
      cur += '/' + parts[i];
    }
    return node;
  }

  /** Node at path, or undefined when it does not exist or cannot be reached. */
  lookup(abs: string, follow = true): FsNode | undefined {
    try {
      return this.walk(abs, follow);
    } catch {
      return undefined;
    }
  }

  /** Node at path; throws FsError when it cannot be returned. */
  get(abs: string, follow = true): FsNode {
    const node = this.walk(abs, follow);
    if (!node) throw new FsError('ENOENT', abs);
    return node;
  }

  exists(abs: string): boolean {
    return this.lookup(abs) !== undefined;
  }
  isDir(abs: string): boolean {
    return this.lookup(abs)?.type === 'dir';
  }
  isFile(abs: string): boolean {
    return this.lookup(abs)?.type === 'file';
  }

  private parentOf(abs: string): DirNode {
    const parent = this.get(dirname(normalize(abs)));
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', abs);
    return parent;
  }

  private make<T extends FsNode>(node: Omit<T, keyof NodeBase> & Partial<NodeBase>): T {
    return {
      owner: this.user,
      group: this.user,
      mtime: this.now(),
      mode: 0o644,
      ...node,
    } as unknown as T;
  }

  readFile(abs: string): string {
    const node = this.get(abs);
    if (node.type === 'dir') throw new FsError('EISDIR', abs);
    if (node.type !== 'file') throw new FsError('ENOENT', abs);
    if (!this.can(node, R)) throw new FsError('EACCES', abs);
    return node.content;
  }

  writeFile(abs: string, content: string, append = false): void {
    const existing = this.walk(abs, true);
    if (existing) {
      if (existing.type === 'dir') throw new FsError('EISDIR', abs);
      if (existing.type !== 'file') throw new FsError('ENOENT', abs);
      if (!this.can(existing, W)) throw new FsError('EACCES', abs);
      existing.content = append ? existing.content + content : content;
      existing.mtime = this.now();
      return;
    }
    // Writing through a dangling symlink creates its target; keep it simple and create in place.
    const parent = this.parentOf(abs);
    if (!this.can(parent, W)) throw new FsError('EACCES', abs);
    parent.children[basename(normalize(abs))] = this.make<FileNode>({ type: 'file', content });
    parent.mtime = this.now();
  }

  mkdir(abs: string, parents = false): void {
    abs = normalize(abs);
    if (abs === '/') {
      if (parents) return;
      throw new FsError('EEXIST', abs);
    }
    const existing = this.walk(abs, true);
    if (existing) {
      if (parents && existing.type === 'dir') return;
      throw new FsError('EEXIST', abs);
    }
    if (parents && !this.walk(dirname(abs), true)) this.mkdir(dirname(abs), true);
    const parent = this.parentOf(abs);
    if (!this.can(parent, W)) throw new FsError('EACCES', abs);
    parent.children[basename(abs)] = this.make<DirNode>({ type: 'dir', children: {}, mode: 0o755 });
    parent.mtime = this.now();
  }

  readdir(abs: string): string[] {
    const node = this.get(abs);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', abs);
    if (!this.can(node, R)) throw new FsError('EACCES', abs);
    return Object.keys(node.children).sort((a, b) => a.localeCompare(b));
  }

  /** Remove the entry at path. Directories need `recursive` unless empty-dir removal is intended. */
  remove(abs: string, recursive = false): void {
    abs = normalize(abs);
    const node = this.get(abs, false);
    if (abs === '/') throw new FsError('EPERM', abs);
    const parent = this.parentOf(abs);
    if (!this.can(parent, W)) throw new FsError('EACCES', abs);
    if (node.type === 'dir' && !recursive && Object.keys(node.children).length) {
      throw new FsError('ENOTEMPTY', abs);
    }
    delete parent.children[basename(abs)];
    parent.mtime = this.now();
  }

  /** Place an existing node at a path (used by cp / mv / tar). Overwrites a file, not a directory. */
  attach(abs: string, node: FsNode): void {
    abs = normalize(abs);
    const parent = this.parentOf(abs);
    if (!this.can(parent, W)) throw new FsError('EACCES', abs);
    parent.children[basename(abs)] = node;
    parent.mtime = this.now();
  }

  /** Deep copy of a node, owned by the current user. */
  cloneNode(node: FsNode, keepOwner = false): FsNode {
    const copy = structuredClone(node);
    if (!keepOwner) {
      const chown = (n: FsNode) => {
        n.owner = this.user;
        n.group = this.user;
        n.mtime = this.now();
        if (n.type === 'dir') Object.values(n.children).forEach(chown);
      };
      chown(copy);
    }
    return copy;
  }

  chmod(abs: string, mode: number): void {
    const node = this.get(abs);
    if (this.user !== 'root' && node.owner !== this.user) throw new FsError('EPERM', abs);
    node.mode = mode & 0o7777;
  }

  chown(abs: string, owner?: string, group?: string): void {
    const node = this.get(abs);
    if (this.user !== 'root') throw new FsError('EPERM', abs);
    if (owner) node.owner = owner;
    if (group) node.group = group;
  }

  symlink(target: string, abs: string): void {
    if (this.lookup(abs, false)) throw new FsError('EEXIST', abs);
    const parent = this.parentOf(abs);
    if (!this.can(parent, W)) throw new FsError('EACCES', abs);
    parent.children[basename(normalize(abs))] = this.make<LinkNode>({ type: 'symlink', target, mode: 0o777 });
  }

  snapshot(): DirNode {
    return structuredClone(this.root);
  }
  restore(snap: DirNode): void {
    this.root = structuredClone(snap);
  }

  // ---- Seeding helpers: bypass permission checks, create parents as needed. ----

  seedDir(abs: string, opts: Partial<NodeBase> = {}): void {
    const parts = normalize(abs).split('/').filter(Boolean);
    let node = this.root;
    parts.forEach((part, i) => {
      let next = node.children[part];
      if (!next) {
        next = { type: 'dir', children: {}, mode: 0o755, owner: node.owner, group: node.group, mtime: SEED_TIME };
        node.children[part] = next;
      }
      if (next.type !== 'dir') throw new FsError('ENOTDIR', abs);
      if (i === parts.length - 1) Object.assign(next, opts);
      node = next;
    });
  }

  seedFile(abs: string, content: string, opts: Partial<NodeBase> = {}): void {
    abs = normalize(abs);
    const dir = dirname(abs);
    if (!this.lookupRaw(dir)) this.seedDir(dir);
    const parent = this.lookupRaw(dir) as DirNode;
    parent.children[basename(abs)] = {
      type: 'file',
      content,
      mode: 0o644,
      owner: parent.owner,
      group: parent.group,
      mtime: SEED_TIME,
      ...opts,
    };
  }

  /** Lookup ignoring permissions and symlinks; for seeding and tests. */
  lookupRaw(abs: string): FsNode | undefined {
    let node: FsNode = this.root;
    for (const part of normalize(abs).split('/').filter(Boolean)) {
      if (node.type !== 'dir') return undefined;
      const next: FsNode | undefined = node.children[part];
      if (!next) return undefined;
      node = next;
    }
    return node;
  }
}

/** Fixed timestamp for seeded files so listings are stable: 2026-11-02 09:14 UTC. */
export const SEED_TIME = Date.UTC(2026, 10, 2, 9, 14);
