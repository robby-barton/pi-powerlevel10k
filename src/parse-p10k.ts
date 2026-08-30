/**
 * Parser for powerlevel10k config files (~/.p10k.zsh).
 *
 * Pure module: no pi imports, never throws. Extracts the subset of p10k
 * parameters this package honors (colors, icons, separators, git formatter
 * locals) plus enough structure to report what was found/skipped.
 *
 * Design notes:
 * - Line-based with a quote-aware comment stripper (`#` inside quotes is text).
 * - Multi-line arrays accumulate until the matching `)` (quote-aware depth count).
 * - Brace expansion `{A,B}` is expanded in NAMES only (values kept raw).
 * - `\uXXXX` and `\u{...}` escapes are unescaped in quoted scalar values.
 * - Git formatter `local meta='%246F'` lines are collected separately;
 *   LAST match wins (the stock config re-assigns these in both branches of
 *   an `if`, and zsh semantics make the later assignment authoritative).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type P10kVar = { kind: "scalar"; value: string } | { kind: "array"; value: string[] };

export type GitFormatterKey = "meta" | "clean" | "modified" | "untracked" | "conflicted";

export interface P10kParsed {
	/** All recognized `typeset -g NAME=VALUE` / `NAME=(...)` assignments. */
	vars: Record<string, P10kVar>;
	/** `local <key>='%NNNF'` colors extracted from the git formatter function. */
	gitFormatter: Partial<Record<GitFormatterKey, number>>;
	/** Non-empty lines that were not recognized as assignments or formatter locals. */
	skippedLines: number;
}

export interface P10kPathResult {
	path: string;
	source: "setting" | "env" | "default";
}

export interface P10kLoadResult {
	parsed: P10kParsed | null;
	path: string | null;
	source?: P10kPathResult["source"];
	error?: string;
}

// ---------------------------------------------------------------------------
// Comment stripping (quote-aware)
// ---------------------------------------------------------------------------

/** Strip a `#` comment that is outside of single/double quotes. */
function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === "\\") {
				i++; // skip escaped char inside double quotes
				continue;
			}
			if (ch === '"') inDouble = false;
			continue;
		}
		if (ch === "'") inSingle = true;
		else if (ch === '"') inDouble = true;
		else if (ch === "#") return line.slice(0, i);
	}
	return line;
}

// ---------------------------------------------------------------------------
// Unescaping
// ---------------------------------------------------------------------------

/** Unescape `\uXXXX` and `\u{...}` sequences (p10k passes glyphs this way). */
export function unescapeZsh(value: string): string {
	return value.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (_m, braced, plain) => {
		const hex = braced ?? plain;
		const code = Number.parseInt(hex, 16);
		if (!Number.isFinite(code) || code > 0x10ffff) return _m;
		try {
			return String.fromCodePoint(code);
		} catch {
			return _m;
		}
	});
}

// ---------------------------------------------------------------------------
// Brace expansion (names only)
// ---------------------------------------------------------------------------

/** Expand a single level of `{a,b,c}` in a parameter name. */
export function expandBraces(name: string): string[] {
	const m = /\{([^{}]*,[^{}]*)\}/.exec(name);
	if (!m) return [name];
	const prefix = name.slice(0, m.index);
	const suffix = name.slice(m.index + m[0].length);
	return m[1].split(",").flatMap((alt) => expandBraces(`${prefix}${alt}${suffix}`));
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/** Parse a scalar value: quoted strings are unwrapped (and \u-unescaped), raw values trimmed. */
function parseScalarValue(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("'")) {
		const end = trimmed.indexOf("'", 1);
		if (end !== -1) return unescapeZsh(trimmed.slice(1, end));
		return unescapeZsh(trimmed.slice(1));
	}
	if (trimmed.startsWith('"')) {
		const end = trimmed.indexOf('"', 1);
		if (end !== -1) return unescapeZsh(trimmed.slice(1, end));
		return unescapeZsh(trimmed.slice(1));
	}
	return trimmed;
}

