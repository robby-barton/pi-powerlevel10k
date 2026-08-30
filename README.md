# pi-powerlevel10k

Powerlevel10k-style prompt for [pi](https://github.com/earendil-works/pi-mono) — a two-line
powerline prompt above the editor, a minimal git-aware footer, and a prompt-char editor,
**styled from your existing `~/.p10k.zsh`**.

```
⌘  ~/projects/pi  main ⇣1 ⇡2 !3 ?1  │  ⚡ z-ai/glm-5.3-flash medium  ◔ 54%  ⋅ $0.123  ↑45k ↓1.2k
❯
```

## Install

```sh
pi install npm:pi-powerlevel10k     # or: pi install /path/to/this/repo
```

Then restart pi. On first start you'll see a notification like:

```
p10k prompt: /home/you/.p10k.zsh (default) — 307 vars parsed
```

## Requirements

- pi `>=0.84.0 <0.86.0`
- A [Nerd Font](https://www.nerdfonts.com/) (the stock `POWERLEVEL9K_MODE=nerdfont-*`
  icon set). Non-nerdfont `MODE` values switch to a Unicode fallback icon set.
- Optional: an existing `~/.p10k.zsh` (the stock `p10k configure` output works).

## What is auto-extracted from ~/.p10k.zsh

| p10k parameter | Prompt knob |
|---|---|
| `POWERLEVEL9K_MODE` | nerd vs Unicode fallback icon set |
| `POWERLEVEL9K_OS_ICON_FOREGROUND` | OS segment color |
| `POWERLEVEL9K_DIR_FOREGROUND` / `_SHORTENED_` / `_ANCHOR_` | directory colors |
| `POWERLEVEL9K_DIR_ANCHOR_BOLD` | bold anchor |
| `POWERLEVEL9K_DIR_MAX_LENGTH` | dir-shortening threshold |
| `POWERLEVEL9K_VCS_CLEAN/UNTRACKED/MODIFIED/CONFLICTED_FOREGROUND` | git colors |
| `POWERLEVEL9K_VCS_BRANCH_ICON` | git branch icon |
| `local meta/clean/modified/untracked/conflicted='%NNNF'` in the git formatter | overrides the `VCS_*` colors (**first assignment wins** — p10k defines the clean/up-to-date palette before the stale/loading fallback) |
| `POWERLEVEL9K_LEFT_SUBSEGMENT_SEPARATOR` (`%244F\uE0B1` form) | thin-separator color + glyph |
| `POWERLEVEL9K_LEFT/RIGHT_SEGMENT_SEPARATOR` | powerline taper glyphs |
| `POWERLEVEL9K_PROMPT_CHAR_OK/ERROR_VIINS_FOREGROUND` | prompt char ok/error colors |
| `POWERLEVEL9K_PROMPT_CHAR_OK_VIINS_CONTENT_EXPANSION` | prompt char glyph |
| `POWERLEVEL9K_PROMPT_ADD_NEWLINE` | blank line below the editor |
| `POWERLEVEL9K_LEFT_PROMPT_ELEMENTS` | left segment list (`os_icon`/`dir`/`vcs` only) |

Config path resolution: `"p10kPrompt".p10kConfigPath` setting → `$P10K_CONFIG_FILE` →
`$POWERLEVEL9K_CONFIG_FILE` (process env only — the value the config file sets internally
is ignored) → `~/.p10k.zsh`.

## Not honored

The zsh-specific machinery is out of scope; these common knobs are ignored:

- Right-prompt element list (`POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS`) — pi's right bar shows
  model / context / cost / tokens / subagents instead.
- Multi-line prompts (`MULTILINE_*`), fill characters, frame/prompt prefixes/suffixes.
- Per-segment classes (`DIR_CLASSES`, `VCS_CLASSES`, …), `DIR_PREFIX`, `VCS_PREFIX`,
  hyperlinks, writable-dir indicators.
- `PROMPT_CHAR_*_VICMD/VIVIS/VIOWR` variants (vi-mode states) — only VIINS is used.
- Async git "loading" formatting; transient prompts; two-line layouts.

## Settings (`"p10kPrompt"` in ~/.pi/agent/settings.json or project .pi/settings.json)

Project settings win over global settings; everything below is optional:

```jsonc
{
  "p10kPrompt": {
    "p10kConfigPath": "/path/to/p10k.zsh",   // null → env vars → ~/.p10k.zsh
    "applyTheme": "auto",                     // "auto" | "on" | "off"
    "widget": true,                           // powerline bar above the editor
    "editor": true,                           // prompt-char editor replacement
    "footer": true,                           // session/status line (subscription always active)
    "promptChar": "❯",                        // set to change; default defers to p10k config
    "editorPaddingX": 2,
    "leftSegments": ["os", "dir", "vcs"],
    "rightSegments": ["model", "context", "cost", "tokens", "agents"],
    "contextWarnPct": 70,
    "contextErrorPct": 90,
    "dropOrder": ["agents", "tokens", "cost", "context", "model"],
    "showThinkingLevel": true,
    "dirShortenThreshold": 80,
    "branchMaxWidth": 32,
    "colors": { "branch": "#00ff00", "thinking.high": 200 },
    "icons": { "git": "\uE725" }
  }
}
```

- `colors` keys are style color names (`bgBar`, `fgSep`, `os`, `dirAnchor`, `dirShort`,
  `dirDefault`, `branch`, `meta`, `modified`, `untracked`, `conflicted`, `ok`, `err`,
  `model`, `ctx`, `ctxWarn`, `ctxErr`, `cost`, `tokens`, `agents`, plus
  `thinking.off|minimal|low|medium|high|xhigh|max`). Values are 256-color indices or
  `#rrggbb` hex. Overrides beat parsed p10k values.
- `icons` keys: `osLinux`, `osMac`, `dir`, `git`, `detached`, `model`, `ctx`, `cost`,
  `up`, `down`, `robot`, `sepRight`, `sepLeft`, `sepThin`, `prompt`.

## Theme behavior

With `applyTheme: "on"` — or `"auto"` (default) when a p10k config was found and the
configured pi theme is unset or `p10k` — the extension builds a runtime theme from the
extracted palette (`toolSuccessBg`/`toolErrorBg` are subtle blends of the bar background)
and applies it via `ctx.ui.setTheme`. It is never persisted; the shipped static
`themes/p10k.json` is the fallback. `applyTheme: "off"` never touches the theme.

## Commands

- `/p10k` or `/p10k status` — what config was parsed (path, source, var count, git
  formatter colors, active segments).
- `/p10k reload` — re-read settings, re-parse the config, rebuild style/theme.
- `/p10k path` — show the resolved config path.

## Troubleshooting

**Boxes/tofu (□) instead of icons.** Your terminal font isn't a Nerd Font. Install one
(e.g. from [nerdfonts.com](https://www.nerdfonts.com/font-downloads)) and select it in
your terminal. Alternatively set `POWERLEVEL9K_MODE=compatible` in your p10k config (or
`"icons": { ... }` overrides) to switch to the Unicode fallback icon set.

**`p10k prompt: no p10k config found — using defaults` on startup.** The parser looked at
`~/.p10k.zsh` (then `$P10K_CONFIG_FILE` / `$POWERLEVEL9K_CONFIG_FILE`) and found nothing.
If your config lives elsewhere (dotfiles checkout, etc.), point the extension at it:

```jsonc
{ "p10kPrompt": { "p10kConfigPath": "/path/to/p10k.zsh" } }
```

Run `/p10k path` to see which path was resolved and why.

**Colors/segments don't match my zsh prompt.** Run `/p10k` and compare the reported git
formatter colors against your p10k config. Remember precedence: built-in defaults <
parsed `~/.p10k.zsh` < `p10kPrompt.colors`/`.icons` in settings — a stray settings
override wins over the parsed file. After editing either file, run `/p10k reload`.

**The chrome (tool boxes, diffs, editor border) doesn't change with my p10k colors.**
The runtime theme only applies when `applyTheme` is `"on"`, or `"auto"` with the
current pi theme unset or `p10k`. If you selected a different theme in `/settings`, set
`"applyTheme": "on"` to force the generated theme, or pick the `p10k` theme.

**The prompt bar disappeared / editor looks wrong after fiddling with settings.** Check
the `widget`, `editor`, and `footer` toggles in the `p10kPrompt` settings — each can be
disabled independently. `/p10k status` reports what is currently registered. With
`"footer": false`, git status refreshes only at turn boundaries instead of instantly
(on branch change).

**Git segment stale.** Status is cached (~2 s TTL, non-blocking) and refreshed
asynchronously; it also refreshes on every turn end and on real branch changes. If it's
stuck, `/p10k reload` rebuilds the style, or check that `git` works in the session's
cwd.

## Development

```sh
npm install
npm run typecheck   # tsc against pi's shipped .d.ts (see .typecheck/)
npm test            # plain node, no build step: parser + style + theme-gen + smoke suites
```

Source layout: `parse-p10k.ts` (pure zsh config parser), `config.ts` (settings),
`style.ts` (p10k → style mapping), `segments.ts`/`ansi.ts` (render stack),
`editor.ts`/`prompt-widget.ts`/`footer.ts` (TUI components), `theme-gen.ts` (runtime
theme), `command.ts` (`/p10k`), `index.ts` (extension entry point).

## License

MIT
