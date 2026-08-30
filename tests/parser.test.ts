/** Parser tests: fixtures + synthetic edge cases. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAssert } from "./helpers.ts";
import {
	expandBraces,
	unescapeZsh,
	parseP10kConfig,
	resolveP10kPath,
	loadP10kParsed,
} from "../src/parse-p10k.ts";

const fixtureDir = join(import.meta.dirname, "fixtures");

export function runParserTests() {
	const { stats, assert, assertEqual, deepEqual } = createAssert("parser");

	// --- unescapeZsh ---------------------------------------------------------
	assertEqual(unescapeZsh("\\uE0B1"), "\uE0B1", "unescape \\uXXXX");
	assertEqual(unescapeZsh("\\u{E0B1}"), "\uE0B1", "unescape \\u{...}");
	assertEqual(unescapeZsh("a\\u276Cb"), "a\u276Cb", "unescape inside text");
	assertEqual(unescapeZsh("plain"), "plain", "no escapes → unchanged");
	assertEqual(unescapeZsh("\\uZZZZ"), "\\uZZZZ", "invalid escape → unchanged");

	// --- expandBraces --------------------------------------------------------
	deepEqual(expandBraces("P_{OK,ERROR}_VIINS"), [
		"P_OK_VIINS",
		"P_ERROR_VIINS",
	], "brace expansion splits on commas");
	assertEqual(expandBraces("NO_BRACES")[0], "NO_BRACES", "no braces → single name");

	// --- parseP10kConfig: sample fixture -------------------------------------
	const sample = parseP10kConfig(readFileSync(join(fixtureDir, "p10k-sample.zsh"), "utf8"));

	const left = sample.vars["POWERLEVEL9K_LEFT_PROMPT_ELEMENTS"];
	assert(left !== undefined && left.kind === "array", "LEFT_PROMPT_ELEMENTS parsed as array");
	if (left && left.kind === "array") {
		deepEqual(left.value, ["os_icon", "dir", "vcs", "newline", "prompt_char"], "array items (comments stripped)");
	}
	assertEqual((sample.vars["POWERLEVEL9K_MODE"] as { value: string }).value, "nerdfont-complete", "scalar value");
	assertEqual((sample.vars["POWERLEVEL9K_LEFT_SEGMENT_SEPARATOR"] as { value: string }).value, "\uE0B0", "\\uXXXX unescaped in single quotes");
	assertEqual((sample.vars["POWERLEVEL9K_OS_ICON_FOREGROUND"] as { value: string }).value, "255", "unquoted numeric scalar");
	assertEqual(
		(sample.vars["POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION"] as { value: string }).value,
		"❯",
		"brace-expanded name → scalar var",
	);
	assertEqual(
		(sample.vars["POWERLEVEL9K_PROMPT_CHAR_ERROR_VIINS_CONTENT_EXPANSION"] as { value: string }).value,
		"❯",
		"second brace alternative also present",
	);
	assertEqual((sample.vars["POWERLEVEL9K_DIR_MAX_LENGTH"] as { value: string }).value, "80", "DIR_MAX_LENGTH scalar");

	// git formatter locals — FIRST match wins per key (clean/up-to-date palette).
	assertEqual(sample.gitFormatter.meta, 246, "gitFormatter meta (first wins)");
	assertEqual(sample.gitFormatter.clean, 76, "gitFormatter clean (first wins)");
	assertEqual(sample.gitFormatter.modified, 178, "gitFormatter modified (first wins)");
	assertEqual(sample.gitFormatter.untracked, 39, "gitFormatter untracked (first wins)");
	assertEqual(sample.gitFormatter.conflicted, 196, "gitFormatter conflicted (first wins)");

	// Formatter function body lines (`local res`, `emulate`) are skipped, not crashed on.
	assert(sample.skippedLines > 0, "skippedLines tracked");

	// --- parseP10kConfig: edge fixture ---------------------------------------
	const edge = parseP10kConfig(readFileSync(join(fixtureDir, "p10k-edge.zsh"), "utf8"));

	assertEqual(
		(edge.vars["POWERLEVEL9K_HASH_IN_QUOTES"] as { value: string }).value,
		"a # not a comment # b",
		"# inside quotes preserved",
	);
	assertEqual(
		(edge.vars["POWERLEVEL9K_DOUBLE_QUOTED"] as { value: string }).value,
		"double ' single inside",
		"double quotes with single quote inside",
	);
	assertEqual((edge.vars["POWERLEVEL9K_UNICODE_SEP"] as { value: string }).value, "\uE0B1", "\\u{...} unescaped");
	assertEqual((edge.vars["POWERLEVEL9K_UNICODE_HEX"] as { value: string }).value, "\u263A", "4-hex \\u unescaped");
	assertEqual((edge.vars["POWERLEVEL9K_EMPTY"] as { value: string }).value, "", "empty value");
	assertEqual((edge.vars["POWERLEVEL9K_UNQUOTED"] as { value: string }).value, "42", "unquoted value");
	assertEqual((edge.vars["POWERLEVEL9K_INDENTED"] as { value: string }).value, "7", "indented typeset parsed");
	assertEqual((edge.vars["POWERLEVEL9K_IN_IF_BLOCK"] as { value: string }).value, "%5F", "typeset inside if block");
	assertEqual((edge.vars["POWERLEVEL9K_BRACE_A_FOREGROUND"] as { value: string }).value, "13", "brace name A");
	assertEqual((edge.vars["POWERLEVEL9K_BRACE_B_FOREGROUND"] as { value: string }).value, "13", "brace name B");
	const oneLine = edge.vars["POWERLEVEL9K_ONE_LINE_ARRAY"];
	assert(oneLine !== undefined && oneLine.kind === "array", "same-line array");
	if (oneLine && oneLine.kind === "array") {
		deepEqual(oneLine.value, ["alpha", "beta"], "same-line array items");
	}
	assertEqual((edge.vars["POWERLEVEL9K_NAMED_COLOR"] as { value: string }).value, "yellow", "named color kept as raw string");
	assert(edge.skippedLines >= 1, "malformed line counted as skipped");

	// --- parseP10kConfig: never throws on garbage ----------------------------
	const garbage = parseP10kConfig("((((( \n typeset -g X=(\n never closed\n");
	assert(garbage.vars["X"] !== undefined, "unclosed array does not hang/crash");
	assertEqual(parseP10kConfig("").skippedLines, 0, "empty input");

	// --- resolveP10kPath -----------------------------------------------------
	const saved = { p10k: process.env.P10K_CONFIG_FILE, p9k: process.env.POWERLEVEL9K_CONFIG_FILE };
	delete process.env.P10K_CONFIG_FILE;
	delete process.env.POWERLEVEL9K_CONFIG_FILE;
	assertEqual(resolveP10kPath(null)?.source, "default", "no override/env → default");
	assertEqual(resolveP10kPath("/tmp/my-p10k.zsh")?.source, "setting", "override → setting");
	assertEqual(resolveP10kPath("/tmp/my-p10k.zsh")?.path, "/tmp/my-p10k.zsh", "override path passthrough");
	process.env.P10K_CONFIG_FILE = "/tmp/env-p10k.zsh";
	assertEqual(resolveP10kPath(null)?.source, "env", "P10K_CONFIG_FILE → env");
	assertEqual(resolveP10kPath(null)?.path, "/tmp/env-p10k.zsh", "env path passthrough");
	delete process.env.P10K_CONFIG_FILE;
	process.env.POWERLEVEL9K_CONFIG_FILE = "/tmp/p9k-env.zsh";
	assertEqual(resolveP10kPath(null)?.source, "env", "POWERLEVEL9K_CONFIG_FILE → env");
	delete process.env.POWERLEVEL9K_CONFIG_FILE;
	process.env.P10K_CONFIG_FILE = saved.p10k;
	process.env.POWERLEVEL9K_CONFIG_FILE = saved.p9k;

	// --- loadP10kParsed: missing file never throws ---------------------------
	const missing = loadP10kParsed("/nonexistent/p10k.zsh");
	assertEqual(missing.parsed, null, "missing file → parsed null");
	assert(missing.error !== undefined, "missing file → error message");

	// Real file (if present) should parse with substantial output.
	const real = loadP10kParsed(process.env.HOME ? `${process.env.HOME}/.p10k.zsh` : undefined);
	if (real.parsed) {
		assert(Object.keys(real.parsed.vars).length > 20, "real config parses many vars");
		assert(real.parsed.gitFormatter.conflicted !== undefined, "real config has gitFormatter locals");
		assert(real.source !== undefined, "real config has a source");
	}

	console.log(`parser: ${stats.checks - stats.failures}/${stats.checks} checks passed`);
	return stats;
}