/** Split array item text on whitespace outside quotes; unwrap per-item quotes. */
function splitArrayItems(text: string): string[] {
	const items: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	const flush = (): void => {
		if (current.length > 0) items.push(current);
		current = "";
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			else current += ch;
			continue;
		}
		if (inDouble) {
			if (ch === "\\") {
				current += text[i + 1] ?? "";
				i++;
				continue;
			}
			if (ch === '"') inDouble = false;
			else current += ch;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
	}
	flush();
	return items;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

const NAME_CHARS = "[A-Za-z0-9_{},]";
const TYPESET_RE = new RegExp(`^typeset\\s+[-a-zA-Z]+\\s+(${NAME_CHARS}+)\\s*=\\s*(.*)$`);
const GIT_LOCAL_RE = /^local\s+(meta|clean|modified|untracked|conflicted)\s*=\s*'?(?:%(\d{1,3})F)'?\s*$/;

/**
 * Parse a p10k config file's text. Never throws.
 *
 * gitFormatter extraction: `local <key>='%NNNF'` (or unquoted) — LAST match
 * per key wins, mirroring zsh's later-assignment-wins semantics.
 */
export function parseP10kConfig(text: string): P10kParsed {
	const result: P10kParsed = { vars: {}, gitFormatter: {}, skippedLines: 0 };
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = stripComment(lines[i]).trim();
		if (line.length === 0) continue;

		// Git formatter locals: `local meta='%246F'` — first match per key wins.
		// p10k's stock formatter defines the clean/up-to-date palette first and
		// the stale/loading palette in a fallback branch; the clean colors are
		// what users actually see, so keep the first assignment per key.
		const localMatch = GIT_LOCAL_RE.exec(line);
		if (localMatch) {
			const n = Number.parseInt(localMatch[2], 10);
			if (Number.isFinite(n) && result.gitFormatter[localMatch[1] as GitFormatterKey] === undefined) {
				result.gitFormatter[localMatch[1] as GitFormatterKey] = n;
			}
			continue;
		}

		const typeset = TYPESET_RE.exec(line);
		if (!typeset) {
			result.skippedLines++;
			continue;
		}

		const rawValue = typeset[2].trim();
		// Multi-line array: opening paren not closed on the same line.
		if (rawValue.startsWith("(") && !balancedOnLine(rawValue)) {
			let buffer = rawValue.slice(1);
			let depth = 1;
			i++;
			for (; i < lines.length && depth > 0; i++) {
				const cont = stripComment(lines[i]).trim();
				for (const ch of cont) {
					if (ch === "(") depth++;
					else if (ch === ")") depth--;
				}
				if (depth > 0) buffer += `\n${cont}`;
				else {
					const close = cont.lastIndexOf(")");
					buffer += `\n${cont.slice(0, close === -1 ? cont.length : close)}`;
				}
			}
			i--; // for-loop will advance past the closing line
			const items = splitArrayItems(buffer);
			for (const name of expandBraces(typeset[1])) {
				result.vars[name] = { kind: "array", value: items };
			}
			continue;
		}

		// Same-line value: scalar or single-line array.
		if (rawValue.startsWith("(")) {
			const close = rawValue.lastIndexOf(")");
			const inner = close === -1 ? rawValue.slice(1) : rawValue.slice(1, close);
			for (const name of expandBraces(typeset[1])) {
				result.vars[name] = { kind: "array", value: splitArrayItems(inner) };
			}
			continue;
		}

		const value = parseScalarValue(rawValue);
		for (const name of expandBraces(typeset[1])) {
			result.vars[name] = { kind: "scalar", value };
		}
	}
	return result;
}

/** True when parens in `s` are balanced (quote-aware). */
function balancedOnLine(s: string): boolean {
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === "\\") i++;
			else if (ch === '"') inDouble = false;
			continue;
		}
		if (ch === "'") inSingle = true;
		else if (ch === '"') inDouble = true;
		else if (ch === "(") depth++;
		else if (ch === ")") depth--;
	}
	return depth <= 0;
}

// ---------------------------------------------------------------------------
// Path resolution + loading
// ---------------------------------------------------------------------------

/**
 * Resolve the p10k config path:
 *   explicit setting → $P10K_CONFIG_FILE → $POWERLEVEL9K_CONFIG_FILE → ~/.p10k.zsh
 *
 * (The stock config sets POWERLEVEL9K_CONFIG_FILE internally via parameter
 * expansion — that in-file value is intentionally ignored; only the process
 * environment is consulted.)
 */
export function resolveP10kPath(userOverride?: string | null): P10kPathResult | null {
	if (userOverride && userOverride.trim().length > 0) {
		return { path: userOverride.trim(), source: "setting" };
	}
	const env = process.env.P10K_CONFIG_FILE ?? process.env.POWERLEVEL9K_CONFIG_FILE;
	if (env && env.trim().length > 0) return { path: env.trim(), source: "env" };
	return { path: join(homedir(), ".p10k.zsh"), source: "default" };
}

/** Resolve + read + parse. Never throws; missing/unreadable files yield `parsed: null`. */
export function loadP10kParsed(userOverride?: string | null): P10kLoadResult {
	let resolved: P10kPathResult | null = null;
	try {
		resolved = resolveP10kPath(userOverride);
	} catch {
		resolved = null;
	}
	if (!resolved) return { parsed: null, path: null };
	try {
		const text = readFileSync(resolved.path, "utf8");
		return { parsed: parseP10kConfig(text), path: resolved.path, source: resolved.source };
	} catch (err) {
		return {
			parsed: null,
			path: resolved.path,
			source: resolved.source,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
