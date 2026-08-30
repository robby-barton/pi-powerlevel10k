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

		// Border handling. Border lines start at column 0 with "─" (plain all-dash
		// frame lines, or scroll indicators with ↑/↓ embedded); content lines always
		// begin with the padding columns, so typed dashes are never matched.
		const isBorderStart = (l: string) => stripAnsi(l).startsWith("─");
		const isPlainBorder = (l: string) => /^[─]+$/.test(stripAnsi(l));

		// The bottom border is the LAST border-start line; anything after it is the
		// autocomplete menu. Split so menu open/close is detectable.
		let bottomIdx = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (isBorderStart(lines[i])) {
				bottomIdx = i;
				break;
			}
		}
		const autocompleteLines = bottomIdx >= 0 ? lines.slice(bottomIdx + 1) : [];
		const body = bottomIdx >= 0 ? lines.slice(0, bottomIdx + 1) : [...lines];

		// Drop the plain top/bottom frame lines (keep ↑/↓ scroll indicators).
		if (body.length > 0 && isPlainBorder(body[0])) body.shift();
		if (body.length > 0 && isPlainBorder(body[body.length - 1])) body.pop();

		// Breathing room at the bottom of the window (PROMPT_ADD_NEWLINE). The
		// footer dock reserves one row below the editor (minSize: 1), which is
		// blank with our minimal footer — so one row here yields ~2 visible
		// blank rows total.
		//
		// Skipped while the autocomplete menu is open: the menu already adds its
		// own rows below the input, and keeping the padding out makes open/close
		// shift the layout by exactly the menu height instead of menu + padding
		// (prevents the wonky snap-back when the menu closes).
		if (this.style.promptAddNewline && autocompleteLines.length === 0) body.push("");
		return [...body, ...autocompleteLines];
	}
}
