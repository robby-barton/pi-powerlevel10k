/**
 * /p10k command — status (default), reload, path.
 *
 * All user-facing output goes through ctx.ui.notify (works in TUI and RPC;
 * silently ignored where notifications are unavailable).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { P10kParsed } from "./parse-p10k.ts";
import type { P10kStyle } from "./style.ts";

export interface P10kCommandDeps {
	getPath(): string | null;
	getSource(): string | undefined;
	getError(): string | undefined;
	getParsed(): P10kParsed | null;
	getStyle(): P10kStyle;
	/** Re-read settings + re-parse + rebuild style + re-apply theme + re-render. */
	reload(ctx: ExtensionContext): { path: string | null; vars: number; error?: string };
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	try {
		ctx.ui.notify(message, type);
	} catch {
		// Notifications unavailable in this mode — ignore.
	}
}

function varCount(parsed: P10kParsed | null): number {
	return parsed ? Object.keys(parsed.vars).length : 0;
}

export async function handleP10kCommand(
	args: string,
	ctx: ExtensionContext,
	deps: P10kCommandDeps,
): Promise<void> {
	const sub = args.trim().split(/\s+/)[0] || "status";

	if (sub === "status") {
		const path = deps.getPath();
		const parsed = deps.getParsed();
		const source = deps.getSource() ?? "—";
		if (!parsed) {
			const why = deps.getError() ? ` (error: ${deps.getError()})` : "";
			notify(ctx, `p10k: no config parsed${path ? ` — ${path}${why}` : " — using defaults"}`, "warning");
			return;
		}
		const gf = parsed.gitFormatter;
		const gfText =
			Object.keys(gf).length > 0
				? Object.entries(gf)
						.map(([k, v]) => `${k}=%${v}F`)
						.join(" ")
				: "none";
		const style = deps.getStyle();
		const lines = [
			`p10k status`,
			`  config : ${path} (${source})`,
			`  vars   : ${varCount(parsed)} parsed, ${parsed.skippedLines} lines skipped`,
			`  git    : ${gfText}`,
			`  left   : ${style.leftSegments.join(" | ")}`,
			`  right  : ${style.rightSegments.join(" | ")}`,
			`  prompt : ${style.promptChar}`,
			`  theme  : applied via settings ("p10kPrompt".applyTheme)`,
		];
		notify(ctx, lines.join("\n"));
		return;
	}

	if (sub === "reload") {
		const result = deps.reload(ctx);
		if (result.error) {
			notify(ctx, `p10k: reload failed for ${result.path ?? "config"} — ${result.error}`, "error");
		} else {
			notify(ctx, `p10k: reloaded ${result.path ?? "(no config)"} — ${result.vars} vars parsed`);
		}
		return;
	}

	if (sub === "path") {
		const path = deps.getPath();
		notify(ctx, path ? `p10k config: ${path} (${deps.getSource() ?? "unknown"})` : "p10k: no config path resolved");
		return;
	}

	notify(ctx, `p10k: unknown subcommand "${sub}" — usage: /p10k [status|reload|path]`, "warning");
}
