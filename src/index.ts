/**
 * pi-powerlevel10k — powerlevel10k-style prompt for pi.
 *
 * Replaces the built-in footer (required for footerData.onBranchChange) and
 * registers a two-line powerline prompt widget above the editor:
 *
 *   ⌘  ~/projects/pi  branch ⇣1 ⇡2 !3 ?1  |  model 54% $0.123 ↑45k ↓1.2k
 *   ❯
 *
 * The ❯ line is a separate widget line above the editor; the aboveEditor
 * placement already supplies the leading blank line.
 *
 * Unlike the stock setup, colors/icons/prompt-char are extracted from the
 * user's ~/.p10k.zsh (see parse-p10k.ts + style.ts) and a matching TUI theme
 * is generated at runtime (see theme-gen.ts). Behavior is tunable via the
 * "p10kPrompt" key in settings.json (see config.ts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GitCache } from "./git.ts";
import type { Color } from "./ansi.ts";
import { PendingUsageQueue, computeUsageFromEntries, type UsageLike, type UsageTotals } from "./usage.ts";
import { P10kPromptComponent } from "./prompt-widget.ts";
import { P10kEditor } from "./editor.ts";
import { makeP10kFooter, type P10kFooterState } from "./footer.ts";
import type { PromptData } from "./segments.ts";
import { loadP10kParsed, type P10kParsed } from "./parse-p10k.ts";
import { loadPkgConfig, readThemeSetting, type PkgConfig } from "./config.ts";
import { resolveStyle, type P10kStyle } from "./style.ts";
import { buildThemeFromStyle } from "./theme-gen.ts";
import { handleP10kCommand } from "./command.ts";

interface SubagentProgress {
	total: number;
	done: number;
}

interface P10kState extends P10kFooterState {
	gitCache?: GitCache;
	pendingUsage: PendingUsageQueue;
	subagents: Map<string, SubagentProgress>;
	lastSummary?: { done: number; total: number; failed: boolean };
	requestRender?: () => void;
	cfg: PkgConfig;
	parsed: P10kParsed | null;
	p10kPath: string | null;
	p10kSource?: string;
	p10kError?: string;
	style: P10kStyle;
}

/** Emitted once per process (reload notifies explicitly). */
let statusAnnounced = false;

function entriesOf(ctx: ExtensionContext): unknown[] {
	try {
		return ctx.sessionManager.getEntries();
	} catch {
		return [];
	}
}

/** Build fresh PromptData — called on every widget render, nothing cached. */
function getData(ctx: ExtensionContext, state: P10kState): PromptData {
	const entries = entriesOf(ctx);
	const totals: UsageTotals = computeUsageFromEntries(entries);
	state.pendingUsage.mergeInto(totals, entries);

	let agentsDone = 0;
	let agentsTotal = 0;
	if (state.lastSummary) {
		agentsDone = state.lastSummary.done;
		agentsTotal = state.lastSummary.total;
	} else if (state.subagents.size > 0) {
		for (const progress of state.subagents.values()) {
			agentsTotal += progress.total;
			agentsDone += progress.done;
		}
	}

	// Error flag: scan the current branch backwards for the last assistant message.
	let error = false;
	try {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type?: unknown; message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } };
			if (entry?.type === "message" && entry.message?.role === "assistant") {
				error = entry.message.stopReason === "error" || Boolean(entry.message.errorMessage);
				break;
			}
		}
	} catch {
		// Session manager unavailable — treat as no error.
	}

	let ctxPercent: number | null = null;
	try {
		ctxPercent = ctx.getContextUsage()?.percent ?? null;
	} catch {
		ctxPercent = null;
	}

	return {
		cwd: ctx.cwd,
		home: process.env.HOME ?? process.env.USERPROFILE,
		git: state.gitCache?.get() ?? null,
		model: ctx.model?.id,
		thinkingLevel:
			state.cfg.showThinkingLevel &&
			(ctx.model as { reasoning?: unknown } | undefined)?.reasoning
				? ctx.thinkingLevel
				: undefined,
		ctxPercent,
		cost: totals.cost,
		inputTokens: totals.input,
		outputTokens: totals.output,
		agentsDone,
		agentsTotal,
		error,
	};
}

