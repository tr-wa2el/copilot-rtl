import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';
const AGENT_PATCH_JS_NAME = 'copilot-rtl-agent-patch.js';
const STATE_FILE_NAME = 'copilot-rtl-state.json';
const STATE_KEY_DISABLED = 'copilotRtl.userDisabled';

/** The JS that gets written to a standalone file (no inline script — avoids CSP). */
function buildScriptFileContent(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): string {
    return `(function () {
    'use strict';

    var _observer = null;
    var _mainInterval = null;
    var _enabled = true;

    const RTL_FONT_FAMILY  = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE    = ${JSON.stringify(fontSize + 'px')};
    const RTL_LINE_HEIGHT  = ${JSON.stringify(String(lineHeight))};
    const RTL_FONT_NAME    = ${JSON.stringify(fontFamily)};
    const LTR_FONT_FAMILY  = ${JSON.stringify(ltrFontFamily)};
    const LTR_FONT_SIZE    = ${JSON.stringify(ltrFontSize > 0 ? ltrFontSize + 'px' : '')};
    const LTR_LINE_HEIGHT  = ${JSON.stringify(ltrLineHeight > 0 ? String(ltrLineHeight) : '')};
    const RTL_TEXT_ALIGN   = ${JSON.stringify(textAlign)};

    // Warn in DevTools console if the requested font is not available
    document.fonts.ready.then(function () {
        if (!document.fonts.check('16px ' + RTL_FONT_NAME)) {
            console.warn(
                '[Copilot RTL] Font "' + RTL_FONT_NAME + '" was not found. ' +
                'Arabic text will fall back to sans-serif. ' +
                'Install the font or change the Copilot RTL font setting.'
            );
        }
    });

    // Arabic Unicode blocks: Arabic, Arabic Supplement, Arabic Presentation Forms A & B
    const ARABIC_RE = /[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;

    // All known selectors for the Copilot/chat markdown container across VS Code versions
    const MD_CONTAINER_SELECTORS = [
        '.rendered-markdown',
        '.chat-response-rendered-markdown',
        '.monaco-chat-answer .markdown-body',
        '.markdown-body',
        '.chat-message-text',
        '.chat-response-list-item .rendered-markdown',
        '.interactive-response .rendered-markdown',
        '.copilot-chat-response .rendered-markdown',
        '.chat-tree-item-contents .rendered-markdown',
        '.chat-list-item-layout .rendered-markdown',
        // Cursor IDE chat containers
        '.markdown-root .space-y-4',
    ];

    function isArabicOrMixed(text) {
        return ARABIC_RE.test(text);
    }

    // ── Apply direction to a single element (used for user messages, table cells) ──
    function applyDirection(el) {
        if (el.tagName === 'PRE' || el.tagName === 'CODE') {
            el.style.direction = 'ltr';
            el.style.fontFamily = '';
            el.style.unicodeBidi = '';
            return;
        }
        if (isArabicOrMixed(el.textContent || '')) {
            el.style.direction = 'rtl';
            el.style.unicodeBidi = 'embed';
            el.style.fontFamily = RTL_FONT_FAMILY;
            el.style.fontSize = RTL_FONT_SIZE;
            el.style.lineHeight = RTL_LINE_HEIGHT;
            el.style.textAlign = RTL_TEXT_ALIGN;
        } else {
            el.style.direction = 'ltr';
            el.style.unicodeBidi = '';
            el.style.fontFamily = LTR_FONT_FAMILY;
            el.style.fontSize = LTR_FONT_SIZE;
            el.style.lineHeight = LTR_LINE_HEIGHT;
            el.style.textAlign = '';
        }
    }

    function markMixedTextBlocks(root) {
        var blocks = root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            if (block.tagName === 'PRE' || block.tagName === 'CODE') { continue; }
            if (block.closest('pre') || block.closest('code')) { continue; }
            if (isArabicOrMixed(block.textContent || '')) {
                // Use setProperty('important') to beat ANY CSS rule including
                // unicode-bidi:plaintext set by the workbench or our own mdSels.
                block.style.setProperty('direction', 'rtl', 'important');
                block.style.setProperty('unicode-bidi', 'embed', 'important');
                block.style.setProperty('text-align', RTL_TEXT_ALIGN, 'important');
                block.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                block.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                block.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
            } else {
                // Force non-Arabic blocks back to LTR so one Arabic line
                // does not flip the whole list/section direction.
                block.style.setProperty('direction', 'ltr', 'important');
                block.style.setProperty('unicode-bidi', 'plaintext', 'important');
                block.style.setProperty('text-align', 'left', 'important');
            }
        }
    }

    // ── CSS-class approach for response containers ──────────────────────
    // Instead of setting inline styles on each child element (which get
    // destroyed when React/VS Code re-renders during streaming), we add a
    // CSS class to the STABLE PARENT CONTAINER. CSS rules injected via
    // injectStyles() automatically style all descendant text elements.
    // This eliminates flicker because the class on the parent persists
    // even when child elements are recreated.
    var _isStreaming = false;

    function processMarkdown(root) {
        var rootArabic = isArabicOrMixed(root.textContent || '');

        // Once Arabic is detected, add the CSS class immediately
        if (rootArabic) {
            root.classList.add('copilot-rtl-response');
        }

        // If the container already has the RTL class and we're streaming,
        // skip ALL child processing — this is the main anti-flicker guard.
        // CSS rules on .copilot-rtl-response handle child styling automatically.
        if (root.classList.contains('copilot-rtl-response') && _isStreaming) {
            return;
        }

        // Non-streaming: apply/remove class based on current content
        if (!rootArabic) {
            root.classList.remove('copilot-rtl-response');
        }

        // Tables need per-cell treatment for mixed content — but ONLY when not streaming.
        // During streaming the cells are recreated on every token which causes inline
        // style thrashing and visible flicker. CSS unicode-bidi:plaintext handles
        // direction automatically until streaming finishes.
        if (!_isStreaming) {
            var cells = root.querySelectorAll('th, td');
            for (var t = 0; t < cells.length; t++) {
                applyDirection(cells[t]);
            }
            var tables = root.querySelectorAll('table');
            for (var tb = 0; tb < tables.length; tb++) {
                if (isArabicOrMixed(tables[tb].textContent || '')) {
                    tables[tb].style.direction = 'rtl';
                } else {
                    tables[tb].style.direction = 'ltr';
                }
            }
            markMixedTextBlocks(root);
        }
    }

    function scanAllMarkdown() {
        MD_CONTAINER_SELECTORS.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(processMarkdown);
        });
    }

    // ── Streaming stabilization ──────────────────────────────────────────
    // After the AI finishes streaming (no mutations for 400ms), mark
    // streaming as ended and do a final clean re-scan.
    var _stabilizeTimeout = null;
    function scheduleStabilize() {
        _isStreaming = true;
        if (_stabilizeTimeout) { clearTimeout(_stabilizeTimeout); }
        _stabilizeTimeout = setTimeout(function () {
            _stabilizeTimeout = null;
            _isStreaming = false;
            // Final clean re-scan — can now remove classes if needed
            scanAllMarkdown();
            scanAntigravity();
        }, 400);
    }

    // ── Antigravity / Cursor chat support (React + Tailwind + Lexical) ──
    // Uses the CSS-class approach: add 'copilot-rtl-response' to the
    // STABLE container so children are styled via CSS, not inline styles.
    // Selectors cover both Antigravity (.leading-relaxed.select-text)
    // and Cursor IDE (.markdown-root .space-y-4).
    var RESPONSE_CONTAINER_SELECTORS = [
        '.leading-relaxed.select-text',
        '.markdown-root .space-y-4',
    ];

    function scanAntigravity() {
        // Bot response CONTAINERS — add class, let CSS handle children
        RESPONSE_CONTAINER_SELECTORS.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (container) {
                var containerArabic = isArabicOrMixed(container.textContent || '');

                // Lock the container as soon as Arabic is detected
                if (containerArabic) {
                    container.classList.add('copilot-rtl-response');
                }

                // If locked and streaming, skip ALL child processing
                if (container.classList.contains('copilot-rtl-response') && _isStreaming) {
                    return;
                }

                // Non-streaming: allow removal
                if (!containerArabic) {
                    container.classList.remove('copilot-rtl-response');
                }

                if (!_isStreaming) {
                    markMixedTextBlocks(container);
                }
            });
        });

        // User messages (skip code/pre and Lexical editors)
        document.querySelectorAll('.whitespace-pre-wrap, .whitespace-normal').forEach(function (el) {
            if (el.tagName === 'CODE' || el.tagName === 'PRE' || el.closest('pre') || el.closest('code')) { return; }
            if (el.closest('[data-lexical-editor="true"]')) { return; }
            // Skip containers already handled as response containers
            if (el.closest('.markdown-root')) { return; }
            applyDirection(el);
        });

        // Table cells — only process when not streaming
        if (!_isStreaming) {
            var tableCellSel = RESPONSE_CONTAINER_SELECTORS.map(function(s) { return s + ' th, ' + s + ' td'; }).join(', ');
            document.querySelectorAll(tableCellSel).forEach(function (el) {
                applyDirection(el);
            });
            var tableSel = RESPONSE_CONTAINER_SELECTORS.map(function(s) { return s + ' table'; }).join(', ');
            document.querySelectorAll(tableSel).forEach(function (el) {
                if (isArabicOrMixed(el.textContent || '')) {
                    el.style.direction = 'rtl';
                } else {
                    el.style.direction = 'ltr';
                }
            });
        }
    }

    // ── Input scan (called ONLY on user input events, never from MutationObserver) ──
    // Keeping this separate prevents the AI streaming response from triggering
    // input re-scans, which caused direction/font to flicker on every streamed token.
    function scanAntigravityInput() {
        document.querySelectorAll('[data-lexical-editor="true"]').forEach(function (editor) {
            var text = editor.textContent || '';
            var arabic = isArabicOrMixed(text);
            editor.style.direction = '';
            editor.style.textAlign = '';
            if (arabic) {
                editor.classList.add('copilot-rtl-lexical');
                // Use setProperty('important') so this inline !important beats
                // any VS Code stylesheet rule regardless of specificity.
                editor.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                editor.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                editor.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
            } else {
                editor.classList.remove('copilot-rtl-lexical');
                editor.style.removeProperty('font-family');
                editor.style.removeProperty('font-size');
                editor.style.removeProperty('line-height');
            }
            var children = editor.children;
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                var childArabic = isArabicOrMixed(child.textContent || '');
                child.style.direction = childArabic ? 'rtl' : (arabic ? 'rtl' : 'ltr');
                child.style.textAlign = childArabic ? RTL_TEXT_ALIGN : '';
                if (arabic) {
                    child.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                    child.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                    child.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
                } else {
                    child.style.removeProperty('font-family');
                    child.style.removeProperty('font-size');
                    child.style.removeProperty('line-height');
                }
            }
        });
    }

    function scanAll() {
        scanAllMarkdown();
        scanAntigravity();
    }

    function observeMarkdown() {
        if (_observer) { _observer.disconnect(); _observer = null; }
        var _mdScanTimeout = null;
        function scheduleMdScan() {
            // Trailing-edge debounce: reset timer on every mutation so the scan
            // only fires after mutations have settled. This prevents repeated
            // scanAll() calls (every 200 ms) during streaming which caused
            // flicker in tables and bullet lists.
            if (_mdScanTimeout) clearTimeout(_mdScanTimeout);
            _mdScanTimeout = setTimeout(function () {
                _mdScanTimeout = null;
                scanAll();
                // Also scan Monaco inputs on every DOM mutation (e.g. switching
                // chat threads recreates elements but fires no 'input' events).
                processNonCodeMonacos();
            }, 150);
            // Each mutation means streaming is still active; schedule stabilize
            scheduleStabilize();
        }

        _observer = new MutationObserver(scheduleMdScan);

        // characterData removed intentionally — every character streamed by
        // the AI was firing a mutation event, which was the main cause of
        // flicker and poor performance. childList alone is sufficient to
        // detect when new elements are added.
        _observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scanAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMarkdown);
    } else {
        observeMarkdown();
    }

    // Watch Lexical input changes directly (Antigravity)
    document.addEventListener('input', function (e) {
        var target = e.target;
        if (target && target.closest && target.closest('[data-lexical-editor="true"]')) {
            scanAntigravityInput();
        }
    }, true);

    // ── CSS Injection for Monaco & Chat ─────────────────────────────────
    function injectStyles() {
        if (document.getElementById('copilot-rtl-styles')) return;
        var style = document.createElement('style');
        style.id = 'copilot-rtl-styles';
        var css = '';

        // ──────── ALWAYS-ACTIVE response RTL (zero JS needed) ─────────
        // These rules target response containers DIRECTLY by selector.
        // They are always active and survive React re-renders because they
        // live in the <style> tag, not as classes/attributes on elements.
        // unicode-bidi:plaintext makes the browser auto-detect direction
        // per paragraph from the first strong character (Arabic=RTL, Latin=LTR).

        // Antigravity + Cursor response containers
        var respTags = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'];
        var respContainerSels = ['.leading-relaxed.select-text', '.markdown-root .space-y-4'];
        var respCssSels = [];
        respContainerSels.forEach(function(c) {
            respTags.forEach(function(t) { respCssSels.push(c + ' ' + t); });
        });
        css += respCssSels.join(', ') + ' { ';
        css += 'unicode-bidi: plaintext !important; ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        // Also style inline spans inside responses (Cursor uses <span class="font-semibold">)
        var respSpanSels = respContainerSels.map(function(c) { return c + ' span'; }).join(', ');
        css += respSpanSels + ' { ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';

        // VS Code Copilot chat containers (rendered-markdown, etc.)
        // td/th are included so table cells auto-detect direction during streaming
        // without needing inline styles set by JS (which caused flicker).
        var mdSels = MD_CONTAINER_SELECTORS.map(function(s) {
            return s + ' > p, ' + s + ' > li, ' + s + ' > h1, ' + s + ' > h2, ' + s + ' > h3, ' + s + ' > h4, ' + s + ' li, ' + s + ' td, ' + s + ' th';
        }).join(', ');
        css += mdSels + ' { ';
        css += 'unicode-bidi: plaintext !important; ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';

        // Code blocks must ALWAYS stay LTR regardless
        var respCodeSels = [];
        respContainerSels.forEach(function(c) { respCodeSels.push(c + ' pre', c + ' code', c + ' pre span', c + ' code span'); });
        css += respCodeSels.join(', ') + ' { ';
        css += 'direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; ';
        css += 'font-family: var(--vscode-editor-font-family, monospace) !important; ';
        css += 'font-size: var(--vscode-editor-font-size, 13px) !important; }';
        var mdCodeSels = MD_CONTAINER_SELECTORS.map(function(s) {
            return s + ' pre, ' + s + ' code';
        }).join(', ');
        css += mdCodeSels + ' { ';
        css += 'direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; ';
        css += 'font-family: var(--vscode-editor-font-family, monospace) !important; ';
        css += 'font-size: var(--vscode-editor-font-size, 13px) !important; }';

        // .copilot-rtl-response is now used as a streaming marker only.
        // Per-block plaintext direction rules already handle each paragraph/list
        // item independently, which reduces flicker during partial streaming.
        css += '.copilot-rtl-response pre, .copilot-rtl-response code { ';
        css += 'direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; ';
        css += 'font-family: var(--vscode-editor-font-family, monospace) !important; ';
        css += 'font-size: var(--vscode-editor-font-size, 13px) !important; }';

        // ──────── Monaco chat input RTL ──────────────────────────────────
        css += '.copilot-rtl-v2 .view-lines { unicode-bidi: plaintext !important; }';
        css += '.copilot-rtl-v2 .view-line { direction: rtl !important; text-align: right !important; }';
        css += '.copilot-rtl-v2 .native-edit-context { direction: rtl !important; unicode-bidi: plaintext !important; font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        css += '.copilot-rtl-v2 .inputarea { direction: rtl !important; text-align: right !important; font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        // Apply font to Monaco's render spans for visual display.
        // Word-wrap metrics are corrected via updateOptions() in tryApplyMonacoFont.
        css += '.copilot-rtl-v2 [class*="mtk"] { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; }';
        css += '.copilot-rtl-v2 .view-line span { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; }';
        // Protect Monaco code views inside AI response containers from inheriting RTL.
        // The .copilot-rtl-response container sets direction:rtl on the whole block,
        // but embedded Monaco editors (code blocks in responses) must always stay LTR.
        var mdInlineCodeSels = MD_CONTAINER_SELECTORS.map(function(s) {
            return s + ' .monaco-editor, ' + s + ' .monaco-editor .view-line, ' + s + ' .monaco-editor .view-lines';
        }).join(', ');
        css += mdInlineCodeSels + ' { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }';
        css += '.copilot-rtl-response .monaco-editor, .copilot-rtl-response .monaco-editor .view-line, .copilot-rtl-response .monaco-editor .view-lines { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }';
        css += '.leading-relaxed.select-text .monaco-editor, .leading-relaxed.select-text .monaco-editor .view-line { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }';

        // ──────── Lexical input (class-based, toggled by JS) ────────────────
        css += '[data-lexical-editor="true"].copilot-rtl-lexical { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        css += '[data-lexical-editor="true"].copilot-rtl-lexical > p { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        css += '[data-lexical-editor="true"].copilot-rtl-lexical span { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; }';

        // ──────── Cursor user messages (CSS-only, no JS needed) ──────────
        // Sent user messages in Cursor become readonly Lexical editors.
        // Use unicode-bidi:plaintext so the browser auto-detects direction.

        // Fix layout: the text container (.min-w-0) inside the flex parent
        // shrinks to content width by default, making text-align:right useless.
        // Force it to take full width so RTL alignment is visible.
        css += '.composer-human-message .min-w-0 { flex: 1 1 0% !important; width: 100% !important; }';

        // The readonly Lexical editor and its children need proper RTL handling
        css += '.composer-human-message [data-lexical-editor] { width: 100% !important; }';
        css += '.composer-human-message [data-lexical-editor] p, ';
        css += '.aislash-editor-input-readonly p { ';
        css += 'unicode-bidi: plaintext !important; ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        // Ensure spans (text nodes) also get the font explicitly
        css += '.composer-human-message [data-lexical-editor] span, ';
        css += '.aislash-editor-input-readonly span { ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';

        style.textContent = css;
        document.head.appendChild(style);
    }

    injectStyles();

    // ── Monaco-based chat input RTL support ──────────────────────────────
    var CODE_EDITOR_ANCESTORS = [
        '.editor-group-container',
        '.editor-instance',
        '.monaco-workbench .part.editor',
    ];

    function isMainCodeEditor(monacoEl) {
        if (!monacoEl || !monacoEl.closest) { return false; }
        for (var i = 0; i < CODE_EDITOR_ANCESTORS.length; i++) {
            if (monacoEl.closest(CODE_EDITOR_ANCESTORS[i])) return true;
        }
        return false;
    }

    // ── Monaco font via updateOptions (fixes word-wrap metrics) ──
    // CSS on .view-line spans makes the font LOOK correct, but Monaco's internal
    // character-width cache still uses the old font, causing wrong word-wrap.
    // updateOptions({fontFamily, fontSize}) updates Monaco's metrics so wrap is correct.
    // We apply to ALL non-code editors so we don't need fragile DOM matching.
    var _monacoOriginals = new WeakMap();

    function getMonacoLib() {
        try {
            if (typeof monaco !== 'undefined' && monaco && monaco.editor) return monaco;
        } catch(e) {}
        // Walk requirejs module cache — most reliable in VS Code workbench
        try {
            var ctx = window.require
                && window.require.s
                && window.require.s.contexts
                && window.require.s.contexts._;
            var defined = ctx && ctx.defined;
            if (defined) {
                var keys = Object.keys(defined);
                for (var ki = 0; ki < keys.length; ki++) {
                    var mod = defined[keys[ki]];
                    if (mod && mod.editor && typeof mod.editor.getEditors === 'function') return mod;
                }
            }
        } catch(e) {}
        try {
            var req = (typeof require !== 'undefined' ? require : null) || window.require;
            if (req) { var m = req('vs/editor/editor.main'); if (m && m.editor) return m; }
        } catch(e) {}
        return null;
    }

    function getEditorDomNode(editorInstance) {
        try {
            return editorInstance.getContainerDomNode
                ? editorInstance.getContainerDomNode()
                : editorInstance.getDomNode();
        } catch(e) {
            return null;
        }
    }

    function applyMonacoFontFor(editorInstance) {
        if (!editorInstance) return;
        try {
            var fs = parseFloat(RTL_FONT_SIZE);
            var lh = parseFloat(RTL_LINE_HEIGHT);
            if (!(fs > 0) || !(lh > 0)) return;

            if (!_monacoOriginals.has(editorInstance)) {
                var raw = editorInstance.getRawOptions ? editorInstance.getRawOptions() : {};
                _monacoOriginals.set(editorInstance, {
                    fontSize: raw.fontSize,
                    fontFamily: raw.fontFamily,
                    lineHeight: raw.lineHeight,
                    wrappingStrategy: raw.wrappingStrategy,
                    allowVariableFonts: raw.allowVariableFonts
                });
            }

            editorInstance.updateOptions({
                fontSize: fs,
                fontFamily: RTL_FONT_FAMILY,
                lineHeight: Math.round(fs * lh),
                wrappingStrategy: 'advanced',
                allowVariableFonts: true
            });
        } catch(e) {}
    }

    function restoreMonacoFontFor(editorInstance) {
        if (!editorInstance) return;
        try {
            if (_monacoOriginals.has(editorInstance)) {
                editorInstance.updateOptions(_monacoOriginals.get(editorInstance));
                _monacoOriginals.delete(editorInstance);
            }
        } catch(e) {}
    }

    function restoreAllNonCodeMonacoFonts() {
        var lib = getMonacoLib();
        if (!lib) return;
        try {
            var editors = lib.editor.getEditors();
            for (var i = 0; i < editors.length; i++) {
                var dn = getEditorDomNode(editors[i]);
                if (dn && isMainCodeEditor(dn)) continue;
                restoreMonacoFontFor(editors[i]);
            }
        } catch(e) {}
    }

    function findMonacoInstanceForDom(monacoDom, editorRecords) {
        for (var i = 0; i < editorRecords.length; i++) {
            var rec = editorRecords[i];
            if (!rec.domNode) continue;
            if (rec.domNode === monacoDom) return rec.instance;
            if (rec.domNode.contains(monacoDom) || monacoDom.contains(rec.domNode)) return rec.instance;
        }
        return null;
    }

    function processNonCodeMonacos() {
        var editorRecords = [];
        var lib = getMonacoLib();
        if (lib) {
            try {
                var monacoEditors = lib.editor.getEditors();
                for (var i = 0; i < monacoEditors.length; i++) {
                    var dn = getEditorDomNode(monacoEditors[i]);
                    if (!dn || isMainCodeEditor(dn)) continue;
                    editorRecords.push({ instance: monacoEditors[i], domNode: dn });
                }
            } catch(e) {}
        }

        var allMonacos = document.querySelectorAll('.monaco-editor');
        for (var m = 0; m < allMonacos.length; m++) {
            var editor = allMonacos[m];
            if (isMainCodeEditor(editor)) continue;

            var editorInstance = findMonacoInstanceForDom(editor, editorRecords);

            // Read ONLY from .view-lines so we don't pick up placeholder text,
            // aria labels, decorations, or surrounding DOM that isn't the typed text.
            var viewLines = editor.querySelector('.view-lines');
            var text = viewLines ? (viewLines.textContent || '') : (editor.textContent || '');

            // Empty guard: only keep the class if we're mid-render (typing).
            // On a periodic scan, focusin, or thread switch (not typing), an
            // empty input correctly removes the class so new conversations start LTR.
            if (!text.trim() && editor.classList.contains('copilot-rtl-v2') && _monacoTyping) {
                continue;
            }

            var arabic = isArabicOrMixed(text);

            if (arabic) {
                editor.classList.add('copilot-rtl-v2');
                applyMonacoFontFor(editorInstance);
            } else {
                editor.classList.remove('copilot-rtl-v2');
                restoreMonacoFontFor(editorInstance);
            }
        }
    }

    // True while we are inside a double-rAF triggered by an 'input' event.
    // Used to distinguish "momentarily empty during Monaco re-render" from
    // "genuinely empty input" so the empty guard doesn't lock RTL on new conversations.
    var _monacoTyping = false;

    // Use a lightweight event listener for typing (Monaco input).
    // Double rAF: Monaco needs 2 frames to fully update .view-line elements
    // after the inputarea textarea receives a character.
    document.addEventListener('input', function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            _monacoTyping = true;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    _monacoTyping = false;
                    processNonCodeMonacos();
                });
            });
        }
    }, true);

    // Also scan when the user focuses any Monaco chat input.
    // _monacoTyping is false here so an empty input correctly removes copilot-rtl-v2,
    // which fixes "new conversation starts as RTL".
    document.addEventListener('focusin', function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            processNonCodeMonacos();
        }
    }, true);

    // ── Periodic fallback scan ──
    // Runs indefinitely at a low frequency so Monaco inputs are always in sync
    // regardless of when conversations are opened or switched.
    _mainInterval = setInterval(function () {
        scanAll();
        processNonCodeMonacos();
        scanAntigravityInput();
    }, 3000);

    // Initial input detection on load
    processNonCodeMonacos();
    scanAntigravityInput();

    // ── Live disable/enable via state file (no reload needed) ────────────
    function shutdown() {
        _enabled = false;
        if (_observer) { _observer.disconnect(); _observer = null; }
        if (_mainInterval) { clearInterval(_mainInterval); _mainInterval = null; }
        var style = document.getElementById('copilot-rtl-styles');
        if (style && style.parentNode) { style.parentNode.removeChild(style); }
        document.querySelectorAll('.copilot-rtl-response').forEach(function(el) { el.classList.remove('copilot-rtl-response'); });
        document.querySelectorAll('.copilot-rtl-v2').forEach(function(el) { el.classList.remove('copilot-rtl-v2'); });
        document.querySelectorAll('.copilot-rtl-lexical').forEach(function(el) { el.classList.remove('copilot-rtl-lexical'); });
        restoreAllNonCodeMonacoFonts();
    }

    function reinitialize() {
        _enabled = true;
        injectStyles();
        observeMarkdown();
        if (_mainInterval) { clearInterval(_mainInterval); }
        _mainInterval = setInterval(function () {
            scanAll();
            processNonCodeMonacos();
            scanAntigravityInput();
        }, 3000);
        scanAll();
        processNonCodeMonacos();
        scanAntigravityInput();
    }

    // Poll copilot-rtl-state.json every 1.5 s — allows instant toggle without reload.
    // This interval keeps running even after shutdown() so re-enable also works live.
    setInterval(function () {
        fetch('./copilot-rtl-state.json?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
            .then(function(data) {
                var nowEnabled = data.enabled !== false;
                if (!nowEnabled && _enabled) { shutdown(); }
                else if (nowEnabled && !_enabled) { reinitialize(); }
            })
            .catch(function() {});
    }, 1500);

}());
`;
}

