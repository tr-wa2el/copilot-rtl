# Changelog

## [0.1.6] - 2026-04-03

### Fixed
- Monaco chat input now correctly applies the configured RTL font family and font size — font is applied via CSS on `.view-line span` and `[class*="mtk"]` for visual rendering, and via `updateOptions({fontFamily, fontSize, lineHeight})` on all non-code Monaco editor instances so Monaco's internal character-width metrics match the visual font
- Word-wrap in the Monaco chat input now wraps at the correct position when using a custom font size — previously Monaco was wrapping based on the default font metrics while rendering a larger font, causing characters to overflow before the line break
- Monaco instance lookup now iterates all editors via `monaco.editor.getEditors()` with `getContainerDomNode()` matching instead of fragile single-element DOM lookup
- Added requirejs module cache walk as the most reliable method to obtain the Monaco API in VS Code's workbench context

## [0.1.5] - 2026-04-02

### Fixed
- Monaco chat input now correctly starts as LTR on new/empty conversations — the empty-guard that was locking the RTL class on blank inputs has been scoped to only apply during Monaco's render gap (while typing)
- Typing Arabic in the chat input now reliably switches direction to RTL — upgraded to double `requestAnimationFrame` since Monaco needs two frames to fully update `.view-line` elements after an input event
- Chat input direction now reads from `.view-lines` only instead of the full `editor.textContent`, avoiding false Arabic detection from placeholder text, aria labels, and decorations
- Added `_monacoTyping` flag to cleanly distinguish "editor is mid-render" from "editor is genuinely empty"

## [0.1.4] - 2026-04-02

### Fixed
- RTL direction no longer reverts to LTR when switching to an existing chat conversation without typing
- Fixed flicker on tables and bullet lists during AI streaming — `td`/`th` cells now get their direction from CSS (`unicode-bidi: plaintext`) instead of inline styles being re-applied on every streamed token
- Removed the 60-second limit on the periodic scanner that caused RTL to stop working after one minute
- Added `focusin` listener to scan Monaco inputs immediately when the user focuses the chat input
- Added `processNonCodeMonacos()` inside `scheduleMdScan` so chat thread switches trigger an immediate Monaco scan

## [0.1.3] - 2026-04-02

### Added
- Cursor IDE support — handles chat containers built with React + Tailwind + Lexical
- Antigravity chat panel support (agent mode)
- CSS-class approach for response containers: adds `copilot-rtl-response` to the stable parent instead of setting inline styles on every child element, eliminating streaming flicker
- `unicode-bidi: plaintext` on all response paragraphs so the browser auto-detects direction per paragraph without any JS
- New settings: `ltrFontFamily`, `ltrFontSize`, `ltrLineHeight` to customize the appearance of English text in chat

### Fixed
- Direction flicker during AI streaming — container is locked to RTL as soon as Arabic is detected and is not removed while streaming is in progress
- Lexical editor in Cursor was losing RTL between keystrokes

## [0.1.2] - 2026-04-01

### Added
- RTL support for Antigravity (Cursor) chat response containers
- Improved `textAlign` logic in `buildScriptFileContent` and `buildAgentScriptContent`
- General code refactoring for readability

### Fixed
- Reverted smart cursor-aware direction detection — it introduced more issues than it solved
- Removed `autoInputDirection` parameter to simplify the internal API

## [0.1.1] - 2026-03-31

### Added
- Monaco-based chat input support — RTL is applied automatically to the Copilot input box when typing Arabic
- Unpatch command in `fix-vscode.js` to remove the injected patch from VS Code
- `lineHeight` setting to control line spacing in chat
- `fontSize` setting to control font size in chat

### Fixed
- `workbench.html` path detection now supports multiple base directories across different VS Code versions
- Expanded README with documentation for all available settings

## [0.1.0] - 2026-03-31

### Added
- Initial release of Copilot RTL
- Automatic Arabic text detection and RTL direction switching in Copilot Chat
- `fontFamily` setting to choose an Arabic font (default: Vazirmatn)
- CSS injection targeting `rendered-markdown` containers in VS Code
- Support for Arabic Unicode blocks: U+0600–U+06FF, U+0750–U+077F, U+FB50–U+FDFF, U+FE70–U+FEFF