/** Re-read settings, re-parse the p10k config, rebuild style. Never throws. */
function reloadAll(ctx: ExtensionContext, state: P10kState): { path: string | null; vars: number; error?: string } {
	try {
		state.cfg = loadPkgConfig(ctx);
		const res = loadP10kParsed(state.cfg.p10kConfigPath);
		state.parsed = res.parsed;
		state.p10kPath = res.path ?? state.cfg.p10kConfigPath;
		state.p10kSource = res.source;
		state.p10kError = res.error;
		state.style = resolveStyle(res.parsed, state.cfg);
		return { path: state.p10kPath, vars: res.parsed ? Object.keys(res.parsed.vars).length : 0, error: res.error };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		state.p10kError = message;
		return { path: state.p10kPath, vars: 0, error: message };
	}
}

/** Apply the dynamically generated theme when configured to (TUI only). */
function applyThemeIfNeeded(ctx: ExtensionContext, state: P10kState): void {
	try {
		if (ctx.mode !== "tui") return;
		const mode = state.cfg.applyTheme;
		let should: boolean;
		if (mode === "on") should = true;
		else if (mode === "off") should = false;
		else should = state.parsed !== null && [undefined, "p10k"].includes(readThemeSetting(ctx));
		if (!should) return;
		const theme = buildThemeFromStyle(state.style);
		if (theme) ctx.ui.setTheme(theme);
	} catch {
		// Theme application is best-effort; never break startup.
	}
}