/** Build the JS for Antigravity's agent chat panel (React + Tailwind + Lexical). */
function buildAgentScriptContent(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): string {
    return `(function () {
    'use strict';

    const RTL_FONT_FAMILY  = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE    = ${JSON.stringify(fontSize + 'px')};
    const RTL_LINE_HEIGHT  = ${JSON.stringify(String(lineHeight))};
    const RTL_FONT_NAME    = ${JSON.stringify(fontFamily)};
    const LTR_FONT_FAMILY  = ${JSON.stringify(ltrFontFamily)};
    const LTR_FONT_SIZE    = ${JSON.stringify(ltrFontSize > 0 ? ltrFontSize + 'px' : '')};
    const LTR_LINE_HEIGHT  = ${JSON.stringify(ltrLineHeight > 0 ? String(ltrLineHeight) : '')};
    const RTL_TEXT_ALIGN   = ${JSON.stringify(textAlign)};

    // Arabic Unicode blocks
    var ARABIC_RE = /[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;

    function isArabic(text) {
        return ARABIC_RE.test(text);
    }

    function applyRtlStyle(el, arabic) {
        if (arabic) {
            el.style.direction = 'rtl';
            el.style.unicodeBidi = 'embed';
            el.style.textAlign = RTL_TEXT_ALIGN;
            el.style.fontFamily = RTL_FONT_FAMILY;
            el.style.fontSize = RTL_FONT_SIZE;
            el.style.lineHeight = RTL_LINE_HEIGHT;
        } else {
            el.style.direction = 'ltr';
            el.style.unicodeBidi = '';
            el.style.textAlign = '';
            el.style.fontFamily = LTR_FONT_FAMILY;
            el.style.fontSize = LTR_FONT_SIZE;
            el.style.lineHeight = LTR_LINE_HEIGHT;
        }
    }

    // ── CSS-class approach for response containers ──────────────────────
    // Same approach as the main workbench script: add a CSS class to the
    // STABLE parent container instead of inline styles on children.
    var _isStreaming = false;

    // ── Chat messages (response + user messages) ─────────────────────────
    function processMessages() {
        // Bot response CONTAINERS — add class, let CSS handle children
        document.querySelectorAll('.leading-relaxed.select-text').forEach(function (container) {
            var containerArabic = isArabic(container.textContent || '');

            // Lock the container as soon as Arabic is detected
            if (containerArabic) {
                container.classList.add('copilot-rtl-response');
            }

            // If locked and streaming, skip ALL child processing
            if (container.classList.contains('copilot-rtl-response') && _isStreaming) {
                return;
            }

            // Non-streaming: allow removal
            if (!containerArabic) {
                container.classList.remove('copilot-rtl-response');
            }

            // Per-paragraph inline styles — bypasses any CSS cascade issue with
            // unicode-bidi:plaintext. setProperty('important') wins over ALL CSS.
            if (!_isStreaming) {
                var blocks = container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote');
                for (var bi = 0; bi < blocks.length; bi++) {
                    var blk = blocks[bi];
                    if (blk.closest('pre') || blk.closest('code')) { continue; }
                    if (isArabic(blk.textContent || '')) {
                        blk.style.setProperty('direction', 'rtl', 'important');
                        blk.style.setProperty('unicode-bidi', 'embed', 'important');
                        blk.style.setProperty('text-align', RTL_TEXT_ALIGN, 'important');
                        blk.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                        blk.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                        blk.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
                    } else {
                        // Keep non-Arabic items LTR even inside RTL-marked containers.
                        blk.style.setProperty('direction', 'ltr', 'important');
                        blk.style.setProperty('unicode-bidi', 'plaintext', 'important');
                        blk.style.setProperty('text-align', 'left', 'important');
                    }
                }
            }
        });

        // User messages (the whitespace-pre-wrap inside the chat bubble)
        document.querySelectorAll('.bg-gray-500\\\\/10 .whitespace-pre-wrap').forEach(function (el) {
            applyRtlStyle(el, isArabic(el.textContent || ''));
        });

        // Table cells — only process when not streaming
        if (!_isStreaming) {
            document.querySelectorAll('.leading-relaxed.select-text th, .leading-relaxed.select-text td').forEach(function (el) {
                applyRtlStyle(el, isArabic(el.textContent || ''));
            });
            document.querySelectorAll('.leading-relaxed.select-text table').forEach(function (el) {
                if (isArabic(el.textContent || '')) {
                    el.style.direction = 'rtl';
                } else {
                    el.style.direction = 'ltr';
                }
            });
        }
    }

    // ── CSS injection for response containers + Lexical input ──────────
    function injectAgentStyles() {
        if (document.getElementById('copilot-rtl-agent-styles')) return;
        var style = document.createElement('style');
        style.id = 'copilot-rtl-agent-styles';
        var css = '';

        // ──────── ALWAYS-ACTIVE response RTL (zero JS needed) ─────────
        // Directly targets response containers by selector — survives React
        // re-renders because CSS rules live in the <style> tag, not on elements.
        css += '.leading-relaxed.select-text p, .leading-relaxed.select-text li, ';
        css += '.leading-relaxed.select-text h1, .leading-relaxed.select-text h2, ';
        css += '.leading-relaxed.select-text h3, .leading-relaxed.select-text h4, ';
        css += '.leading-relaxed.select-text h5, .leading-relaxed.select-text h6 { ';
        css += 'unicode-bidi: plaintext !important; ';
        css += 'font-family: ' + RTL_FONT_FAMILY + ' !important; ';
        css += 'font-size: ' + RTL_FONT_SIZE + ' !important; ';
        css += 'line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        // Code blocks stay LTR
        css += '.leading-relaxed.select-text pre, .leading-relaxed.select-text code { ';
        css += 'direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; ';
        css += 'font-family: var(--vscode-editor-font-family, monospace) !important; ';
        css += 'font-size: var(--vscode-editor-font-size, 13px) !important; }';

        // .copilot-rtl-response is now a streaming marker only.
        // Bot response paragraphs and list items are already styled via the
        // always-active plaintext rules above, reducing flicker on lists.
        css += '.copilot-rtl-response pre, .copilot-rtl-response code { ';
        css += 'direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; ';
        css += 'font-family: var(--vscode-editor-font-family, monospace) !important; ';
        css += 'font-size: var(--vscode-editor-font-size, 13px) !important; }';

        // Lexical input
        css += '[data-lexical-editor="true"].copilot-rtl-lexical { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        css += '[data-lexical-editor="true"].copilot-rtl-lexical > p { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; line-height: ' + RTL_LINE_HEIGHT + ' !important; }';
        css += '[data-lexical-editor="true"].copilot-rtl-lexical span { font-family: ' + RTL_FONT_FAMILY + ' !important; font-size: ' + RTL_FONT_SIZE + ' !important; }';
        style.textContent = css;
        document.head.appendChild(style);
    }
    injectAgentStyles();

    // ── Input box (Lexical contenteditable) ──────────────────────────────
    // Called ONLY from user input events — never from the MutationObserver —
    // to prevent flickering while the AI streams its response.
    function processInput() {
        var editors = document.querySelectorAll('[data-lexical-editor="true"]');
        editors.forEach(function (editor) {
            var text = editor.textContent || '';
            var arabic = isArabic(text);

            editor.style.direction = '';
            editor.style.textAlign = '';

            if (arabic) {
                editor.classList.add('copilot-rtl-lexical');
                editor.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                editor.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                editor.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
            } else {
                editor.classList.remove('copilot-rtl-lexical');
                editor.style.removeProperty('font-family');
                editor.style.removeProperty('font-size');
                editor.style.removeProperty('line-height');
            }

            var children = editor.children;
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                var childArabic = isArabic(child.textContent || '');
                child.style.direction = childArabic ? 'rtl' : (arabic ? 'rtl' : 'ltr');
                child.style.textAlign = childArabic ? RTL_TEXT_ALIGN : '';
                if (arabic) {
                    child.style.setProperty('font-family', RTL_FONT_FAMILY, 'important');
                    child.style.setProperty('font-size', RTL_FONT_SIZE, 'important');
                    child.style.setProperty('line-height', RTL_LINE_HEIGHT, 'important');
                } else {
                    child.style.removeProperty('font-family');
                    child.style.removeProperty('font-size');
                    child.style.removeProperty('line-height');
                }
            }
        });
    }

    // ── Streaming stabilization ──────────────────────────────────────────
    // After the AI finishes streaming (no mutations for 400ms), mark
    // streaming as ended and do a final clean re-scan.
    var _stabilizeTimeout = null;
    function scheduleStabilize() {
        _isStreaming = true;
        if (_stabilizeTimeout) { clearTimeout(_stabilizeTimeout); }
        _stabilizeTimeout = setTimeout(function () {
            _stabilizeTimeout = null;
            _isStreaming = false;
            // Final clean re-scan — can now remove classes if needed
            processMessages();
        }, 400);
    }

    // ── Debounced observer ───────────────────────────────────────────────
    var _scanTimeout = null;
    function scheduleScan() {
        if (_scanTimeout) { clearTimeout(_scanTimeout); }
        _scanTimeout = setTimeout(function () {
            _scanTimeout = null;
            processMessages();
        }, 150);
        // Each mutation means streaming is still active; schedule stabilize
        scheduleStabilize();
    }

    function startObserver() {
        var observer = new MutationObserver(scheduleScan);
        // characterData removed — same as main script, prevents per-character
        // mutation events during AI streaming.
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        // Only scan responses here; input is handled by 'input' events
        processMessages();
    }

    // Also watch input changes directly
    function watchInputEvents() {
        document.addEventListener('input', function (e) {
            var target = e.target;
            if (target && target.closest && target.closest('[data-lexical-editor="true"]')) {
                processInput();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            startObserver();
            watchInputEvents();
        });
    } else {
        startObserver();
        watchInputEvents();
    }

    // Periodic fallback for lazy-loaded content
    // processInput() is included here (not in the observer) to pick up initial state.
    var _count = 0;
    var _timer = setInterval(function () {
        processMessages();
        processInput();
        if (++_count >= 20) { clearInterval(_timer); }
    }, 3000);

    // Initial input detection on load
    processInput();

}());
`;
}

