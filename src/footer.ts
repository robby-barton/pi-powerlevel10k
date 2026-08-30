/**
 * p10k minimal custom footer — replaces the built-in footer so the extension
 * can subscribe to footerData.onBranchChange (used to invalidate the git cache).
 *
 * Renders a single dim line of: session name • extension statuses.
 * With `showContent: false` it renders nothing (cfg.footer=false) but still
 * subscribes — the subscription IS the git-refresh mechanism.
 */

import type { Component } from "@earendil-works/pi-tui";
import { C, truncateToWidth, fg } from "./ansi.ts";
import type { GitCache } from "./git.ts";

/** State shared between index.ts and the footer factory (all accessors optional). */
export interface P10kFooterState {
	gitCache?: GitCache;
	requestRender?: () => void;
	getSessionName?: () => string | undefined;
}

interface FooterDataLike {
	getExtensionStatuses(): ReadonlyMap<string, string>;
	onBranchChange(callback: () => void): () => void;
}

export function makeP10kFooter(state: P10kFooterState, showContent: boolean) {
	return (
		_tui: unknown,
		_theme: unknown,
		footerData: FooterDataLike,
	): Component & { dispose(): void } => {
		const unsub = footerData.onBranchChange(() => {
			state.gitCache?.invalidate();
			state.requestRender?.();
		});
		return {
			invalidate() {
				// We use raw ANSI anyway; nothing cached to refresh on theme change.
			},
			dispose() {
				unsub();
			},
			render(width: number): string[] {
				if (!showContent) return [];
				const parts: string[] = [];
				try {
					const sessionName = state.getSessionName?.();
					if (sessionName) parts.push(sessionName);
					for (const status of footerData.getExtensionStatuses().values()) {
						parts.push(String(status).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
					}
				} catch {
					// Footer must never throw.
				}
				if (parts.length === 0) return [];
				return [truncateToWidth(fg(C.meta, parts.join(" • ")), width, "")];
			},
		};
	};
}
