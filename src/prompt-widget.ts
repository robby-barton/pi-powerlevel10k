/**
 * p10k prompt widget component (the two-line powerline prompt shown above the editor).
 *
 * Note: the aboveEditor widget placement already provides a leading blank line,
 * so this component deliberately does not add one of its own.
 */

import type { Component } from "@earendil-works/pi-tui";
import { composePrompt, type PromptData } from "./segments.ts";
import type { P10kStyle } from "./style.ts";

export class P10kPromptComponent implements Component {
	private disposed = false;
	private readonly getDataFn: () => PromptData;
	private readonly style: P10kStyle;
	private readonly requestRenderFn?: () => void;

	// Note: no TS parameter properties (not supported by Node type stripping).
	constructor(getData: () => PromptData, style: P10kStyle, requestRender?: () => void) {
		this.getDataFn = getData;
		this.style = style;
		this.requestRenderFn = requestRender;
	}

	/** Recomputes everything via getData() on every call — no cached themed strings. */
	render(width: number): string[] {
		if (this.disposed) return [];
		try {
			return composePrompt(width, this.getDataFn(), this.style);
		} catch {
			return [];
		}
	}

	invalidate(): void {
		// No cached state to invalidate.
	}

	dispose(): void {
		this.disposed = true;
	}
}
