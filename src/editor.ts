/**
 * P10kEditor — CustomEditor subclass that renders the p10k prompt char (❯)
 * locked to the first (top) content line inside the editor, replacing the
 * first left padding column (paddingX forced to >= editorPaddingX, default 2:
 * col 1 becomes the glyph, col 2 remains as the gap before the text; line
 * widths stay exactly `width`).
 *
 * Hardware-cursor positioning is unaffected: the glyph only substitutes a
 * padding column that precedes all cursor content, and the TUI computes the
 * cursor column from the visible width before CURSOR_MARKER on its own line.
 *
 * PROMPT_ADD_NEWLINE from the p10k config controls the trailing blank line
 * below the editor (true by default, matching the stock config).
 */

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { fg, stripAnsi, type Color } from "./ansi.ts";
import type { P10kStyle } from "./style.ts";

export interface P10kEditorOptions {
	/** Resolved style (colors for the prompt glyph). */
	style: P10kStyle;
	/** Prompt glyph (style.promptChar, from config or parsed p10k settings). */
	promptChar: string;
	/** Editor left padding columns (column 1 becomes the glyph). */
	paddingX: number;
	/** Current prompt color (ok/err). */
	getPromptColor: () => Color;
}

export class P10kEditor extends CustomEditor {
	private readonly style: P10kStyle;
	private readonly promptChar: string;
	private readonly editorPaddingX: number;
	private getPromptColor: () => Color;

	// Note: no TS parameter properties (not supported by Node type stripping).
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: P10kEditorOptions) {
		super(tui, theme, keybindings, { paddingX: Math.max(2, options.paddingX) });
		this.style = options.style;
		this.promptChar = options.promptChar;
		this.editorPaddingX = Math.max(2, options.paddingX);
		this.getPromptColor = options.getPromptColor;
	}

	/**
	 * pi copies the default editor's padding onto custom editors after
	 * construction (setCustomEditorComponent calls setPaddingX). Clamp to the
	 * configured padding: column 1 is swapped for the prompt glyph, the
	 * remaining columns stay as the gap between the prompt char and the text.
	 */
	setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(this.editorPaddingX, padding));
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length < 3) return lines; // top border + content + bottom border minimum

		// Lock the glyph to the first content line (top of the editor box),
		// regardless of where the cursor is. Content lines start at index 1
		// (lines[0] is the top border; the bottom border is lines[len-1],
		// with autocomplete lines possibly following it).
		const idx = 1;

		// Replace the first left-padding column with the prompt glyph.
		const line = lines[idx];
		if (line.startsWith(" ")) {
			lines[idx] = fg(this.getPromptColor(), this.promptChar) + line.slice(1);
		}

		// Drop the plain horizontal frame lines (top/bottom borders). Border
		// lines start at column 0 and strip to all "─"; content lines always
		// begin with the padding columns, so typed dashes are never matched.
		// Scroll-indicator borders (↑/↓ embedded) are kept for overflow feedback.
		const isPlainBorder = (l: string) => /^[─]+$/.test(stripAnsi(l));
		const out = [...lines];
		if (out.length > 0 && isPlainBorder(out[0])) out.shift();
		// Bottom border: the last all-dash line (autocomplete lines may follow it).
		for (let i = out.length - 1; i >= 0; i--) {
			if (isPlainBorder(out[i])) {
				out.splice(i, 1);
				break;
			}
		}
		// Breathing room at the bottom of the window (PROMPT_ADD_NEWLINE).
		// The footer dock reserves one row below the editor (minSize: 1), which
		// is blank with our minimal footer — so one row here yields ~2 visible
		// blank rows total.
		if (this.style.promptAddNewline) out.push("");
		return out;
	}
}
