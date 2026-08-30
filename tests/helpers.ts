/** Tiny assertion harness shared by all test modules (plain node, no deps). */

export interface TestStats {
	checks: number;
	failures: number;
}

export function createAssert(label: string) {
	const stats: TestStats = { checks: 0, failures: 0 };

	function assert(cond: boolean, what: string): void {
		stats.checks++;
		if (!cond) {
			stats.failures++;
			console.error(`FAIL [${label}]: ${what}`);
		}
	}

	function assertEqual(actual: unknown, expected: unknown, what: string): void {
		stats.checks++;
		if (actual !== expected) {
			stats.failures++;
			console.error(`FAIL [${label}]: ${what} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		}
	}

	function deepEqual(actual: unknown, expected: unknown, what: string): void {
		stats.checks++;
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a !== e) {
			stats.failures++;
			console.error(`FAIL [${label}]: ${what} — expected ${e}, got ${a}`);
		}
	}

	return { stats, assert, assertEqual, deepEqual };
}
