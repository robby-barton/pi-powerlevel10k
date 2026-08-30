/**
 * Pure segment builders for the p10k prompt — no pi imports.
 * Width utilities are injectable (local ANSI-aware implementations by default)
 * so everything here is smoke-testable with plain node.
 */

import {
	fgBg,
	leadIn,
	osIcon,
	seg,
	sepThin,
	taper,
	truncateToWidth as localTruncateToWidth,
	visibleWidth as localVisibleWidth,
	type Color,
} from "./ansi.ts";
import type { P10kStyle } from "./style.ts";
import type { GitStatus } from "./git.ts";
import { formatCost, formatTokens } from "./usage.ts";

export interface WidthUtils {
	visibleWidth(s: string): number;
	truncateToWidth(s: string, width: number, ellipsis?: string): string;
}

export const defaultWidthUtils: WidthUtils = {
	visibleWidth: localVisibleWidth,
	truncateToWidth: localTruncateToWidth,
};

/** Everything the prompt bar needs, rebuilt fresh on every render. */
export interface PromptData {
	cwd: string;
	home?: string;
	git: GitStatus | null;
	model?: string;
	/** Thinking level shown next to the model (only when the model supports reasoning). */
	thinkingLevel?: string;
	/** Context usage percent, or null when unknown. */
	ctxPercent: number | null;
	cost: number;
	inputTokens: number;
	outputTokens: number;
	agentsDone: number;
	agentsTotal: number;
	/** True when the last assistant message ended in error. */
	error: boolean;
}

/** A multi-color piece within one bar segment. */
interface Piece {
	fg: Color;
	text: string;
	bold?: boolean;
}

/** A padded multi-color segment on the bar background. */
function barJoin(items: (Piece | string)[], style: P10kStyle): string {
	if (items.length === 0) return "";
	const bgBar = style.colors.bgBar;
	const out: string[] = [];
	for (const item of items) {
		out.push(typeof item === "string" ? item : fgBg(item.fg, bgBar, item.text, item.bold));
	}
	const pad = (p: Piece): string => fgBg(p.fg, bgBar, " ");
	const first = items[0];
	const last = items[items.length - 1];
	return (
		pad(typeof first === "string" ? { fg: style.colors.meta, text: " " } : first) +
		out.join("") +
		pad(typeof last === "string" ? { fg: style.colors.meta, text: " " } : last)
	);
}

