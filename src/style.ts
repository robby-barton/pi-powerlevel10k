/**
 * P10kStyle — the resolved style knobs the render stack consumes.
 *
 * resolveStyle() layers three sources (lowest → highest precedence):
 *   1. DEFAULT_STYLE (the powerlevel10k stock dark palette)
 *   2. parsed ~/.p10k.zsh values (via the mapping table below)
 *   3. explicit "p10kPrompt".colors / .icons overrides from pi settings
 *
 * Scalar knobs (thresholds, segment lists) come from settings only; they are
 * pi-specific and have no p10k counterpart except where noted.
 */

import type { Color } from "./ansi.ts";
import { C, ICON } from "./ansi.ts";
import type { P10kParsed } from "./parse-p10k.ts";
import { unescapeZsh } from "./parse-p10k.ts";
import type { PkgConfig } from "./config.ts";
import { DEFAULT_CONFIG } from "./config.ts";

export interface P10kThinkingColors {
	off: Color;
	minimal: Color;
	low: Color;
	medium: Color;
	high: Color;
	xhigh: Color;
	max: Color;
}

export interface P10kStyleColors {
	bgBar: Color;
	fgSep: Color;
	os: Color;
	dirAnchor: Color;
	dirShort: Color;
	dirDefault: Color;
	branch: Color;
	meta: Color;
	modified: Color;
	untracked: Color;
	conflicted: Color;
	ok: Color;
	err: Color;
	model: Color;
	ctx: Color;
	ctxWarn: Color;
	ctxErr: Color;
	cost: Color;
	tokens: Color;
	agents: Color;
	thinking: P10kThinkingColors;
}

export interface P10kStyleIcons {
	osLinux: string;
	osMac: string;
	dir: string;
	git: string;
	detached: string;
	model: string;
	ctx: string;
	cost: string;
	up: string;
	down: string;
	robot: string;
	sepRight: string;
	sepLeft: string;
	sepThin: string;
}

export interface P10kStyle {
	colors: P10kStyleColors;
	icons: P10kStyleIcons;
	/** PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION (parsed) unless settings override. */
	promptChar: string;
	/** PROMPT_ADD_NEWLINE — controls the blank line below the editor. */
	promptAddNewline: boolean;
	/** POWERLEVEL9K_DIR_ANCHOR_BOLD. */
	dirAnchorBold: boolean;
	dirShortenThreshold: number;
	branchMaxWidth: number;
	ctxWarnPct: number;
	ctxErrPct: number;
	/** Left bar segments in display order: "os" | "dir" | "vcs". */
	leftSegments: string[];
	/** Right bar segments in display order. */
	rightSegments: string[];
	/** Right-segment drop order on overflow. */
	dropOrder: string[];
}

export const DEFAULT_STYLE: P10kStyle = {
	colors: {
		bgBar: C.bgBar,
		fgSep: C.fgSep,
		os: C.os,
		dirAnchor: C.dirAnchor,
		dirShort: C.dirShort,
		dirDefault: C.dirDefault,
		branch: C.branch,
		meta: C.meta,
		modified: C.modified,
		untracked: C.untracked,
		conflicted: C.conflicted,
		ok: C.ok,
		err: C.err,
		model: C.model,
		ctx: C.ctx,
		ctxWarn: C.ctxWarn,
		ctxErr: C.ctxErr,
		cost: C.cost,
		tokens: C.tokens,
		agents: C.agents,
		thinking: { ...C.thinking },
	},
	icons: { ...ICON },
	promptChar: "❯",
	promptAddNewline: true,
	dirAnchorBold: true,
	dirShortenThreshold: 80,
	branchMaxWidth: 32,
	ctxWarnPct: 70,
	ctxErrPct: 90,
	leftSegments: ["os", "dir", "vcs"],
	rightSegments: ["model", "context", "cost", "tokens", "agents"],
	dropOrder: ["agents", "tokens", "cost", "context", "model"],
};

// ---------------------------------------------------------------------------
// Color value parsing
// ---------------------------------------------------------------------------

const ZSH_NAMED_COLORS: Record<string, number> = {
	black: 0,
	red: 1,
	green: 2,
	yellow: 3,
	blue: 4,
	magenta: 5,
	cyan: 6,
	white: 7,
	grey: 8,
	gray: 8,
	"bright-black": 8,
	"bright-red": 9,
	"bright-green": 10,
	"bright-yellow": 11,
	"bright-blue": 12,
	"bright-magenta": 13,
	"bright-cyan": 14,
	"bright-white": 15,
};

/**
 * Parse a p10k color value: `%NNNF` / `%NNN` prompt-expansion prefix, plain
 * palette index, `#rrggbb`, or a zsh named color. Returns null when unparsable.
 */