/** The HTML snippet injected into workbench.html — just a src="" script tag, no inline code. */
function buildPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

function buildAgentPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${AGENT_PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

/** Find Antigravity's agent chat panel HTML (workbench-jetski-agent.html). */
function getAgentHtmlPath(): string | undefined {
    try {
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        const candidates: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            // Cursor uses electron-sandbox instead of electron-browser
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
        ];

        for (const candidate of candidates) {
            const normalized = path.normalize(candidate);
            if (fs.existsSync(normalized)) {
                return normalized;
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

function getWorkbenchHtmlPath(): string | undefined {
    try {
        // vscode.env.appRoot reliably points to the VS Code "resources/app" directory
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        // Each entry is [baseDir, fileName] pair — ordered most-likely-first
        const candidates: [string, string][] = [
            // VS Code 1.90+ (electron-browser layout, just "workbench.html")
            [path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            // Cursor IDE (electron-sandbox layout)
            [path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench'), 'workbench.html'],
            // Older layouts that used workbench.desktop.main.html
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.esm.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.desktop.esm.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.html'],
            // Fallbacks via process.execPath
            [path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            [path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'), 'workbench.html'],
            [path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
            [path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            [path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'), 'workbench.html'],
            [path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
        ];

        for (const [dir, fileName] of candidates) {
            const candidate = path.normalize(path.join(dir, fileName));
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    } catch {
        // ignore filesystem errors
    }
    return undefined;
}

function isPatched(content: string): boolean {
    return content.includes(MARKER_START);
}

function escapeForRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSettings(): { fontFamily: string; fontSize: number; lineHeight: number; ltrFontFamily: string; ltrFontSize: number; ltrLineHeight: number; autoInputDirection: boolean; textAlign: string } {
    const cfg = vscode.workspace.getConfiguration('copilotRtl');
    return {
        fontFamily: cfg.get<string>('fontFamily', 'vazirmatn'),
        fontSize: cfg.get<number>('fontSize', 13),
        lineHeight: cfg.get<number>('lineHeight', 1.8),
        ltrFontFamily: cfg.get<string>('ltrFontFamily', ''),
        ltrFontSize: cfg.get<number>('ltrFontSize', 0),
        ltrLineHeight: cfg.get<number>('ltrLineHeight', 0),
        autoInputDirection: cfg.get<boolean>('autoInputDirection', true),
        textAlign: cfg.get<string>('textAlign', 'justify'),
    };
}

async function enablePatch(htmlPath: string, fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): Promise<{ success: boolean; error?: string }> {
    try {
        const htmlDir = path.dirname(htmlPath);
        const jsPath = path.join(htmlDir, PATCH_JS_NAME);

        // Always write/overwrite the JS file (updates font settings)
        await fsp.writeFile(jsPath, buildScriptFileContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign), 'utf8');

        // Write state file for immediate live toggle (no reload needed)
        try { await fsp.writeFile(path.join(htmlDir, STATE_FILE_NAME), JSON.stringify({ enabled: true }), 'utf8'); } catch { /* ignore */ }

        let content = await fsp.readFile(htmlPath, 'utf8');
        const version = Date.now();
        const patch = buildPatchContent(version);

        // Remove existing patch first (handles re-enable after settings update)
        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
        } else {
            // Create a backup only on first-time install
            const backupPath = `${htmlPath}.bak-copilot-rtl`;
            if (!fs.existsSync(backupPath)) {
                await fsp.writeFile(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        await fsp.writeFile(htmlPath, content, 'utf8');

        // Also patch the Antigravity agent panel if it exists
        await enableAgentPatch(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function enableAgentPatch(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): Promise<{ success: boolean; error?: string }> {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return { success: false, error: 'Agent HTML not found' }; }

    try {
        const htmlDir = path.dirname(agentPath);
        const jsPath = path.join(htmlDir, AGENT_PATCH_JS_NAME);

        // Write the agent-specific JS
        await fsp.writeFile(jsPath, buildAgentScriptContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign), 'utf8');

        let content = await fsp.readFile(agentPath, 'utf8');
        const version = Date.now();
        const patch = buildAgentPatchContent(version);

        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
        } else {
            const backupPath = `${agentPath}.bak-copilot-rtl`;
            if (!fs.existsSync(backupPath)) {
                await fsp.writeFile(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        await fsp.writeFile(agentPath, content, 'utf8');
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function disablePatch(htmlPath: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Write state file first — running script sees it within 1.5s and shuts down (no reload needed)
        try { await fsp.writeFile(path.join(path.dirname(htmlPath), STATE_FILE_NAME), JSON.stringify({ enabled: false }), 'utf8'); } catch { /* ignore */ }

        let content = await fsp.readFile(htmlPath, 'utf8');

        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            await fsp.writeFile(htmlPath, content, 'utf8');
        }

        // Remove the JS file if it exists
        const jsPath = path.join(path.dirname(htmlPath), PATCH_JS_NAME);
        try { await fsp.unlink(jsPath); } catch { /* file may not exist */ }

        // Also clean up the agent panel
        await disableAgentPatch();

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function disableAgentPatch(): Promise<void> {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return; }

    try {
        let content = await fsp.readFile(agentPath, 'utf8');
        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            await fsp.writeFile(agentPath, content, 'utf8');
        }
        const jsPath = path.join(path.dirname(agentPath), AGENT_PATCH_JS_NAME);
        try { await fsp.unlink(jsPath); } catch { /* file may not exist */ }
    } catch {
        // ignore
    }
}

async function promptReload(message: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(message, 'Reload Now');
    if (action === 'Reload Now') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const userDisabled = context.globalState.get<boolean>(STATE_KEY_DISABLED, false);

    // ── Auto-enable on first activation ──────────────────────────────────────
    const htmlPath = getWorkbenchHtmlPath();
    if (htmlPath) {
        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            if (!isPatched(content)) {
                // Only auto-enable if the user hasn't explicitly disabled it
                if (!userDisabled) {
                    const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                    const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                    if (result.success) {
                        promptReload('Copilot RTL installed and enabled automatically. Reload to apply.');
                    }
                }
            } else {
                // Already patched — fully re-patch (HTML + JS) so extension updates
                // take effect. enablePatch() removes the old patch and adds a new one
                // with a fresh ?v=timestamp, ensuring the browser loads the latest JS.
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                try {
                    await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                } catch {
                    // ignore — user can still use the manual enable command
                }
            }
        } catch {
            // If we can't read/write, the user can still use the manual command
        }
    }

    // ── Status bar toggle button ─────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'copilot-rtl.toggle';
    statusBarItem.tooltip = 'Click to toggle Copilot RTL on/off';
    statusBarItem.show();

    async function updateStatusBar(): Promise<void> {
        const hp = getWorkbenchHtmlPath();
        if (!hp) {
            statusBarItem.text = '$(globe) RTL ❌';
            return;
        }
        try {
            const content = await fsp.readFile(hp, 'utf8');
            if (isPatched(content)) {
                statusBarItem.text = '$(globe) RTL ✅';
                statusBarItem.backgroundColor = undefined;
            } else {
                statusBarItem.text = '$(globe) RTL ❌';
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        } catch {
            statusBarItem.text = '$(globe) RTL ⚠️';
        }
    }

    // Set initial status
    updateStatusBar();

    // ── Toggle command ──────────────────────────────────────────────────────
    const toggleCmd = vscode.commands.registerCommand('copilot-rtl.toggle', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            const currentlyEnabled = isPatched(content);

            if (currentlyEnabled) {
                // Disable
                const result = await disablePatch(htmlPath);
                if (result.success) {
                    await context.globalState.update(STATE_KEY_DISABLED, true);
                    await updateStatusBar();
                    vscode.window.showInformationMessage('Copilot RTL disabled.');
                } else {
                    vscode.window.showErrorMessage(
                        `Copilot RTL: Failed to disable — ${result.error}. Try running VS Code as Administrator.`
                    );
                }
            } else {
                // Enable
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                if (result.success) {
                    await context.globalState.update(STATE_KEY_DISABLED, false);
                    await updateStatusBar();
                    vscode.window.showInformationMessage('Copilot RTL enabled.');
                } else {
                    vscode.window.showErrorMessage(
                        `Copilot RTL: Failed to enable — ${result.error}. Try running VS Code as Administrator.`
                    );
                }
            }
        } catch {
            vscode.window.showErrorMessage('Copilot RTL: Could not read workbench HTML file.');
        }
    });

    // ── Enable command ──────────────────────────────────────────────────────
    const enableCmd = vscode.commands.registerCommand('copilot-rtl.enable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
        const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
        if (result.success) {
            await context.globalState.update(STATE_KEY_DISABLED, false);
            await updateStatusBar();
            vscode.window.showInformationMessage('Copilot RTL enabled.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to enable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    // ── Disable command ─────────────────────────────────────────────────────
    const disableCmd = vscode.commands.registerCommand('copilot-rtl.disable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const result = await disablePatch(htmlPath);
        if (result.success) {
            await context.globalState.update(STATE_KEY_DISABLED, true);
            await updateStatusBar();
            vscode.window.showInformationMessage('Copilot RTL disabled.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to disable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    // ── Status command ──────────────────────────────────────────────────────
    const statusCmd = vscode.commands.registerCommand('copilot-rtl.status', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showWarningMessage(
                `Copilot RTL: Could not find workbench HTML file. appRoot=${vscode.env.appRoot}`
            );
            return;
        }

        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            const enabled = isPatched(content);
            vscode.window.showInformationMessage(
                `Copilot RTL is currently ${enabled ? '✅ ENABLED' : '❌ DISABLED'}.`
            );
        } catch {
            vscode.window.showErrorMessage('Copilot RTL: Could not read workbench HTML file.');
        }
    });

    // Re-apply patch automatically when the user changes font settings
    const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (!e.affectsConfiguration('copilotRtl')) { return; }
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) { return; }
        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            if (!isPatched(content)) { return; }  // only update if already enabled
        } catch { return; }
        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
        const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
        if (result.success) {
            await updateStatusBar();
            await promptReload('Copilot RTL: Settings updated. Reload to apply.');
        }
    });

    context.subscriptions.push(toggleCmd, enableCmd, disableCmd, statusCmd, statusBarItem, configListener);
}

export function deactivate(): void { }
