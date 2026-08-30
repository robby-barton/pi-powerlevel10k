/**
 * Raw 256-color ANSI helpers for the p10k prompt.
 *
 * Theme.fg only accepts the 51 named theme tokens, so exact powerlevel10k
 * fidelity needs our own SGR escapes. Every helper emits exactly ONE SGR
 * opener followed by one `\x1b[0m` reset — no nesting — so strings compose
 * safely by plain concatenation.
 *
 * Pure module: no pi imports, so it is smoke-testable with plain node.
 */

/**
 * A segment color: a 256-color palette index or an RGB hex string ("#rrggbb").
 */
export type Color = number | string;

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/** SGR parameters for a foreground color (truecolor for hex, 256-color for indices). */
function fgParams(color: Color): string {
	if (typeof color === "number") return `38;5;${color}`;
	const m = HEX_RE.exec(color);
	if (!m) return `38;5;${color}`; // fall back to raw index string
	const r = Number.parseInt(m[1].slice(0, 2), 16);
	const g = Number.parseInt(m[1].slice(2, 4), 16);
	const b = Number.parseInt(m[1].slice(4, 6), 16);
	return `38;2;${r};${g};${b}`;
}

/** SGR parameters for a background color. */
function bgParams(color: Color): string {
	if (typeof color === "number") return `48;5;${color}`;
	const m = HEX_RE.exec(color);
	if (!m) return `48;5;${color}`;
	const r = Number.parseInt(m[1].slice(0, 2), 16);
	const g = Number.parseInt(m[1].slice(2, 4), 16);
	const b = Number.parseInt(m[1].slice(4, 6), 16);
	return `48;2;${r};${g};${b}`;
}

/** 256-color palette indices used by the p10k segments (style defaults). */
export const C = {
	bgBar: 236,
	fgSep: 244,
	os: 255,
	dirAnchor: 39,
	dirShort: 103,
	dirDefault: 31,
	branch: 76,
	meta: 246,
	modified: 178,
	untracked: 39,
	conflicted: 196,
	ok: 76,
	err: 196,
	model: 103,
	ctx: 248,
	ctxWarn: 178,
	ctxErr: 196,
	cost: 37,
	tokens: 246,
	agents: 178,
	// Thinking-level gradient (matches pi's editor border progression).
	thinking: { off: 236, minimal: 238, low: 244, medium: 248, high: 103, xhigh: 178, max: 196 },
} as const;

/** Nerd Font glyphs used by the p10k segments. */
export const ICON = {
	osLinux: "\uF17C",
	osMac: "\uF179",
	dir: "\uF07C",
	git: "\uF126",
	detached: "\uF417",
	model: "\uF2DB",
	ctx: "\uF49B",
	cost: "\uF155",
	up: "\uF062",
	down: "\uF063",
	robot: "\uF544",
	sepRight: "\uE0B0",
	sepLeft: "\uE0B2",
	sepThin: "\uE0B1",
	prompt: "❯",
} as const;

const RESET = "\x1b[0m";

/** Foreground color: single SGR opener (bold folded in) + text + one reset. */
export function fg(n: Color, s: string, bold = false): string {
	return `\x1b[${fgParams(n)}${bold ? ";1" : ""}m${s}${RESET}`;
}

/** Foreground + background color: single SGR opener (bold folded in) + text + one reset. */
export function fgBg(n: Color, bg: Color, s: string, bold = false): string {
	return `\x1b[${fgParams(n)};${bgParams(bg)}${bold ? ";1" : ""}m${s}${RESET}`;
}

/** A padded powerline segment on the bar background. */
export function seg(bgBar: Color, fgN: Color, s: string, bold = false): string {
	return fgBg(fgN, bgBar, ` ${s} `, bold);
}

/** Thin separator between two segments on the bar. */
export function sepThin(fgSep: Color, bgBar: Color): string {
	return fgBg(fgSep, bgBar, ICON.sepThin);
}

/** Right-pointing powerline taper that closes the left bar. */
export function taper(bgBar: Color): string {
	return fg(bgBar, ICON.sepRight);
}

/** Left-pointing powerline taper that opens the right bar. */
export function leadIn(bgBar: Color): string {
	return fg(bgBar, ICON.sepLeft);
}

/** OS glyph via process.platform (linux → linux icon, darwin → apple, else linux). */
export function osIcon(icons: { osMac: string; osLinux: string } = ICON): string {
	return process.platform === "darwin" ? icons.osMac : icons.osLinux;
}

/** Remove SGR escape sequences. */
export function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Visible width in terminal columns (code points after stripping ANSI). */
export function visibleWidth(s: string): number {
	return Array.from(stripAnsi(s)).length;
}

const SGR_RE = /\x1b\[[0-9;]*m/;

/** ANSI-aware truncation to `width` visible columns, appending `ellipsis` when cut. */
export function truncateToWidth(text: string, width: number, ellipsis = ""): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	const ellWidth = visibleWidth(ellipsis);
	const limit = Math.max(0, width - ellWidth);
	let out = "";
	let count = 0;
	let i = 0;
	while (i < text.length && count < limit) {
		if (text[i] === "\x1b") {
			const m = SGR_RE.exec(text.slice(i));
			if (m) {
				out += m[0];
				i += m[0].length;
				continue;
			}
		}
		const cp = text.codePointAt(i) ?? 0;
		const len = cp > 0xffff ? 2 : 1;
		out += text.slice(i, i + len);
		count += 1;
		i += len;
	}
	out += ellipsis;
	// Keep lines ANSI-balanced: never end inside an open color.
	if (out.includes("\x1b") && !out.endsWith(RESET)) out += RESET;
	return out;
}
