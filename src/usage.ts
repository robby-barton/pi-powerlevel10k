/**
 * Usage accounting for the p10k prompt/footer.
 *
 * Mirrors the accumulation logic of pi's built-in footer
 * (dist/modes/interactive/components/footer.js) plus PendingUsageQueue,
 * which bridges the message_end-fires-before-persistence race.
 *
 * Pure module: no pi imports, so it is smoke-testable with plain node.
 */

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

/** Structural subset of @earendil-works/pi-ai `Usage` (defensively optional). */
export interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { total?: number } | number;
}

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

export function usageCost(usage: UsageLike | null | undefined): number {
	if (!usage) return 0;
	if (typeof usage.cost === "number") return num(usage.cost);
	return num(usage.cost?.total);
}

export function createUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

export function addToTotals(totals: UsageTotals, usage: UsageLike | null | undefined): void {
	if (!usage) return;
	totals.input += num(usage.input);
	totals.output += num(usage.output);
	totals.cacheRead += num(usage.cacheRead);
	totals.cacheWrite += num(usage.cacheWrite);
	totals.totalTokens += num(usage.totalTokens);
	totals.cost += usageCost(usage);
}

/**
 * Replicates the built-in footer's accumulation over session entries:
 * - message entries: assistant usage always; toolResult usage when present
 * - branch_summary / compaction entries: entry.usage when present
 */
export function computeUsageFromEntries(entries: readonly unknown[]): UsageTotals {
	const totals = createUsageTotals();
	for (const entry of entries) {
		const e = entry as { type?: unknown; message?: { role?: unknown; usage?: UsageLike }; usage?: UsageLike };
		if (!e || typeof e.type !== "string") continue;
		if (e.type === "message") {
			const msg = e.message;
			if (!msg) continue;
			if (msg.role === "assistant") {
				addToTotals(totals, msg.usage);
			} else if (msg.role === "toolResult" && msg.usage) {
				addToTotals(totals, msg.usage);
			}
		} else if (e.type === "branch_summary" || e.type === "compaction") {
			addToTotals(totals, e.usage);
		}
	}
	return totals;
}

interface PendingItem {
	usage: UsageLike;
	/** Session entries count at the time the usage was captured (pre-persistence). */
	atEntryCount: number;
}

/**
 * Queues usage captured from message_end / session_compact events that fire
 * BEFORE the corresponding entry is persisted into sessionManager entries.
 *
 * mergeInto() adds still-unpersisted items into the freshly computed totals
 * exactly once, then drops them, so nothing is ever double-counted once the
 * entry lands (assistant messages persist before their toolResults, so
 * nothing lingers either).
 */
export class PendingUsageQueue {
	private items: PendingItem[] = [];

	add(usage: UsageLike, atEntryCount: number): void {
		if (!usage) return;
		this.items.push({ usage, atEntryCount });
	}

	/**
	 * Merge pending usage into `totals` (computed from `entries`).
	 * Items whose entry is already visible in `entries` (persisted) are dropped
	 * without merging; still-pending items are merged once, then dropped.
	 */
	mergeInto(totals: UsageTotals, entries: readonly unknown[]): void {
		if (this.items.length === 0) return;
		for (const item of this.items) {
			if (item.atEntryCount >= entries.length) {
				addToTotals(totals, item.usage);
			}
		}
		this.items = [];
	}

	clear(): void {
		this.items = [];
	}

	get size(): number {
		return this.items.length;
	}
}

/** Copy of the built-in footer's compact token formatting (45k, 1.2M, ...). */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCost(c: number): string {
	return `$${c.toFixed(3)}`;
}
