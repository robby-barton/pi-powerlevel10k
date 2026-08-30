/**
 * Smoke tests for the p10k pure modules (ansi, usage, git parsing, segments),
 * ported from the original loose extension and parameterized over P10kStyle.
 * These modules must not import pi-tui / pi-coding-agent.
 */

import { C, ICON, stripAnsi, truncateToWidth, visibleWidth } from "../src/ansi.ts";
import { parsePorcelainV2, type GitStatus } from "../src/git.ts";
import {
	PendingUsageQueue,
	computeUsageFromEntries,
	formatCost,
	formatTokens,
	type UsageTotals,
} from "../src/usage.ts";
import { buildDirSegment, buildGitSegment, composePrompt, type PromptData } from "../src/segments.ts";
import { DEFAULT_STYLE, resolveStyle } from "../src/style.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createAssert } from "./helpers.ts";

const STYLE = resolveStyle(null, DEFAULT_CONFIG);

const cleanGit: GitStatus = {
	branch: "main",
	oid: "abc1234567890abcdef",
	ahead: 0,
	behind: 0,
	staged: 0,
	unstaged: 0,
	untracked: 0,
	conflicted: 0,
	stashes: 0,
};

const dirtyGit: GitStatus = {
	branch: "feature/some-long-branch-name",
	oid: "def4567890abcdef1234",
	ahead: 2,
	behind: 1,
	staged: 3,
	unstaged: 5,
	untracked: 7,
	conflicted: 1,
	stashes: 2,
};

const fullData: PromptData = {
	cwd: "/home/robby/projects/pi-coding-agent",
	home: "/home/robby",
	git: dirtyGit,
	model: "z-ai/glm-5.3-flash",
	ctxPercent: 54,
	cost: 0.1234,
	inputTokens: 45000,
	outputTokens: 1200,
	agentsDone: 1,
	agentsTotal: 3,
	error: false,
};

