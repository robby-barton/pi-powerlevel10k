/**
 * Dynamic theme generation: maps a resolved P10kStyle onto pi's Theme tokens
 * so TUI chrome (tool rows, diffs, syntax, markdown) matches the extracted
 * p10k palette.
 *
 * Pure module (imports only the Theme class for construction), so the color
 * mapping is unit-testable without a TUI.
 */

import { Theme } from "@earendil-works/pi-coding-agent";
import type { Color } from "./ansi.ts";
import type { P10kStyle } from "./style.ts";

// ---------------------------------------------------------------------------
// 256-color ↔ RGB helpers
// ---------------------------------------------------------------------------

/** Standard xterm base-16 palette (index → RGB). */
const BASE16: ReadonlyArray<readonly [number, number, number]> = [
	[0, 0, 0],
	[128, 0, 0],
	[0, 128, 0],
	[128, 128, 0],
	[0, 0, 128],
	[128, 0, 128],
	[0, 128, 128],
	[192, 192, 192],
	[128, 128, 128],
	[255, 0, 0],
	[0, 255, 0],
	[255, 255, 0],
	[0, 0, 255],
	[255, 0, 255],
	[0, 255, 255],
	[255, 255, 255],
];

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** Decode a Color to RGB. Numbers use the xterm 256 palette; hex parsed directly. */
export function decodeColorRgb(color: Color): readonly [number, number, number] {
	if (typeof color === "number") {
		if (color < 16) return BASE16[color] ?? [0, 0, 0];
		if (color < 232) {
			const idx = color - 16;
			const r = CUBE_LEVELS[Math.floor(idx / 36)];
			const g = CUBE_LEVELS[Math.floor((idx % 36) / 6)];
			const b = CUBE_LEVELS[idx % 6];
			return [r, g, b];
		}
		const gray = 8 + 10 * (color - 232);
		return [gray, gray, gray];
	}
	const m = /^#([0-9a-fA-F]{6})$/.exec(color);
	if (m) {
		return [
			Number.parseInt(m[1].slice(0, 2), 16),
			Number.parseInt(m[1].slice(2, 4), 16),
			Number.parseInt(m[1].slice(4, 6), 16),
		];
	}
	// Non-hex strings should not reach here; treat as black.
	return [0, 0, 0];
}

/** Nearest xterm-256 index for an RGB triple (exhaustive scan — 256 candidates). */
export function rgbToNearest256(r: number, g: number, b: number): number {
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < 256; i++) {
		const [cr, cg, cb] = decodeColorRgb(i);
		const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best;
}

const toHex = (n: number): string => n.toString(16).padStart(2, "0");

/**
 * Blend two colors (0 = a, 1 = b). When both inputs are palette indices the
 * result is re-encoded to the nearest index; otherwise an RGB hex string.
 */
export function blend256(a: Color, b: Color, t: number): Color {
	const [ar, ag, ab] = decodeColorRgb(a);
	const [br, bg_, bb] = decodeColorRgb(b);
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg_ - ag) * t);
	const bl = Math.round(ab + (bb - ab) * t);
	if (typeof a === "number" && typeof b === "number") return rgbToNearest256(r, g, bl);
	return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

// ---------------------------------------------------------------------------
// Theme token mapping
// ---------------------------------------------------------------------------

export interface ThemeColorSets {
	fgColors: Record<string, Color>;
	bgColors: Record<string, Color>;
}

/**
 * Map style colors onto pi's 51 foreground theme tokens + background tokens.
 * toolSuccessBg / toolErrorBg are subtle blends of the bar background toward
 * the ok/err colors (mirrors the static themes/p10k.json look).
 */
export function themeColorsFromStyle(style: P10kStyle): ThemeColorSets {
	const c = style.colors;
	const bgBar = c.bgBar;
	return {
		fgColors: {
			accent: c.dirAnchor,
			border: 238,
			borderAccent: c.dirAnchor,
			borderMuted: bgBar,
			success: c.ok,
			error: c.err,
			warning: c.modified,
			muted: c.meta,
			dim: c.fgSep,
			text: "",
			thinkingText: c.meta,
			searchMatchText: "",
			userMessageText: "",
			customMessageText: "",
			customMessageLabel: c.dirAnchor,
			toolTitle: c.dirAnchor,
			toolOutput: "",
			mdHeading: c.dirAnchor,
			mdLink: c.dirAnchor,
			mdLinkUrl: c.meta,
			mdCode: c.ok,
			mdCodeBlock: "",
			mdCodeBlockBorder: bgBar,
			mdQuote: c.meta,
			mdQuoteBorder: c.fgSep,
			mdHr: c.fgSep,
			mdListBullet: c.meta,
			toolDiffAdded: c.ok,
			toolDiffRemoved: c.err,
			toolDiffContext: c.meta,
			syntaxComment: c.meta,
			syntaxKeyword: c.dirAnchor,
			syntaxFunction: c.ok,
			syntaxVariable: c.modified,
			syntaxString: c.ok,
			syntaxNumber: c.dirShort,
			syntaxType: c.dirAnchor,
			syntaxOperator: c.dirShort,
			syntaxPunctuation: c.meta,
			thinkingOff: c.thinking.off,
			thinkingMinimal: c.thinking.minimal,
			thinkingLow: c.thinking.low,
			thinkingMedium: c.thinking.medium,
			thinkingHigh: c.thinking.high,
			thinkingXhigh: c.thinking.xhigh,
			thinkingMax: c.thinking.max,
			bashMode: c.modified,
		},
		bgColors: {
			selectedBg: bgBar,
			scrollbarThumb: bgBar,
			searchMatchBg: bgBar,
			userMessageBg: bgBar,
			customMessageBg: bgBar,
			toolPendingBg: bgBar,
			toolSuccessBg: blend256(bgBar, c.ok, 0.18),
			toolErrorBg: blend256(bgBar, c.err, 0.22),
		},
	};
}

/** Detect a ColorMode-ish value for Theme construction from the environment. */
export function detectColorMode(): "truecolor" | "256color" {
	const ct = process.env.COLORTERM ?? "";
	const term = process.env.TERM ?? "";
	if (ct.includes("truecolor") || term.includes("truecolor") || ct === "24bit") return "truecolor";
	return "256color";
}

/**
 * Build a runtime Theme from the resolved style, or null when the Theme class
 * is unavailable (never throws — callers fall back to the static theme).
 */
export function buildThemeFromStyle(style: P10kStyle, mode: "truecolor" | "256color" = detectColorMode()): Theme | null {
	try {
		const { fgColors, bgColors } = themeColorsFromStyle(style);
		// ColorMode is not part of pi's public surface; recover it structurally.
		type ThemeCtor = typeof Theme;
		type ModeParam = ConstructorParameters<ThemeCtor>[2];
		return new Theme(
			fgColors as ConstructorParameters<ThemeCtor>[0],
			bgColors as ConstructorParameters<ThemeCtor>[1],
			mode as ModeParam,
			{ name: "p10k-dynamic" },
		);
	} catch {
		return null;
	}
}
