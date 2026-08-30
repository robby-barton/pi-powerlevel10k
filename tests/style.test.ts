/** Style resolution tests: precedence, p10k key mapping, color parsing. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAssert } from "./helpers.ts";
import { parseP10kConfig } from "../src/parse-p10k.ts";
import { DEFAULT_CONFIG, type PkgConfig } from "../src/config.ts";
import { resolveStyle, parseColorValue, DEFAULT_STYLE } from "../src/style.ts";
import { C, ICON } from "../src/ansi.ts";

const fixtureDir = join(import.meta.dirname, "fixtures");

function cfgWith(overrides: Partial<PkgConfig>): PkgConfig {
	return { ...DEFAULT_CONFIG, ...overrides, colors: { ...overrides.colors }, icons: { ...overrides.icons } };
}

export function runStyleTests() {
	const { stats, assert, assertEqual, deepEqual } = createAssert("style");

	// --- parseColorValue -------------------------------------------------------
	assertEqual(parseColorValue("%246F"), 246, "%NNF prefix");
	assertEqual(parseColorValue("%76F rest"), 76, "%NNF prefix with suffix");
	assertEqual(parseColorValue("255"), 255, "plain index");
	assertEqual(parseColorValue("#AABBCC"), "#aabbcc", "hex normalized to lowercase");
	assertEqual(parseColorValue("yellow"), 3, "zsh named color");
	assertEqual(parseColorValue("bright-red"), 9, "bright named color");
	assertEqual(parseColorValue("garbage"), null, "unparsable → null");
	assertEqual(parseColorValue(""), null, "empty → null");

	// --- defaults (no parsed config) -------------------------------------------
	const style = resolveStyle(null, DEFAULT_CONFIG);
	assertEqual(style.colors.bgBar, C.bgBar, "default bgBar from C");
	assertEqual(style.colors.branch, C.branch, "default branch color");
	deepEqual(style.icons, ICON, "default icons from ICON");
	assertEqual(style.promptChar, "❯", "default prompt char");
	assertEqual(style.dirShortenThreshold, 80, "default dir threshold");
	assertEqual(style.branchMaxWidth, 32, "default branch width");
	deepEqual(style.leftSegments, ["os", "dir", "vcs"], "default left segments");
	deepEqual(style.dropOrder, ["agents", "tokens", "cost", "context", "model"], "default drop order");

	// --- parsed sample fixture ---------------------------------------------------
	const parsed = parseP10kConfig(readFileSync(join(fixtureDir, "p10k-sample.zsh"), "utf8"));
	const styled = resolveStyle(parsed, DEFAULT_CONFIG);

	assertEqual(styled.icons.sepThin, "\uE0B1", "LEFT_SUBSEGMENT_SEPARATOR glyph");
	assertEqual(styled.colors.fgSep, 244, "LEFT_SUBSEGMENT_SEPARATOR %NNNF color");
	assertEqual(styled.icons.sepRight, "\uE0B0", "LEFT_SEGMENT_SEPARATOR glyph");
	assertEqual(styled.icons.sepLeft, "\uE0B2", "RIGHT_SEGMENT_SEPARATOR glyph");
	assertEqual(styled.colors.os, 255, "OS_ICON_FOREGROUND");
	assertEqual(styled.colors.dirDefault, 31, "DIR_FOREGROUND");
	assertEqual(styled.colors.dirShort, 103, "DIR_SHORTENED_FOREGROUND");
	assertEqual(styled.colors.dirAnchor, 39, "DIR_ANCHOR_FOREGROUND");
	assertEqual(styled.dirAnchorBold, true, "DIR_ANCHOR_BOLD=true");
	assertEqual(styled.dirShortenThreshold, 80, "DIR_MAX_LENGTH → threshold");
	assertEqual(styled.icons.git, "\uF126", "VCS_BRANCH_ICON (trimmed)");
	assertEqual(styled.promptChar, "❯", "PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION");
	assertEqual(styled.colors.ok, 76, "PROMPT_CHAR_OK_VIINS_FOREGROUND (via brace expansion)");
	assertEqual(styled.colors.err, 196, "PROMPT_CHAR_ERROR_VIINS_FOREGROUND");
	assertEqual(styled.promptAddNewline, true, "PROMPT_ADD_NEWLINE=true");
	deepEqual(styled.leftSegments, ["os", "dir", "vcs"], "LEFT_PROMPT_ELEMENTS mapped");
	// gitFormatter locals override VCS_* — last assignment wins (zsh semantics).
	assertEqual(styled.colors.branch, 76, "gitFormatter clean overrides VCS_CLEAN");
	assertEqual(styled.colors.modified, 178, "gitFormatter modified overrides VCS_MODIFIED");
	assertEqual(styled.colors.meta, 246, "gitFormatter meta");
	assertEqual(styled.colors.untracked, 39, "gitFormatter untracked overrides VCS_UNTRACKED");
	assertEqual(styled.colors.conflicted, 196, "gitFormatter conflicted");

	// --- mode: non-nerdfont → unicode fallback ------------------------------------
	const parsedUnicode = parseP10kConfig("typeset -g POWERLEVEL9K_MODE=compatible\n");
	const unicodeStyle = resolveStyle(parsedUnicode, DEFAULT_CONFIG);
	assert(unicodeStyle.icons.sepRight !== ICON.sepRight, "non-nerdfont MODE switches icon set");
	const parsedNerd = parseP10kConfig("typeset -g POWERLEVEL9K_MODE=nerdfont-complete\n");
	assertEqual(resolveStyle(parsedNerd, DEFAULT_CONFIG).icons.sepRight, ICON.sepRight, "nerdfont MODE keeps nerd icons");

	// --- settings overrides win -----------------------------------------------------
	const overrideCfg = cfgWith({
		colors: { branch: "#00ff00", "thinking.high": 200, meta: 100 },
		icons: { git: "\uE725" },
	});
	const overrideStyle = resolveStyle(parsed, overrideCfg);
	assertEqual(overrideStyle.colors.branch, "#00ff00", "cfg.colors override beats parsed");
	assertEqual(overrideStyle.colors.thinking.high, 200, "thinking.high override");
	assertEqual(overrideStyle.colors.meta, 100, "meta override beats gitFormatter");
	assertEqual(overrideStyle.icons.git, "\uE725", "cfg.icons override beats parsed");

	// --- scalar knobs from settings ---------------------------------------------------
	const knobCfg = cfgWith({
		dirShortenThreshold: 60,
		branchMaxWidth: 20,
		contextWarnPct: 50,
		contextErrorPct: 80,
		leftSegments: ["dir", "vcs"],
		rightSegments: ["model", "context"],
		dropOrder: ["model", "context"],
		promptChar: "▶",
	});
	const knobStyle = resolveStyle(parsed, knobCfg);
	assertEqual(knobStyle.dirShortenThreshold, 60, "dirShortenThreshold from cfg");
	assertEqual(knobStyle.branchMaxWidth, 20, "branchMaxWidth from cfg");
	assertEqual(knobStyle.ctxWarnPct, 50, "ctxWarnPct from cfg");
	assertEqual(knobStyle.ctxErrPct, 80, "ctxErrPct from cfg");
	deepEqual(knobStyle.leftSegments, ["dir", "vcs"], "leftSegments from cfg (os dropped)");
	deepEqual(knobStyle.rightSegments, ["model", "context"], "rightSegments from cfg");
	deepEqual(knobStyle.dropOrder, ["model", "context"], "dropOrder from cfg");
	assertEqual(knobStyle.promptChar, "▶", "explicit cfg.promptChar beats parsed");

	// default promptChar does NOT clobber a parsed one
	const parsedCustomChar = parseP10kConfig("typeset -g POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION='→'\n");
	assertEqual(resolveStyle(parsedCustomChar, DEFAULT_CONFIG).promptChar, "→", "parsed prompt char wins over default");

	// DIR_ANCHOR_BOLD=false
	const noBold = resolveStyle(parseP10kConfig("typeset -g POWERLEVEL9K_DIR_ANCHOR_BOLD=false\n"), DEFAULT_CONFIG);
	assertEqual(noBold.dirAnchorBold, false, "DIR_ANCHOR_BOLD=false");

	// PROMPT_ADD_NEWLINE=false
	const noNewline = resolveStyle(parseP10kConfig("typeset -g POWERLEVEL9K_PROMPT_ADD_NEWLINE=false\n"), DEFAULT_CONFIG);
	assertEqual(noNewline.promptAddNewline, false, "PROMPT_ADD_NEWLINE=false mapped");

	// --- never throws on partial configs ----------------------------------------------
	const empty = resolveStyle(parseP10kConfig(""), DEFAULT_CONFIG);
	assertEqual(empty.colors.bgBar, C.bgBar, "empty parse → defaults");

	console.log(`style: ${stats.checks - stats.failures}/${stats.checks} checks passed`);
	return stats;
}