export function runSmokeTests() {
	const { stats, assert, assertEqual } = createAssert("smoke");

	// --- 1. Widths never exceed the viewport -------------------------------------
	for (const width of [40, 80, 120, 200]) {
		const lines = composePrompt(width, fullData, STYLE);
		assertEqual(lines.length, 1, `composePrompt(${width}) returns 1 line`);
		for (let i = 0; i < lines.length; i++) {
			assert(
				visibleWidth(lines[i]) <= width,
				`composePrompt(${width}) line ${i + 1} width ${visibleWidth(lines[i])} <= ${width}`,
			);
		}
	}

	// --- 2. Balanced ANSI per line ------------------------------------------------
	function sgrOpeners(s: string): number {
		return (s.match(/\x1b\[(?!0m)[0-9;]*m/g) ?? []).length;
	}
	function sgrResets(s: string): number {
		return (s.match(/\x1b\[0m/g) ?? []).length;
	}
	for (const width of [40, 80, 200]) {
		const lines = composePrompt(width, fullData, STYLE);
		for (let i = 0; i < lines.length; i++) {
			assertEqual(sgrOpeners(lines[i]), sgrResets(lines[i]), `composePrompt(${width}) line ${i + 1} ANSI balanced`);
			assert(!stripAnsi(lines[i]).includes("\x1b"), `line ${i + 1} has no residual escapes in visible text`);
		}
	}

	// --- 3. Overflow drop order agents→tokens→cost→ctx→model ----------------------
	function dropOrderTest(): void {
		// Drop order agents→tokens→cost→ctx→model means the present set is always a
		// prefix of the display order [model, ctx, cost, tokens, agents], shrinking
		// one segment at a time as width decreases.
		const detect: Array<[string, string]> = [
			["model", ICON.model],
			["ctx", ICON.ctx],
			["cost", ICON.cost],
			["tokens", "↑"],
			["agents", ICON.robot],
		];
		let prevLen = detect.length;
		for (let width = 220; width >= 24; width--) {
			const visible = stripAnsi(composePrompt(width, fullData, STYLE)[0]);
			let len = 0;
			for (const [name, glyph] of detect) {
				if (!visible.includes(glyph)) break;
				len++;
			}
			assert(len <= prevLen, `width ${width}: prefix length ${len} <= ${prevLen} (drop order enforced)`);
			assert(
				prevLen - len <= 1,
				`width ${width}: exactly one segment dropped at a time (was ${prevLen}, now ${len})`,
			);
			prevLen = len;
		}
		assert(prevLen < detect.length, "some right segments eventually dropped");
	}
	dropOrderTest();

	// --- 4. Git segment dropped before dir on narrow ------------------------------
	const narrow = composePrompt(30, { ...fullData }, STYLE);
	const narrowVisible = stripAnsi(narrow[0]);
	assert(!narrowVisible.includes(ICON.git), "git segment dropped on narrow width");
	assert(narrowVisible.includes(ICON.dir), "dir segment kept on narrow width");

	// --- 5. No repo → git segment omitted ----------------------------------------
	const noRepo = composePrompt(120, { ...fullData, git: null }, STYLE);
	assert(!stripAnsi(noRepo[0]).includes(ICON.git), "no-repo data omits git segment");
	assert(stripAnsi(noRepo[0]).includes(ICON.dir), "no-repo data keeps dir segment");

	// --- 6. Percent null → "?" -----------------------------------------------------
	const unknownCtx = composePrompt(120, { ...fullData, ctxPercent: null }, STYLE);
	assert(stripAnsi(unknownCtx[0]).includes(`${ICON.ctx} ?`), "null ctx percent renders as ?");

	// --- 7. Bar only — prompt char is rendered by the editor, not the widget ---
	const okLines = composePrompt(80, { ...fullData, error: false }, STYLE);
	assert(okLines.length === 1, "composePrompt returns exactly 1 line");
	assert(!stripAnsi(okLines[0]).includes(ICON.prompt), "bar does not render the prompt char (editor owns it)");

	// --- 7b. leftSegments config: os dropped / reordered --------------------------
	const noOsStyle = { ...STYLE, leftSegments: ["dir", "vcs"] };
	const noOs = composePrompt(160, { ...fullData }, noOsStyle);
	assert(!stripAnsi(noOs[0]).includes(ICON.osLinux) && !stripAnsi(noOs[0]).includes(ICON.osMac), "os segment omitted when not in leftSegments");
	assert(stripAnsi(noOs[0]).includes(ICON.dir), "dir kept when leftSegments=[dir,vcs]");
	const gitFirstStyle = { ...STYLE, leftSegments: ["vcs", "dir", "os"] };
	const gitFirst = stripAnsi(composePrompt(200, { ...fullData }, gitFirstStyle)[0]);
	assert(
		gitFirst.indexOf(ICON.git) !== -1 && gitFirst.indexOf(ICON.git) < gitFirst.indexOf(ICON.dir),
		"leftSegments order is honored",
	);
	const dirOnlyStyle = { ...STYLE, leftSegments: ["dir"] };
	assert(
		!stripAnsi(composePrompt(160, { ...fullData, git: dirtyGit }, dirOnlyStyle)[0]).includes(ICON.git),
		"vcs segment omitted when not in leftSegments",
	);

	// --- 8. Porcelain v2 fixtures --------------------------------------------------
	const cleanParsed = parsePorcelainV2(
		[
			"# branch.oid abc1234567890abcdef",
			"# branch.head refs/heads/main",
			"# branch.upstream origin/main",
			"# branch.ab +0 -0",
			"",
		].join("\n"),
	);
	assertEqual(cleanParsed.branch, "main", "clean fixture: branch");
	assertEqual(cleanParsed.oid, "abc1234567890abcdef", "clean fixture: oid");
	assertEqual(cleanParsed.ahead, 0, "clean fixture: ahead");
	assertEqual(cleanParsed.behind, 0, "clean fixture: staged");
	assertEqual(cleanParsed.staged, undefined, "clean fixture: no staged key");
	assertEqual(cleanParsed.untracked, undefined, "clean fixture: no untracked key");

	const dirtyParsed = parsePorcelainV2(
		[
			"# branch.oid def456",
			"# branch.head refs/heads/dev",
			"# branch.ab +3 -1",
			"1 .M N... 100644 100644 100644 abc def file.txt",
			"1 M. N... 100644 100644 100644 abc def other.txt",
			"2 R. N... 100644 100644 100644 abc def new.txt\told.txt",
			"? untracked.txt",
			"? untracked2.txt",
			"? untracked3.txt",
			"",
		].join("\n"),
	);
	assertEqual(dirtyParsed.branch, "dev", "dirty fixture: branch");
	assertEqual(dirtyParsed.ahead, 3, "dirty fixture: ahead");
	assertEqual(dirtyParsed.behind, 1, "dirty fixture: behind");
	assertEqual(dirtyParsed.staged, 2, "dirty fixture: staged (M. + R.)");
	assertEqual(dirtyParsed.unstaged, 1, "dirty fixture: unstaged (.M)");
	assertEqual(dirtyParsed.untracked, 3, "dirty fixture: untracked");
	assertEqual(dirtyParsed.conflicted, undefined, "dirty fixture: no conflicted key");

	const detachedParsed = parsePorcelainV2(
		[
			"# branch.oid 0123456789abcdef0123456789abcdef01234567",
			"# branch.head (detached)",
			"1 MM N... 100644 100644 100644 abc def x.txt",
			"u DU N... 100644 100644 100644 100644 abc abc abc conflict.txt",
			"",
		].join("\n"),
	);
	assertEqual(detachedParsed.branch, null, "detached fixture: branch null");
	assertEqual(detachedParsed.oid, "0123456789abcdef0123456789abcdef01234567", "detached fixture: oid");
	assertEqual(detachedParsed.staged, 1, "detached fixture: staged (M of MM)");
	assertEqual(detachedParsed.unstaged, 1, "detached fixture: unstaged (M of MM)");
	assertEqual(detachedParsed.conflicted, 1, "detached fixture: conflicted (u line)");

	const abParsed = parsePorcelainV2(
		["# branch.oid 1111", "# branch.head refs/heads/main", "# branch.ab +12 -34", ""].join("\n"),
	);
	assertEqual(abParsed.ahead, 12, "ahead+behind fixture: ahead 12");
	assertEqual(abParsed.behind, 34, "ahead+behind fixture: behind 34");

	// --- 9. PendingUsageQueue merges once, never double-counts ---------------------
	const mkUsage = (n: number) => ({ input: n, output: n, cacheRead: 0, cacheWrite: 0, totalTokens: n, cost: { total: n } });

	// Entry persisted and visible: pending must NOT merge again.
	const q1 = new PendingUsageQueue();
	const entries1 = [{ type: "message", message: { role: "assistant", usage: mkUsage(10) } }];
	q1.add(mkUsage(5), 1); // captured at entries.length === 1 → not yet persisted → merges once.
	const t1: UsageTotals = computeUsageFromEntries(entries1);
	q1.mergeInto(t1, entries1);
	assertEqual(t1.input, 15, "pending merges into pre-persistence totals (10 + 5)");
	// Queue drained: merging again (fresh totals) adds nothing.
	const t1b: UsageTotals = computeUsageFromEntries(entries1);
	q1.mergeInto(t1b, entries1);
	assertEqual(t1b.input, 10, "queue drained — no double merge after persistence lands");

	// Entry already persisted (entries.length grew past atEntryCount): dropped, not merged.
	const q2 = new PendingUsageQueue();
	const entries2 = [
		{ type: "message", message: { role: "assistant", usage: mkUsage(10) } },
		{ type: "message", message: { role: "assistant", usage: mkUsage(20) } },
	];
	q2.add(mkUsage(99), 1); // captured at length 1; entries.length now 2 → persisted
	const t2: UsageTotals = computeUsageFromEntries(entries2);
	q2.mergeInto(t2, entries2);
	assertEqual(t2.input, 30, "persisted pending item is dropped without merging (no double count)");

	// Multiple pending items merge exactly once each.
	const q3 = new PendingUsageQueue();
	const entries3: unknown[] = [{ type: "message", message: { role: "assistant", usage: mkUsage(1) } }];
	q3.add(mkUsage(2), 1);
	q3.add(mkUsage(3), 1);
	const t3: UsageTotals = computeUsageFromEntries(entries3);
	q3.mergeInto(t3, entries3);
	assertEqual(t3.input, 6, "multiple pending items each merge once (1+2+3)");

	// --- 10. formatTokens / formatCost ---------------------------------------------
	assertEqual(formatTokens(999), "999", "formatTokens 999");
	assertEqual(formatTokens(4500), "4.5k", "formatTokens 4500");
	assertEqual(formatTokens(45000), "45k", "formatTokens 45000");
	assertEqual(formatTokens(1200000), "1.2M", "formatTokens 1200000");
	assertEqual(formatTokens(25000000), "25M", "formatTokens 25000000");
	assertEqual(formatCost(0), "$0.000", "formatCost 0");
	assertEqual(formatCost(0.1234), "$0.123", "formatCost 0.1234");

	// --- 11. ANSI helpers ------------------------------------------------------------
	assertEqual(visibleWidth("a\x1b[38;5;39mbc\x1b[0m"), 3, "visibleWidth ignores ANSI");
	assertEqual(truncateToWidth("\x1b[38;5;39mabcdef\x1b[0m", 4, ""), "\x1b[38;5;39mabcd\x1b[0m", "truncate keeps reset");
	assertEqual(truncateToWidth("abc", 10), "abc", "truncate no-op when short");
	assertEqual(C.bgBar, 236, "bar color");

	// Git segment direct check: truncation of long branch names.
	const longBranch = buildGitSegment({ ...cleanGit, branch: "a".repeat(40) }, STYLE);
	assert(stripAnsi(longBranch).includes("…"), "long branch name truncated with ellipsis");
	const longBranchVisible = stripAnsi(longBranch);
	assert(
		longBranchVisible.includes("a".repeat(12) + "…" + "a".repeat(12)),
		"long branch truncated with head/last halves around ellipsis",
	);

	// Hex colors render as truecolor SGR.
	const hexStyle = structuredClone(DEFAULT_STYLE);
	hexStyle.colors.branch = "#00ff00";
	const hexSeg = buildGitSegment({ ...cleanGit }, hexStyle);
	assert(hexSeg.includes("38;2;0;255;0"), "hex branch color emits truecolor SGR");

	// Style thresholds drive dir shortening.
	const longHome = "/home/user";
	const longCwd = `${longHome}/aa/bb/cc/dddddddddddddddddd`;
	const tightStyle = structuredClone(DEFAULT_STYLE);
	tightStyle.dirShortenThreshold = 5;
	const tightened = stripAnsi(buildDirSegment(longCwd, longHome, tightStyle));
	assert(tightened.includes("~/a/b/c/"), "dir shorten threshold from style (tight → shortened)");
	const looseStyle = structuredClone(DEFAULT_STYLE);
	looseStyle.dirShortenThreshold = 200;
	const loose = stripAnsi(buildDirSegment(longCwd, longHome, looseStyle));
	assert(loose.includes("~/aa/bb/cc/"), "dir not shortened under loose threshold");

	console.log(`\n${stats.checks - stats.failures}/${stats.checks} checks passed`);
	return stats;
}
