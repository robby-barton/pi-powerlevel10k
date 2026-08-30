/** theme-gen tests: RGB decode/blend + token mapping + Theme construction. */

import { createAssert } from "./helpers.ts";
import { DEFAULT_STYLE } from "../src/style.ts";
import {
	blend256,
	decodeColorRgb,
	rgbToNearest256,
	themeColorsFromStyle,
	buildThemeFromStyle,
} from "../src/theme-gen.ts";

export function runThemeGenTests() {
	const { stats, assert, assertEqual, deepEqual } = createAssert("theme-gen");

	// --- decodeColorRgb ---------------------------------------------------------
	deepEqual(decodeColorRgb(0), [0, 0, 0], "index 0 → black");
	deepEqual(decodeColorRgb(16), [0, 0, 0], "cube corner → black");
	deepEqual(decodeColorRgb(231), [255, 255, 255], "cube corner → white");
	deepEqual(decodeColorRgb(196), [255, 0, 0], "index 196 → red cube corner");
	deepEqual(decodeColorRgb(244), [128, 128, 128], "grayscale ramp 244");
	deepEqual(decodeColorRgb("#ff0000"), [255, 0, 0], "hex decode");
	deepEqual(decodeColorRgb("#a0b0c0"), [160, 176, 192], "hex decode mixed");

	// --- rgbToNearest256 ----------------------------------------------------------
	assertEqual(rgbToNearest256(255, 0, 0), 9, "pure red → 9 (exact match, ties beat 196)");
	assertEqual(rgbToNearest256(0, 0, 0), 0, "black → 0 (exact match)");
	assertEqual(rgbToNearest256(255, 255, 255), 15, "white → 15 (exact match)");
	assertEqual(rgbToNearest256(135, 135, 135), 102, "gray 135 → 102 (exact cube match)");

	// --- blend256 -------------------------------------------------------------------
	assertEqual(blend256(0, 255, 0), 0, "t=0 → a (index result)");
	assertEqual(blend256(0, 255, 1), 255, "t=1 → b (index result)");
	const blended = blend256(236, 196, 0.5);
	assert(typeof blended === "number", "index+index → index");
	assertEqual(blend256("#000000", "#ffffff", 1), "#ffffff", "hex t=1 → b");
	assertEqual(blend256("#000000", "#ffffff", 0), "#000000", "hex t=0 → a");
	const hexBlend = blend256("#000000", "#ffffff", 0.5);
	assert(typeof hexBlend === "string" && hexBlend.startsWith("#"), "hex involved → hex result");
	assertEqual(hexBlend, "#808080", "black/white 50% blend");

	// --- themeColorsFromStyle ---------------------------------------------------------
	const { fgColors, bgColors } = themeColorsFromStyle(DEFAULT_STYLE);
	assertEqual(fgColors.accent, 39, "accent ← dirAnchor");
	assertEqual(fgColors.success, 76, "success ← ok");
	assertEqual(fgColors.error, 196, "error ← err");
	assertEqual(fgColors.warning, 178, "warning ← modified");
	assertEqual(fgColors.thinkingMax, 196, "thinkingMax");
	assertEqual(bgColors.selectedBg, 236, "selectedBg ← bgBar");
	// toolSuccessBg = blend(bgBar 236 → ok 76, 0.18) — verify it sits between.
	const successBg = bgColors.toolSuccessBg;
	assert(typeof successBg === "number", "toolSuccessBg index for index inputs");
	const successRgb = decodeColorRgb(successBg as number);
	const [barR] = decodeColorRgb(236);
	const [okR] = decodeColorRgb(76);
	assert(successRgb[0] > (barR ?? 0) && successRgb[0] < (okR ?? 0) + 40, "toolSuccessBg between bar and ok");
	const errorBg = bgColors.toolErrorBg;
	assert(typeof errorBg === "number", "toolErrorBg index for index inputs");

	// custom style → colors flow through
	const custom = structuredClone(DEFAULT_STYLE);
	custom.colors.ok = "#00ff00";
	const customSets = themeColorsFromStyle(custom);
	assertEqual(customSets.fgColors.success, "#00ff00", "hex colors pass through");
	assert(typeof customSets.bgColors.toolSuccessBg === "string", "hex ok → hex blend");

	// --- buildThemeFromStyle ------------------------------------------------------------
	const theme = buildThemeFromStyle(DEFAULT_STYLE, "256color");
	assert(theme !== null, "Theme constructed");
	assertEqual(theme?.name, "p10k-dynamic", "theme name");
	const themeFg = theme?.fg("success", "X") ?? "";
	assert(themeFg.includes("\x1b["), "theme.fg returns ANSI");
	assert(theme?.fg("accent", "X") !== undefined, "accent token usable");

	console.log(`theme-gen: ${stats.checks - stats.failures}/${stats.checks} checks passed`);
	return stats;
}
