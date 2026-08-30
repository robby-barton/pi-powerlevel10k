/**
 * Test runner — executes all test modules in-process and aggregates results.
 * Plain node (type stripping), no dependencies:  node tests/run.ts
 */

import type { TestStats } from "./helpers.ts";
import { runParserTests } from "./parser.test.ts";
import { runStyleTests } from "./style.test.ts";
import { runThemeGenTests } from "./theme-gen.test.ts";
import { runSmokeTests } from "./smoke.ts";

const all: Array<[string, () => TestStats]> = [
	["parser", runParserTests],
	["style", runStyleTests],
	["theme-gen", runThemeGenTests],
	["smoke", runSmokeTests],
];

let checks = 0;
let failures = 0;
for (const [name, run] of all) {
	const stats = run();
	checks += stats.checks;
	failures += stats.failures;
	if (stats.failures > 0) {
		console.error(`\n== ${name}: ${stats.failures} failure(s) ==`);
	}
}

console.log(`\nTOTAL: ${checks - failures}/${checks} checks passed across ${all.length} suites`);
if (failures > 0) process.exit(1);
