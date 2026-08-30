/**
 * Package configuration (`"p10kPrompt"` key in pi settings.json).
 *
 * Sources: global ~/.pi/agent/settings.json + project .pi/settings.json
 * (project wins, defaults underneath). Malformed files never throw —
 * defaults are returned instead.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PkgConfig {
	/** Explicit path to the p10k config; null → env vars → ~/.p10k.zsh. */
	p10kConfigPath: string | null;
	/** Apply a dynamically generated theme: "auto" (default) | "on" | "off". */
	applyTheme: "auto" | "on" | "off";
	/** Register the two-line powerline prompt widget above the editor. */
	widget: boolean;
	/** Replace the built-in editor with the p10k prompt-char editor. */
	editor: boolean;
	/** Show session name / extension statuses in the p10k footer line. */
	footer: boolean;
	/** Glyph for the prompt char (❯). Overridden by the p10k config unless changed. */
	promptChar: string;
	/** Editor left padding columns; column 1 becomes the prompt glyph. */
	editorPaddingX: number;
	/** Left bar segments in display order (subset of: os, dir, vcs). */
	leftSegments: string[];
	/** Right bar segments in display order. */
	rightSegments: string[];
	/** Context-usage percent above which the ctx segment turns warn-colored. */
	contextWarnPct: number;
	/** Context-usage percent above which the ctx segment turns error-colored. */
	contextErrorPct: number;
	/** Right-segment drop order on narrow terminals. */
	dropOrder: string[];
	/** Show the thinking level next to the model. */
	showThinkingLevel: boolean;
	/** Shorten directory display when longer than this many columns. */
	dirShortenThreshold: number;
	/** Truncate git branch names to this many characters. */
	branchMaxWidth: number;
	/** Color overrides keyed by P10kStyle color name ("thinking.high" etc.). */
	colors: Record<string, number | string>;
	/** Icon overrides keyed by P10kStyle icon name. */
	icons: Record<string, string>;
}

export const DEFAULT_CONFIG: PkgConfig = {
	p10kConfigPath: null,
	applyTheme: "auto",
	widget: true,
	editor: true,
	footer: true,
	promptChar: "❯",
	editorPaddingX: 2,
	leftSegments: ["os", "dir", "vcs"],
	rightSegments: ["model", "context", "cost", "tokens", "agents"],
	contextWarnPct: 70,
	contextErrorPct: 90,
	dropOrder: ["agents", "tokens", "cost", "context", "model"],
	showThinkingLevel: true,
	dirShortenThreshold: 80,
	branchMaxWidth: 32,
	colors: {},
	icons: {},
};

function readSettingsObject(path: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/** Shallow merge: project wins over global, defaults underneath. Never throws. */
export function mergeConfig(
	...sources: Array<Record<string, unknown> | null | undefined>
): PkgConfig {
	const merged: Record<string, unknown> = { ...DEFAULT_CONFIG };
	for (const src of sources) {
		if (!src) continue;
		for (const [key, value] of Object.entries(src)) {
			if (!(key in DEFAULT_CONFIG)) continue;
			if (value === undefined) continue;
			merged[key] = value;
		}
	}
	return merged as unknown as PkgConfig;
}

/** Load the effective package config for a session. Never throws. */
export function loadPkgConfig(ctx: { cwd: string }): PkgConfig {
	const globalSettings = readSettingsObject(join(getAgentDir(), "settings.json"));
	const projectSettings = readSettingsObject(join(ctx.cwd, ".pi", "settings.json"));
	const globalP10k =
		globalSettings && typeof globalSettings.p10kPrompt === "object" && globalSettings.p10kPrompt !== null
			? (globalSettings.p10kPrompt as Record<string, unknown>)
			: null;
	const projectP10k =
		projectSettings && typeof projectSettings.p10kPrompt === "object" && projectSettings.p10kPrompt !== null
			? (projectSettings.p10kPrompt as Record<string, unknown>)
			: null;
	return mergeConfig(globalP10k, projectP10k);
}

/**
 * Read the effective "theme" setting (global ← project override), or
 * undefined when unset / unreadable. Used by applyTheme "auto".
 */
export function readThemeSetting(ctx: { cwd: string }): string | undefined {
	const globalSettings = readSettingsObject(join(getAgentDir(), "settings.json"));
	const projectSettings = readSettingsObject(join(ctx.cwd, ".pi", "settings.json"));
	const project = typeof projectSettings?.theme === "string" ? projectSettings.theme : undefined;
	if (project !== undefined) return project;
	return typeof globalSettings?.theme === "string" ? globalSettings.theme : undefined;
}
