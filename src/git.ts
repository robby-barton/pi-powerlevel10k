/**
 * Git status parsing + non-blocking cache for the p10k prompt.
 *
 * Pure module (only node builtins), so it is smoke-testable with plain node.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface GitStatus {
	branch: string | null;
	oid: string | null;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
	conflicted: number;
	stashes: number;
}

export interface GitCacheOptions {
	ttlMs?: number;
	negTtlMs?: number;
	timeoutMs?: number;
}

/**
 * Parse `git status --porcelain=v2 --branch` output.
 *
 * Handles:
 *   # branch.oid <sha>
 *   # branch.head <name> | (detached)
 *   # branch.ab +A -B
 *   1 <XY> ... / 2 <XY> ...   (X = index → staged, Y = worktree → unstaged)
 *   u ...                     (unmerged/conflicted)
 *   ? <path>                  (untracked)
 */
export function parsePorcelainV2(out: string): Partial<GitStatus> {
	const st: Partial<GitStatus> = {};
	const bump = (key: "staged" | "unstaged" | "untracked" | "conflicted"): void => {
		st[key] = (st[key] ?? 0) + 1;
	};
	for (const line of out.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			let head = line.slice("# branch.head ".length).trim();
			// Normalize fully-qualified refs to short branch names.
			if (head.startsWith("refs/heads/")) head = head.slice("refs/heads/".length);
			st.branch = head === "(detached)" || head.length === 0 ? null : head;
		} else if (line.startsWith("# branch.oid ")) {
			const oid = line.slice("# branch.oid ".length).trim();
			st.oid = oid || null;
		} else if (line.startsWith("# branch.ab ")) {
			const m = /\+(\d+)\s+-(\d+)/.exec(line);
			if (m) {
				st.ahead = Number.parseInt(m[1], 10);
				st.behind = Number.parseInt(m[2], 10);
			}
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			const parts = line.split(/\s+/);
			const xy = parts[1];
			if (xy && xy.length >= 2) {
				if (xy[0] !== ".") bump("staged");
				if (xy[1] !== ".") bump("unstaged");
			}
		} else if (line.startsWith("u ")) {
			bump("conflicted");
		} else if (line.startsWith("? ")) {
			bump("untracked");
		}
	}
	return st;
}

function countLines(out: string): number {
	const trimmed = out.trim();
	return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function emptyStatus(): GitStatus {
	return {
		branch: null,
		oid: null,
		ahead: 0,
		behind: 0,
		staged: 0,
		unstaged: 0,
		untracked: 0,
		conflicted: 0,
		stashes: 0,
	};
}

/**
 * Non-blocking git status cache.
 *
 * get() is synchronous and always returns the cached value immediately
 * (possibly null/stale). When stale it kicks off a deduped async refetch
 * (`git status --porcelain=v2 --branch` + `git stash list` with timeout);
 * the notify callback fires after a refetch so the caller can re-render.
 *
 * Non-zero exit or "not a git repository" stderr → null cached with negTtl.
 */
export class GitCache {
	private readonly cwdValue: string;
	private readonly opts: GitCacheOptions;
	private value: GitStatus | null = null;
	private fetchedAt = 0;
	private fetching = false;
	private refetchQueued = false;
	private disposed = false;
	private notifyCb: (() => void) | null = null;

	// Note: no TS parameter properties (not supported by Node type stripping).
	constructor(cwdValue: string, opts: GitCacheOptions = {}) {
		this.cwdValue = cwdValue;
		this.opts = opts;
	}

	setNotify(cb: (() => void) | null): void {
		this.notifyCb = cb;
	}

	/** Synchronous, never blocks: returns cached value; schedules refetch if stale. */
	get(): GitStatus | null {
		if (this.disposed) return this.value;
		const ttl = this.value ? (this.opts.ttlMs ?? 2000) : (this.opts.negTtlMs ?? 30000);
		if (Date.now() - this.fetchedAt > ttl) this.scheduleRefetch();
		return this.value;
	}

	/** Drop cached value so the next get() triggers a refetch. */
	invalidate(): void {
		this.fetchedAt = 0;
	}

	dispose(): void {
		this.disposed = true;
		this.notifyCb = null;
	}

	private scheduleRefetch(): void {
		if (this.disposed) return;
		if (this.fetching) {
			this.refetchQueued = true;
			return;
		}
		this.fetching = true;
		void this.refetch()
			.catch(() => {})
			.finally(() => {
				this.fetching = false;
				if (this.refetchQueued && !this.disposed) {
					this.refetchQueued = false;
					this.scheduleRefetch();
				}
			});
	}

	private async refetch(): Promise<void> {
		const timeoutMs = this.opts.timeoutMs ?? 2500;
		try {
			const [status, stash] = await Promise.all([
				execFileP("git", ["status", "--porcelain=v2", "--branch"], {
					cwd: this.cwdValue,
					timeout: timeoutMs,
				}),
				execFileP("git", ["stash", "list"], { cwd: this.cwdValue, timeout: timeoutMs }).catch(
					(): { stdout: string } => ({ stdout: "" }),
				),
			]);
			this.value = { ...emptyStatus(), stashes: countLines(stash.stdout), ...parsePorcelainV2(status.stdout) };
			this.fetchedAt = Date.now();
			this.notifyCb?.();
		} catch (err) {
			// Non-repo (stderr contains "not a git repository") or git failure:
			// cache null with negative TTL so we don't hammer git.
			void err;
			this.value = null;
			this.fetchedAt = Date.now();
			this.notifyCb?.();
		}
	}
}