export function parseColorValue(value: string): Color | null {
	const v = value.trim();
	if (v.length === 0) return null;
	const pct = /^%(\d{1,3})F?/.exec(v);
	if (pct) {
		const n = Number.parseInt(pct[1], 10);
		return Number.isFinite(n) ? n : null;
	}
	if (/^\d{1,3}$/.test(v)) {
		const n = Number.parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	}
	if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
	const named = ZSH_NAMED_COLORS[v.toLowerCase()];
	return named === undefined ? null : named;
}

/** Extract a `%NNNF` prefix color + remaining glyph from a separator value. */
function parseSeparator(value: string): { color: Color | null; glyph: string } {
	const m = /^%(\d{1,3})F/.exec(value);
	const color = m ? Number.parseInt(m[1], 10) : null;
	const rest = m ? value.slice(m[0].length) : value;
	return { color: color !== null && Number.isFinite(color) ? color : null, glyph: unescapeZsh(rest) };
}

/** Read a scalar var as a color, applied via `apply` when valid. */
function applyColorVar(
	vars: Record<string, { kind: string; value: unknown }>,
	name: string,
	apply: (color: Color) => void,
): void {
	const v = vars[name];
	if (!v || v.kind !== "scalar") return;
	const color = parseColorValue(String(v.value));
	if (color !== null) apply(color);
}

function scalar(vars: Record<string, { kind: string; value: unknown }>, name: string): string | undefined {
	const v = vars[name];
	if (!v || v.kind !== "scalar") return undefined;
	return String(v.value);
}

// ---------------------------------------------------------------------------
// Icon sets
// ---------------------------------------------------------------------------

/** Icons for terminals without Nerd Fonts (MODE not nerdfont-*). */
const UNICODE_ICONS: P10kStyleIcons = {
	osLinux: "\u{1F427}",
	osMac: "\u{1F34E}",
	dir: "\u{1F4C1}",
	git: "\u2387",
	detached: "@",
	model: "\u2699",
	ctx: "\u25CB",
	cost: "$",
	up: "\u2191",
	down: "\u2193",
	robot: "\u{1F916}",
	sepRight: "\u25B6",
	sepLeft: "\u25C0",
	sepThin: "\u25B8",
};

// ---------------------------------------------------------------------------
// resolveStyle
// ---------------------------------------------------------------------------

/**
 * Resolve the effective style: defaults ← parsed p10k config ← settings
 * overrides. Never throws; `parsed` may be null (no config found).
 */