export default function (pi: ExtensionAPI) {
	const state: P10kState = {
		pendingUsage: new PendingUsageQueue(),
		subagents: new Map(),
		cfg: loadPkgConfig({ cwd: process.cwd() }),
		parsed: null,
		p10kPath: null,
		style: resolveStyle(null, loadPkgConfig({ cwd: process.cwd() })),
	};
	let currentCtx: ExtensionContext | undefined;

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		const reloadResult = reloadAll(ctx, state);

		// Accessors for the custom footer (safe outside TUI too).
		state.getSessionName = () => {
			try {
				return ctx.sessionManager.getSessionName();
			} catch {
				return undefined;
			}
		};

		applyThemeIfNeeded(ctx, state);

		if (!statusAnnounced) {
			statusAnnounced = true;
			try {
				const vars = reloadResult.vars;
				if (reloadResult.error) {
					ctx.ui.notify(
						`p10k prompt: could not read ${reloadResult.path ?? "config"} — ${reloadResult.error} (using defaults)`,
						"warning",
					);
				} else if (state.parsed) {
					ctx.ui.notify(`p10k prompt: ${reloadResult.path} (${state.p10kSource}) — ${vars} vars parsed`, "info");
				} else {
					ctx.ui.notify("p10k prompt: no p10k config found — using defaults", "info");
				}
			} catch {
				// Notifications unavailable — ignore.
			}
		}

		// Widgets are terminal-only; guard non-TUI modes.
		if (ctx.mode !== "tui") return;

		state.gitCache?.dispose();
		const gitCache = new GitCache(ctx.cwd);
		gitCache.setNotify(() => state.requestRender?.());
		state.gitCache = gitCache;

		try {
			ctx.ui.setWidget("p10k-prompt", (tui) => {
				state.requestRender = () => tui.requestRender();
				return new P10kPromptComponent(() => getData(ctx, state), state.style, () => state.requestRender?.());
			});
			if (state.cfg.editor) {
				ctx.ui.setEditorComponent((tui, theme, keybindings) => {
					state.requestRender = () => tui.requestRender();
					return new P10kEditor(tui, theme, keybindings, {
						style: state.style,
						promptChar: state.style.promptChar,
						paddingX: state.cfg.editorPaddingX,
						getPromptColor: (): Color => (getData(ctx, state).error ? state.style.colors.err : state.style.colors.ok),
					});
				});
			}
			// Always registered: the onBranchChange subscription drives git-cache
			// freshness. cfg.footer only controls whether content is rendered.
			ctx.ui.setFooter(makeP10kFooter(state, state.cfg.footer));
		} catch {
			// UI unavailable — skip widget/footer setup rather than breaking startup.
		}
	});

	pi.registerCommand("p10k", {
		description: "p10k prompt: status (default), reload, path",
		handler: (args, ctx) =>
			handleP10kCommand(args, ctx, {
				getPath: () => state.p10kPath,
				getSource: () => state.p10kSource,
				getError: () => state.p10kError,
				getParsed: () => state.parsed,
				getStyle: () => state.style,
				reload: (cmdCtx) => {
					const result = reloadAll(cmdCtx, state);
					applyThemeIfNeeded(cmdCtx, state);
					state.requestRender?.();
					return result;
				},
			}),
	});

	pi.on("message_end", (_event, ctx) => {
		const msg = (_event as { message?: { role?: unknown; usage?: UsageLike } }).message;
		if (!msg) return;
		if (msg.role !== "assistant" && msg.role !== "toolResult") return;
		if (!msg.usage) return;
		// message_end fires before persistence — remember entries length so
		// PendingUsageQueue can detect whether the entry is visible at render time.
		state.pendingUsage.add(msg.usage, entriesOf(ctx).length);
		state.requestRender?.();
	});

	pi.on("session_compact", (event) => {
		const usage = (event.compactionEntry as { usage?: UsageLike } | undefined)?.usage;
		if (!usage) return;
		state.pendingUsage.add(usage, currentCtx ? entriesOf(currentCtx).length : 0);
		state.requestRender?.();
	});

	pi.on("tool_execution_start", (event) => {
		if (event.toolName !== "subagent") return;
		const args = (event.args ?? {}) as { tasks?: unknown[]; chain?: unknown[] };
		const total = args.tasks?.length ?? args.chain?.length ?? 1;
		state.subagents.set(event.toolCallId, { total, done: 0 });
		state.requestRender?.();
	});

	pi.on("tool_execution_update", (event) => {
		if (event.toolName !== "subagent") return;
		const entry = state.subagents.get(event.toolCallId);
		if (!entry) return;
		const results = (event.partialResult as { details?: { results?: Array<{ exitCode?: number }> } } | undefined)
			?.details?.results;
		if (!Array.isArray(results)) return;
		let done = 0;
		for (const r of results) {
			if (r && r.exitCode !== -1) done++;
		}
		entry.done = done;
		entry.total = Math.max(entry.total, results.length);
		state.requestRender?.();
	});

	pi.on("tool_execution_end", (event) => {
		if (event.toolName !== "subagent") return;
		const entry = state.subagents.get(event.toolCallId);
		const total = entry?.total ?? 1;
		state.lastSummary = { done: total, total, failed: event.isError };
		state.subagents.delete(event.toolCallId);
		state.requestRender?.();
	});

	pi.on("turn_start", () => {
		state.lastSummary = undefined;
		state.requestRender?.();
	});

	pi.on("turn_end", () => {
		state.gitCache?.invalidate();
		state.requestRender?.();
	});

	pi.on("model_select", () => {
		state.requestRender?.();
	});

	pi.on("thinking_level_select", () => {
		state.requestRender?.();
	});

	pi.on("session_shutdown", () => {
		state.gitCache?.dispose();
		state.gitCache = undefined;
		state.pendingUsage.clear();
		state.subagents.clear();
		state.lastSummary = undefined;
		state.requestRender = undefined;
	});
}