/** Directory segment: ~-collapse, long-path shortening, anchored last component. */
export function buildDirSegment(cwd: string, home: string | undefined, style: P10kStyle): string {
	let display = cwd;
	if (home) {
		const h = home.replace(/\/+$/, "");
		if (h && (cwd === h || cwd.startsWith(`${h}/`))) display = `~${cwd.slice(h.length)}`;
	}
	const raw = display.replace(/^\//, "").split("/").filter((c) => c.length > 0);
	if (raw.length === 0) raw.push(display === "/" ? "/" : ".");

	const { dirDefault, dirShort, dirAnchor } = style.colors;
	const pieces: Piece[] = [{ fg: dirDefault, text: style.icons.dir }];
	const shorten = localVisibleWidth(display) > style.dirShortenThreshold && raw.length > 2;
	raw.forEach((comp, i) => {
		const isLast = i === raw.length - 1;
		if (i > 0) pieces.push({ fg: dirDefault, text: "/" });
		if (shorten && i !== 0 && !isLast) {
			pieces.push({ fg: dirShort, text: Array.from(comp)[0] ?? comp });
		} else if (isLast) {
			pieces.push({ fg: dirAnchor, text: comp, bold: style.dirAnchorBold });
		} else {
			pieces.push({ fg: dirDefault, text: comp });
		}
	});
	return barJoin(pieces, style);
}

/** Git segment: branch (or detached oid) + ahead/behind/stash/staged/dirty meta. */
export function buildGitSegment(git: GitStatus, style: P10kStyle): string {
	const { branch, modified, untracked, conflicted } = style.colors;
	let branchText: string;
	if (git.branch) {
		let branchName = git.branch;
		const max = style.branchMaxWidth;
		if (branchName.length > max) {
			const head = Math.floor(max / 2) - 0;
			const tail = max - head - 1;
			branchName = branchName.slice(0, head) + "…" + branchName.slice(branchName.length - tail);
		}
		branchText = `${style.icons.git} ${branchName}`;
	} else {
		branchText = `${style.icons.detached} ${(git.oid ?? "").slice(0, 7)}`;
	}

	const meta: Piece[] = [];
	if (git.behind) meta.push({ fg: branch, text: `⇣${git.behind}` });
	if (git.ahead) meta.push({ fg: branch, text: `⇡${git.ahead}` });
	if (git.stashes) meta.push({ fg: branch, text: `*${git.stashes}` });
	if (git.staged) meta.push({ fg: branch, text: `+${git.staged}` });
	if (git.unstaged) meta.push({ fg: modified, text: `!${git.unstaged}` });
	if (git.untracked) meta.push({ fg: untracked, text: `?${git.untracked}` });
	if (git.conflicted) meta.push({ fg: conflicted, text: `✘${git.conflicted}` });

	const items: (Piece | string)[] = [{ fg: branch, text: branchText }];
	if (meta.length > 0) {
		items.push(sepThin(style.colors.fgSep, style.colors.bgBar));
		for (const m of meta) {
			items.push(m);
			if (m !== meta[meta.length - 1]) items.push(sepThin(style.colors.fgSep, style.colors.bgBar));
		}
	}
	return barJoin(items, style);
}

/** Right-side segments in display order: [model, ctx, cost, tokens, agents]. */
export function buildRightSegments(
	data: PromptData,
	style: P10kStyle,
): Array<{ name: string; text: string }> {
	const segs: Array<{ name: string; text: string }> = [];
	// model (+ thinking level when applicable)
	const modelPieces: Piece[] = [{ fg: style.colors.model, text: `${style.icons.model} ${data.model || "no-model"}` }];
	if (data.thinkingLevel) {
		const levelFg =
			style.colors.thinking[data.thinkingLevel as keyof typeof style.colors.thinking] ?? style.colors.meta;
		modelPieces.push({ fg: levelFg, text: ` ${data.thinkingLevel}` });
	}
	segs.push({ name: "model", text: barJoin(modelPieces, style) });
	// context usage
	if (data.ctxPercent === null) {
		segs.push({ name: "context", text: barJoin([{ fg: style.colors.ctx, text: `${style.icons.ctx} ?` }], style) });
	} else {
		const fgN =
			data.ctxPercent > style.ctxErrPct
				? style.colors.ctxErr
				: data.ctxPercent > style.ctxWarnPct
					? style.colors.ctxWarn
					: style.colors.ctx;
		segs.push({
			name: "context",
			text: barJoin([{ fg: fgN, text: `${style.icons.ctx} ${Math.round(data.ctxPercent)}%` }], style),
		});
	}
	// cost
	if (data.cost > 0) {
		segs.push({
			name: "cost",
			text: barJoin([{ fg: style.colors.cost, text: `${style.icons.cost} ${formatCost(data.cost)}` }], style),
		});
	}
	// tokens
	if (data.inputTokens > 0 || data.outputTokens > 0) {
		segs.push({
			name: "tokens",
			text: barJoin(
				[
					{ fg: style.colors.tokens, text: `↑${formatTokens(data.inputTokens)} ↓${formatTokens(data.outputTokens)}` },
				],
				style,
			),
		});
	}
	// subagents
	if (data.agentsTotal > 0) {
		if (data.agentsDone < data.agentsTotal) {
			segs.push({
				name: "agents",
				text: barJoin([{ fg: style.colors.agents, text: `${style.icons.robot} ${data.agentsDone}/${data.agentsTotal}` }], style),
			});
		} else {
			segs.push({
				name: "agents",
				text: barJoin([{ fg: style.colors.meta, text: `${style.icons.robot} ${data.agentsTotal}/${data.agentsTotal} done` }], style),
			});
		}
	}
	return segs;
}

/**
 * Compose the prompt bar line:
 *   left powerline bar (per style.leftSegments) + right-aligned right bar
 *
 * (The prompt char is rendered by P10kEditor on the editor's cursor
 * line — see editor.ts.)
 *
 * Overflow handling: drop right segments in style.dropOrder order until they
 * fit, then drop the git segment; final ANSI-aware truncate guards the rest.
 */
export function composePrompt(
	width: number,
	data: PromptData,
	style: P10kStyle,
	utils: WidthUtils = defaultWidthUtils,
): string[] {
	const bgBar = style.colors.bgBar;
	const leftNamed: Array<{ name: string; text: string }> = [];
	for (const name of style.leftSegments) {
		if (name === "os") {
			leftNamed.push({ name, text: seg(bgBar, style.colors.os, osIcon(style.icons)) });
		} else if (name === "dir") {
			leftNamed.push({ name, text: buildDirSegment(data.cwd, data.home, style) });
		} else if (name === "vcs") {
			if (data.git) leftNamed.push({ name, text: buildGitSegment(data.git, style) });
		}
	}
	const hasVcs = leftNamed.some((p) => p.name === "vcs");
	const leftPrefix = leftNamed
		.map((p) => p.text)
		.join(sepThin(style.colors.fgSep, bgBar));
	const leftBase = leftPrefix + taper(bgBar);

	const buildRight = (segs: string[]): string => (segs.length > 0 ? leadIn(bgBar) + segs.join(sepThin(style.colors.fgSep, bgBar)) : "");
	const namedSegs = buildRightSegments(data, style);
	const nameToText = new Map(namedSegs.map((s) => [s.name, s.text]));
	const rightSegs = style.rightSegments.map((n) => nameToText.get(n)).filter((s): s is string => s !== undefined);
	let left = leftBase;
	let right = buildRight(rightSegs);

	if (utils.visibleWidth(left) + 1 + utils.visibleWidth(right) > width) {
		// Drop right segments one at a time in style.dropOrder order.
		const kept = [...style.rightSegments];
		const keptText = new Map(nameToText);
		for (const dropName of style.dropOrder) {
			if (!kept.includes(dropName)) continue;
			kept.splice(kept.indexOf(dropName), 1);
			keptText.delete(dropName);
			const candidate = kept.map((n) => keptText.get(n)).filter((s): s is string => s !== undefined);
			right = buildRight(candidate);
			if (utils.visibleWidth(left) + 1 + utils.visibleWidth(right) <= width) break;
		}
		if (hasVcs && utils.visibleWidth(left) + 1 + utils.visibleWidth(right) > width) {
			left =
				leftNamed
					.filter((p) => p.name !== "vcs")
					.map((p) => p.text)
					.join(sepThin(style.colors.fgSep, bgBar)) + taper(bgBar);
		}
	}

	const leftW = utils.visibleWidth(left);
	const rightW = utils.visibleWidth(right);
	const pad = Math.max(0, width - leftW - rightW);
	const line1 = utils.truncateToWidth(left + " ".repeat(pad) + right, width, "");
	return [line1];
}