export function resolveStyle(parsed: P10kParsed | null, cfg: PkgConfig): P10kStyle {
	const style: P10kStyle = structuredClone(DEFAULT_STYLE) as P10kStyle;

	if (parsed) {
		const vars = parsed.vars as Record<string, { kind: string; value: unknown }>;

		// MODE → icon set (nerd vs unicode fallback).
		const mode = scalar(vars, "POWERLEVEL9K_MODE");
		if (mode !== undefined && !mode.includes("nerdfont")) {
			style.icons = { ...UNICODE_ICONS };
		}

		// OS icon color.
		applyColorVar(vars, "POWERLEVEL9K_OS_ICON_FOREGROUND", (c) => (style.colors.os = c));

		// Directory colors + knobs.
		applyColorVar(vars, "POWERLEVEL9K_DIR_FOREGROUND", (c) => (style.colors.dirDefault = c));
		applyColorVar(vars, "POWERLEVEL9K_DIR_SHORTENED_FOREGROUND", (c) => (style.colors.dirShort = c));
		applyColorVar(vars, "POWERLEVEL9K_DIR_ANCHOR_FOREGROUND", (c) => (style.colors.dirAnchor = c));
		if (scalar(vars, "POWERLEVEL9K_DIR_ANCHOR_BOLD") === "false") style.dirAnchorBold = false;
		const dirMax = scalar(vars, "POWERLEVEL9K_DIR_MAX_LENGTH");
		if (dirMax !== undefined && /^\d+$/.test(dirMax)) style.dirShortenThreshold = Number.parseInt(dirMax, 10);

		// Git colors (VCS_*).
		applyColorVar(vars, "POWERLEVEL9K_VCS_CLEAN_FOREGROUND", (c) => (style.colors.branch = c));
		applyColorVar(vars, "POWERLEVEL9K_VCS_UNTRACKED_FOREGROUND", (c) => (style.colors.untracked = c));
		applyColorVar(vars, "POWERLEVEL9K_VCS_MODIFIED_FOREGROUND", (c) => (style.colors.modified = c));
		applyColorVar(vars, "POWERLEVEL9K_VCS_CONFLICTED_FOREGROUND", (c) => (style.colors.conflicted = c));
		const branchIcon = scalar(vars, "POWERLEVEL9K_VCS_BRANCH_ICON");
		if (branchIcon !== undefined && branchIcon.trim().length > 0) {
			style.icons.git = unescapeZsh(branchIcon).trim();
		}

		// Git formatter locals OVERRIDE VCS_* (zsh later-assignment-wins).
		if (parsed.gitFormatter.clean !== undefined) style.colors.branch = parsed.gitFormatter.clean;
		if (parsed.gitFormatter.untracked !== undefined) style.colors.untracked = parsed.gitFormatter.untracked;
		if (parsed.gitFormatter.modified !== undefined) style.colors.modified = parsed.gitFormatter.modified;
		if (parsed.gitFormatter.conflicted !== undefined) style.colors.conflicted = parsed.gitFormatter.conflicted;
		if (parsed.gitFormatter.meta !== undefined) style.colors.meta = parsed.gitFormatter.meta;

		// Separators: '%244F\uE0B1' style values → color + glyph.
		const leftSub = scalar(vars, "POWERLEVEL9K_LEFT_SUBSEGMENT_SEPARATOR");
		if (leftSub !== undefined) {
			const { color, glyph } = parseSeparator(leftSub);
			if (color !== null) style.colors.fgSep = color;
			if (glyph.length > 0) style.icons.sepThin = glyph;
		}
		const leftSep = scalar(vars, "POWERLEVEL9K_LEFT_SEGMENT_SEPARATOR");
		if (leftSep !== undefined) {
			const glyph = unescapeZsh(leftSep).trim();
			if (glyph.length > 0) style.icons.sepRight = glyph;
		}
		const rightSep = scalar(vars, "POWERLEVEL9K_RIGHT_SEGMENT_SEPARATOR");
		if (rightSep !== undefined) {
			const glyph = unescapeZsh(rightSep).trim();
			if (glyph.length > 0) style.icons.sepLeft = glyph;
		}

		// Prompt char symbols/colors (brace-expanded names: OK_VIINS / ERROR_VIINS).
		const okChar = scalar(vars, "POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION");
		if (okChar !== undefined && okChar.trim().length > 0) style.promptChar = unescapeZsh(okChar);
		applyColorVar(vars, "POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_FOREGROUND", (c) => (style.colors.ok = c));
		applyColorVar(vars, "POWERLEVEL9K_PROMPT_CHAR_ERROR_VIINS_FOREGROUND", (c) => (style.colors.err = c));

		// PROMPT_ADD_NEWLINE → blank-line toggle below the editor.
		const addNewline = scalar(vars, "POWERLEVEL9K_PROMPT_ADD_NEWLINE");
		if (addNewline === "false" || addNewline === "0" || addNewline === "") style.promptAddNewline = false;

		// LEFT_PROMPT_ELEMENTS → left segment list (os_icon/dir/vcs only).
		const leftElems = vars["POWERLEVEL9K_LEFT_PROMPT_ELEMENTS"];
		if (leftElems && leftElems.kind === "array") {
			const mapped: string[] = [];
			for (const raw of leftElems.value as string[]) {
				if (raw === "os_icon") mapped.push("os");
				else if (raw === "dir") mapped.push("dir");
				else if (raw === "vcs") mapped.push("vcs");
				// prompt_char / newline etc. are handled elsewhere or unsupported.
			}
			if (mapped.length > 0) style.leftSegments = mapped;
		}
	}

	// Settings color overrides (highest precedence).
	for (const [key, value] of Object.entries(cfg.colors)) {
		if (key.startsWith("thinking.")) {
			const sub = key.slice("thinking.".length) as keyof P10kStyleColors["thinking"];
			if (sub in style.colors.thinking) style.colors.thinking[sub] = value as Color;
			continue;
		}
		if (key in style.colors && key !== "thinking") {
			style.colors[key as keyof Omit<P10kStyleColors, "thinking">] = value as Color;
		}
	}
	for (const [key, value] of Object.entries(cfg.icons)) {
		if (key in style.icons) style.icons[key as keyof P10kStyleIcons] = value;
	}

	// Scalar knobs from settings.
	style.dirShortenThreshold = cfg.dirShortenThreshold;
	style.branchMaxWidth = cfg.branchMaxWidth;
	style.ctxWarnPct = cfg.contextWarnPct;
	style.ctxErrPct = cfg.contextErrorPct;
	style.leftSegments = [...cfg.leftSegments];
	style.rightSegments = [...cfg.rightSegments];
	style.dropOrder = [...cfg.dropOrder];

	// Prompt char: parsed config wins over the default, explicit settings override both.
	if (cfg.promptChar !== DEFAULT_CONFIG.promptChar) style.promptChar = cfg.promptChar;

	return style;
}
